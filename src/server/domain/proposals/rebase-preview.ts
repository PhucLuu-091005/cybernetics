import type { z } from 'zod';
import { PreviewRebaseInputSchema, type ActorContext, type Commit, type RebasePreview, type RebaseResult } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import type { Db, ProjectRow, Tx } from '../../db/tx';
import { diffSnapshots } from '../../graph/diff';
import { threeWayRebase } from '../../graph/rebase';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { loadCommit } from '../commits/store';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { findProposal, type ProposalRow } from './read';

export type RebaseExpected = { mainCommitId: string; proposalRevision: number; evidenceRevision: number };
export type RebaseComputation = { base: Commit; main: Commit; result: RebaseResult; digest: string };

/** Unlike review, rebase does not require the draft to have pinned the current evidence revision: applying it pins that revision. */
export function assertRebaseBasis(project: ProjectRow, proposal: ProposalRow, expected: RebaseExpected): void {
  const details = { actualMainCommitId: project.mainCommitId, actualProposalRevision: proposal.revision, actualEvidenceRevision: project.evidenceRevision, status: proposal.status };
  const fail = (message: string) => { throw new AppError('CONFLICT', message, { details }); };
  if (proposal.status !== 'draft') fail(`Proposal is ${proposal.status}, not a draft`);
  if (expected.mainCommitId !== project.mainCommitId) fail('Main moved since the expected commit');
  if (expected.proposalRevision !== proposal.revision) fail('Proposal changed since the expected revision');
  if (expected.evidenceRevision !== project.evidenceRevision) fail('Evidence changed since the expected revision');
}
export async function computeRebase(db: Db | Tx, projectRow: ProjectRow, proposal: ProposalRow): Promise<RebaseComputation> {
  const project = toProject(projectRow);
  const main = await loadCommit(db, project.id, project.mainCommitId);
  const base = proposal.baseCommitId === main.id ? main : await loadCommit(db, project.id, proposal.baseCommitId);
  const result = threeWayRebase(base.snapshot, proposal.candidate, main.snapshot);
  const digest = canonicalHash({ kind: 'rebase', proposalId: proposal.id, proposalRevision: proposal.revision, baseCommitId: base.id, mainCommitId: main.id, evidenceRevision: project.evidenceRevision, conflicts: result.conflicts.map(c => [c.collection, c.id]) });
  return { base, main, result, digest };
}

export async function previewRebase(db: Db, ctx: ActorContext, raw: z.input<typeof PreviewRebaseInputSchema>): Promise<RebasePreview> {
  requireScope(ctx, 'project:read');
  const parsed = PreviewRebaseInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid rebase preview', parsed.error);
  const input = parsed.data;
  return db.transaction(async tx => {
    const projectRow = await requireProject(tx, ctx, input.projectId);
    const row = await findProposal(tx, projectRow.id, input.proposalId, false);
    assertRebaseBasis(projectRow, row, { mainCommitId: input.expectedMainCommitId, proposalRevision: input.expectedProposalRevision, evidenceRevision: input.expectedEvidenceRevision });
    const { base, main, result, digest } = await computeRebase(tx, projectRow, row);
    return {
      projectId: projectRow.id, proposalId: row.id, baseCommitId: base.id, mainCommitId: main.id, proposalRevision: row.revision, evidenceRevision: projectRow.evidenceRevision, T: input.T, digest,
      // Without a composed candidate, show the proposal's own changes so the conflicts have context.
      candidate: result.snapshot, conflicts: result.conflicts, diff: result.snapshot ? diffSnapshots(main.snapshot, result.snapshot) : diffSnapshots(base.snapshot, row.candidate), requestId: ctx.requestId,
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
