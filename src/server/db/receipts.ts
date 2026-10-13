import { and, eq, sql } from 'drizzle-orm';
import type { ActorContext } from '../../contracts';
import { canonicalHash } from '../../lib/canonical-json';
import { AppError } from '../errors';
import { mutationReceipts } from './schema';
import type { Tx } from './tx';
export type ReceiptKey = { projectId: string; actorKey: string; operation: string; idempotencyKey: string; input: unknown };
export const actorKey = (ctx: ActorContext) => ctx.kind === 'agent' ? `token:${ctx.tokenId}` : `user:${ctx.userId}`;
export async function withReceipt<T>(tx: Tx, key: ReceiptKey, run: () => Promise<T>): Promise<T> {
  const requestHash = canonicalHash(key.input);
  const identity = { projectId: key.projectId, actorKey: key.actorKey, operation: key.operation, idempotencyKey: key.idempotencyKey };
  // A concurrent duplicate waits here until the first transaction commits, then replays its receipt instead of running again.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${identity.projectId}:${identity.actorKey}:${identity.operation}:${identity.idempotencyKey}`}, 0))`);
  const [existing] = await tx.select({ requestHash: mutationReceipts.requestHash, result: mutationReceipts.result }).from(mutationReceipts)
    .where(and(eq(mutationReceipts.projectId, identity.projectId), eq(mutationReceipts.actorKey, identity.actorKey), eq(mutationReceipts.operation, identity.operation), eq(mutationReceipts.idempotencyKey, identity.idempotencyKey))).limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError('CONFLICT', 'Idempotency key reused with different input');
    return existing.result as T;
  }
  const raw = await run();
  if (raw === undefined) throw new AppError('INTERNAL', 'Receipt result must be a JSON value');
  // The first response must match what a replay will return from jsonb.
  const result = JSON.parse(JSON.stringify(raw)) as T;
  const inserted = await tx.insert(mutationReceipts).values({ ...identity, requestHash, result }).onConflictDoNothing().returning({ projectId: mutationReceipts.projectId });
  if (!inserted.length) throw new AppError('INTERNAL', 'Receipt already exists despite the advisory lock');
  return result;
}
