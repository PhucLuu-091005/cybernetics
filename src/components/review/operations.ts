import type { Act, ActType, DerivedAct, GraphOperation, GraphSnapshot, Loop, Party, QuotedRange, RecordDecision } from '../../contracts';
import { isUtf16Boundary } from '../../contracts/primitives';

export const MAX_QUOTE = 400;
type Disposition = RecordDecision['disposition'];

/** Parties travel through <select> values: a person ID, or `side:client` / `side:vendor`. */
export type ActForm = {
  id: string; type: ActType; actor: string; customer: string; performer: string; action: string;
  dueDate: string; duePrecision: 'day' | 'week' | 'month'; hedged: boolean; loopId: string | null; hidden: boolean;
  origin: Act['origin']; confidence: number | null;
  /** The cited version's decision in the draft before this save. */
  decision: Disposition | null;
};
export type QuotedCitation = { recordVersionId: string; start: number; end: number; quote: string };

export const partyValue = (party: Party): string => party.kind === 'side' ? `side:${party.side}` : party.personId;
export function partyFromValue(value: string): Party {
  if (value === 'side:client' || value === 'side:vendor') return { kind: 'side', side: value === 'side:client' ? 'client' : 'vendor' };
  return { kind: 'person', personId: value };
}

/** A visible act citing a record makes it included; an ignored record would otherwise fail validation, so it is included too. */
export function buildActOperations(form: ActForm, citation: QuotedCitation): GraphOperation[] {
  const value: Act = {
    id: form.id, citation: { recordVersionId: citation.recordVersionId, start: citation.start, end: citation.end }, type: form.type,
    actor: partyFromValue(form.actor), customer: partyFromValue(form.customer), performer: partyFromValue(form.performer), action: form.action.trim(),
    due: form.dueDate ? { date: form.dueDate, precision: form.duePrecision } : null, hedged: form.hedged, loopId: form.loopId, hidden: form.hidden,
    origin: form.origin, confidence: form.confidence,
  };
  const operations: GraphOperation[] = [{ op: 'put', collection: 'acts', value, quote: citation.quote }];
  if (!form.hidden && form.decision !== 'included') operations.push({ op: 'put', collection: 'recordDecisions', value: { recordVersionId: citation.recordVersionId, disposition: 'included', reason: '' } });
  return operations;
}

export function actToForm(act: Act, decision: Disposition | null): ActForm {
  return {
    id: act.id, type: act.type, actor: partyValue(act.actor), customer: partyValue(act.customer), performer: partyValue(act.performer), action: act.action,
    dueDate: act.due?.date ?? '', duePrecision: act.due?.precision ?? 'day', hedged: act.hedged, loopId: act.loopId, hidden: act.hidden, origin: act.origin, confidence: act.confidence, decision,
  };
}

export function toAct(derived: DerivedAct | Act): Act {
  const { id, citation, type, actor, customer, performer, action, due, hedged, loopId, hidden, origin, confidence } = derived;
  return { id, citation, type, actor, customer, performer, action, due, hedged, loopId, hidden, origin, confidence };
}

/** Mirrors the server's citation rules so the editor reports a problem before the save does. */
export function checkCitation(text: string, quotedRanges: readonly QuotedRange[], start: number, end: number): { ok: true; quote: string } | { ok: false; message: string } {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length) return { ok: false, message: 'The offsets fall outside the record text.' };
  if (end <= start) return { ok: false, message: 'The end offset must follow the start offset.' };
  if (end - start > MAX_QUOTE) return { ok: false, message: `A quote can be at most ${MAX_QUOTE} characters. This one has ${end - start}.` };
  if (!isUtf16Boundary(text, start) || !isUtf16Boundary(text, end)) return { ok: false, message: 'The offsets must not split a character.' };
  if (quotedRanges.some(range => start < range.end && end > range.start)) return { ok: false, message: 'The quote overlaps quoted text from an earlier message.' };
  return { ok: true, quote: text.slice(start, end) };
}

const putAct = (act: Act, quote: string): GraphOperation => ({ op: 'put', collection: 'acts', value: act, quote });
export const changeActType = (act: Act, quote: string, type: ActType): GraphOperation[] => [putAct({ ...act, type }, quote)];
export const moveAct = (act: Act, quote: string, loopId: string | null): GraphOperation[] => [putAct({ ...act, loopId }, quote)];
export const setLoopMilestone = (loop: Loop, milestoneId: string | null): GraphOperation[] => [{ op: 'put', collection: 'loops', value: { ...loop, milestoneId } }];

/** An included record needs a visible citing act, so hiding its last one returns the record to pending review. */
export function hideAct(act: Act, quote: string, snapshot: Pick<GraphSnapshot, 'acts' | 'recordDecisions'>): GraphOperation[] {
  const versionId = act.citation.recordVersionId;
  const stillCited = snapshot.acts.some(other => other.id !== act.id && !other.hidden && other.citation.recordVersionId === versionId);
  const included = snapshot.recordDecisions.some(decision => decision.recordVersionId === versionId && decision.disposition === 'included');
  return [putAct({ ...act, hidden: true }, quote), ...(included && !stillCited ? [{ op: 'remove', collection: 'recordDecisions', id: versionId } as const] : [])];
}
