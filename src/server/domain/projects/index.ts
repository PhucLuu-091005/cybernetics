import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import {
  GraphSnapshotSchema,
  ProjectSchema,
  type ActorContext,
  type GraphSnapshot,
  type Project,
} from '../../../contracts';
import { localDate } from '../../../lib/calendar';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { graphCommits, projects, workspaceMembers } from '../../db/schema';
import { isId, withTransaction, type Db, type ProjectRow } from '../../db/tx';
const CreateProjectInputSchema = z.strictObject({
  title: ProjectSchema.shape.title,
  clientName: ProjectSchema.shape.clientName,
  snapshot: GraphSnapshotSchema.optional(),
});
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;
export function emptySnapshot(timeZone = 'Asia/Ho_Chi_Minh', now = new Date()): GraphSnapshot {
  const windowStart = localDate(now, timeZone);
  const windowEnd = new Date(Date.parse(`${windowStart}T00:00:00Z`) + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    schemaVersion: 1,
    context: {
      timeZone,
      windowStart,
      windowEnd,
      asOfOverride: null,
      holidays: [],
      replyWindowDays: 2,
      acceptWindowDays: 5,
      hedgeWindowDays: 5,
      atRiskWindowDays: 2,
      people: [],
      departments: [],
      milestones: [],
    },
    acts: [],
    loops: [],
    annotations: [],
    recordDecisions: [],
  };
}
export function toProject(row: ProjectRow): Project {
  if (row.mainCommitId === null) throw new AppError('INTERNAL', 'Project has no main commit');
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    clientName: row.clientName,
    mainCommitId: row.mainCommitId,
    evidenceRevision: row.evidenceRevision,
    sourceRouting: row.sourceRouting,
  };
}
export async function createProject(
  db: Db,
  ctx: ActorContext,
  raw: CreateProjectInput,
): Promise<Project> {
  if (ctx.kind !== 'user')
    throw new AppError('FORBIDDEN', 'Only browser users can create projects');
  const parsed = CreateProjectInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Invalid project input', {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  const { title, clientName } = parsed.data,
    snapshot = parsed.data.snapshot ?? emptySnapshot();
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
    const projectId = randomUUID(),
      commitId = randomUUID();
    await tx
      .insert(projects)
      .values({ id: projectId, workspaceId: ctx.workspaceId, title, clientName });
    await tx.insert(graphCommits).values({
      id: commitId,
      workspaceId: ctx.workspaceId,
      projectId,
      sequence: 0,
      parentId: null,
      snapshot,
      snapshotHash: canonicalHash(snapshot),
      actor: { kind: 'user', userId: ctx.userId },
      message: 'Initial graph',
      kind: 'initial',
      proposalId: null,
      targetCommitId: null,
      reviewedEvidenceRevision: 0,
    });
    const [row] = await tx
      .update(projects)
      .set({ mainCommitId: commitId })
      .where(eq(projects.id, projectId))
      .returning();
    return toProject(row);
  });
}
export async function listProjects(db: Db, ctx: ActorContext): Promise<Project[]> {
  if (!isId(ctx.userId)) return [];
  const rows = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, ctx.userId),
      ),
    )
    .where(
      and(
        isNotNull(projects.mainCommitId),
        ctx.kind === 'agent' ? eq(projects.id, ctx.projectId) : undefined,
      ),
    )
    .orderBy(asc(projects.createdAt), asc(projects.id));
  return rows.map((row) => toProject(row.project));
}
