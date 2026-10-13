import type { z } from 'zod';
import { DiffProposalInputSchema, ReviewProposalInputSchema, type ActorContext, type EngineOutput, type ProposalReview } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import type { Db } from '../../db/tx';
import { diffSnapshots } from '../../graph/diff';
import { threeWayRebase } from '../../graph/rebase';
import { requireScope } from '../../http/scopes';
import { deriveProject } from '../../loops/engine';
import { requireProject } from '../access';
import { loadCommit } from '../commits/store';
import { evaluationTime, hydrateEngineInput } from '../graph/hydrate';
import { countPending } from '../inbox/list';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { assertReviewBasis, reviewDigest } from './digest';
import { findProposal, toProposal } from './read';

function loopEffects(before: EngineOutput, after: EngineOutput): ProposalReview['effects'] {
  const byId = (output: EngineOutput) => new Map(output.loops.map(loop => [loop.loop.id, loop]));
  const old = byId(before), next = byId(after);
  const types = (loop: EngineOutput['loops'][number] | undefined) => [...new Set(loop?.breakdowns.map(item => item.type) ?? [])].sort();
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap(loopId => {
    const beforeTypes = types(old.get(loopId)), afterTypes = types(next.get(loopId));
    const effect = { loopId, beforeState: old.get(loopId)?.state ?? null, afterState: next.get(loopId)?.state ?? null, addedBreakdowns: afterTypes.filter(type => !beforeTypes.includes(type)), removedBreakdowns: beforeTypes.filter(type => !afterTypes.includes(type)) };
    return effect.beforeState === effect.afterState && !effect.addedBreakdowns.length && !effect.removedBreakdowns.length ? [] : [effect];
  });
}

export async function reviewProposal(db: Db, ctx: ActorContext, raw: z.input<typeof ReviewProposalInputSchema>): Promise<ProposalReview> {
  requireScope(ctx, 'project:read');
  const parsed = ReviewProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal review', parsed.error);
  const input = parsed.data;
  // One snapshot of project, proposal and commits, so the digest never mixes states from before and after a concurrent merge.
  return db.transaction(async tx => {
    const projectRow = await requireProject(tx, ctx, input.projectId);
    const project = toProject(projectRow);
    const row = await findProposal(tx, project.id, input.proposalId, false);
    assertReviewBasis(projectRow, row, { mainCommitId: input.expectedMainCommitId, proposalRevision: input.expectedProposalRevision, evidenceRevision: input.expectedEvidenceRevision });
    const proposal = toProposal(row), candidate = proposal.candidate;
    const main = await loadCommit(tx, project.id, project.mainCommitId);
    const base = proposal.baseCommitId === main.id ? main : await loadCommit(tx, project.id, proposal.baseCommitId);
    const before = deriveProject(await hydrateEngineInput(tx, project.id, main.snapshot, input.T));
    const after = deriveProject(await hydrateEngineInput(tx, project.id, candidate, input.T));
    const snapshotHash = canonicalHash(candidate);
    return {
      projectId: project.id, proposalId: proposal.id, baseCommitId: base.id, proposalRevision: proposal.revision, mainCommitId: main.id, evidenceRevision: project.evidenceRevision, snapshotHash, T: input.T,
      digest: reviewDigest({ baseCommitId: base.id, proposalRevision: proposal.revision, mainCommitId: main.id, evidenceRevision: project.evidenceRevision, snapshotHash, T: input.T }),
      diff: diffSnapshots(base.snapshot, candidate), conflicts: base.id === main.id ? [] : threeWayRebase(base.snapshot, candidate, main.snapshot).conflicts,
      pendingEvidenceCount: await countPending(tx, project.id, main.snapshot), author: proposal.author, rationale: proposal.rationale,
      citedRecordVersionIds: [...new Set(candidate.acts.map(act => act.citation.recordVersionId))].sort(), effects: loopEffects(before, after), requestId: ctx.requestId,
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/** Reviews the draft at the revisions current now; a concurrent change between the read and the review surfaces as CONFLICT, never as a mixed digest. */
export async function diffProposal(db: Db, ctx: ActorContext, raw: z.input<typeof DiffProposalInputSchema>): Promise<ProposalReview> {
  requireScope(ctx, 'project:read');
  const parsed = DiffProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal diff', parsed.error);
  const input = parsed.data;
  const project = toProject(await requireProject(db, ctx, input.projectId));
  const row = await findProposal(db, project.id, input.proposalId, false);
  return reviewProposal(db, ctx, { projectId: project.id, proposalId: row.id, expectedMainCommitId: project.mainCommitId, expectedProposalRevision: row.revision, expectedEvidenceRevision: project.evidenceRevision, T: evaluationTime(row.candidate, input.T) });
}
