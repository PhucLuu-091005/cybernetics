import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { IdSchema, type ActorContext } from '../../contracts';
import { AppError } from '../errors';
import * as schema from './schema';
import { projects } from './schema';
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
export async function lockProject(tx: Tx, ctx: ActorContext, projectId: string): Promise<ProjectRow> {
  if (!isId(projectId) || (ctx.kind === 'agent' && ctx.projectId !== projectId)) throw new AppError('NOT_FOUND', 'Project not found');
  const [row] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId))).for('update');
  if (!row) throw new AppError('NOT_FOUND', 'Project not found');
  return row;
}
