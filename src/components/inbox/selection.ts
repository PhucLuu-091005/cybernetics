import { z } from 'zod';
import { IdSchema, isUtf16Boundary } from '../../contracts/primitives';
import type { QuotedRange } from '../../contracts/records';

export const MAX_QUOTE = 400;
export type Citation = { recordVersionId: string; start: number; end: number; quote: string };
export type Segment = { start: number; end: number; quoted: boolean };

const COMBINING = /\p{M}/u;
const splitsCharacter = (body: string, offset: number) =>
  !isUtf16Boundary(body, offset) ||
  (offset > 0 && offset < body.length && COMBINING.test(body[offset]));

/** Offsets are UTF-16 code units, the same unit the server validates citations in. */
export function selectionToCitation(
  body: string,
  domStart: number,
  domEnd: number,
  quotedRanges: QuotedRange[],
): { start: number; end: number; quote: string } | { error: string } {
  let start = Math.min(domStart, domEnd),
    end = Math.max(domStart, domEnd);
  if (start < 0 || end > body.length)
    return { error: 'The selection falls outside the record text.' };
  if (splitsCharacter(body, start) || splitsCharacter(body, end))
    return { error: 'The selection must not split a character.' };
  while (start < end && /\s/.test(body[start])) start++;
  while (end > start && /\s/.test(body[end - 1])) end--;
  if (start === end) return { error: 'Select some text to cite.' };
  if (end - start > MAX_QUOTE)
    return {
      error: `A quote can be at most ${MAX_QUOTE} characters. This selection has ${end - start}.`,
    };
  if (quotedRanges.some((range) => start < range.end && end > range.start))
    return { error: 'Quoted text from earlier messages cannot be cited.' };
  return { start, end, quote: body.slice(start, end) };
}

/** Overlapping quoted ranges merge, so every body offset belongs to exactly one rendered text node. */
export function segmentBody(body: string, quotedRanges: QuotedRange[]): Segment[] {
  const merged: QuotedRange[] = [];
  for (const range of [...quotedRanges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: Math.min(range.end, body.length) });
  }
  const segments: Segment[] = [];
  let at = 0;
  for (const range of merged) {
    if (range.start > at) segments.push({ start: at, end: range.start, quoted: false });
    if (range.end > range.start)
      segments.push({ start: range.start, end: range.end, quoted: true });
    at = range.end;
  }
  if (at < body.length) segments.push({ start: at, end: body.length, quoted: false });
  return segments;
}

const CiteSchema = z
  .strictObject({
    recordVersionId: IdSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(MAX_QUOTE),
  })
  .refine(
    (value) => value.end - value.start === value.quote.length,
    'Quote length must match the offsets',
  );
/** The `cite` search parameter hands a selection to the proposal editor. */
export const formatCite = (citation: Citation): string => JSON.stringify(citation);
export function parseCite(value: string | null | undefined): Citation | null {
  if (!value) return null;
  try {
    const parsed = CiteSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
