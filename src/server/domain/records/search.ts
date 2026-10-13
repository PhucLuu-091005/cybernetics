import { and, desc, eq, gt, ilike, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { SearchRecordsInputSchema, isUtf16Boundary, type ActorContext, type SearchRecordsResult } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { recordVersions, records } from '../../db/schema';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { invalid } from './metadata';
import { foldForSearch } from './normalize';

const EXCERPT = 1000, LEAD = 300;
const CursorSchema = z.strictObject({ f: z.string(), o: z.number().int().nonnegative() });
function decodeCursor(cursor: string, filters: string): number {
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { decoded = null; }
  const parsed = CursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.f !== filters) throw new AppError('VALIDATION', 'Cursor does not belong to this search');
  return parsed.data.o;
}
/** Offsets from the folded body index the original body only while folding keeps the UTF-16 length; otherwise show the title. */
function excerptFor(title: string, body: string, foldedQuery: string): { excerpt: string; start: number; end: number } {
  const foldedBody = foldForSearch(body);
  if (foldedBody.length !== body.length) return { excerpt: title, start: 0, end: 0 };
  let start = Math.max(0, foldedBody.indexOf(foldedQuery) - LEAD), end = Math.min(body.length, start + EXCERPT);
  if (!isUtf16Boundary(body, start)) start += 1;
  if (!isUtf16Boundary(body, end)) end -= 1;
  return { excerpt: body.slice(start, end), start, end };
}

export async function searchRecords(db: Db, ctx: ActorContext, raw: z.input<typeof SearchRecordsInputSchema>): Promise<SearchRecordsResult> {
  requireScope(ctx, 'project:read');
  const parsed = SearchRecordsInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid record search', parsed.error);
  const input = parsed.data;
  const project = await requireProject(db, ctx, input.projectId);
  const folded = foldForSearch(input.query), pattern = `%${folded.replace(/[\\%_]/g, match => `\\${match}`)}%`;
  const filters = canonicalHash({ projectId: project.id, query: input.query, source: input.source ?? null, after: input.after ?? null, before: input.before ?? null });
  const offset = input.cursor ? decodeCursor(input.cursor, filters) : 0;
  const rows = await db.select({ id: recordVersions.id, recordId: recordVersions.recordId, title: recordVersions.title, bodyText: recordVersions.bodyText, withdrawnAt: records.withdrawnAt }).from(recordVersions)
    .innerJoin(records, and(eq(records.projectId, recordVersions.projectId), eq(records.currentVersionId, recordVersions.id)))
    .where(and(
      eq(recordVersions.projectId, project.id),
      input.source ? eq(recordVersions.source, input.source) : undefined,
      input.after ? gt(recordVersions.occurredAt, input.after) : undefined,
      input.before ? lt(recordVersions.occurredAt, input.before) : undefined,
      // A withdrawn body must not answer queries, so withdrawn records match on their title only.
      or(and(isNull(records.withdrawnAt), ilike(recordVersions.searchText, pattern)), and(isNotNull(records.withdrawnAt), ilike(recordVersions.searchTitle, pattern))),
    ))
    .orderBy(desc(recordVersions.occurredAt), desc(recordVersions.createdAt), desc(recordVersions.id)).limit(input.limit + 1).offset(offset);
  const page = rows.slice(0, input.limit);
  return {
    projectId: project.id, evidenceRevision: project.evidenceRevision, requestId: ctx.requestId,
    items: page.map(row => {
      const withdrawn = row.withdrawnAt !== null;
      return { recordVersionId: row.id, recordId: row.recordId, title: row.title, withdrawn, ...(withdrawn ? { excerpt: '', start: 0, end: 0 } : excerptFor(row.title, row.bodyText, folded)) };
    }),
    nextCursor: rows.length > input.limit ? Buffer.from(JSON.stringify({ f: filters, o: offset + input.limit })).toString('base64url') : null,
  };
}
