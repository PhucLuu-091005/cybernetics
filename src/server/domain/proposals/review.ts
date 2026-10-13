import { and, count, eq, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import { ReviewProposalInputSchema, type ActorContext, type EngineInput, type EngineOutput, type GraphSnapshot, type ProposalReview } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { recordVersions } from '../../db/schema';
import type { Db, Tx } from '../../db/tx';
import { diffSnapshots } from '../../graph/diff';
import { threeWayRebase } from '../../graph/rebase';
import { requireScope } from '../../http/scopes';
import { deriveProject } from '../../loops/engine';
import { requireProject } from '../access';
import { loadCommit } from '../commits/store';
import { toProject } from '../projects';
import { invalid, loadRecordMetadata } from '../records/metadata';
import { assertReviewBasis, reviewDigest } from './digest';
import { findProposal, toProposal } from './read';

/** Temporary until Task 10's hydrateEngineInput. Every cited version is loaded, including ones after T, because the engine rejects a citation without metadata. */
async function engineInputFor(db: Db | Tx, projectId: string, snapshot: GraphSnapshot, T: string): Promise<EngineInput> {
  const metadata = await loadRecordMetadata(db, projectId, snapshot.acts.map(act => act.citation.recordVersionId));
  return { snapshot, T, records: [...metadata.values()].map(({ recordVersionId, occurredAt, bodyText, digest, withdrawn, quotedRanges }) => ({ recordVersionId, occurredAt, bodyText, digest, withdrawn, quotedRanges })) };
}
/** Temporary until Task 10's countPending: versions without a decision in the candidate. */
async function pendingCount(db: Db | Tx, projectId: string, snapshot: GraphSnapshot): Promise<number> {
  const decided = snapshot.recordDecisions.map(decision => decision.recordVersionId);
  const [row] = await db.select({ n: count() }).from(recordVersions).where(and(eq(recordVersions.projectId, projectId), decided.length ? notInArray(recordVersions.id, decided) : undefined));
  return row.n;
}
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
    const before = deriveProject(await engineInputFor(tx, project.id, main.snapshot, input.T));
    const after = deriveProject(await engineInputFor(tx, project.id, candidate, input.T));
    const snapshotHash = canonicalHash(candidate);
    return {
      projectId: project.id, proposalId: proposal.id, baseCommitId: base.id, proposalRevision: proposal.revision, mainCommitId: main.id, evidenceRevision: project.evidenceRevision, snapshotHash, T: input.T,
      digest: reviewDigest({ baseCommitId: base.id, proposalRevision: proposal.revision, mainCommitId: main.id, evidenceRevision: project.evidenceRevision, snapshotHash, T: input.T }),
      diff: diffSnapshots(base.snapshot, candidate), conflicts: base.id === main.id ? [] : threeWayRebase(base.snapshot, candidate, main.snapshot).conflicts,
      pendingEvidenceCount: await pendingCount(tx, project.id, candidate), author: proposal.author, rationale: proposal.rationale,
      citedRecordVersionIds: [...new Set(candidate.acts.map(act => act.citation.recordVersionId))].sort(), effects: loopEffects(before, after), requestId: ctx.requestId,
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
