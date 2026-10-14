import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  ApplyRebaseInputSchema,
  type Act,
  type ActorContext,
  type FieldError,
  type Proposal,
} from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { graphProposals } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { resolveRebase } from '../../graph/resolve';
import { requireScope } from '../../http/scopes';
import { invalid } from '../records/metadata';
import { assertRebaseBasis, computeRebase } from './rebase-preview';
import { findProposal, toProposal } from './read';
import { assertValidCandidate } from './update';

export async function applyRebase(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ApplyRebaseInputSchema>,
): Promise<Proposal> {
  requireScope(ctx, 'graph:propose');
  const parsed = ApplyRebaseInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid rebase', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async (tx) => {
    const project = await lockProject(tx, ctx, input.projectId);
    const row = await findProposal(tx, project.id, input.proposalId, true);
    return withReceipt(
      tx,
      {
        projectId: project.id,
        actorKey: actorKey(ctx),
        operation: 'apply_rebase',
        idempotencyKey: input.idempotencyKey,
        input,
      },
      async () => {
        assertRebaseBasis(project, row, {
          mainCommitId: input.expectedMainCommitId,
          proposalRevision: input.expectedProposalRevision,
          evidenceRevision: input.expectedEvidenceRevision,
        });
        const { base, main, digest } = await computeRebase(tx, project, row);
        if (digest !== input.reviewDigest)
          throw new AppError(
            'CONFLICT',
            'Rebase preview digest does not match the current inputs; preview the rebase again',
            {
              details: {
                actualMainCommitId: main.id,
                actualProposalRevision: row.revision,
                actualEvidenceRevision: project.evidenceRevision,
                baseCommitId: base.id,
              },
            },
          );
        const resolved = resolveRebase(
          base.snapshot,
          row.candidate,
          main.snapshot,
          input.resolutions,
        );
        if (!resolved.snapshot)
          throw new AppError('CONFLICT', 'Rebase has unresolved or invalid conflict resolutions', {
            details: {
              actualMainCommitId: main.id,
              actualProposalRevision: row.revision,
              conflicts: resolved.conflicts,
            },
          });
        const quotes = new Map<string, string>(),
          missing: FieldError[] = [];
        input.resolutions.forEach((resolution, index) => {
          if (
            resolution.choice !== 'replacement' ||
            resolution.collection !== 'acts' ||
            resolution.value === null
          )
            return;
          if (resolution.quote === undefined)
            missing.push({
              path: `resolutions.${index}.quote`,
              message: 'A replacement act requires the quote of its cited text',
            });
          else quotes.set((resolution.value as Act).id, resolution.quote);
        });
        if (missing.length)
          throw new AppError('VALIDATION', 'Rebase resolution is invalid', { errors: missing });
        await assertValidCandidate(
          tx,
          project.id,
          resolved.snapshot,
          quotes,
          main.snapshot,
          'Rebased snapshot is invalid',
        );
        const [updated] = await tx
          .update(graphProposals)
          .set({
            baseCommitId: main.id,
            candidate: resolved.snapshot,
            revision: row.revision + 1,
            evidenceRevision: project.evidenceRevision,
            updatedAt: sql`now()`,
          })
          .where(and(eq(graphProposals.projectId, project.id), eq(graphProposals.id, row.id)))
          .returning();
        return toProposal(updated);
      },
    );
  });
}
