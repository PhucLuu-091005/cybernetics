import type { ActorContext, ActorReference } from '../../contracts';
import { findProjectForActor, type Db, type ProjectRow, type Tx } from '../db/tx';
export function requireProject(
  db: Db | Tx,
  ctx: ActorContext,
  projectId: string,
): Promise<ProjectRow> {
  return findProjectForActor(db, ctx, projectId, false);
}
export function actorReference(ctx: ActorContext): ActorReference {
  return ctx.kind === 'agent'
    ? { kind: 'agent', userId: ctx.userId, tokenId: ctx.tokenId }
    : { kind: 'user', userId: ctx.userId };
}
