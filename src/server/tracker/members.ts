import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import { trackerCrAsks, trackerCrs, trackerMembers, trackerProjects, users } from '../db/schema';
import { withTransaction, type Db, type Tx } from '../db/tx';
import { AppError, invalidInput } from '../errors';
import { requireScope } from '../http/scopes';
import { ProjectScopeSchema, readScope, requireOwner, writeScope, type Scope } from './access';
import { OWNER_ROLE_LABEL } from './projects';
import { isInvite, type Reader } from './store';

export const MEMBER_ROLES = ['owner', 'member', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type ProjectMember = {
  id: string;
  name: string;
  /** What the person does in the project, for example "Digitization lead". */
  label: string;
  email: string | null;
  role: MemberRole;
  /** An invite that waits until a person signs in with this email. */
  pending: boolean;
  color: string;
  /** The acting member, so the demo marks the person you work as. */
  you: boolean;
};

export type MembersPayload = { canManage: boolean; members: ProjectMember[] };

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const ListMembersInputSchema = z.strictObject(ProjectScopeSchema);
const InviteMemberInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  email: EmailSchema,
  role: z.enum(['member', 'viewer']),
});
const ChangeRoleInputSchema = z.strictObject({
  ...ProjectScopeSchema,
  memberId: IdSchema,
  role: z.enum(MEMBER_ROLES),
});
const RemoveMemberInputSchema = z.strictObject({ ...ProjectScopeSchema, memberId: IdSchema });

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

function toPayload(ctx: ActorContext, scope: Scope, rows: Row[]): MembersPayload {
  const owner = scope.tracker.ownerMemberId;
  return {
    canManage: ctx.kind === 'user' && !!scope.me && scope.me.id === owner,
    members: rows
      .filter((row) => row.removedAt === null)
      .map((row) => ({
        id: row.id,
        name: row.name,
        label: row.roleLabel,
        email: row.email ?? row.userEmail?.toLowerCase() ?? null,
        role: row.id === owner ? 'owner' : row.access,
        pending: isInvite(row),
        color: row.color,
        you: row.id === scope.me?.id,
      })),
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
    async (tx) => {
      const scope = await readScope(tx, ctx, projectId, actAs);
      return toPayload(ctx, scope, await memberRows(tx, scope.project.id));
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** One owner write: lock the project, check the acting owner, change, and answer with the new list. */
async function ownerWrite(
  db: Db,
  ctx: ActorContext,
  input: { projectId: string; actAs?: string | null },
  change: (tx: Tx, scope: Scope, rows: Row[]) => Promise<void>,
): Promise<MembersPayload> {
  return withTransaction(db, async (tx) => {
    let scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    requireOwner(ctx, scope);
    await change(tx, scope, await memberRows(tx, scope.project.id));
    scope = await writeScope(tx, ctx, input.projectId, input.actAs);
    return toPayload(ctx, scope, await memberRows(tx, scope.project.id));
  });
}

export async function inviteMember(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof InviteMemberInputSchema>,
): Promise<MembersPayload> {
  const input = parse(InviteMemberInputSchema, raw, 'Invalid invite');
  return ownerWrite(db, ctx, input, async (tx, scope, rows) => {
    const { email, role } = input;
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
    if (match && match.removedAt === null)
      throw new AppError('CONFLICT', `${email} is already in this project`);
    if (match) {
      await tx
        .update(trackerMembers)
        .set({
          removedAt: null,
          access: role,
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
      access: role,
    });
  });
}

function liveRow(rows: Row[], memberId: string): Row {
  const row = rows.find((item) => item.id === memberId && item.removedAt === null);
  if (!row) throw new AppError('NOT_FOUND', 'That person is not a member of this project');
  return row;
}

/** A person who cannot act any more hands each open change request they edit back to its author, or to the owner. */
async function releaseEditing(tx: Tx, scope: Scope, rows: Row[], memberId: string) {
  const projectId = scope.project.id;
  const canAct = new Set(
    rows
      .filter((row) => row.removedAt === null && row.access === 'member' && !isInvite(row))
      .map((row) => row.id),
  );
  canAct.delete(memberId);
  const crs = await tx
    .select()
    .from(trackerCrs)
    .where(
      and(
        eq(trackerCrs.projectId, projectId),
        eq(trackerCrs.editor, memberId),
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
    .where(and(eq(trackerCrAsks.projectId, projectId), eq(trackerCrAsks.memberId, memberId)));
}

const NEEDS_NEW_OWNER = 'Make another member the owner first';

export async function changeMemberRole(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ChangeRoleInputSchema>,
): Promise<MembersPayload> {
  const input = parse(ChangeRoleInputSchema, raw, 'Invalid role change');
  return ownerWrite(db, ctx, input, async (tx, scope, rows) => {
    const projectId = scope.project.id;
    const target = liveRow(rows, input.memberId);
    const owner = scope.tracker.ownerMemberId;
    const set = (id: string, values: Partial<typeof trackerMembers.$inferInsert>) =>
      tx
        .update(trackerMembers)
        .set(values)
        .where(and(eq(trackerMembers.projectId, projectId), eq(trackerMembers.id, id)));
    if (input.role !== 'owner') {
      if (target.id === owner) throw new AppError('VALIDATION', NEEDS_NEW_OWNER);
      await set(target.id, { access: input.role });
      if (input.role === 'viewer') await releaseEditing(tx, scope, rows, target.id);
      return;
    }
    if (target.id === owner) return;
    if (isInvite(target)) throw new AppError('VALIDATION', `${target.email} has not signed in yet`);
    await tx
      .update(trackerProjects)
      .set({ ownerMemberId: target.id })
      .where(eq(trackerProjects.projectId, projectId));
    await set(target.id, {
      access: 'member',
      ...(target.roleLabel ? {} : { roleLabel: OWNER_ROLE_LABEL }),
    });
    const previous = rows.find((row) => row.id === owner);
    if (previous?.roleLabel === OWNER_ROLE_LABEL) await set(owner, { roleLabel: '' });
  });
}

export async function removeMember(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof RemoveMemberInputSchema>,
): Promise<MembersPayload> {
  const input = parse(RemoveMemberInputSchema, raw, 'Invalid removal');
  return ownerWrite(db, ctx, input, async (tx, scope, rows) => {
    const target = liveRow(rows, input.memberId);
    if (target.id === scope.tracker.ownerMemberId)
      throw new AppError('VALIDATION', `The owner cannot leave the project. ${NEEDS_NEW_OWNER}.`);
    await tx
      .update(trackerMembers)
      .set({ removedAt: sql`now()` })
      .where(and(eq(trackerMembers.projectId, scope.project.id), eq(trackerMembers.id, target.id)));
    await releaseEditing(tx, scope, rows, target.id);
  });
}
