import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  addDays,
  ALL_GRANTS,
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
  trackerTeamMembers,
  trackerTeams,
} from '../db/schema';
import type { Tx } from '../db/tx';
import {
  LARKSPUR_MEMBERS,
  LARKSPUR_OWNER,
  LARKSPUR_PROJECT,
  LARKSPUR_TEAM_PEOPLE,
  LARKSPUR_WINDOW_START,
  larkspurBase,
  larkspurCrs,
  larkspurQueueRows,
  larkspurShift,
} from './seed/larkspur';
import { addComment, insertTeams } from './store';

export const LEAD_ROLE_LABEL = 'Project lead';
const LEAD = { roleLabel: LEAD_ROLE_LABEL, color: '#0f766e', ...ALL_GRANTS };

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
    ...LEAD,
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
  await insertTeams(
    tx,
    tenant,
    base.teams.map(({ id, name }) => ({ id, name, leadId: null, memberIds: [] })),
  );
  return { ownerMemberId };
}

/**
 * The clock of a new demo copy: now, with no fixed `asOf`, so the T line and the statuses follow
 * the real time. Tests pin it with TRACKER_DEMO_AS_OF, which also fixes the project's clock there.
 */
export function demoClock(values: Record<string, string | undefined> = process.env): {
  now: Date;
  asOf: string | null;
} {
  const pinned = values.TRACKER_DEMO_AS_OF;
  if (!pinned) return { now: new Date(), asOf: null };
  if (values.NODE_ENV === 'production') throw new Error('TRACKER_DEMO_AS_OF is for tests only');
  const now = new Date(pinned);
  if (Number.isNaN(now.getTime())) throw new Error('TRACKER_DEMO_AS_OF must be an ISO instant');
  return { now, asOf: pinned };
}

/** A pin in production or a wrong one stops the server at start, so no visitor meets it as a 500. */
export function assertDemoClock(values: Record<string, string | undefined> = process.env): void {
  try {
    demoClock(values);
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'demo_clock_invalid', message: (error as Error).message }),
    );
    process.exit(1);
  }
}

/**
 * The project lead keeps the story name Minh Trần (spec 2.19), so it needs no user name.
 */
export async function seedTrackerDemo(
  tx: Tx,
  input: { workspaceId: string; userId: string; now?: Date; asOf?: string | null },
): Promise<{ projectId: string; ids: Record<string, string> }> {
  const days = larkspurShift(input.now ?? new Date());
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
  const base = larkspurBase(id, days);
  await createTrackerProject(tx, {
    ...tenant,
    userId: input.userId,
    userName: owner.name,
    teams: [],
    demo: true,
    asOf: input.asOf ?? null,
    windowStart: addDays(LARKSPUR_WINDOW_START, days),
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
      ...member.grants,
    })),
  );
  for (const [teamId, people] of Object.entries(LARKSPUR_TEAM_PEOPLE)) {
    const key = and(eq(trackerTeams.projectId, project.id), eq(trackerTeams.id, teamId));
    if (people.lead)
      await tx
        .update(trackerTeams)
        .set({ leadMemberId: id(people.lead) })
        .where(key);
    await tx
      .insert(trackerTeamMembers)
      .values(people.members.map((key) => ({ ...tenant, teamId, memberId: id(key) })));
  }
  const rows = larkspurQueueRows(id, days);
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
  for (const [index, seed] of larkspurCrs(id, days).entries()) {
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
