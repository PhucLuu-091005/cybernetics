import { and, eq } from 'drizzle-orm';
import type { ActorContext } from '../../contracts';
import { AppError } from '../errors';
import { projects, workspaceMembers } from '../db/schema';
import { isId, type Db, type ProjectRow, type Tx } from '../db/tx';
export async function requireProject(db: Db | Tx, ctx: ActorContext, projectId: string): Promise<ProjectRow> {
  if (!isId(projectId) || !isId(ctx.userId)) throw new AppError('NOT_FOUND', 'Project not found');
  const rows = await db.select().from(projects)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, ctx.userId)))
    .where(eq(projects.id, projectId)).limit(1);
  if (!rows.length || (ctx.kind === 'agent' && ctx.projectId !== projectId)) throw new AppError('NOT_FOUND', 'Project not found');
  return rows[0].projects;
}
