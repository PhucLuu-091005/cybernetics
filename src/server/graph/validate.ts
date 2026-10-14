import type { z } from 'zod';
import {
  GraphSnapshotSchema,
  isUtf16Boundary,
  utf8Bytes,
  type Act,
  type Citation,
  type FieldError,
  type GraphSnapshot,
  type Party,
} from '../../contracts';
import type { EvidenceRecord } from '../domain/records/metadata';
import { referenceErrors } from './references';

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024,
  MAX_RECORD_VERSIONS = 1000,
  MAX_QUOTE = 400;
const issueError = (issue: z.core.$ZodIssue): FieldError => ({
  path: issue.path.join('.'),
  message: issue.message,
});

export function citedVersionIds(snapshot: GraphSnapshot): string[] {
  return [
    ...new Set([
      ...snapshot.acts.map((act) => act.citation.recordVersionId),
      ...snapshot.recordDecisions.map((decision) => decision.recordVersionId),
    ]),
  ].sort();
}

/** SRD 6.1 caps answer LIMIT_EXCEEDED, so callers check them before the VALIDATION pass. */
export function snapshotLimitErrors(snapshot: GraphSnapshot): FieldError[] {
  const parsed = GraphSnapshotSchema.safeParse(snapshot);
  const errors = parsed.success
    ? []
    : parsed.error.issues
        .filter((issue) => issue.code === 'too_big' && issue.origin === 'array')
        .map(issueError);
  if (citedVersionIds(snapshot).length > MAX_RECORD_VERSIONS)
    errors.push({
      path: 'recordDecisions',
      message: `Snapshot references more than ${MAX_RECORD_VERSIONS} record versions`,
    });
  // Measured directly because zod skips the schema's size and version refinements once an array cap fails.
  if (utf8Bytes(JSON.stringify(snapshot)) > MAX_SNAPSHOT_BYTES)
    errors.push({
      path: 'snapshot',
      message: `Snapshot JSON exceeds ${MAX_SNAPSHOT_BYTES} UTF-8 bytes`,
    });
  return errors;
}

const sameCitation = (a: Citation, b: Citation) =>
  a.recordVersionId === b.recordVersionId && a.start === b.start && a.end === b.end;
/** A withdrawal must not freeze the graph: an act carried unchanged from the baseline may keep its withdrawn citation so it can be hidden, edited or reconciled. */
const carriedActs = (baseline: GraphSnapshot | undefined) =>
  new Map((baseline?.acts ?? []).map((act) => [act.id, act.citation]));
const isCarried = (act: Act, carried: Map<string, Citation>) => {
  const citation = carried.get(act.id);
  return citation !== undefined && sameCitation(citation, act.citation);
};

function citationError(
  act: Act,
  evidence: Map<string, EvidenceRecord>,
  carried: boolean,
): string | null {
  const { recordVersionId, start, end } = act.citation,
    record = evidence.get(recordVersionId);
  if (!record) return `Citation cites unknown record version ${recordVersionId}`;
  if (record.withdrawn || record.bodyText === null)
    return carried ? null : `Citation cites withdrawn record version ${recordVersionId}`;
  if (end > record.bodyText.length) return 'Citation offsets fall outside the record body';
  if (!isUtf16Boundary(record.bodyText, start) || !isUtf16Boundary(record.bodyText, end))
    return 'Citation offsets must fall on UTF-16 boundaries';
  if (record.quotedRanges.some((range) => start < range.end && end > range.start))
    return 'Citation overlaps a quoted range of earlier messages';
  return null;
}

export function validateSnapshot(
  snapshot: GraphSnapshot,
  evidence: Map<string, EvidenceRecord>,
  baseline?: GraphSnapshot,
): FieldError[] {
  const parsed = GraphSnapshotSchema.safeParse(snapshot);
  // Semantic checks assume a well-formed snapshot.
  if (!parsed.success) return parsed.error.issues.map(issueError);
  const errors: FieldError[] = referenceErrors(snapshot).map((error) => ({
    path: `${error.collection}.${error.id}`,
    message: error.message,
  }));
  const people = new Map(snapshot.context.people.map((person) => [person.id, person])),
    carried = carriedActs(baseline);
  const party = (act: Act, field: 'actor' | 'customer' | 'performer', value: Party) => {
    if (value.kind === 'person' && people.get(value.personId)?.side === 'unknown')
      errors.push({
        path: `acts.${act.id}.${field}`,
        message: `Person ${value.personId} must be on the client or vendor side`,
      });
  };
  for (const act of snapshot.acts) {
    party(act, 'actor', act.actor);
    party(act, 'customer', act.customer);
    party(act, 'performer', act.performer);
    const message = citationError(act, evidence, isCarried(act, carried));
    if (message) errors.push({ path: `acts.${act.id}.citation`, message });
  }
  const visible = new Set(
    snapshot.acts.filter((act) => !act.hidden).map((act) => act.citation.recordVersionId),
  );
  for (const { recordVersionId: id, disposition } of snapshot.recordDecisions) {
    const path = `recordDecisions.${id}`;
    if (!evidence.has(id))
      errors.push({ path, message: `Decision cites unknown record version ${id}` });
    if (disposition === 'included' && !visible.has(id))
      errors.push({
        path,
        message: `Record version ${id} is included but has no visible act citing it`,
      });
    if (disposition === 'ignored' && visible.has(id))
      errors.push({
        path,
        message: `Record version ${id} is ignored but has a visible act citing it`,
      });
  }
  return errors;
}

export function verifyQuote(
  act: Act,
  quote: string,
  evidence: Map<string, EvidenceRecord>,
  baseline?: GraphSnapshot,
): FieldError | null {
  const path = `acts.${act.id}.quote`,
    { recordVersionId, start, end } = act.citation,
    record = evidence.get(recordVersionId);
  if (quote.length > MAX_QUOTE)
    return { path, message: `Quote must be at most ${MAX_QUOTE} characters` };
  if (!record) return { path, message: `Quote cites unknown record version ${recordVersionId}` };
  if (record.withdrawn || record.bodyText === null)
    return isCarried(act, carriedActs(baseline))
      ? null
      : { path, message: `Quote cites withdrawn record version ${recordVersionId}` };
  if (record.bodyText.slice(start, end) !== quote)
    return { path, message: 'Quote does not match the cited text' };
  return null;
}
