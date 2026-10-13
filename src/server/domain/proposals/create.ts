import type { z } from 'zod';
import { CreateProposalInputSchema, type ActorContext, type Proposal } from '../../../contracts';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { graphProposals } from '../../db/schema';
import { lockProject, withTransaction, type Db } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { actorReference } from '../access';
import { loadCommit } from '../commits/store';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { toProposal } from './read';

export async function createProposal(db: Db, ctx: ActorContext, raw: z.input<typeof CreateProposalInputSchema>): Promise<Proposal> {
  requireScope(ctx, 'graph:propose');
  const parsed = CreateProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal', parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const project = await lockProject(tx, ctx, input.projectId);
    const { mainCommitId, evidenceRevision } = toProject(project);
    return withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'create_proposal', idempotencyKey: input.idempotencyKey, input }, async () => {
      if (input.baseCommitId !== mainCommitId || input.expectedEvidenceRevision !== evidenceRevision) throw new AppError('CONFLICT', 'Proposals start from the current main commit and evidence revision', { details: { actualMainCommitId: mainCommitId, actualEvidenceRevision: evidenceRevision } });
      const base = await loadCommit(tx, project.id, mainCommitId);
      const [row] = await tx.insert(graphProposals).values({
        workspaceId: project.workspaceId, projectId: project.id, baseCommitId: base.id, candidate: base.snapshot, revision: 0, author: actorReference(ctx),
        title: input.title, rationale: input.rationale, evidenceRevision, status: 'draft', mergedCommitId: null,
      }).returning();
      return toProposal(row);
    });
  });
}
