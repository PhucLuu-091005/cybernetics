import { z } from 'zod';
import { RevisionSchema, TimestampSchema, utf8Bytes } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';

export const MAX_PAGE_BYTES = 50_000;
const CursorSchema = z.strictObject({ view: z.string(), T: TimestampSchema.optional(), o: RevisionSchema });
export type PageCursor = z.infer<typeof CursorSchema>;

/** Binds a cursor to the project, the immutable commit or proposal revision, and every filter. */
export const viewKey = (binding: Record<string, unknown>) => canonicalHash(binding);
export const encodeCursor = (cursor: PageCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
export function decodeCursor(raw: string | null | undefined, view: string): PageCursor | null {
  if (raw == null) return null;
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); }
  catch { decoded = null; }
  const parsed = CursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.view !== view) throw new AppError('VALIDATION', 'Cursor does not belong to this view');
  return parsed.data;
}

/**
 * Takes items from `offset` while the page stays within the item limit and the byte budget.
 * `envelope` is the page with no items and a worst-case cursor; each item adds its JSON plus one separator.
 */
export function takePage<I>(items: readonly I[], offset: number, limit: number, envelope: unknown): { taken: I[]; next: number | null } {
  let used = utf8Bytes(JSON.stringify(envelope));
  const taken: I[] = [];
  for (const item of items.slice(offset, offset + limit)) {
    used += utf8Bytes(JSON.stringify(item)) + 1;
    if (used > MAX_PAGE_BYTES) {
      if (!taken.length) throw new AppError('LIMIT_EXCEEDED', 'One item exceeds the 50,000-character page limit; read it on its own');
      break;
    }
    taken.push(item);
  }
  return { taken, next: offset + taken.length < items.length ? offset + taken.length : null };
}
