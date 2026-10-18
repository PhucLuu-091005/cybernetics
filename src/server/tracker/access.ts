import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import {
  rightsOf,
  type CrPermission,
  type CrStatus,
  type Member,
  type PermissionSubject,
  type Rights,
} from '../../tracker';
import { AppError } from '../errors';
import { trackerCrShares, workspaceMembers } from '../db/schema';
import { findProjectForActor, lockProject, type ProjectRow, type Tx } from '../db/tx';
import {
  findTracker,
  loadMembers,
  type CrRow,
  type Reader,
  type Tenant,
  type TrackerRow,
} from './store';

/** The `pg_act_<projectId>` cookie value; anything that names no member is rejected later. */
export const ActAsSchema = z.string().max(200).nullish();
export const ProjectScopeSchema = { projectId: IdSchema, actAs: ActAsSchema };

export function resolveActing(
  tracker: Pick<TrackerRow, 'demo'>,
  members: readonly Member[],
  ctx: ActorContext,
  actAs?: string | null,
  canSwitch = true,
): Member | null {
  const own = members.find((item) => item.userId === ctx.userId && item.active) ?? null;
  // The cookie only switches a member to another member; it never makes a guest a member.
  if (!actAs || !own) return own;
  if (ctx.kind === 'agent') throw new AppError('FORBIDDEN', 'An agent acts only as its user');
  if (!tracker.demo)
    throw new AppError('FORBIDDEN', 'Working as another person works only in a demo project');
  if (!canSwitch)
    throw new AppError('FORBIDDEN', 'Only the person of this sandbox can work as another person');
  // A real person speaks only for themself, so the sandbox plays the seeded people and its own member.
  const member = members.find(
    (item) =>
      item.id === actAs && item.active && (item.userId === null || item.userId === ctx.userId),
  );
  if (!member) throw new AppError('FORBIDDEN', 'That person is not a member of this project');
  return member;
}

/** A demo sandbox lets its own person play every member; someone invited into it works as themself. */
async function canSwitchMember(
  db: Reader,
  ctx: ActorContext,
  project: ProjectRow,
  tracker: TrackerRow,
): Promise<boolean> {
  if (!tracker.demo || ctx.kind !== 'user') return false;
  const [row] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, project.workspaceId),
        eq(workspaceMembers.userId, ctx.userId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function actingMember(
  tx: Tx,
  ctx: ActorContext,
  projectId: string,
  actAsCookie?: string | null,
): Promise<Member | null> {
  const project = await findProjectForActor(tx, ctx, projectId, false);
  const members = await loadMembers(tx, project.id);
  const tracker = await findTracker(tx, project.id, members);
  return resolveActing(
    tracker,
    members,
    ctx,
    actAsCookie,
    await canSwitchMember(tx, ctx, project, tracker),
  );
}

export type Scope = {
  project: ProjectRow;
  tracker: TrackerRow;
  members: Member[];
  me: Member | null;
  canActAs: boolean;
  /** The signed-in person, who stays the same while they act as another member. */
  userId: string;
  tenant: Tenant;
};

async function scopeOf(
  db: Reader,
  ctx: ActorContext,
  project: ProjectRow,
  actAs?: string | null,
): Promise<Scope> {
  const members = await loadMembers(db, project.id);
  const tracker = await findTracker(db, project.id, members);
  const canSwitch = await canSwitchMember(db, ctx, project, tracker);
  const me = resolveActing(tracker, members, ctx, actAs, canSwitch);
  return {
    project,
    tracker,
    members,
    me,
    canActAs: canSwitch && me !== null,
    userId: ctx.userId,
    tenant: { workspaceId: project.workspaceId, projectId: project.id },
  };
}

export async function readScope(
  db: Reader,
  ctx: ActorContext,
  projectId: string,
  actAs?: string | null,
): Promise<Scope> {
  return scopeOf(db, ctx, await findProjectForActor(db, ctx, projectId, false), actAs);
}

/** Every tracker write serializes on the project row. */
export async function writeScope(
  tx: Tx,
  ctx: ActorContext,
  projectId: string,
  actAs?: string | null,
): Promise<Scope> {
  return scopeOf(tx, ctx, await lockProject(tx, ctx, projectId), actAs);
}

const notMember = () =>
  new AppError('FORBIDDEN', 'You can read this project, but you are not a member of it');

export const subjectOf = (scope: Pick<Scope, 'me' | 'tracker'>): PermissionSubject => ({
  me: scope.me,
  project: { leadMemberId: scope.tracker.ownerMemberId },
  base: scope.tracker.base,
});

/** The rights of any member of the scope, for example the person a change request goes to. */
export const rightsIn = (scope: Pick<Scope, 'tracker'>, member: Member): Rights =>
  rightsOf(subjectOf({ tracker: scope.tracker, me: member }));

const MISSING: Record<keyof Rights, string> = {
  viewMain: 'You cannot see Main of this project. Ask the project lead for access',
  viewCrs: 'You cannot see the change requests of this project',
  create: 'You cannot create or edit change requests in this project',
  merge: 'You cannot merge change requests in this project',
  manage: 'Only the project lead can do this',
};

export function requireRight(
  ctx: ActorContext,
  scope: Pick<Scope, 'me' | 'tracker'>,
  right: keyof Rights,
): Member {
  if (ctx.kind === 'agent')
    throw new AppError('FORBIDDEN', 'An agent can only read and add to the Queue');
  if (!scope.me) throw notMember();
  if (!rightsOf(subjectOf(scope))[right]) throw new AppError('FORBIDDEN', MISSING[right]);
  return scope.me;
}

/** A member with no grant left still sees the Members page, so they know whom to ask. */
export function requireView(scope: Pick<Scope, 'me' | 'tracker' | 'members'>): void {
  if (rightsOf(subjectOf(scope)).viewMain) return;
  const lead = scope.members.find((member) => member.id === scope.tracker.ownerMemberId);
  throw new AppError(
    'FORBIDDEN',
    `You cannot see Main of this project. Ask ${lead?.name ?? 'the project lead'} for access`,
    {
      details: { reason: 'no-view', lead: lead?.name ?? null },
    },
  );
}

/** Agents add to the Queue as the member of their token user, with that member's rights. */
export function requireQueueWriter(scope: Pick<Scope, 'me' | 'tracker'>): Member {
  if (!scope.me) throw notMember();
  if (!rightsOf(subjectOf(scope)).create) throw new AppError('FORBIDDEN', MISSING.create);
  return scope.me;
}

export function requireEditor(ctx: ActorContext, scope: Scope, cr: CrRow): Member {
  const me = requireRight(ctx, scope, 'create');
  if (cr.editor !== me.id)
    throw new AppError('FORBIDDEN', `Only the person who edits #${cr.num} now can do this`);
  return me;
}

export const OPEN: readonly CrStatus[] = ['draft', 'ready'];

export function requireStatus(cr: CrRow, allowed: readonly CrStatus[]): void {
  if (!allowed.includes(cr.status))
    throw new AppError('CONFLICT', `#${cr.num} is ${cr.status}`, {
      details: { status: cr.status, revision: cr.revision },
    });
}

export async function loadShares(
  tx: Tx,
  cr: CrRow,
): Promise<Array<{ memberId: string; permission: CrPermission }>> {
  return tx
    .select({ memberId: trackerCrShares.memberId, permission: trackerCrShares.permission })
    .from(trackerCrShares)
    .where(and(eq(trackerCrShares.projectId, cr.projectId), eq(trackerCrShares.crId, cr.id)));
}

/** A part in the change request; the create right is checked apart. */
export const hasEditRight = (
  cr: Pick<CrRow, 'author'>,
  shares: ReadonlyArray<{ memberId: string; permission: CrPermission }>,
  memberId: string,
) =>
  cr.author === memberId ||
  shares.some((share) => share.memberId === memberId && share.permission === 'edit');
