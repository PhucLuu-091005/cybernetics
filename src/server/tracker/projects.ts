import { randomUUID } from 'node:crypto';
import {
  DEFAULT_TIME_ZONE,
  mainState,
  replayOps,
  TrackerBaseSchema,
  type Commit,
  type Op,
  type TrackerBase,
} from '../../tracker';
import {
  projects,
  trackerCommits,
  trackerCrShares,
  trackerCrs,
  trackerMembers,
  trackerProjects,
  trackerQueue,
} from '../db/schema';
import type { Tx } from '../db/tx';
import {
  LARKSPUR_AS_OF,
  LARKSPUR_MEMBERS,
  LARKSPUR_OWNER,
  LARKSPUR_PROJECT,
  LARKSPUR_WINDOW_START,
  larkspurBase,
  larkspurCrs,
  larkspurQueueRows,
} from './seed/larkspur';
import { addComment } from './store';

export const OWNER_ROLE_LABEL = 'Project owner, owns Main';
const OWNER = { roleLabel: OWNER_ROLE_LABEL, color: '#0f766e' };

export type CreateTrackerProjectInput = {
  workspaceId: string;
  projectId: string;
  userId: string;
  userName: string;
  teams: readonly string[];
  milestone?: { name: string; date: string; time?: string } | null;
  demo: boolean;
  asOf?: string | null;
  windowStart?: string | null;
  /** Replaces the base built from teams and milestone; the demo seed brings its own. */
  base?: TrackerBase;
  ownerMemberId?: string;
};

function startingBase(input: CreateTrackerProjectInput, ownerMemberId: string): TrackerBase {
  return {
    people: [{ id: ownerMemberId, name: input.userName }],
    teams: input.teams.map((name) => ({ id: randomUUID(), name, leadId: null })),
    milestones: input.milestone
      ? [
          {
            id: randomUUID(),
            name: input.milestone.name,
            planned: input.milestone.date,
            ...(input.milestone.time ? { plannedTime: input.milestone.time } : {}),
            firstPlanned: input.milestone.date,
            ...(input.milestone.time ? { firstPlannedTime: input.milestone.time } : {}),
            moves: [],
          },
        ]
      : [],
    workItems: [],
    events: [],
  };
}

export async function createTrackerProject(
  tx: Tx,
  input: CreateTrackerProjectInput,
): Promise<{ ownerMemberId: string }> {
  const ownerMemberId = input.ownerMemberId ?? randomUUID();
  const tenant = { workspaceId: input.workspaceId, projectId: input.projectId };
  const base = TrackerBaseSchema.parse(input.base ?? startingBase(input, ownerMemberId));
  await tx.insert(trackerMembers).values({
    ...tenant,
    id: ownerMemberId,
    name: input.userName,
    ...OWNER,
    userId: input.userId,
  });
  await tx.insert(trackerProjects).values({
    ...tenant,
    base,
    timeZone: DEFAULT_TIME_ZONE,
    windowStart: input.windowStart ?? null,
    asOf: input.asOf ?? null,
    demo: input.demo,
    ownerMemberId,
  });
  return { ownerMemberId };
}

/** The owner member keeps the story name Minh Trần (spec 2.19), so it needs no user name. */
export async function seedTrackerDemo(
  tx: Tx,
  input: { workspaceId: string; userId: string },
): Promise<{ projectId: string; ids: Record<string, string> }> {
  const [project] = await tx
    .insert(projects)
    .values({ id: randomUUID(), workspaceId: input.workspaceId, ...LARKSPUR_PROJECT })
    .returning({ id: projects.id });
  const queueRows = larkspurQueueRows();
  const ids: Record<string, string> = Object.fromEntries(
    [...LARKSPUR_MEMBERS.map((member) => member.key), ...queueRows.map((row) => row.id)].map(
      (key) => [key, randomUUID()],
    ),
  );
  const id = (key: string) => ids[key] ?? key;
  const tenant = { workspaceId: input.workspaceId, projectId: project.id };
  const owner = LARKSPUR_MEMBERS.find((member) => member.key === LARKSPUR_OWNER)!;
  const base = larkspurBase(id);
  await createTrackerProject(tx, {
    ...tenant,
    userId: input.userId,
    userName: owner.name,
    teams: [],
    demo: true,
    asOf: LARKSPUR_AS_OF,
    windowStart: LARKSPUR_WINDOW_START,
    base,
    ownerMemberId: id(owner.key),
  });
  await tx.insert(trackerMembers).values(
    LARKSPUR_MEMBERS.filter((member) => member !== owner).map((member) => ({
      ...tenant,
      id: id(member.key),
      name: member.name,
      roleLabel: member.roleLabel,
      color: member.color,
    })),
  );
  const rows = larkspurQueueRows(id);
  await tx.insert(trackerQueue).values(
    rows.map((row) => ({
      ...tenant,
      id: row.id,
      kind: row.kind,
      payload: row.payload,
      addedByMember: row.addedByMember,
      addedByAgent: row.addedByAgent,
      createdAt: row.createdAt,
    })),
  );
  const commits: Commit[] = [];
  for (const [index, seed] of larkspurCrs(id).entries()) {
    const num = index + 1;
    const ops: Op[] = replayOps(
      mainState(base, rows, commits, seed.ops[0].rev),
      seed.ops,
    ).entries.map(({ i, skipped, ...d }) => {
      if (skipped) throw new Error(`Seed change request #${num} op ${i} does not apply`);
      return { ...seed.ops[i], d };
    });
    const merged =
      seed.status === 'merged' ? { rev: commits.length + 1, at: seed.mergedAt! } : null;
    const updatedAt = seed.comments.at(-1)!.at;
    const [cr] = await tx
      .insert(trackerCrs)
      .values({
        ...tenant,
        num,
        title: seed.title,
        author: seed.author,
        editor: seed.author,
        status: seed.status,
        ops,
        createdAt: seed.createdAt,
        updatedAt,
        ...(merged ? { mergedRev: merged.rev, mergedBy: id(owner.key), mergedAt: merged.at } : {}),
      })
      .returning({ id: trackerCrs.id });
    if (merged) {
      const commit = {
        rev: merged.rev,
        crId: cr.id,
        mergedBy: id(owner.key),
        mergedAt: merged.at,
        ops,
        resolutions: [],
      };
      await tx.insert(trackerCommits).values({ ...tenant, ...commit });
      commits.push({ ...commit, crNum: num });
    }
    if (seed.shares.length)
      await tx
        .insert(trackerCrShares)
        .values(seed.shares.map((share) => ({ ...tenant, crId: cr.id, ...share })));
    for (const comment of seed.comments)
      await addComment(tx, tenant, {
        crId: cr.id,
        memberId: comment.by,
        kind: comment.kind,
        body: comment.body,
        createdAt: comment.at,
      });
  }
  return { projectId: project.id, ids };
}
