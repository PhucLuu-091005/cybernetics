import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  ReadRecordChunkInputSchema,
  isUtf16Boundary,
  type ActorContext,
  type RecordChunk,
} from '../../../contracts';
import { buildRecordHeader } from '../../../lib/record-header';
import { AppError } from '../../errors';
import { recordVersions, records } from '../../db/schema';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { invalid, mainTimeZone, toRecordVersion } from './metadata';

const CursorSchema = z.strictObject({ v: z.uuid(), o: z.number().int().nonnegative() });
const encodeCursor = (versionId: string, offset: number) =>
  Buffer.from(JSON.stringify({ v: versionId, o: offset })).toString('base64url');
function decodeCursor(cursor: string, versionId: string, body: string): number {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    decoded = null;
  }
  const parsed = CursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.v !== versionId || !isUtf16Boundary(body, parsed.data.o))
    throw new AppError('VALIDATION', 'Cursor does not belong to this record version');
  return parsed.data.o;
}

async function loadVersion(db: Db, ctx: ActorContext, projectId: string, recordVersionId: string) {
  const project = await requireProject(db, ctx, projectId);
  const [row] = await db
    .select({ version: recordVersions, withdrawnAt: records.withdrawnAt })
    .from(recordVersions)
    .innerJoin(
      records,
      and(eq(records.projectId, recordVersions.projectId), eq(records.id, recordVersions.recordId)),
    )
    .where(and(eq(recordVersions.projectId, project.id), eq(recordVersions.id, recordVersionId)))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Record version not found');
  const version = toRecordVersion(row.version, row.withdrawnAt !== null);
  return {
    project,
    version,
    header: buildRecordHeader(version, { timeZone: await mainTimeZone(db, project) }),
  };
}

export async function readRecordChunk(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ReadRecordChunkInputSchema>,
): Promise<RecordChunk> {
  requireScope(ctx, 'project:read');
  const parsed = ReadRecordChunkInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid record read', parsed.error);
  const input = parsed.data;
  const { project, version, header } = await loadVersion(
    db,
    ctx,
    input.projectId,
    input.recordVersionId,
  );
  const { bodyText: body, ...metadata } = version;
  const start = input.cursor == null ? 0 : decodeCursor(input.cursor, version.id, body);
  let end = Math.min(start + input.limit, body.length);
  // With limit 1 at a surrogate pair, stepping back would return nothing forever; the whole pair is the smallest valid chunk.
  if (end < body.length && !isUtf16Boundary(body, end)) end = end - 1 > start ? end - 1 : end + 1;
  return {
    projectId: project.id,
    recordVersionId: version.id,
    digest: version.digest,
    start,
    end,
    text: body.slice(start, end),
    nextCursor: end < body.length ? encodeCursor(version.id, end) : null,
    totalLength: body.length,
    withdrawn: version.withdrawn,
    header,
    metadata,
    requestId: ctx.requestId,
  };
}

const ReadRecordTextInputSchema = ReadRecordChunkInputSchema.pick({
  projectId: true,
  recordVersionId: true,
});
export type RecordText = Omit<RecordChunk, 'start' | 'end' | 'nextCursor'>;
/** Browser viewer only: it maps a selection to absolute offsets, so it needs the whole body, which the ingest contract caps at 64 KiB. */
export async function readRecordText(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ReadRecordTextInputSchema>,
): Promise<RecordText> {
  requireScope(ctx, 'project:read');
  const parsed = ReadRecordTextInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid record read', parsed.error);
  const { project, version, header } = await loadVersion(
    db,
    ctx,
    parsed.data.projectId,
    parsed.data.recordVersionId,
  );
  const { bodyText: text, ...metadata } = version;
  return {
    projectId: project.id,
    recordVersionId: version.id,
    digest: version.digest,
    text,
    totalLength: text.length,
    withdrawn: version.withdrawn,
    header,
    metadata,
    requestId: ctx.requestId,
  };
}
