import { z } from 'zod';
import { RevisionSchema } from '../../contracts';
import { canonicalHash } from '../../lib/canonical-json';
import { AppError } from '../errors';

const CursorSchema = z.strictObject({ view: z.string(), o: RevisionSchema });
export type PageCursor = z.infer<typeof CursorSchema>;

/** Binds a cursor to the listing it came from, so a cursor from another project or user fails. */
export const viewKey = (binding: Record<string, unknown>) => canonicalHash(binding);
export const encodeCursor = (cursor: PageCursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');
export function decodeCursor(raw: string | null | undefined, view: string): PageCursor | null {
  if (raw == null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    decoded = null;
  }
  const parsed = CursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.view !== view)
    throw new AppError('VALIDATION', 'Cursor does not belong to this view');
  return parsed.data;
}
