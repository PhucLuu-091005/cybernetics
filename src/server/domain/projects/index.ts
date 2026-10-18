import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import {
  GetProjectInputSchema,
  ProjectSchema,
  type ActorContext,
  type GetProjectResult,
  type Project,
} from '../../../contracts';
import { AppError, invalidInput } from '../../errors';
import { projects, trackerProjects, users, workspaceMembers } from '../../db/schema';
import {
  findProjectForActor,
  isId,
  joinTransaction,
  projectOpenTo,
  withTransaction,
  type Db,
  type ProjectRow,
} from '../../db/tx';
import { requireScope } from '../../http/scopes';
import {
  DEFAULT_TIME_ZONE,
  FirstMilestoneSchema,
  noNul,
  ProjectTeamsSchema,
} from '../../../tracker';
import { createTrackerProject } from '../../tracker/projects';
const CreateProjectInputSchema = z.strictObject({
  title: ProjectSchema.shape.title,
  clientName: ProjectSchema.shape.clientName,
});
const EmptyProjectInputSchema = CreateProjectInputSchema.extend({
  title: noNul(ProjectSchema.shape.title),
  clientName: noNul(ProjectSchema.shape.clientName),
  teams: ProjectTeamsSchema,
  milestone: FirstMilestoneSchema,
});
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;
export const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  clientName: row.clientName,
});
export async function createProject(
  db: Db,
  ctx: ActorContext,
  raw: CreateProjectInput,
): Promise<Project> {
  if (ctx.kind !== 'user')
    throw new AppError('FORBIDDEN', 'Only browser users can create projects');
  const parsed = CreateProjectInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid project input', parsed.error);
  return withTransaction(db, async (tx) => {
    const [member] = isId(ctx.userId)
      ? await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, ctx.workspaceId),
              eq(workspaceMembers.userId, ctx.userId),
            ),
          )
          .limit(1)
      : [];
    if (!member) throw new AppError('NOT_FOUND', 'Workspace not found');
    const [row] = await tx
      .insert(projects)
      .values({ id: randomUUID(), workspaceId: ctx.workspaceId, ...parsed.data })
      .returning();
    return toProject(row);
  });
}
export async function createEmptyProject(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof EmptyProjectInputSchema>,
): Promise<Project> {
  const parsed = EmptyProjectInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid project input', parsed.error);
  const { teams, milestone, ...fields } = parsed.data;
  return withTransaction(db, async (tx) => {
    const project = await createProject(joinTransaction(tx), ctx, fields);
    const [user] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);
    await createTrackerProject(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      userId: ctx.userId,
      userName: user.name,
      teams,
      milestone,
      demo: false,
    });
    return project;
  });
}
export async function getProject(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetProjectInputSchema>,
): Promise<GetProjectResult> {
  requireScope(ctx, 'project:read');
  const parsed = GetProjectInputSchema.safeParse(raw);
  if (!parsed.success) throw invalidInput('Invalid project read', parsed.error);
  const row = await findProjectForActor(db, ctx, parsed.data.projectId, false);
  const [tracker] = await db
    .select({ timeZone: trackerProjects.timeZone })
    .from(trackerProjects)
    .where(eq(trackerProjects.projectId, row.id))
    .limit(1);
  return {
    project: toProject(row),
    timeZone: tracker?.timeZone ?? DEFAULT_TIME_ZONE,
    requestId: ctx.requestId,
  };
}
export async function listProjects(db: Db, ctx: ActorContext): Promise<Project[]> {
  if (!isId(ctx.userId)) return [];
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        projectOpenTo(ctx.userId),
        ctx.kind === 'agent' && ctx.projectId ? eq(projects.id, ctx.projectId) : undefined,
      ),
    )
    .orderBy(asc(projects.createdAt), asc(projects.id));
  return rows.map(toProject);
}
