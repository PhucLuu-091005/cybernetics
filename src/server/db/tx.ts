import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IdSchema, type ActorContext } from '../../contracts';
import { AppError } from '../errors';
import * as schema from './schema';
import { projects, trackerMembers, workspaceMembers } from './schema';
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type ProjectRow = typeof projects.$inferSelect;
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
/** Drizzle runs a nested transaction() as a savepoint and ignores its isolation options, so domain functions written for Db can join an outer transaction. */
export function joinTransaction(tx: Tx): Db {
  return tx as unknown as Db;
}
export const isId = (value: string) => IdSchema.safeParse(value).success;
/** Postgres renders timestamptz as "2026-10-13 10:00:00.123+00"; contracts require ISO 8601. */
export function toIso(value: string): string {
  return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString();
}
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    const pg = current as Error & { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
  }
  return false;
}
/** A person opens a project through its workspace, or through a member row of their own; a removed member row closes it either way. */
export function projectOpenTo(userId: string): SQL {
  const own = sql`select 1 from ${trackerMembers} where ${trackerMembers.projectId} = ${projects.id} and ${trackerMembers.userId} = ${userId}`;
  return sql`((exists (select 1 from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${projects.workspaceId} and ${workspaceMembers.userId} = ${userId}) and not exists (${own} and ${trackerMembers.removedAt} is not null)) or exists (${own} and ${trackerMembers.removedAt} is null))`;
}
/** A key that acts as a seeded demo member reaches only that member's project; other actors reach all. */
export function keyReaches(ctx: ActorContext): SQL | undefined {
  if (ctx.kind !== 'agent' || !ctx.memberId) return undefined;
  return sql`${projects.id} in (select ${trackerMembers.projectId} from ${trackerMembers} where ${trackerMembers.id} = ${ctx.memberId})`;
}
/** Membership decides access; callers write with the returned row's workspaceId, never ctx.workspaceId. */
export async function findProjectForActor(
  db: Db | Tx,
  ctx: ActorContext,
  projectId: string,
  lock: boolean,
): Promise<ProjectRow> {
  if (!isId(projectId) || !isId(ctx.userId)) throw new AppError('NOT_FOUND', 'Project not found');
  const query = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), projectOpenTo(ctx.userId), keyReaches(ctx)))
    .limit(1);
  const rows = lock ? await query.for('update') : await query;
  if (
    !rows.length ||
    (ctx.kind === 'agent' &&
      (ctx.projectId !== projectId || ctx.workspaceId !== rows[0].workspaceId))
  )
    throw new AppError('NOT_FOUND', 'Project not found');
  return rows[0];
}
export function lockProject(tx: Tx, ctx: ActorContext, projectId: string): Promise<ProjectRow> {
  return findProjectForActor(tx, ctx, projectId, true);
}
