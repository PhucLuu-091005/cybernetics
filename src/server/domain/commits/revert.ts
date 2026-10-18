import { z } from 'zod';
import {
  IdSchema,
  IdempotencyKeySchema,
  RevisionSchema,
  type ActorContext,
  type CommitPreview,
  type CommitReceipt,
  type Proposal,
  type PreviewRevertInput,
  type RevertCommitInput,
} from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { graphProposals } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { inverseCommit } from '../../graph/revert';
import { requireScope } from '../../http/scopes';
import { actorReference } from '../access';
import { toProject } from '../projects';
import { toProposal } from '../proposals/read';
import { assertValidCandidate } from '../proposals/update';
import { invalid } from '../records/metadata';
import {
  applyCommit,
  assertExpectedHead,
  parentOf,
  previewCommit,
  type CommitOperation,
} from './preview';
import { loadCommit } from './store';

const ProposalFromInverseInputSchema = z.strictObject({
  projectId: IdSchema,
  targetCommitId: IdSchema,
  expectedMainCommitId: IdSchema,
  expectedEvidenceRevision: RevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type ProposalFromInverseInput = z.input<typeof ProposalFromInverseInputSchema>;
const revert: CommitOperation = {
  kind: 'revert',
  async compute(db, projectId, target, main) {
    const parent = await parentOf(db, projectId, target);
    return inverseCommit(parent.snapshot, target.snapshot, main.snapshot);
  },
};

export function previewRevert(
  db: Db,
  ctx: ActorContext,
  raw: PreviewRevertInput,
): Promise<CommitPreview> {
  return previewCommit(db, ctx, revert, raw);
}
export function revertCommit(
  db: Db,
  ctx: ActorContext,
  raw: RevertCommitInput,
): Promise<CommitReceipt> {
  return applyCommit(db, ctx, revert, raw);
}

/** Conflicting entities keep main's image in the draft; the rationale lists them so the author resolves each one explicitly. */
export async function proposalFromInverse(
  db: Db,
  ctx: ActorContext,
  raw: ProposalFromInverseInput,
): Promise<Proposal> {
  requireScope(ctx, 'graph:propose');
  const parsed = ProposalFromInverseInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inverse proposal', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async (tx) => {
    const projectRow = await lockProject(tx, ctx, input.projectId);
    return withReceipt(
      tx,
      {
        projectId: projectRow.id,
        actorKey: actorKey(ctx),
        operation: 'proposal_from_inverse',
        idempotencyKey: input.idempotencyKey,
        input,
      },
      async () => {
        assertExpectedHead(projectRow, {
          mainCommitId: input.expectedMainCommitId,
          evidenceRevision: input.expectedEvidenceRevision,
        });
        const { id: projectId, mainCommitId, evidenceRevision } = toProject(projectRow);
        const target = await loadCommit(tx, projectId, input.targetCommitId);
        const parent = await parentOf(tx, projectId, target);
        const main = await loadCommit(tx, projectId, mainCommitId);
        const inverse = inverseCommit(parent.snapshot, target.snapshot, main.snapshot);
        if (!inverse.snapshot)
          throw new AppError(
            'CONFLICT',
            'The inverse cannot be composed with later changes; start a proposal from main instead',
            { details: { actualMainCommitId: main.id, conflicts: inverse.conflicts } },
          );
        await assertValidCandidate(
          tx,
          projectId,
          inverse.snapshot,
          new Map(),
          main.snapshot,
          'The proposed inverse is invalid',
        );
        const open = inverse.conflicts.map(
          (conflict) => `- ${conflict.collection}/${conflict.id}: ${conflict.reason}`,
        );
        const rationale = [
          `Inverse of commit ${target.id} (${target.message}).`,
          ...(open.length ? ['Resolve before merge:', ...open] : []),
        ]
          .join('\n')
          .slice(0, 10000);
        const [row] = await tx
          .insert(graphProposals)
          .values({
            workspaceId: projectRow.workspaceId,
            projectId,
            baseCommitId: main.id,
            candidate: inverse.snapshot,
            revision: 0,
            author: actorReference(ctx),
            title: `Undo: ${target.message}`.slice(0, 200),
            rationale,
            evidenceRevision,
            status: 'draft',
            mergedCommitId: null,
          })
          .returning();
        return toProposal(row);
      },
    );
  });
}
