import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Commit, Cr, CrCommentKind, Member, QueueRow } from '../../tracker';
import { AppError } from '../errors';
import {
  trackerCommits,
  trackerCrAsks,
  trackerCrComments,
  trackerCrShares,
  trackerCrs,
  trackerEventOffsets,
  trackerMembers,
  trackerProjects,
  trackerQueue,
} from '../db/schema';
import { toIso, type Db, type Tx } from '../db/tx';

export type Reader = Db | Tx;
export type TrackerRow = typeof trackerProjects.$inferSelect;
export type CrRow = typeof trackerCrs.$inferSelect;
export type QueueDbRow = typeof trackerQueue.$inferSelect;
export type Tenant = { workspaceId: string; projectId: string };

const isoOrNull = (value: string | null) => (value === null ? null : toIso(value));

export async function findTracker(db: Reader, projectId: string): Promise<TrackerRow> {
  const [row] = await db
    .select()
    .from(trackerProjects)
    .where(eq(trackerProjects.projectId, projectId))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'This project has no tracker yet');
  return row;
}

export async function loadMembers(db: Reader, projectId: string): Promise<Member[]> {
  const rows = await db
    .select()
    .from(trackerMembers)
    .where(eq(trackerMembers.projectId, projectId))
    .orderBy(asc(trackerMembers.seq));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    roleLabel: row.roleLabel,
    color: row.color,
    userId: row.userId,
  }));
}

export function toQueueRow(row: QueueDbRow): QueueRow {
  const meta = {
    id: row.id,
    addedByMember: row.addedByMember,
    addedByAgent: row.addedByAgent,
    createdAt: toIso(row.createdAt),
  };
  // The jsonb column type cannot tie the payload shape to the kind column.
  return { ...meta, kind: row.kind, payload: row.payload } as QueueRow;
}

/** Every card that is not dismissed, including the ones Main used: replays start from this list. */
export async function loadQueue(db: Reader, projectId: string): Promise<QueueRow[]> {
  const rows = await db
    .select()
    .from(trackerQueue)
    .where(and(eq(trackerQueue.projectId, projectId), isNull(trackerQueue.dismissedAt)))
    .orderBy(asc(trackerQueue.createdAt), asc(trackerQueue.id));
  return rows.map(toQueueRow);
}

export async function loadCommits(db: Reader, projectId: string): Promise<Commit[]> {
  const rows = await db
    .select({ commit: trackerCommits, crNum: trackerCrs.num })
    .from(trackerCommits)
    .innerJoin(
      trackerCrs,
      and(
        eq(trackerCrs.projectId, trackerCommits.projectId),
        eq(trackerCrs.id, trackerCommits.crId),
      ),
    )
    .where(eq(trackerCommits.projectId, projectId))
    .orderBy(asc(trackerCommits.rev));
  return rows.map(({ commit, crNum }) => ({
    rev: commit.rev,
    crId: commit.crId,
    crNum,
    mergedBy: commit.mergedBy,
    mergedAt: toIso(commit.mergedAt),
    ops: commit.ops,
    resolutions: commit.resolutions,
  }));
}

export const mainRevision = (commits: readonly Commit[]) =>
  commits.reduce((rev, commit) => Math.max(rev, commit.rev), 0);

function groupBy<T extends { crId: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.crId, [...(groups.get(row.crId) ?? []), row]);
  return groups;
}

export async function loadCrs(
  db: Reader,
  projectId: string,
  members: readonly Member[],
): Promise<Cr[]> {
  const crs = await db
    .select()
    .from(trackerCrs)
    .where(eq(trackerCrs.projectId, projectId))
    .orderBy(asc(trackerCrs.num));
  const shares = await db
    .select()
    .from(trackerCrShares)
    .where(eq(trackerCrShares.projectId, projectId));
  const asks = await db
    .select()
    .from(trackerCrAsks)
    .where(eq(trackerCrAsks.projectId, projectId))
    .orderBy(asc(trackerCrAsks.createdAt));
  const comments = await db
    .select()
    .from(trackerCrComments)
    .where(eq(trackerCrComments.projectId, projectId))
    .orderBy(asc(trackerCrComments.createdAt), asc(trackerCrComments.seq));
  const position = new Map(members.map((member, index) => [member.id, index]));
  const byMember = (a: { memberId: string }, b: { memberId: string }) =>
    (position.get(a.memberId) ?? 0) - (position.get(b.memberId) ?? 0);
  const sharesOf = groupBy(shares),
    asksOf = groupBy(asks),
    commentsOf = groupBy(comments);
  return crs.map((row) => ({
    id: row.id,
    num: row.num,
    title: row.title,
    author: row.author,
    editor: row.editor,
    status: row.status,
    ops: row.ops,
    revision: row.revision,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    mergedRev: row.mergedRev,
    mergedBy: row.mergedBy,
    mergedAt: isoOrNull(row.mergedAt),
    closedBy: row.closedBy,
    closedAt: isoOrNull(row.closedAt),
    closedRev: row.closedRev,
    resolutions: row.resolutions,
    shares: (sharesOf.get(row.id) ?? [])
      .sort(byMember)
      .map(({ memberId, permission }) => ({ memberId, permission })),
    asks: (asksOf.get(row.id) ?? []).map(({ memberId, createdAt }) => ({
      memberId,
      createdAt: toIso(createdAt),
    })),
    comments: (commentsOf.get(row.id) ?? []).map((comment) => ({
      id: comment.id,
      memberId: comment.memberId,
      kind: comment.kind,
      body: comment.body,
      opIndex: comment.opIndex,
      createdAt: toIso(comment.createdAt),
    })),
  }));
}

export async function lockCr(tx: Tx, projectId: string, num: number): Promise<CrRow> {
  const [row] = await tx
    .select()
    .from(trackerCrs)
    .where(and(eq(trackerCrs.projectId, projectId), eq(trackerCrs.num, num)))
    .limit(1)
    .for('update');
  if (!row) throw new AppError('NOT_FOUND', `Change request #${num} not found`);
  return row;
}

export async function addComment(
  tx: Tx,
  tenant: Tenant,
  comment: {
    crId: string;
    memberId: string;
    kind: CrCommentKind;
    body?: string | null;
    opIndex?: number | null;
    createdAt?: string;
  },
): Promise<void> {
  await tx.insert(trackerCrComments).values({ ...tenant, ...comment });
}

export async function loadOffsets(
  db: Reader,
  projectId: string,
  userId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ eventId: trackerEventOffsets.eventId, minutes: trackerEventOffsets.offsetMinutes })
    .from(trackerEventOffsets)
    .where(
      and(eq(trackerEventOffsets.projectId, projectId), eq(trackerEventOffsets.userId, userId)),
    );
  return Object.fromEntries(rows.map((row) => [row.eventId, row.minutes]));
}
