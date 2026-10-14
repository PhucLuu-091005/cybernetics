import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { projectRow } from '../../support/evidence';
import { T, ingestText, putAct, putLoop, quote, seedProject } from '../../support/proposals';
import {
  createProposal,
  getProposal,
  mergeProposal,
  reviewProposal,
  updateProposal,
} from '../../../src/server/domain/proposals';
import { withdrawRecord } from '../../../src/server/domain/records';
import { graphCommits, recordVersions } from '../../../src/server/db/schema';
import {
  CommitReceiptSchema,
  type ActorContext,
  type MergeProposalInput,
  type ProposalReview,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('proposal merge', () => {
  let t: TestDb, ctx: ActorContext, projectId: string, mainId: string, versionId: string;
  const ingestOne = (text: string) => ingestText(t.db, ctx, projectId, text);
  const reviewed = async (title: string): Promise<ProposalReview> => {
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title,
      expectedEvidenceRevision: 1,
      idempotencyKey: `c-${title}`,
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: 1,
      operations: [putLoop(title), putAct(versionId, quote)],
      idempotencyKey: `u-${title}`,
    });
    return reviewProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedMainCommitId: mainId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      T,
    });
  };
  const mergeInput = (review: ProposalReview, idempotencyKey: string): MergeProposalInput => ({
    projectId,
    proposalId: review.proposalId,
    expectedMainCommitId: review.mainCommitId,
    expectedProposalRevision: review.proposalRevision,
    expectedEvidenceRevision: review.evidenceRevision,
    reviewDigest: review.digest,
    T: review.T,
    message: `Merge ${idempotencyKey}`,
    idempotencyKey,
  });
  const merge = (review: ProposalReview, key: string) =>
    mergeProposal(t.db, ctx, mergeInput(review, key));
  const commitCount = async () =>
    (
      await t.db
        .select({ id: graphCommits.id })
        .from(graphCommits)
        .where(eq(graphCommits.projectId, projectId))
    ).length;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    ({ projectId, mainId, versionId } = await seedProject(t.db, ctx));
  });

  it('two concurrent merges yield one commit', async () => {
    const [a, b] = await Promise.all([reviewed('A'), reviewed('B')]);
    const results = await Promise.allSettled([merge(a, 'm-a'), merge(b, 'm-b')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ code: 'CONFLICT' });
    expect(await commitCount()).toBe(2);
    const loser = results[0].status === 'rejected' ? a : b;
    expect((await getProposal(t.db, ctx, { projectId, proposalId: loser.proposalId })).status).toBe(
      'draft',
    );
  });
  it('merge after evidence change conflicts until the review is refreshed', async () => {
    const review = await reviewed('C');
    await ingestOne('unrelated new evidence');
    await expect(merge(review, 'm-c')).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualEvidenceRevision: 2 } },
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: review.proposalId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 2,
      operations: [],
      idempotencyKey: 'ack-c',
    });
    const refreshed = await reviewProposal(t.db, ctx, {
      projectId,
      proposalId: review.proposalId,
      expectedMainCommitId: mainId,
      expectedProposalRevision: 2,
      expectedEvidenceRevision: 2,
      T,
    });
    expect((await merge(refreshed, 'm-c2')).evidenceRevision).toBe(2);
  });
  it('a default agent token cannot merge and a granted token can', async () => {
    const review = await reviewed('D');
    await expect(
      mergeProposal(
        t.db,
        agentActor(ctx, projectId, ['project:read', 'records:import', 'graph:propose']),
        mergeInput(review, 'm-d'),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const receipt = await mergeProposal(
      t.db,
      agentActor(ctx, projectId, ['project:read', 'graph:merge']),
      mergeInput(review, 'm-d2'),
    );
    expect(receipt.kind).toBe('merge');
  });
  it('a merge retry with the same key returns the original receipt', async () => {
    const review = await reviewed('E');
    const first = await merge(review, 'm-e');
    expect(await merge(review, 'm-e')).toEqual(first);
  });
  it('a tampered review digest is refused', async () => {
    const review = await reviewed('F');
    await expect(
      mergeProposal(t.db, ctx, { ...mergeInput(review, 'm-f'), reviewDigest: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a merge inserts one commit, advances main and marks the proposal merged', async () => {
    const review = await reviewed('G');
    const receipt = await merge(review, 'm-g');
    expect(CommitReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt).toMatchObject({
      projectId,
      parentCommitId: mainId,
      sequence: 1,
      snapshotHash: review.snapshotHash,
      evidenceRevision: 1,
      kind: 'merge',
      proposalId: review.proposalId,
      targetCommitId: null,
      idempotencyKey: 'm-g',
    });
    expect((await projectRow(t.db, projectId)).mainCommitId).toBe(receipt.commitId);
    const proposal = await getProposal(t.db, ctx, { projectId, proposalId: review.proposalId });
    expect(proposal).toMatchObject({ status: 'merged', mergedCommitId: receipt.commitId });
    const [commit] = await t.db
      .select()
      .from(graphCommits)
      .where(and(eq(graphCommits.projectId, projectId), eq(graphCommits.id, receipt.commitId)));
    expect(commit).toMatchObject({
      kind: 'merge',
      parentId: mainId,
      proposalId: review.proposalId,
      reviewedEvidenceRevision: 1,
      actor: { kind: 'user', userId: ctx.userId },
      message: 'Merge m-g',
    });
    expect(commit.snapshot).toEqual(proposal.candidate);
  });
  it('a proposal reviewed against a moved main needs a rebase before merge', async () => {
    const [first, second] = [await reviewed('H'), await reviewed('I')];
    const merged = await merge(first, 'm-h');
    const again = await reviewProposal(t.db, ctx, {
      projectId,
      proposalId: second.proposalId,
      expectedMainCommitId: merged.commitId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      T,
    });
    expect(again.conflicts.length).toBeGreaterThan(0);
    await expect(merge(again, 'm-i')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/Rebase required/),
    });
    await expect(merge(first, 'm-h2')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('a proposal edited after review conflicts with the actual revision', async () => {
    const review = await reviewed('J');
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: review.proposalId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      operations: [putLoop('J2')],
      idempotencyKey: 'edit-j',
    });
    await expect(merge(review, 'm-j')).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualProposalRevision: 2 } },
    });
  });
  it('a withdrawn citation on main does not block acknowledging, hiding, reviewing or merging', async () => {
    const merged = await merge(await reviewed('W'), 'm-w');
    const [version] = await t.db
      .select({ recordId: recordVersions.recordId })
      .from(recordVersions)
      .where(eq(recordVersions.id, versionId));
    await withdrawRecord(t.db, ctx, {
      projectId,
      recordId: version.recordId,
      expectedEvidenceRevision: 1,
      reason: 'Client asked to remove it',
      idempotencyKey: 'w-1',
    });
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: merged.commitId,
      title: 'Hide withdrawn',
      expectedEvidenceRevision: 2,
      idempotencyKey: 'c-hide',
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: 2,
      operations: [],
      idempotencyKey: 'ack-w',
    });
    const hidden = await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 2,
      operations: [putAct(versionId, quote, { hidden: true })],
      idempotencyKey: 'hide-w',
    });
    expect(hidden.candidate.acts[0].hidden).toBe(true);
    const review = await reviewProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedMainCommitId: merged.commitId,
      expectedProposalRevision: 2,
      expectedEvidenceRevision: 2,
      T,
    });
    expect((await merge(review, 'm-hide')).kind).toBe('merge');
  });
});
