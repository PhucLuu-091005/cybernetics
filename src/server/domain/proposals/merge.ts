import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { MergeProposalInputSchema, type ActorContext, type CommitReceipt } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { graphProposals } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { actorReference } from '../access';
import { advanceMain, insertCommit, loadCommit } from '../commits/store';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { assertReviewBasis, reviewDigest } from './digest';
import { findProposal } from './read';
import { assertValidCandidate } from './update';

export async function mergeProposal(db: Db, ctx: ActorContext, raw: z.input<typeof MergeProposalInputSchema>): Promise<CommitReceipt> {
  requireScope(ctx, 'graph:merge');
  const parsed = MergeProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid merge', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const projectRow = await lockProject(tx, ctx, input.projectId);
    const project = toProject(projectRow);
    const row = await findProposal(tx, project.id, input.proposalId, true);
    return withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'merge_proposal', idempotencyKey: input.idempotencyKey, input }, async () => {
      assertReviewBasis(projectRow, row, { mainCommitId: input.expectedMainCommitId, proposalRevision: input.expectedProposalRevision, evidenceRevision: input.expectedEvidenceRevision });
      if (row.baseCommitId !== project.mainCommitId) throw new AppError('CONFLICT', 'Rebase required: the proposal is not based on the current main commit', { details: { actualMainCommitId: project.mainCommitId, baseCommitId: row.baseCommitId } });
      const snapshotHash = canonicalHash(row.candidate);
      const digest = reviewDigest({ baseCommitId: row.baseCommitId, proposalRevision: row.revision, mainCommitId: project.mainCommitId, evidenceRevision: project.evidenceRevision, snapshotHash, T: input.T });
      if (digest !== input.reviewDigest) throw new AppError('CONFLICT', 'Review digest does not match the current review inputs; refresh the review', { details: { actualMainCommitId: project.mainCommitId, actualProposalRevision: row.revision, actualEvidenceRevision: project.evidenceRevision } });
      await assertValidCandidate(tx, project.id, row.candidate, new Map());
      const parent = await loadCommit(tx, project.id, project.mainCommitId);
      const commit = await insertCommit(tx, {
        workspaceId: projectRow.workspaceId, projectId: project.id, sequence: parent.sequence + 1, parentId: parent.id, snapshot: row.candidate, snapshotHash, actor: actorReference(ctx),
        message: input.message, kind: 'merge', proposalId: row.id, targetCommitId: null, reviewedEvidenceRevision: project.evidenceRevision,
      });
      await advanceMain(tx, project.id, parent.id, commit.id);
      await tx.update(graphProposals).set({ status: 'merged', mergedCommitId: commit.id, updatedAt: sql`now()` }).where(and(eq(graphProposals.projectId, project.id), eq(graphProposals.id, row.id)));
      return { projectId: project.id, commitId: commit.id, parentCommitId: parent.id, sequence: commit.sequence, snapshotHash, evidenceRevision: project.evidenceRevision, kind: 'merge' as const, proposalId: row.id, targetCommitId: null, idempotencyKey: input.idempotencyKey, requestId: ctx.requestId };
    });
  });
}
