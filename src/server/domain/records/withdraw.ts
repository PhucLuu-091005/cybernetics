import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  WithdrawRecordInputSchema,
  type ActorContext,
  type WithdrawRecordResult,
} from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { projects, records } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { invalid } from './metadata';

export async function withdrawRecord(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof WithdrawRecordInputSchema>,
): Promise<WithdrawRecordResult> {
  if (ctx.kind !== 'user')
    throw new AppError('FORBIDDEN', 'Only browser users can withdraw records');
  const parsed = WithdrawRecordInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid withdrawal', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async (tx) => {
    const project = await lockProject(tx, ctx, input.projectId);
    const [record] = await tx
      .select({ id: records.id, withdrawnAt: records.withdrawnAt })
      .from(records)
      .where(and(eq(records.projectId, project.id), eq(records.id, input.recordId)))
      .limit(1)
      .for('update');
    if (!record) throw new AppError('NOT_FOUND', 'Record not found');
    return withReceipt(
      tx,
      {
        projectId: project.id,
        actorKey: actorKey(ctx),
        operation: 'withdraw_record',
        idempotencyKey: input.idempotencyKey,
        input,
      },
      async () => {
        const result = {
          projectId: project.id,
          recordId: record.id,
          withdrawn: true as const,
          requestId: ctx.requestId,
        };
        if (record.withdrawnAt !== null)
          return { ...result, evidenceRevision: project.evidenceRevision };
        if (project.evidenceRevision !== input.expectedEvidenceRevision)
          throw new AppError('CONFLICT', 'Evidence revision changed', {
            details: { evidenceRevision: project.evidenceRevision },
          });
        await tx
          .update(records)
          .set({ withdrawnAt: sql`now()`, withdrawnReason: input.reason })
          .where(and(eq(records.projectId, project.id), eq(records.id, record.id)));
        await tx
          .update(projects)
          .set({ evidenceRevision: sql`${projects.evidenceRevision} + 1` })
          .where(eq(projects.id, project.id));
        return { ...result, evidenceRevision: project.evidenceRevision + 1 };
      },
    );
  });
}
