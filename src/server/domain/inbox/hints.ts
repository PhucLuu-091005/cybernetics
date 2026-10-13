import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../../contracts';
import { AppError } from '../../errors';
import { recordVersions, records } from '../../db/schema';
import type { Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { invalid } from '../records/metadata';

const GetInboxHintsInputSchema = z.strictObject({ projectId: IdSchema, recordVersionId: IdSchema });
export type GetInboxHintsInput = z.input<typeof GetInboxHintsInputSchema>;
export type InboxHint = { kind: 'thread' | 'parent' | 'author'; recordVersionId: string; reason: string };
const v = recordVersions, r = records;
const MAX_THREAD_HINTS = 40, MAX_AUTHOR_HINTS = 9;

/** Read-only candidates from source identifiers and exact author aliases (SRD 8.1); hints point at current versions and never touch the graph. */
export async function getInboxHints(db: Db, ctx: ActorContext, raw: GetInboxHintsInput): Promise<InboxHint[]> {
  requireScope(ctx, 'project:read');
  const parsed = GetInboxHintsInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inbox hint read', parsed.error);
  const input = parsed.data;
  return db.transaction(async tx => {
    const project = await requireProject(tx, ctx, input.projectId);
    const [version] = await tx.select({ id: v.id, recordId: v.recordId, source: v.source, threadExternalId: v.threadExternalId, parentExternalId: v.parentExternalId, author: v.author }).from(v)
      .where(and(eq(v.projectId, project.id), eq(v.id, input.recordVersionId))).limit(1);
    if (!version) throw new AppError('NOT_FOUND', 'Record version not found');
    const current = (condition: SQL) => tx.select({ id: v.id }).from(v)
      .innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.currentVersionId, v.id)))
      .where(and(eq(v.projectId, project.id), eq(v.source, version.source), ne(v.recordId, version.recordId), condition));
    const hints: InboxHint[] = [], seen = new Set<string>();
    const add = (kind: InboxHint['kind'], id: string, reason: string) => { if (!seen.has(id)) { seen.add(id); hints.push({ kind, recordVersionId: id, reason }); } };
    if (version.parentExternalId !== null) {
      for (const row of await current(eq(r.externalId, version.parentExternalId)).limit(1)) add('parent', row.id, `Replies to source message ${version.parentExternalId}`);
    }
    if (version.threadExternalId !== null) {
      const thread = version.threadExternalId;
      const rows = await current(sql`(${v.threadExternalId} = ${thread} or ${r.externalId} = ${thread})`).orderBy(desc(v.occurredAt), desc(v.id)).limit(MAX_THREAD_HINTS);
      for (const row of rows) add('thread', row.id, `Same source thread ${thread}`);
    }
    const alias = [version.author.name, version.author.email ? `<${version.author.email}>` : null].filter(Boolean).join(' ');
    const rows = await current(sql`${v.author} = ${JSON.stringify(version.author)}::jsonb`).orderBy(desc(v.occurredAt), desc(v.id)).limit(MAX_AUTHOR_HINTS + hints.length);
    for (const row of rows.filter(item => !seen.has(item.id)).slice(0, MAX_AUTHOR_HINTS)) add('author', row.id, `Same author alias ${alias}`);
    return hints;
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
