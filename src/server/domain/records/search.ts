import { and, desc, eq, gt, ilike, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { SearchRecordsInputSchema, SearchRecordsResultSchema, boundedJson, isUtf16Boundary, utf8Bytes, type ActorContext, type SearchRecordsResult } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { recordVersions, records } from '../../db/schema';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { invalid } from './metadata';
import { foldForSearch } from './normalize';

const EXCERPT = 1000, LEAD = 300, MAX_RESULT_BYTES = 50_000;
const BoundedResultSchema = boundedJson(SearchRecordsResultSchema, MAX_RESULT_BYTES);
const encodeCursor = (filters: string, offset: number) => Buffer.from(JSON.stringify({ f: filters, o: offset })).toString('base64url');
const CursorSchema = z.strictObject({ f: z.string(), o: z.number().int().nonnegative() });
function decodeCursor(cursor: string, filters: string): number {
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { decoded = null; }
  const parsed = CursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.f !== filters) throw new AppError('VALIDATION', 'Cursor does not belong to this search');
  return parsed.data.o;
}
// start/end index the body only when the excerpt comes from the body; a title excerpt carries 0/0.
function excerptFor(title: string, body: string, foldedQuery: string): { excerpt: string; start: number; end: number } {
  const foldedBody = foldForSearch(body), at = foldedBody.indexOf(foldedQuery);
  // Folded offsets locate the original text only while folding keeps the UTF-16 length.
  if (foldedBody.length !== body.length || at < 0) return { excerpt: title, start: 0, end: 0 };
  let start = Math.max(0, at - LEAD), end = Math.min(body.length, start + EXCERPT);
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
  const offset = input.cursor == null ? 0 : decodeCursor(input.cursor, filters);
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
  const result: SearchRecordsResult = { projectId: project.id, evidenceRevision: project.evidenceRevision, items: [], nextCursor: null, requestId: ctx.requestId };
  for (const row of rows.slice(0, input.limit)) {
    const withdrawn = row.withdrawnAt !== null;
    const item = { recordVersionId: row.id, recordId: row.recordId, title: row.title, withdrawn, ...(withdrawn ? { excerpt: '', start: 0, end: 0 } : excerptFor(row.title, row.bodyText, folded)) };
    // Measure with a cursor present so adding it afterwards cannot push the page over the limit.
    if (result.items.length && utf8Bytes(JSON.stringify({ ...result, items: [...result.items, item], nextCursor: encodeCursor(filters, offset + result.items.length + 1) })) > MAX_RESULT_BYTES) break;
    result.items.push(item);
  }
  if (result.items.length < rows.length) result.nextCursor = encodeCursor(filters, offset + result.items.length);
  if (!BoundedResultSchema.safeParse(result).success) throw new AppError('INTERNAL', 'Search page exceeds the response limit');
  return result;
}
