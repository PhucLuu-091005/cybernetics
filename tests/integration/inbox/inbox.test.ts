import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { mainSnapshotJson } from '../../support/evidence';
import {
  headOf,
  ingestEnvelope,
  larkspurRecords,
  larkspurT,
  mergeOperations,
  rekey,
  seedLarkspur,
  type LarkspurSeed,
} from '../../support/seed';
import proposals from '../../../fixtures/proposals.json';
import { uuidFromKey } from '../../../scripts/build-fixtures';
import { previewRevert, revertCommit } from '../../../src/server/domain/commits';
import {
  countInbox,
  getInboxHints,
  listInbox,
  readInboxView,
} from '../../../src/server/domain/inbox';
import { createProject } from '../../../src/server/domain/projects';
import { createProposal, updateProposal } from '../../../src/server/domain/proposals';
import { ingestRecords, withdrawRecord } from '../../../src/server/domain/records';
import {
  ListInboxResultSchema,
  type ActorContext,
  type GraphOperation,
  type ListInboxInput,
  type ListInboxResult,
  type RecordInput,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('inbox', () => {
  let t: TestDb, ctx: ActorContext, seed: LarkspurSeed, projectId: string;
  const T = larkspurT;
  const itemOf = async (
    recordVersionId: string,
    view: Partial<ListInboxInput> = {},
  ): Promise<ListInboxResult['items'][number] | undefined> => {
    let cursor: string | null | undefined;
    do {
      const page = await listInbox(t.db, ctx, { projectId, cursor, ...view });
      expect(ListInboxResultSchema.parse(page)).toEqual(page);
      const hit = page.items.find((item) => item.recordVersionId === recordVersionId);
      if (hit) return hit;
      cursor = page.nextCursor;
    } while (cursor);
    return undefined;
  };
  const stateOf = async (recordVersionId: string, view: Partial<ListInboxInput> = {}) =>
    (await itemOf(recordVersionId, view))?.state;
  const ingestOne = async (record: RecordInput) => {
    const item = (await ingestRecords(t.db, ctx, ingestEnvelope(projectId, [record]))).items[0];
    if (item.decision === 'invalid') throw new Error('Test record is invalid');
    return item.recordVersionId;
  };
  const versionOfAct = (key: string) =>
    seed.snapshot.acts.find((act) => act.id === uuidFromKey(`act:${key}`))!.citation
      .recordVersionId;
  const inputOf = (versionId: string) => seed.inputs.get(versionId)!;
  const withdraw = async (versionId: string) =>
    withdrawRecord(t.db, ctx, {
      projectId,
      recordId: seed.recordIds.get(versionId)!,
      expectedEvidenceRevision: (await headOf(t.db, projectId)).evidenceRevision,
      reason: 'Source asked to withdraw',
      idempotencyKey: randomUUID(),
    });
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    seed = await seedLarkspur(t.db, ctx);
    projectId = seed.projectId;
  });

  it('import and hint reads do not alter main', async () => {
    const before = await mainSnapshotJson(t.db, projectId);
    const parent = inputOf(versionOfAct('secret:0'));
    const reply = await ingestOne({
      ...parent,
      externalId: `${parent.externalId}.reply`,
      threadExternalId: parent.threadExternalId,
      parentExternalId: parent.externalId,
      bodyText: 'Any update on the secret rotation?',
      occurredAt: '2026-10-09T10:00:00+07:00',
    });
    const hints = await getInboxHints(t.db, ctx, { projectId, recordVersionId: reply });
    expect(hints).toContainEqual(
      expect.objectContaining({ kind: 'parent', recordVersionId: versionOfAct('secret:0') }),
    );
    expect(hints.some((hint) => hint.kind === 'author' && hint.reason.length > 0)).toBe(true);
    expect(hints.every((hint) => hint.recordVersionId !== reply)).toBe(true);
    expect(await mainSnapshotJson(t.db, projectId)).toEqual(before);
    expect(await stateOf(reply)).toBe('pending');
  });
  it('a new version is pending even when the old version is included', async () => {
    const oldVersionId = versionOfAct('go-live:0');
    const newVersionIdOfIncludedRecord = await ingestOne({
      ...inputOf(oldVersionId),
      bodyText: `${inputOf(oldVersionId).bodyText} (edited)`,
    });
    const items = await stateOf(newVersionIdOfIncludedRecord);
    expect(items).toBe('pending');
    expect(await stateOf(oldVersionId)).toBe('included');
  });
  it('an older undecided version is superseded and the pending count ignores it', async () => {
    const [pending] = seed.pendingVersionIds;
    await ingestOne({ ...inputOf(pending), bodyText: `${inputOf(pending).bodyText} (edited)` });
    expect(await stateOf(pending)).toBe('superseded');
    const page = await listInbox(t.db, ctx, { projectId, state: 'pending' });
    expect(page.items).toHaveLength(4);
    expect(page.items.every((item) => item.state === 'pending')).toBe(true);
  });
  it('decisions are commit-specific: revert makes a decision pending again', async () => {
    const agent = proposals.find((item) => item.key === 'agent-incident-follow-up')!;
    const operations = rekey(agent.operations as GraphOperation[], seed.versionIds);
    const included = (
      operations.find((op) => op.op === 'put' && op.collection === 'recordDecisions') as {
        value: { recordVersionId: string };
      }
    ).value.recordVersionId;
    expect(await stateOf(included)).toBe('pending');
    const merge = await mergeOperations(t.db, ctx, projectId, operations, 'Include the follow-up');
    expect(await stateOf(included)).toBe('included');
    expect(await stateOf(included, { commitId: seed.seedCommitId })).toBe('pending');
    const { mainCommitId, evidenceRevision } = await headOf(t.db, projectId);
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId: merge.commitId,
      expectedMainCommitId: mainCommitId,
      expectedEvidenceRevision: evidenceRevision,
      T,
    });
    await revertCommit(t.db, ctx, {
      projectId,
      targetCommitId: merge.commitId,
      expectedMainCommitId: mainCommitId,
      expectedEvidenceRevision: evidenceRevision,
      reviewDigest: preview.digest,
      T,
      message: 'Revert the follow-up',
      idempotencyKey: randomUUID(),
    });
    expect(await stateOf(included)).toBe('pending');
  });
  it('a withdrawn referenced item stays reconciliation-needed until the graph removes its acts', async () => {
    const versionId = versionOfAct('go-live:0');
    await withdraw(versionId);
    expect(await itemOf(versionId)).toMatchObject({
      state: 'withdrawn',
      proposedDisposition: 'included',
      header: expect.stringContaining('Unavailable evidence'),
    });
    const acts = seed.snapshot.acts.filter((act) => act.citation.recordVersionId === versionId);
    await mergeOperations(
      t.db,
      ctx,
      projectId,
      [
        ...acts.map((act): GraphOperation => ({ op: 'remove', collection: 'acts', id: act.id })),
        {
          op: 'put',
          collection: 'recordDecisions',
          value: {
            recordVersionId: versionId,
            disposition: 'ignored',
            reason: 'Withdrawn by the source',
          },
        },
      ],
      'Reconcile withdrawn evidence',
    );
    expect(await stateOf(versionId)).toBe('ignored');
    expect(await stateOf(versionId, { commitId: seed.seedCommitId })).toBe('withdrawn');
  });
  it('countInbox counts every state of the selected view and matches the paged list', async () => {
    const counted = async (view: Partial<ListInboxInput> = {}) => {
      const counts = { pending: 0, included: 0, ignored: 0, superseded: 0, withdrawn: 0 };
      let cursor: string | null | undefined;
      do {
        const page = await listInbox(t.db, ctx, { projectId, cursor, ...view });
        for (const item of page.items) counts[item.state]++;
        cursor = page.nextCursor;
      } while (cursor);
      return counts;
    };
    const [pending] = seed.pendingVersionIds;
    await ingestOne({ ...inputOf(pending), bodyText: `${inputOf(pending).bodyText} (edited)` });
    await withdraw(versionOfAct('go-live:0'));
    const main = await countInbox(t.db, ctx, { projectId });
    expect(main).toEqual(await counted());
    expect(main).toMatchObject({ pending: 4, superseded: 1, withdrawn: 1 });
    expect(await countInbox(t.db, ctx, { projectId, commitId: seed.seedCommitId })).toEqual(
      await counted({ commitId: seed.seedCommitId }),
    );
    await expect(
      countInbox(t.db, ctx, { projectId, proposalId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(countInbox(t.db, ctx, { projectId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const stranger = await testActor(t.db);
    const foreign = await createProject(t.db, stranger, {
      title: 'Other workspace',
      clientName: 'Cobalt',
    });
    await expect(countInbox(t.db, ctx, { projectId: foreign.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('readInboxView resolves one view for the page, the counts, the proposal and the selected record', async () => {
    const [pending] = seed.pendingVersionIds,
      included = versionOfAct('go-live:0');
    const main = await readInboxView(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      state: 'pending',
      limit: 2,
      recordVersionId: included,
    });
    const head = await headOf(t.db, projectId);
    expect(main).toMatchObject({
      projectId,
      mainCommitId: head.mainCommitId,
      evidenceRevision: head.evidenceRevision,
      timeZone: 'Asia/Ho_Chi_Minh',
      proposal: null,
    });
    expect(main.counts).toEqual(await countInbox(t.db, ctx, { projectId }));
    const listed = await listInbox(t.db, ctx, { projectId, state: 'pending', limit: 2 });
    expect(
      main.page.items.map(({ withdrawn, ...item }) => {
        expect(withdrawn).toBe(false);
        return item;
      }),
    ).toEqual(listed.items);
    expect(main.selected).toEqual({
      recordVersionId: included,
      state: 'included',
      decision: seed.snapshot.recordDecisions.find((item) => item.recordVersionId === included),
      citedByVisibleAct: true,
    });
    const second = await readInboxView(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      state: 'pending',
      limit: 2,
      cursor: main.page.nextCursor,
    });
    expect(second.page.items.map((item) => item.recordVersionId)).toEqual(
      (
        await listInbox(t.db, ctx, {
          projectId,
          state: 'pending',
          limit: 2,
          cursor: listed.nextCursor,
        })
      ).items.map((item) => item.recordVersionId),
    );
    expect(second.selected).toBeNull();
    const firstSelected = await readInboxView(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      state: 'pending',
      limit: 2,
      selectFirst: true,
    });
    expect(firstSelected.selected).toMatchObject({
      recordVersionId: main.page.items[0].recordVersionId,
      state: 'pending',
      decision: null,
    });
    // A cursor from another view restarts at the first page instead of failing the render.
    const restarted = await readInboxView(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      state: 'ignored',
      limit: 2,
      cursor: main.page.nextCursor,
    });
    expect(restarted.page.items.map((item) => item.recordVersionId)).toEqual(
      (await listInbox(t.db, ctx, { projectId, state: 'ignored', limit: 2 })).items.map(
        (item) => item.recordVersionId,
      ),
    );

    const draft = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: head.mainCommitId,
      title: 'Inbox review',
      expectedEvidenceRevision: head.evidenceRevision,
      idempotencyKey: randomUUID(),
    });
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: draft.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: head.evidenceRevision,
      idempotencyKey: randomUUID(),
      operations: [
        {
          op: 'put',
          collection: 'recordDecisions',
          value: { recordVersionId: pending, disposition: 'ignored', reason: 'Out of scope' },
        },
      ],
    });
    const inDraft = await readInboxView(t.db, ctx, {
      projectId,
      view: { kind: 'proposal', proposalId: draft.id },
      state: 'ignored',
      recordVersionId: pending,
    });
    expect(inDraft.proposal).toMatchObject({
      id: draft.id,
      revision: 1,
      status: 'draft',
      title: 'Inbox review',
      baseCommitId: head.mainCommitId,
      author: { kind: 'user', userId: ctx.userId },
    });
    expect(inDraft.proposal).not.toHaveProperty('candidate');
    expect(inDraft.selected).toEqual({
      recordVersionId: pending,
      state: 'ignored',
      decision: { recordVersionId: pending, disposition: 'ignored', reason: 'Out of scope' },
      citedByVisibleAct: false,
    });
    expect(inDraft.page.items.map((item) => item.recordVersionId)).toContain(pending);
    expect(inDraft.counts).toEqual({
      ...main.counts,
      pending: main.counts.pending - 1,
      ignored: main.counts.ignored + 1,
    });
    expect(
      (
        await readInboxView(t.db, ctx, {
          projectId,
          view: { kind: 'main' },
          recordVersionId: pending,
        })
      ).selected,
    ).toMatchObject({ state: 'pending', decision: null });

    await withdraw(included);
    const withdrawn = await readInboxView(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      state: 'withdrawn',
    });
    expect(withdrawn.page.items).toEqual([
      expect.objectContaining({ recordVersionId: included, withdrawn: true, state: 'withdrawn' }),
    ]);
    expect(
      (
        await readInboxView(t.db, ctx, {
          projectId,
          view: { kind: 'main' },
          recordVersionId: randomUUID(),
        })
      ).selected,
    ).toBeNull();
    await expect(
      readInboxView(t.db, ctx, { projectId, view: { kind: 'proposal', proposalId: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stranger = await testActor(t.db);
    await expect(
      readInboxView(t.db, stranger, { projectId, view: { kind: 'main' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('a proposal view needs its revision and pages are bounded', async () => {
    await expect(
      listInbox(t.db, ctx, { projectId, proposalId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const first = await listInbox(t.db, ctx, { projectId });
    expect(first.items).toHaveLength(50);
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(50_000);
    const all: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await listInbox(t.db, ctx, { projectId, cursor });
      all.push(...page.items.map((item) => item.recordVersionId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(all).size).toBe(larkspurRecords.length);
  });
});
