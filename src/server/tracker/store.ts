import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Commit, Cr, CrCommentKind, Grants, Member, QueueRow } from '../../tracker';
import { AppError } from '../errors';
import {
  trackerCommits,
  trackerCrAsks,
  trackerCrComments,
  trackerCrShares,
  trackerCrs,
  trackerMembers,
  trackerProjects,
  trackerQueue,
  trackerTeamMembers,
  trackerTeams,
} from '../db/schema';
import { toIso, type Db, type Tx } from '../db/tx';

export type Reader = Db | Tx;
export type TrackerRow = typeof trackerProjects.$inferSelect;
export type CrRow = typeof trackerCrs.$inferSelect;
export type QueueDbRow = typeof trackerQueue.$inferSelect;
/**
 * byAgent and viaKey ride along with every tenant spread; only tables with those columns keep them,
 * so each change request comment records the key that wrote it for its person.
 */
export type Tenant = { workspaceId: string; projectId: string; byAgent?: boolean; viaKey?: string };

const isoOrNull = (value: string | null) => (value === null ? null : toIso(value));

/**
 * Main's teams and people come from the project, so a rename, a new lead or an invite shows at once
 * in every view. Removed members stay as people, so the work they did keeps their name. The caller
 * passes the rows of `loadMembers`, so one request reads the members once.
 */
export async function findTracker(
  db: Reader,
  projectId: string,
  members: readonly Pick<Member, 'id' | 'name'>[],
): Promise<TrackerRow> {
  const [row] = await db
    .select()
    .from(trackerProjects)
    .where(eq(trackerProjects.projectId, projectId))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'This project has no tracker yet');
  const teams = await loadTeams(db, projectId);
  const memberName = new Map(members.map((member) => [member.id, member.name]));
  const story = new Set(row.base.people.map((person) => person.id));
  return {
    ...row,
    base: {
      ...row.base,
      people: [
        ...row.base.people.map((person) => ({
          id: person.id,
          name: memberName.get(person.id) ?? person.name,
        })),
        ...members.filter((member) => !story.has(member.id)).map(({ id, name }) => ({ id, name })),
      ],
      teams: teams.map(({ id, name, leadId }) => ({ id, name, leadId })),
    },
  };
}

export async function insertTeams(
  tx: Tx,
  tenant: Tenant,
  teams: ReadonlyArray<{ id: string; name: string; leadId: string | null; memberIds: string[] }>,
) {
  if (!teams.length) return;
  await tx
    .insert(trackerTeams)
    .values(
      teams.map((team) => ({ ...tenant, id: team.id, name: team.name, leadMemberId: team.leadId })),
    );
  const members = teams.flatMap((team) =>
    [...new Set([...team.memberIds, ...(team.leadId ? [team.leadId] : [])])].map((memberId) => ({
      ...tenant,
      teamId: team.id,
      memberId,
    })),
  );
  if (members.length) await tx.insert(trackerTeamMembers).values(members);
}

export type TeamRow = { id: string; name: string; leadId: string | null; memberIds: string[] };

export async function loadTeams(db: Reader, projectId: string): Promise<TeamRow[]> {
  const teams = await db
    .select()
    .from(trackerTeams)
    .where(eq(trackerTeams.projectId, projectId))
    .orderBy(asc(trackerTeams.seq));
  const members = await db
    .select({ teamId: trackerTeamMembers.teamId, memberId: trackerTeamMembers.memberId })
    .from(trackerTeamMembers)
    .innerJoin(
      trackerMembers,
      and(
        eq(trackerMembers.projectId, trackerTeamMembers.projectId),
        eq(trackerMembers.id, trackerTeamMembers.memberId),
      ),
    )
    .where(eq(trackerTeamMembers.projectId, projectId))
    .orderBy(asc(trackerMembers.seq));
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    leadId: team.leadMemberId,
    memberIds: members.filter((row) => row.teamId === team.id).map((row) => row.memberId),
  }));
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
    active: row.removedAt === null && !isInvite(row),
    removed: row.removedAt !== null,
    grants: grantsOf(row),
  }));
}

export const grantsOf = (row: typeof trackerMembers.$inferSelect): Grants => ({
  viewMain: row.viewMain,
  viewCrs: row.viewCrs,
  createCrs: row.createCrs,
  mergeCrs: row.mergeCrs,
});

export const isInvite = (row: { userId: string | null; email: string | null }) =>
  row.userId === null && row.email !== null;

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
      agent: comment.byAgent,
      viaKey: comment.viaKey,
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
