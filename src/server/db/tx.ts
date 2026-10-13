import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IdSchema, type ActorContext } from '../../contracts';
import { AppError } from '../errors';
import * as schema from './schema';
import { projects, workspaceMembers } from './schema';
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type ProjectRow = typeof projects.$inferSelect;
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> { return db.transaction(fn); }
export const isId = (value: string) => IdSchema.safeParse(value).success;
/** Postgres renders timestamptz as "2026-10-13 10:00:00.123+00"; contracts require ISO 8601. */
export function toIso(value: string): string { return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString(); }
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    const pg = current as Error & { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
  }
  return false;
}
/** Membership decides access; callers write with the returned row's workspaceId, never ctx.workspaceId. */
export async function findProjectForActor(db: Db | Tx, ctx: ActorContext, projectId: string, lock: boolean): Promise<ProjectRow> {
  if (!isId(projectId) || !isId(ctx.userId)) throw new AppError('NOT_FOUND', 'Project not found');
  const query = db.select().from(projects)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, projects.workspaceId), eq(workspaceMembers.userId, ctx.userId)))
    .where(eq(projects.id, projectId)).limit(1);
  const rows = lock ? await query.for('update', { of: projects }) : await query;
  if (!rows.length || (ctx.kind === 'agent' && (ctx.projectId !== projectId || ctx.workspaceId !== rows[0].projects.workspaceId))) throw new AppError('NOT_FOUND', 'Project not found');
  return rows[0].projects;
}
export function lockProject(tx: Tx, ctx: ActorContext, projectId: string): Promise<ProjectRow> { return findProjectForActor(tx, ctx, projectId, true); }
