import { and, eq } from 'drizzle-orm';
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
  const [existing] = await tx.select({ requestHash: mutationReceipts.requestHash, result: mutationReceipts.result }).from(mutationReceipts)
    .where(and(eq(mutationReceipts.projectId, identity.projectId), eq(mutationReceipts.actorKey, identity.actorKey), eq(mutationReceipts.operation, identity.operation), eq(mutationReceipts.idempotencyKey, identity.idempotencyKey))).limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new AppError('CONFLICT', 'Idempotency key reused with different input');
    return existing.result as T;
  }
  const result = await run();
  const inserted = await tx.insert(mutationReceipts).values({ ...identity, requestHash, result }).onConflictDoNothing().returning({ projectId: mutationReceipts.projectId });
  // A concurrent request with the same key committed first; throwing rolls back this run so the retry replays the stored result.
  if (!inserted.length) throw new AppError('CONFLICT', 'Concurrent request with the same idempotency key; retry');
  return result;
}
