import { createHash } from 'node:crypto';
import { and, asc, count, eq, isNull, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorContext } from '../../contracts';
import { canSeeCr, joinVersion, type TrackerVersion } from '../../tracker';
import {
  trackerCommits,
  trackerCrAsks,
  trackerCrComments,
  trackerCrShares,
  trackerCrs,
  trackerQueue,
} from '../db/schema';
import type { Db } from '../db/tx';
import { invalidInput } from '../errors';
import { requireScope } from '../http/scopes';
import { ProjectScopeSchema, readScope, requireView, subjectOf, type Scope } from './access';
import type { Reader } from './store';

const GetVersionInputSchema = z.strictObject(ProjectScopeSchema);

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 12);

/** Reads ids, revisions and counts only: no ops, no comment bodies, so a check costs far less than the payload. */
export async function versionOf(db: Reader, scope: Scope): Promise<TrackerVersion> {
  const projectId = scope.project.id;
  const [main] = await db
    .select({ rev: max(trackerCommits.rev), n: count() })
    .from(trackerCommits)
    .where(eq(trackerCommits.projectId, projectId));
  const queue = await db
    .select({
      id: trackerQueue.id,
      by: trackerQueue.addedByMember,
      agent: trackerQueue.addedByAgent,
      body: sql<string>`md5(${trackerQueue.payload}::text)`,
    })
    .from(trackerQueue)
    .where(and(eq(trackerQueue.projectId, projectId), isNull(trackerQueue.dismissedAt)))
    .orderBy(asc(trackerQueue.createdAt), asc(trackerQueue.id));
  const crs = await db
    .select({
      id: trackerCrs.id,
      num: trackerCrs.num,
      title: trackerCrs.title,
      author: trackerCrs.author,
      editor: trackerCrs.editor,
      status: trackerCrs.status,
      revision: trackerCrs.revision,
      updatedAt: sql<string>`${trackerCrs.updatedAt}::text`,
    })
    .from(trackerCrs)
    .where(eq(trackerCrs.projectId, projectId))
    .orderBy(asc(trackerCrs.num));
  const shares = await db
    .select({
      crId: trackerCrShares.crId,
      memberId: trackerCrShares.memberId,
      permission: trackerCrShares.permission,
    })
    .from(trackerCrShares)
    .where(eq(trackerCrShares.projectId, projectId))
    .orderBy(asc(trackerCrShares.crId), asc(trackerCrShares.memberId));
  const asks = await db
    .select({ crId: trackerCrAsks.crId, memberId: trackerCrAsks.memberId })
    .from(trackerCrAsks)
    .where(eq(trackerCrAsks.projectId, projectId))
    .orderBy(asc(trackerCrAsks.crId), asc(trackerCrAsks.memberId));
  const comments = await db
    .select({ crId: trackerCrComments.crId, n: count(), last: max(trackerCrComments.seq) })
    .from(trackerCrComments)
    .where(eq(trackerCrComments.projectId, projectId))
    .groupBy(trackerCrComments.crId)
    .orderBy(asc(trackerCrComments.crId));
  const subject = subjectOf(scope);
  const visible = crs
    .map((cr) => ({ ...cr, shares: shares.filter((share) => share.crId === cr.id) }))
    .filter((cr) => canSeeCr(subject, cr))
    .map((cr) => ({
      ...cr,
      asks: asks.filter((ask) => ask.crId === cr.id),
      comments: comments.find((c) => c.crId === cr.id) ?? null,
    }));
  const { project, tracker, members, me, canActAs } = scope;
  return {
    version: joinVersion({
      main: digest([main?.rev ?? 0, main?.n ?? 0]),
      queue: digest(queue),
      crs: digest(visible),
      project: digest([project.title, project.clientName, tracker, members, me?.id, canActAs]),
    }),
    crCount: visible.length,
  };
}

export async function getTrackerVersion(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetVersionInputSchema>,
): Promise<TrackerVersion> {
  requireScope(ctx, 'project:read');
  const parsed = GetVersionInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid tracker version read', parsed.error);
  const { projectId, actAs } = parsed.data;
  return db.transaction(
    async (tx) => {
      const scope = await readScope(tx, ctx, projectId, actAs);
      requireView(scope);
      return versionOf(tx, scope);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
