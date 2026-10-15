import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import {
  T,
  ingestText,
  proposalIds,
  putAct,
  putLoop,
  quote,
  seedProject,
} from '../../support/proposals';
import { createProject } from '../../../src/server/domain/projects';
import {
  closeProposal,
  createProposal,
  getProposal,
  listProposals,
  reviewDigest,
  reviewProposal,
  updateProposal,
} from '../../../src/server/domain/proposals';
import {
  ProposalReviewSchema,
  ProposalSchema,
  utf8Bytes,
  type ActorContext,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('proposal lifecycle', () => {
  let t: TestDb,
    ctx: ActorContext,
    projectId: string,
    mainId: string,
    versionId: string,
    proposalId: string,
    otherProjectId: string;
  const ingestOne = (text: string) => ingestText(t.db, ctx, projectId, text);
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
    otherProjectId = (
      await createProject(t.db, ctx, { title: 'Other', clientName: 'Other client' })
    ).id;
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    ({ projectId, mainId, versionId } = await seedProject(t.db, ctx));
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title: 'Reviewed',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'seed-create',
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: 1,
      operations: [putLoop(), putAct(versionId, quote)],
      idempotencyKey: 'seed-update',
    });
    proposalId = proposal.id;
  });

  it('rejects a bad quote atomically and keeps the previous revision', async () => {
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title: 'Add act',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'c1',
    });
    const bad = putAct(versionId, 'We will go live by 31 September.');
    await expect(
      updateProposal(t.db, ctx, {
        projectId,
        proposalId: proposal.id,
        expectedProposalRevision: 0,
        expectedEvidenceRevision: 1,
        operations: [putLoop(), bad],
        idempotencyKey: 'u1',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await getProposal(t.db, ctx, { projectId, proposalId: proposal.id })).revision).toBe(0);
  });
  it('rejects a note whose marker cites an act outside actIds', async () => {
    const note = (text: string) => ({
      op: 'put' as const,
      collection: 'annotations' as const,
      value: { id: randomUUID(), text, actIds: [proposalIds.act] },
    });
    await expect(
      updateProposal(t.db, ctx, {
        projectId,
        proposalId,
        expectedProposalRevision: 1,
        expectedEvidenceRevision: 1,
        operations: [note(`See [act:${randomUUID()}]`)],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      extras: { errors: [{ path: 'operations.0.value.text' }] },
    });
    const accepted = await updateProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      operations: [note(`See [act:${proposalIds.act}]`)],
      idempotencyKey: randomUUID(),
    });
    expect(accepted.candidate.annotations).toHaveLength(1);
  });
  it('a stale expectedProposalRevision conflicts and keeps the winner edit', async () => {
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title: 'Race',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'c2',
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: 1,
      operations: [putLoop('A')],
      idempotencyKey: 'u2',
    });
    await expect(
      updateProposal(t.db, ctx, {
        projectId,
        proposalId: proposal.id,
        expectedProposalRevision: 0,
        expectedEvidenceRevision: 1,
        operations: [putLoop('B')],
        idempotencyKey: 'u3',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      (await getProposal(t.db, ctx, { projectId, proposalId: proposal.id })).candidate.loops[0]
        .title,
    ).toBe('A');
  });
  it('a zero-operation update acknowledges new evidence and bumps the revision', async () => {
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title: 'Ack',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'c3',
    });
    await ingestOne('new evidence');
    const updated = await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: 2,
      operations: [],
      idempotencyKey: 'u4',
    });
    expect(updated).toMatchObject({ revision: 1, evidenceRevision: 2 });
  });
  it('review returns diff, derived effects and a digest bound to its inputs', async () => {
    const review = await reviewProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedMainCommitId: mainId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      T: '2026-10-09T11:00:00Z',
    });
    expect(review.diff.changes.length).toBeGreaterThan(0);
    expect(review.effects[0]).toMatchObject({ beforeState: null, afterState: 'requested' });
    expect(review.digest).toBe(
      reviewDigest({
        baseCommitId: mainId,
        proposalRevision: 1,
        mainCommitId: mainId,
        evidenceRevision: 1,
        snapshotHash: review.snapshotHash,
        T: review.T,
      }),
    );
  });
  it('an agent with another project id gets NOT_FOUND for this proposal', async () => {
    await expect(
      getProposal(t.db, agentActor(ctx, otherProjectId, ['project:read']), {
        projectId,
        proposalId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('review reports cited versions, pending evidence, conflicts and a schema-valid result', async () => {
    await ingestOne('pending evidence');
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 2,
      operations: [],
      idempotencyKey: 'ack',
    });
    const review = await reviewProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedMainCommitId: mainId,
      expectedProposalRevision: 2,
      expectedEvidenceRevision: 2,
      T,
    });
    expect(ProposalReviewSchema.parse(review)).toEqual(review);
    expect(review).toMatchObject({
      baseCommitId: mainId,
      mainCommitId: mainId,
      proposalRevision: 2,
      evidenceRevision: 2,
      citedRecordVersionIds: [versionId],
      conflicts: [],
      pendingEvidenceCount: 2,
      author: { kind: 'user', userId: ctx.userId },
    });
    expect(review.effects).toEqual([
      {
        loopId: expect.any(String),
        beforeState: null,
        afterState: 'requested',
        addedBreakdowns: ['unanswered_request'],
        removedBreakdowns: [],
      },
    ]);
  });
  it('review conflicts with actual values when an expected value is stale', async () => {
    await expect(
      reviewProposal(t.db, ctx, {
        projectId,
        proposalId,
        expectedMainCommitId: mainId,
        expectedProposalRevision: 0,
        expectedEvidenceRevision: 1,
        T,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualProposalRevision: 1 } },
    });
    await ingestOne('more evidence');
    await expect(
      reviewProposal(t.db, ctx, {
        projectId,
        proposalId,
        expectedMainCommitId: mainId,
        expectedProposalRevision: 1,
        expectedEvidenceRevision: 2,
        T,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualEvidenceRevision: 2, proposalEvidenceRevision: 1 } },
    });
  });
  it('update replays the same result for a retried key and refuses a stale evidence revision', async () => {
    const input = {
      projectId,
      proposalId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      operations: [putLoop('Retitled')],
      idempotencyKey: 'retry',
    };
    const first = await updateProposal(t.db, ctx, input);
    expect(await updateProposal(t.db, ctx, input)).toEqual(first);
    await ingestOne('later evidence');
    await expect(
      updateProposal(t.db, ctx, {
        ...input,
        expectedProposalRevision: 2,
        idempotencyKey: 'stale-evidence',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualProposalRevision: 2, actualEvidenceRevision: 2 } },
    });
  });
  it('create refuses a base that is not main and stores the agent author', async () => {
    await expect(
      createProposal(t.db, ctx, {
        projectId,
        baseCommitId: otherProjectId,
        title: 'Wrong base',
        expectedEvidenceRevision: 1,
        idempotencyKey: 'c4',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      extras: { details: { actualMainCommitId: mainId } },
    });
    const agent = agentActor(ctx, projectId, ['project:read', 'graph:propose']);
    const proposal = await createProposal(t.db, agent, {
      projectId,
      baseCommitId: mainId,
      title: 'From agent',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'c5',
    });
    expect(ProposalSchema.parse(proposal)).toEqual(proposal);
    expect(proposal).toMatchObject({
      author: {
        kind: 'agent',
        userId: ctx.userId,
        tokenId: agent.kind === 'agent' ? agent.tokenId : '',
      },
      revision: 0,
      status: 'draft',
      mergedCommitId: null,
    });
    await expect(
      createProposal(t.db, agentActor(ctx, projectId, ['project:read']), {
        projectId,
        baseCommitId: mainId,
        title: 'No scope',
        expectedEvidenceRevision: 1,
        idempotencyKey: 'c6',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('close ends a draft, blocks later edits, and list filters by status without candidates', async () => {
    const closed = await closeProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedProposalRevision: 1,
      idempotencyKey: 'close',
    });
    expect(closed.status).toBe('closed');
    await expect(
      updateProposal(t.db, ctx, {
        projectId,
        proposalId,
        expectedProposalRevision: 1,
        expectedEvidenceRevision: 1,
        operations: [],
        idempotencyKey: 'after-close',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title: 'Second',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'c7',
    });
    await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: mainId,
      title: 'Third',
      expectedEvidenceRevision: 1,
      idempotencyKey: 'c8',
    });
    const drafts = await listProposals(t.db, ctx, { projectId, status: 'draft', limit: 1 });
    expect(drafts.items).toHaveLength(1);
    expect(drafts.items[0]).not.toHaveProperty('candidate');
    const rest = await listProposals(t.db, ctx, {
      projectId,
      status: 'draft',
      cursor: drafts.nextCursor,
      limit: 1,
    });
    expect(rest.nextCursor).toBeNull();
    expect([drafts.items[0].title, rest.items[0].title].sort()).toEqual(['Second', 'Third']);
    expect(
      (await listProposals(t.db, ctx, { projectId, status: 'closed' })).items.map(
        (item) => item.id,
      ),
    ).toEqual([proposalId]);
  });
  it('an update over the loop cap is LIMIT_EXCEEDED and writes nothing', async () => {
    const loops = (from: number) =>
      Array.from({ length: 100 }, (_, index) =>
        putLoop(
          `Loop ${from + index}`,
          `50000000-0000-4000-8000-${String(from + index).padStart(12, '0')}`,
        ),
      );
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedProposalRevision: 1,
      expectedEvidenceRevision: 1,
      operations: loops(0),
      idempotencyKey: 'cap-1',
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId,
      expectedProposalRevision: 2,
      expectedEvidenceRevision: 1,
      operations: loops(100),
      idempotencyKey: 'cap-2',
    });
    await expect(
      updateProposal(t.db, ctx, {
        projectId,
        proposalId,
        expectedProposalRevision: 3,
        expectedEvidenceRevision: 1,
        operations: loops(200),
        idempotencyKey: 'cap-3',
      }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      extras: { errors: [expect.objectContaining({ path: 'loops' })] },
    });
    const stored = await getProposal(t.db, ctx, { projectId, proposalId });
    expect(stored.revision).toBe(3);
    expect(stored.candidate.loops).toHaveLength(201);
  });
  it('list pages stay within 50,000 bytes and return every proposal exactly once', async () => {
    for (let index = 0; index < 50; index++)
      await createProposal(t.db, ctx, {
        projectId,
        baseCommitId: mainId,
        title: `Long ${index}`,
        rationale: 'x'.repeat(10000),
        expectedEvidenceRevision: 1,
        idempotencyKey: `long-${index}`,
      });
    const seen: string[] = [];
    let cursor: string | null = null,
      pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listProposals>> = await listProposals(t.db, ctx, {
        projectId,
        cursor,
      });
      expect(utf8Bytes(JSON.stringify(page))).toBeLessThanOrEqual(50_000);
      expect(page.items.length).toBeGreaterThan(0);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toHaveLength(51);
    expect(new Set(seen).size).toBe(51);
  });
});
