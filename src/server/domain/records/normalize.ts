import { isUtf16Boundary, type Alias, type FieldError, type QuotedRange, type RecordInput, type RecordVersion } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { zonedStartOfDay } from '../../../lib/calendar';
import { AppError } from '../../errors';

type NormalizedAlias = { name: string; email: string | null; slackUserId: string | null };
export type NormalizedRecord = {
  externalId: string | null; threadExternalId: string | null; parentExternalId: string | null; sourceLabel: string;
  title: string; bodyText: string; occurredAt: string; occurredDate: string | null; occurredTimeZone: string | null; timePrecision: RecordVersion['timePrecision'];
  author: NormalizedAlias; recipients: NormalizedAlias[]; quotedRanges: QuotedRange[]; attachmentNames: string[]; permalink: string | null;
};
const text = (value: string) => value.replaceAll('\r\n', '\n').normalize('NFC');
const alias = (value: Alias): NormalizedAlias => ({ name: value.name.normalize('NFC'), email: value.email ?? null, slackUserId: value.slackUserId ?? null });

/** Callers quote the raw body; a boundary maps only when each side normalizes alone to the same text, so it never splits a CRLF pair or a combining sequence. */
function remapOffset(raw: string, body: string, offset: number): number | null {
  if (!isUtf16Boundary(raw, offset)) return null;
  const before = text(raw.slice(0, offset));
  return before + text(raw.slice(offset)) === body ? before.length : null;
}
export function normalizeRecord(input: RecordInput, timeZone: string): NormalizedRecord {
  const bodyText = text(input.bodyText), quotedRanges: QuotedRange[] = [], errors: FieldError[] = [];
  (input.quotedRanges ?? []).forEach((range, index) => {
    const start = remapOffset(input.bodyText, bodyText, range.start), end = remapOffset(input.bodyText, bodyText, range.end);
    if (start === null || end === null || start >= end) errors.push({ path: `quotedRanges.${index}`, message: 'Range boundary must not split a line break or a combining sequence' });
    else quotedRanges.push({ start, end });
  });
  if (errors.length) throw new AppError('VALIDATION', 'Quoted ranges do not map onto the normalized body', { errors });
  const time = input.occurredDate !== undefined
    ? { occurredAt: zonedStartOfDay(input.occurredDate, timeZone), occurredDate: input.occurredDate, occurredTimeZone: timeZone, timePrecision: 'day' as const }
    : { occurredAt: new Date(input.occurredAt!).toISOString(), occurredDate: null, occurredTimeZone: null, timePrecision: 'instant' as const };
  return {
    externalId: input.externalId ?? null, threadExternalId: input.threadExternalId ?? null, parentExternalId: input.parentExternalId ?? null, sourceLabel: input.sourceLabel,
    title: text(input.title), bodyText, ...time, author: alias(input.author), recipients: input.recipients.map(alias), quotedRanges, attachmentNames: [...(input.attachmentNames ?? [])], permalink: input.permalink ?? null,
  };
}
/** External id and source label identify where a record came from, not what it says, so they stay out of the digest. */
export function recordDigest(n: NormalizedRecord): string {
  return canonicalHash({ bodyText: n.bodyText, author: n.author, recipients: n.recipients, title: n.title, occurredAt: n.occurredAt, occurredDate: n.occurredDate, occurredTimeZone: n.occurredTimeZone, timePrecision: n.timePrecision, threadExternalId: n.threadExternalId, parentExternalId: n.parentExternalId, quotedRanges: n.quotedRanges, attachmentNames: n.attachmentNames, permalink: n.permalink });
}
export { foldForSearch } from '../../../lib/search';
