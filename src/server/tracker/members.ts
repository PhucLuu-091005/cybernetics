import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import {
  ALL_GRANTS,
  closeGrants,
  DEFAULT_GRANTS,
  mainState,
  memberRights,
  noNul,
  type Grants,
  type Op,
  type Rights,
} from '../../tracker';
import {
  agentTokens,
  trackerCrAsks,
  trackerCrShares,
  trackerCrs,
  trackerMembers,
  trackerProjects,
  trackerTeamMembers,
  trackerTeams,
  users,
} from '../db/schema';
import { isUniqueViolation, withTransaction, type Db, type Tx } from '../db/tx';
import { AppError, invalidInput } from '../errors';
import { requireScope } from '../http/scopes';
import {
  ProjectScopeSchema,
  readScope,
  requireRight,
  rightsIn,
  writeScope,
  type Scope,
} from './access';
import { LEAD_ROLE_LABEL } from './projects';
import {
  grantsOf,
  isInvite,
  loadCommits,
  loadQueue,
  insertTeams,
  loadTeams,
  type Reader,
  type TeamRow,
} from './store';

export type ProjectMember = {
  id: string;
  name: string;
  /** What the person does in the project, for example "Digitization lead". */
  label: string;
  email: string | null;
  /** An invite that waits until a person signs in with this email. */
  pending: boolean;
  color: string;
  /** The acting member, so the demo marks the person you work as. */
  you: boolean;
  projectLead: boolean;
  grants: Grants;
  rights: Rights;
  teamIds: string[];
};

export type ProjectTeam = {
  id: string;
  name: string;
  leadId: string | null;
  memberIds: string[];
  workItems: number;
  /** Why the team cannot be deleted, or null. */
  keep: string | null;
};

export type MembersPayload = {
  canManage: boolean;
  leadId: string;
  members: ProjectMember[];
  teams: ProjectTeam[];
};

const GrantsSchema = z.strictObject({
  viewMain: z.boolean(),
  viewCrs: z.boolean(),
  createCrs: z.boolean(),
  mergeCrs: z.boolean(),
});
const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const TeamNameSchema = noNul(
  z.string().trim().min(1, 'Give the team a name').max(200, 'Keep the team name to 200 characters'),
);
const ListMembersInputSchema = z.strictObject(ProjectScopeSchema);
const InviteMemberInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  email: EmailSchema,
  grants: GrantsSchema.optional(),
});
const UpdateMemberInputSchema = z.union([
  z.strictObject({ ...ProjectScopeSchema, memberId: IdSchema, grants: GrantsSchema }),
  z.strictObject({ ...ProjectScopeSchema, memberId: IdSchema, projectLead: z.literal(true) }),
]);
const RemoveMemberInputSchema = z.strictObject({ ...ProjectScopeSchema, memberId: IdSchema });
const TeamIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const AddTeamInputSchema = z.strictObject({ ...ProjectScopeSchema, name: TeamNameSchema });
const UpdateTeamInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  teamId: TeamIdSchema,
  name: TeamNameSchema.optional(),
  leadId: IdSchema.nullable().optional(),
  memberIds: z.array(IdSchema).max(500).optional(),
});
const DeleteTeamInputSchema = z.strictObject({ ...ProjectScopeSchema, teamId: TeamIdSchema });

const UNIQUE = ['tracker_members_project_email_unique', 'tracker_members_project_user_unique'];
const COLORS = ['#2563eb', '#0f766e', '#d97706', '#0891b2', '#65a30d', '#dc2626', '#4f46e5'];

type Row = typeof trackerMembers.$inferSelect & { userEmail: string | null };

async function memberRows(db: Reader, projectId: string): Promise<Row[]> {
  const rows = await db
    .select({ member: trackerMembers, userEmail: users.email })
    .from(trackerMembers)
    .leftJoin(users, eq(users.id, trackerMembers.userId))
    .where(eq(trackerMembers.projectId, projectId))
    .orderBy(asc(trackerMembers.seq));
  return rows.map(({ member, userEmail }) => ({ ...member, userEmail }));
}

const teamOf = (op: Op): string | null => {
  if (op.op === 'addTeam') return op.a.id;
  const args = op.a as { teamId?: unknown };
  return typeof args.teamId === 'string' ? args.teamId : null;
};

/** Main's history and the open change requests replay against the team list, so a team they name stays. */
async function teamUse(db: Reader, scope: Scope, teams: TeamRow[]) {
  const projectId = scope.project.id;
  const commits = await loadCommits(db, projectId);
  const main = mainState(scope.tracker.base, await loadQueue(db, projectId), commits);
  const open = await db
    .select({ ops: trackerCrs.ops })
    .from(trackerCrs)
    .where(
      and(eq(trackerCrs.projectId, projectId), inArray(trackerCrs.status, ['draft', 'ready'])),
    );
  const named = new Set(
    [...commits.flatMap((commit) => commit.ops), ...open.flatMap((cr) => cr.ops)].map(teamOf),
  );
  return new Map(
    teams.map((team) => {
      const workItems = main.workItems.filter((item) => item.teamId === team.id).length;
      const keep = workItems
        ? `${team.name} has ${workItems} work item${workItems === 1 ? '' : 's'}, so it stays. Rename it instead.`
        : named.has(team.id)
          ? `Change requests use ${team.name}, so it stays. Rename it instead.`
          : null;
      return [team.id, { workItems, keep }];
    }),
  );
}

async function toPayload(db: Reader, ctx: ActorContext, scope: Scope): Promise<MembersPayload> {
  const lead = scope.tracker.ownerMemberId;
  const rows = await memberRows(db, scope.project.id);
  const teams = await loadTeams(db, scope.project.id);
  const use = await teamUse(db, scope, teams);
  const live = rows.filter((row) => row.removedAt === null);
  return {
    canManage: ctx.kind === 'user' && !!scope.me && scope.me.id === lead,
    leadId: lead,
    members: live.map((row) => {
      const grants = grantsOf(row);
      return {
        id: row.id,
        name: row.name,
        label: row.roleLabel,
        email: row.email ?? row.userEmail?.toLowerCase() ?? null,
        pending: isInvite(row),
        color: row.color,
        you: row.id === scope.me?.id,
        projectLead: row.id === lead,
        grants,
        rights: memberRights({
          projectLead: row.id === lead,
          teamLead: teams.some((team) => team.leadId === row.id),
          grants,
        }),
        teamIds: teams.filter((team) => team.memberIds.includes(row.id)).map((team) => team.id),
      };
    }),
    teams: teams.map((team) => ({ ...team, ...use.get(team.id)! })),
  };
}

function parse<S extends z.ZodType>(schema: S, raw: unknown, message: string): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidInput(message, parsed.error);
  return parsed.data;
}

export async function listProjectMembers(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ListMembersInputSchema>,
): Promise<MembersPayload> {
  requireScope(ctx, 'project:read');
  const { projectId, actAs } = parse(ListMembersInputSchema, raw, 'Invalid members read');
  return db.transaction(
    async (tx) => toPayload(tx, ctx, await readScope(tx, ctx, projectId, actAs)),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** A write by the project lead; whoever loses the create right stops editing their open change requests. */
async function leadWrite(
  db: Db,
  ctx: ActorContext,
  input: { projectId: string; actAs?: string | null },
  change: (tx: Tx, scope: Scope, rows: Row[]) => Promise<void>,
): Promise<MembersPayload> {
  return withTransaction(db, async (tx) => {
    let scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    requireRight(ctx, scope, 'manage');
    await change(tx, scope, await memberRows(tx, scope.project.id));
    scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    await releaseEditing(tx, scope);
    return toPayload(tx, ctx, scope);
  });
}

export async function inviteMember(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof InviteMemberInputSchema>,
): Promise<MembersPayload> {
  const input = parse(InviteMemberInputSchema, raw, 'Invalid invite');
  const grants = closeGrants(input.grants ?? DEFAULT_GRANTS);
  const taken = () => new AppError('CONFLICT', `${input.email} is already in this project`);
  try {
    return await leadWrite(db, ctx, input, async (tx, scope, rows) => {
      const { email } = input;
      const [user] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .orderBy(asc(users.createdAt))
        .limit(1);
      const linked = user && rows.find((row) => row.userId === user.id);
      const byEmail = rows.find(
        (row) => row.email === email || row.userEmail?.toLowerCase() === email,
      );
      const match = linked ?? byEmail;
      if (match && match.removedAt === null) throw taken();
      if (match) {
        await tx
          .update(trackerMembers)
          .set({
            removedAt: null,
            ...grants,
            email: match.email ?? email,
            userId: match.userId ?? user?.id ?? null,
            name: user?.name ?? match.name,
          })
          .where(
            and(eq(trackerMembers.projectId, scope.project.id), eq(trackerMembers.id, match.id)),
          );
        return;
      }
      await tx.insert(trackerMembers).values({
        ...scope.tenant,
        name: user?.name ?? email,
        roleLabel: '',
        color: COLORS[rows.length % COLORS.length],
        userId: user?.id ?? null,
        email,
        ...grants,
      });
    });
  } catch (error) {
    // The project lock orders invites, so a clash here comes from another removed row with this email.
    if (UNIQUE.some((name) => isUniqueViolation(error, name))) throw taken();
    throw error;
  }
}

function liveRow(rows: Row[], memberId: string): Row {
  const row = rows.find((item) => item.id === memberId && item.removedAt === null);
  if (!row) throw new AppError('NOT_FOUND', 'That person is not a member of this project');
  return row;
}

async function releaseEditing(tx: Tx, scope: Scope) {
  const projectId = scope.project.id;
  const canAct = new Set(
    scope.members
      .filter((member) => member.active && rightsIn(scope, member).create)
      .map((member) => member.id),
  );
  const crs = await tx
    .select()
    .from(trackerCrs)
    .where(
      and(
        eq(trackerCrs.projectId, projectId),
        notInArray(trackerCrs.editor, [...canAct]),
        inArray(trackerCrs.status, ['draft', 'ready']),
      ),
    )
    .for('update');
  for (const cr of crs)
    await tx
      .update(trackerCrs)
      .set({
        editor: canAct.has(cr.author) ? cr.author : scope.tracker.ownerMemberId,
        revision: cr.revision + 1,
        updatedAt: sql`now()`,
      })
      .where(and(eq(trackerCrs.projectId, projectId), eq(trackerCrs.id, cr.id)));
  await tx
    .delete(trackerCrAsks)
    .where(
      and(eq(trackerCrAsks.projectId, projectId), notInArray(trackerCrAsks.memberId, [...canAct])),
    );
}

const NEEDS_NEW_LEAD = 'Make another member the project lead first';

export async function updateMember(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof UpdateMemberInputSchema>,
): Promise<MembersPayload> {
  const input = parse(UpdateMemberInputSchema, raw, 'Invalid member change');
  return leadWrite(db, ctx, input, async (tx, scope, rows) => {
    const projectId = scope.project.id;
    const target = liveRow(rows, input.memberId);
    const lead = scope.tracker.ownerMemberId;
    const set = (id: string, values: Partial<typeof trackerMembers.$inferInsert>) =>
      tx
        .update(trackerMembers)
        .set(values)
        .where(and(eq(trackerMembers.projectId, projectId), eq(trackerMembers.id, id)));
    if ('grants' in input) {
      if (target.id === lead)
        throw new AppError('VALIDATION', `The project lead has every right. ${NEEDS_NEW_LEAD}.`);
      await set(target.id, closeGrants(input.grants));
      return;
    }
    if (target.id === lead) return;
    if (isInvite(target)) throw new AppError('VALIDATION', `${target.email} has not signed in yet`);
    await tx
      .update(trackerProjects)
      .set({ ownerMemberId: target.id })
      .where(eq(trackerProjects.projectId, projectId));
    await set(target.id, {
      ...ALL_GRANTS,
      ...(target.roleLabel ? {} : { roleLabel: LEAD_ROLE_LABEL }),
    });
    // The old lead keeps every grant, so the hand-over takes no right away until the new lead decides.
    const previous = rows.find((row) => row.id === lead);
    await set(lead, {
      ...ALL_GRANTS,
      ...(previous?.roleLabel === LEAD_ROLE_LABEL ? { roleLabel: '' } : {}),
    });
  });
}

export async function removeMember(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof RemoveMemberInputSchema>,
): Promise<MembersPayload> {
  const input = parse(RemoveMemberInputSchema, raw, 'Invalid removal');
  return leadWrite(db, ctx, input, async (tx, scope, rows) => {
    const projectId = scope.project.id;
    const target = liveRow(rows, input.memberId);
    if (target.id === scope.tracker.ownerMemberId)
      throw new AppError(
        'VALIDATION',
        `The project lead cannot leave the project. ${NEEDS_NEW_LEAD}.`,
      );
    await tx
      .update(trackerMembers)
      .set({ removedAt: sql`now()` })
      .where(and(eq(trackerMembers.projectId, projectId), eq(trackerMembers.id, target.id)));
    await tx
      .update(trackerTeams)
      .set({ leadMemberId: null })
      .where(and(eq(trackerTeams.projectId, projectId), eq(trackerTeams.leadMemberId, target.id)));
    await tx
      .delete(trackerTeamMembers)
      .where(
        and(
          eq(trackerTeamMembers.projectId, projectId),
          eq(trackerTeamMembers.memberId, target.id),
        ),
      );
    // A later invite brings the member back, and must not bring back old edit rights.
    await tx
      .delete(trackerCrShares)
      .where(
        and(eq(trackerCrShares.projectId, projectId), eq(trackerCrShares.memberId, target.id)),
      );
    if (target.userId)
      await tx
        .update(agentTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(agentTokens.projectId, projectId),
            eq(agentTokens.userId, target.userId),
            isNull(agentTokens.revokedAt),
          ),
        );
  });
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function requireFreeName(teams: TeamRow[], name: string, except?: string) {
  const taken = teams.find((team) => team.id !== except && sameName(team.name, name));
  if (taken) throw new AppError('VALIDATION', `${taken.name} is already a team`);
}

function requireTeam(teams: TeamRow[], teamId: string): TeamRow {
  const team = teams.find((item) => item.id === teamId);
  if (!team) throw new AppError('NOT_FOUND', 'That team is not in this project');
  return team;
}

/**
 * A merged New team becomes a project team, so the Members page can rename it and give it people.
 * A team lead gets the create right, so only the project lead names one there, never a merge.
 */
export async function addMergedTeams(tx: Tx, scope: Scope, ops: readonly Op[]) {
  const known = new Set(scope.tracker.base.teams.map((team) => team.id));
  const added = ops.flatMap((op) =>
    op.op === 'addTeam' && !known.has(op.a.id)
      ? [{ id: op.a.id, name: op.a.name, leadId: null, memberIds: [] }]
      : [],
  );
  await insertTeams(tx, scope.tenant, added);
}

export async function addTeam(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof AddTeamInputSchema>,
): Promise<MembersPayload> {
  const input = parse(AddTeamInputSchema, raw, 'Invalid team');
  return leadWrite(db, ctx, input, async (tx, scope) => {
    requireFreeName(await loadTeams(tx, scope.project.id), input.name);
    await insertTeams(tx, scope.tenant, [
      { id: randomUUID(), name: input.name, leadId: null, memberIds: [] },
    ]);
  });
}

export async function updateTeam(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof UpdateTeamInputSchema>,
): Promise<MembersPayload> {
  const input = parse(UpdateTeamInputSchema, raw, 'Invalid team change');
  return leadWrite(db, ctx, input, async (tx, scope, rows) => {
    const projectId = scope.project.id;
    const teams = await loadTeams(tx, projectId);
    const team = requireTeam(teams, input.teamId);
    if (input.name !== undefined) requireFreeName(teams, input.name, team.id);
    const memberIds = [...new Set(input.memberIds ?? team.memberIds)];
    for (const id of memberIds) liveRow(rows, id);
    let leadId = input.leadId === undefined ? team.leadId : input.leadId;
    // Taking the lead out of the team also ends the lead.
    if (input.leadId === undefined && leadId && !memberIds.includes(leadId)) leadId = null;
    if (leadId) {
      liveRow(rows, leadId);
      if (!memberIds.includes(leadId)) memberIds.push(leadId);
    }
    const key = and(eq(trackerTeams.projectId, projectId), eq(trackerTeams.id, team.id));
    await tx
      .update(trackerTeams)
      .set({ leadMemberId: leadId, ...(input.name === undefined ? {} : { name: input.name }) })
      .where(key);
    const teamMembers = and(
      eq(trackerTeamMembers.projectId, projectId),
      eq(trackerTeamMembers.teamId, team.id),
    );
    await tx.delete(trackerTeamMembers).where(teamMembers);
    if (memberIds.length)
      await tx
        .insert(trackerTeamMembers)
        .values(memberIds.map((memberId) => ({ ...scope.tenant, teamId: team.id, memberId })));
  });
}

export async function deleteTeam(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof DeleteTeamInputSchema>,
): Promise<MembersPayload> {
  const input = parse(DeleteTeamInputSchema, raw, 'Invalid team removal');
  return leadWrite(db, ctx, input, async (tx, scope) => {
    const teams = await loadTeams(tx, scope.project.id);
    const team = requireTeam(teams, input.teamId);
    if (teams.length === 1)
      throw new AppError('VALIDATION', 'A project needs at least one team, so the last one stays');
    const keep = (await teamUse(tx, scope, [team])).get(team.id)!.keep;
    if (keep) throw new AppError('VALIDATION', keep);
    await tx
      .delete(trackerTeams)
      .where(and(eq(trackerTeams.projectId, scope.project.id), eq(trackerTeams.id, team.id)));
  });
}
