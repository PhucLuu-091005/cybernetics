import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { T, ingestText } from '../../support/proposals';
import {
  historyIds,
  historyLoop,
  mergeSnapshotChange,
  seedHistoryProject,
} from '../../support/history';
import {
  applyRebase,
  createProposal,
  getProposal,
  mergeProposal,
  previewRebase,
  reviewProposal,
  updateProposal,
} from '../../../src/server/domain/proposals';
import {
  RebasePreviewSchema,
  type ActorContext,
  type GraphSnapshot,
  type MergeProposalInput,
  type PreviewRebaseInput,
  type Proposal,
  type ProposalReview,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('explicit rebase', () => {
  let t: TestDb, ctx: ActorContext, projectId: string, main: string, evidence: number;
  const loopId = historyIds.loopA;
  const oldReviews = new Map<string, ProposalReview>();
  const mainId = () => main;
  const ev = () => evidence;
  const rebaseInput = (proposal: Proposal): PreviewRebaseInput => ({
    projectId,
    proposalId: proposal.id,
    expectedMainCommitId: mainId(),
    expectedProposalRevision: proposal.revision,
    expectedEvidenceRevision: ev(),
    T,
  });
  const mergeChange = async (mutate: (snapshot: GraphSnapshot) => void) => {
    const receipt = await mergeSnapshotChange(t.db, ctx, projectId, mutate);
    main = receipt.commitId;
    return receipt;
  };
  const mergeSomethingElse = () =>
    mergeChange((s) => {
      s.loops[1].title = 'Something else';
    });
  const reviewedProposal = async (title: string): Promise<Proposal> => {
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId(),
      title: 'Stale',
      expectedEvidenceRevision: ev(),
      idempotencyKey: randomUUID(),
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: ev(),
      operations: [{ op: 'put', collection: 'loops', value: historyLoop(loopId, title) }],
      idempotencyKey: randomUUID(),
    });
    oldReviews.set(
      proposal.id,
      await reviewProposal(t.db, ctx, {
        projectId,
        proposalId: proposal.id,
        expectedMainCommitId: mainId(),
        expectedProposalRevision: 1,
        expectedEvidenceRevision: ev(),
        T,
      }),
    );
    return getProposal(t.db, ctx, { projectId, proposalId: proposal.id });
  };
  const staleProposalWithDisjointChange = async () => {
    const proposal = await reviewedProposal('Proposal A');
    await mergeChange((s) => {
      s.loops[1].title = 'Main B';
    });
    return { proposal };
  };
  const staleProposalWithSameLoopEdit = async () => {
    const proposal = await reviewedProposal('Proposal title');
    await mergeChange((s) => {
      s.loops[0].title = 'Main title';
    });
    return { proposal };
  };
  /** Current expected values with the pre-rebase digest, so only the stale review can cause the refusal. */
  const mergeInputFromOldReview = (proposal: Proposal): MergeProposalInput => {
    const old = oldReviews.get(proposal.id)!;
    return {
      projectId,
      proposalId: proposal.id,
      expectedMainCommitId: mainId(),
      expectedProposalRevision: proposal.revision + 1,
      expectedEvidenceRevision: ev(),
      reviewDigest: old.digest,
      T: old.T,
      message: 'Merge with the old review',
      idempotencyKey: randomUUID(),
    };
  };
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    ({ projectId, mainId: main } = await seedHistoryProject(t.db, ctx));
    evidence = 1;
  });

  it('preview never edits the draft', async () => {
    const { proposal } = await staleProposalWithDisjointChange();
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    expect(preview.conflicts).toEqual([]);
    expect(await getProposal(t.db, ctx, { projectId, proposalId: proposal.id })).toEqual(proposal);
  });
  it('apply moves the base to main, bumps the revision and requires a fresh review', async () => {
    const { proposal } = await staleProposalWithDisjointChange();
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    const rebased = await applyRebase(t.db, ctx, {
      ...rebaseInput(proposal),
      reviewDigest: preview.digest,
      resolutions: [],
      idempotencyKey: 'r1',
    });
    expect(rebased).toMatchObject({ baseCommitId: mainId(), revision: proposal.revision + 1 });
    await expect(mergeProposal(t.db, ctx, mergeInputFromOldReview(proposal))).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    const fresh = await reviewProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedMainCommitId: mainId(),
      expectedProposalRevision: rebased.revision,
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(fresh.conflicts).toEqual([]);
    const receipt = await mergeProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedMainCommitId: mainId(),
      expectedProposalRevision: rebased.revision,
      expectedEvidenceRevision: ev(),
      reviewDigest: fresh.digest,
      T,
      message: 'Merge rebased',
      idempotencyKey: 'm-fresh',
    });
    expect(receipt.kind).toBe('merge');
  });
  it('a divergent edit needs a resolution, and an applied resolution keeps the chosen side', async () => {
    const { proposal } = await staleProposalWithSameLoopEdit();
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    expect(preview.conflicts).toHaveLength(1);
    await expect(
      applyRebase(t.db, ctx, {
        ...rebaseInput(proposal),
        reviewDigest: preview.digest,
        resolutions: [],
        idempotencyKey: 'r2',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const applied = await applyRebase(t.db, ctx, {
      ...rebaseInput(proposal),
      reviewDigest: preview.digest,
      resolutions: [{ collection: 'loops', id: loopId, choice: 'proposal' }],
      idempotencyKey: 'r3',
    });
    expect(applied.candidate.loops.find((loop) => loop.id === loopId)!.title).toBe(
      'Proposal title',
    );
  });
  it('a stale apply after main moves again conflicts', async () => {
    const { proposal } = await staleProposalWithDisjointChange();
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    await mergeSomethingElse();
    await expect(
      applyRebase(t.db, ctx, {
        ...rebaseInput(proposal),
        reviewDigest: preview.digest,
        resolutions: [],
        idempotencyKey: 'r4',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('preview is schema-valid and composes main with the proposal change', async () => {
    const { proposal } = await staleProposalWithDisjointChange();
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    expect(RebasePreviewSchema.parse(preview)).toEqual(preview);
    expect(preview).toMatchObject({
      projectId,
      proposalId: proposal.id,
      baseCommitId: proposal.baseCommitId,
      mainCommitId: mainId(),
      proposalRevision: 1,
      evidenceRevision: 1,
    });
    expect(preview.candidate!.loops.map((loop) => loop.title).sort()).toEqual([
      'Main B',
      'Proposal A',
    ]);
    expect(preview.diff.changes).toEqual([
      expect.objectContaining({ collection: 'loops', id: loopId, kind: 'changed' }),
    ]);
  });
  it('a divergent preview has no candidate, and a replacement resolution keeps its identity', async () => {
    const { proposal } = await staleProposalWithSameLoopEdit();
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    expect(preview.candidate).toBeNull();
    await expect(
      applyRebase(t.db, ctx, {
        ...rebaseInput(proposal),
        reviewDigest: preview.digest,
        resolutions: [
          {
            collection: 'loops',
            id: loopId,
            choice: 'replacement',
            value: historyLoop(historyIds.newLoop, 'Moved'),
          },
        ],
        idempotencyKey: 'r5',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const applied = await applyRebase(t.db, ctx, {
      ...rebaseInput(proposal),
      reviewDigest: preview.digest,
      resolutions: [
        {
          collection: 'loops',
          id: loopId,
          choice: 'replacement',
          value: historyLoop(loopId, 'Agreed title'),
        },
      ],
      idempotencyKey: 'r6',
    });
    expect(applied.candidate.loops.find((loop) => loop.id === loopId)!.title).toBe('Agreed title');
  });
  it('apply pins the current evidence revision, replays a retried key and reports actual values on a stale revision', async () => {
    const { proposal } = await staleProposalWithDisjointChange();
    await ingestText(t.db, ctx, projectId, 'later evidence');
    evidence = 2;
    await expect(
      previewRebase(t.db, ctx, { ...rebaseInput(proposal), expectedProposalRevision: 0 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: {
        details: {
          actualProposalRevision: 1,
          actualMainCommitId: mainId(),
          actualEvidenceRevision: 2,
        },
      },
    });
    const preview = await previewRebase(t.db, ctx, rebaseInput(proposal));
    const input = {
      ...rebaseInput(proposal),
      reviewDigest: preview.digest,
      resolutions: [],
      idempotencyKey: 'r7',
    };
    const rebased = await applyRebase(t.db, ctx, input);
    expect(rebased).toMatchObject({ evidenceRevision: 2, baseCommitId: mainId(), revision: 2 });
    expect(await applyRebase(t.db, ctx, input)).toEqual(rebased);
    await expect(applyRebase(t.db, ctx, { ...input, idempotencyKey: 'r8' })).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualProposalRevision: 2 } },
    });
  });
});
