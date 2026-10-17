import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema, type ActorContext } from '../../contracts';
import type { CrPermission, CrStatus, Member } from '../../tracker';
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
  // A viewer has a member row but acts as no one, so they read like a workspace guest.
  const own = members.find((item) => item.userId === ctx.userId && item.active) ?? null;
  // The cookie only switches a member to another member; it never makes a guest a member.
  if (!actAs || !own) return own;
  if (ctx.kind === 'agent') throw new AppError('FORBIDDEN', 'An agent acts only as its user');
  if (!tracker.demo)
    throw new AppError('FORBIDDEN', 'Working as another person works only in a demo project');
  if (!canSwitch)
    throw new AppError('FORBIDDEN', 'Only the person of this sandbox can work as another person');
  const member = members.find((item) => item.id === actAs && item.active);
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
  const tracker = await findTracker(tx, project.id);
  return resolveActing(
    tracker,
    await loadMembers(tx, project.id),
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
  /** The demo select may switch the acting member. */
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
  const tracker = await findTracker(db, project.id);
  const members = await loadMembers(db, project.id);
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

/** Agents may add to the Queue as the member of their token user. */
export function requireQueueWriter(me: Member | null): Member {
  if (!me) throw notMember();
  return me;
}

export function requireMember(ctx: ActorContext, me: Member | null): Member {
  if (ctx.kind === 'agent')
    throw new AppError('FORBIDDEN', 'An agent can only read and add to the Queue');
  if (!me) throw notMember();
  return me;
}

export function requireOwner(ctx: ActorContext, scope: Scope): Member {
  const me = requireMember(ctx, scope.me);
  if (me.id !== scope.tracker.ownerMemberId)
    throw new AppError('FORBIDDEN', 'Only the owner of Main can do this');
  return me;
}

export function requireEditor(ctx: ActorContext, scope: Scope, cr: CrRow): Member {
  const me = requireMember(ctx, scope.me);
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

export const hasEditRight = (
  cr: Pick<CrRow, 'author'>,
  shares: ReadonlyArray<{ memberId: string; permission: CrPermission }>,
  memberId: string,
) =>
  cr.author === memberId ||
  shares.some((share) => share.memberId === memberId && share.permission === 'edit');
