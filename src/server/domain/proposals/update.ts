import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { UpdateProposalInputSchema, type ActorContext, type GraphSnapshot, type Proposal } from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { graphProposals } from '../../db/schema';
import { lockProject, withTransaction, type Db, type Tx } from '../../db/tx';
import { applyOperations } from '../../graph/apply-operations';
import { citedVersionIds, snapshotLimitErrors, validateSnapshot, verifyQuote } from '../../graph/validate';
import { requireScope } from '../../http/scopes';
import { loadCommit } from '../commits/store';
import { invalid, loadRecordMetadata } from '../records/metadata';
import { findProposal, toProposal } from './read';

/** Quotes are checked against the act as it stands after the whole batch; the baseline decides which withdrawn citations are carried, not new. */
export async function assertValidCandidate(tx: Tx, projectId: string, snapshot: GraphSnapshot, quotes: Map<string, string>, baseline: GraphSnapshot): Promise<void> {
  const limits = snapshotLimitErrors(snapshot);
  if (limits.length) throw new AppError('LIMIT_EXCEEDED', 'Snapshot exceeds a P0 limit', { errors: limits });
  const evidence = await loadRecordMetadata(tx, projectId, citedVersionIds(snapshot));
  const acts = new Map(snapshot.acts.map(act => [act.id, act]));
  const errors = [...quotes].flatMap(([actId, quote]) => {
    const act = acts.get(actId), error = act ? verifyQuote(act, quote, evidence, baseline) : null;
    return error ? [error] : [];
  });
  errors.push(...validateSnapshot(snapshot, evidence, baseline));
  if (errors.length) throw new AppError('VALIDATION', 'Proposal snapshot is invalid', { errors });
}

export async function updateProposal(db: Db, ctx: ActorContext, raw: z.input<typeof UpdateProposalInputSchema>): Promise<Proposal> {
  requireScope(ctx, 'graph:propose');
  const parsed = UpdateProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal update', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const project = await lockProject(tx, ctx, input.projectId);
    const row = await findProposal(tx, project.id, input.proposalId, true);
    return withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'update_proposal', idempotencyKey: input.idempotencyKey, input }, async () => {
      const details = { actualProposalRevision: row.revision, actualEvidenceRevision: project.evidenceRevision, status: row.status };
      if (row.status !== 'draft') throw new AppError('CONFLICT', `Proposal is ${row.status}, not a draft`, { details });
      if (row.revision !== input.expectedProposalRevision || project.evidenceRevision !== input.expectedEvidenceRevision) throw new AppError('CONFLICT', 'Proposal or evidence changed since the expected revision', { details });
      const { snapshot, quotes } = applyOperations(row.candidate, input.operations);
      await assertValidCandidate(tx, project.id, snapshot, quotes, (await loadCommit(tx, project.id, row.baseCommitId)).snapshot);
      const [updated] = await tx.update(graphProposals).set({ candidate: snapshot, revision: row.revision + 1, evidenceRevision: project.evidenceRevision, updatedAt: sql`now()` })
        .where(and(eq(graphProposals.projectId, project.id), eq(graphProposals.id, row.id))).returning();
      return toProposal(updated);
    });
  });
}
