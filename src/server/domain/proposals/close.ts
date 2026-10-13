import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { CloseProposalInputSchema, type ActorContext, type Proposal } from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { graphProposals } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { invalid } from '../records/metadata';
import { findProposal, toProposal } from './read';

export async function closeProposal(db: Db, ctx: ActorContext, raw: z.input<typeof CloseProposalInputSchema>): Promise<Proposal> {
  requireScope(ctx, 'graph:propose');
  const parsed = CloseProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal close', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const project = await lockProject(tx, ctx, input.projectId);
    const row = await findProposal(tx, project.id, input.proposalId, true);
    return withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'close_proposal', idempotencyKey: input.idempotencyKey, input }, async () => {
      const details = { actualProposalRevision: row.revision, status: row.status };
      if (row.status !== 'draft') throw new AppError('CONFLICT', `Proposal is ${row.status}, not a draft`, { details });
      if (row.revision !== input.expectedProposalRevision) throw new AppError('CONFLICT', 'Proposal changed since the expected revision', { details });
      const [closed] = await tx.update(graphProposals).set({ status: 'closed', updatedAt: sql`now()` })
        .where(and(eq(graphProposals.projectId, project.id), eq(graphProposals.id, row.id))).returning();
      return toProposal(closed);
    });
  });
}
