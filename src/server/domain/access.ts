import type { ActorContext } from '../../contracts';
import { findProjectForActor, type Db, type ProjectRow, type Tx } from '../db/tx';
export function requireProject(
  db: Db | Tx,
  ctx: ActorContext,
  projectId: string,
): Promise<ProjectRow> {
  return findProjectForActor(db, ctx, projectId, false);
}
