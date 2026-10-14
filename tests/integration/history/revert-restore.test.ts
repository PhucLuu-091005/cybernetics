import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { T } from '../../support/proposals';
import {
  commitsIn,
  historyAct,
  historyIds,
  historyLoop,
  mainState,
  mergeSnapshotChange,
  originalTitle,
  recordIdOf,
  seedHistoryProject,
  versionsIn,
} from '../../support/history';
import {
  getCommit,
  listHistory,
  previewRestore,
  previewRevert,
  proposalFromInverse,
  restoreCommit,
  revertCommit,
} from '../../../src/server/domain/commits';
import { withdrawRecord } from '../../../src/server/domain/records';
import {
  CommitPreviewSchema,
  CommitReceiptSchema,
  GetCommitResultSchema,
  ListHistoryResultSchema,
  utf8Bytes,
  type ActorContext,
  type GraphSnapshot,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('revert, restore and history', () => {
  let t: TestDb,
    ctx: ActorContext,
    stranger: ActorContext,
    projectId: string,
    versionId: string,
    main: string,
    evidence: number;
  const mainId = () => main;
  const ev = () => evidence;
  const mergeChange = async (mutate: (snapshot: GraphSnapshot) => void, message?: string) => {
    const receipt = await mergeSnapshotChange(t.db, ctx, projectId, mutate, message);
    main = receipt.commitId;
    return receipt;
  };
  const mainSnapshot = async () => (await mainState(t.db, projectId)).snapshot;
  const commitCount = async () => (await commitsIn(t.db, projectId)).length;
  const initialCommitId = async () =>
    (await commitsIn(t.db, projectId)).find((commit) => commit.kind === 'initial')!.id;
  const versionCountTotal = () => versionsIn(t.db, projectId);
  const newLoop = () => historyLoop(historyIds.newLoop, 'New loop');
  const actOn = (loopId: string) => historyAct(versionId, loopId);
  const revertNow = async (targetCommitId: string, idempotencyKey: string) => {
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(preview.conflicts).toEqual([]);
    const receipt = await revertCommit(t.db, ctx, {
      projectId,
      targetCommitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      reviewDigest: preview.digest,
      T,
      message: `Revert ${targetCommitId}`,
      idempotencyKey,
    });
    main = receipt.commitId;
    return receipt;
  };
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
    stranger = await testActor(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    ({ projectId, mainId: main, versionId } = await seedHistoryProject(t.db, ctx));
    evidence = 1;
  });

  it('revert keeps an unrelated later change and creates a new revert commit', async () => {
    const first = await mergeChange((s) => {
      s.loops[0].title = 'First';
    });
    await mergeChange((s) => {
      s.loops[1].title = 'Unrelated later';
    });
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(preview.conflicts).toEqual([]);
    const receipt = await revertCommit(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      reviewDigest: preview.digest,
      T,
      message: 'Revert first',
      idempotencyKey: 'v1',
    });
    const head = await mainSnapshot();
    expect(head.loops[0].title).toBe(originalTitle);
    expect(head.loops[1].title).toBe('Unrelated later');
    expect(receipt).toMatchObject({ kind: 'revert', targetCommitId: first.commitId });
    expect(await commitCount()).toBe(4);
  });
  it('revert that orphans a later act conflicts', async () => {
    const addLoop = await mergeChange((s) => {
      s.loops.push(newLoop());
    });
    await mergeChange((s) => {
      s.acts.push(actOn(newLoop().id));
    });
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId: addLoop.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(
      preview.conflicts.some((conflict) => /references missing loops/.test(conflict.reason)),
    ).toBe(true);
  });
  it('a touched later change blocks revert and can become a proposal', async () => {
    const first = await mergeChange((s) => {
      s.loops[0].title = 'First';
    });
    await mergeChange((s) => {
      s.loops[0].title = 'Touched later';
    });
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(preview.conflicts).toHaveLength(1);
    const draft = await proposalFromInverse(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      idempotencyKey: 'pi1',
    });
    expect(draft.status).toBe('draft');
  });
  it('reverting a revert restores the change', async () => {
    const x = await mergeChange((s) => {
      s.loops[0].title = 'X';
    });
    const postX = await mainSnapshot();
    const revert = await revertNow(x.commitId, 'rx1');
    expect((await mainSnapshot()).loops[0].title).toBe(originalTitle);
    await revertNow(revert.commitId, 'rx2');
    expect(await mainSnapshot()).toEqual(postX);
  });
  it('restore creates a child commit and keeps history and evidence', async () => {
    await mergeChange((s) => {
      s.loops[0].title = 'Changed';
    });
    const before = await commitCount();
    const versionsBefore = await versionCountTotal();
    const initial = await initialCommitId();
    const preview = await previewRestore(t.db, ctx, {
      projectId,
      targetCommitId: initial,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    const receipt = await restoreCommit(t.db, ctx, {
      projectId,
      targetCommitId: initial,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      reviewDigest: preview.digest,
      T,
      message: 'Restore',
      idempotencyKey: 's1',
    });
    expect(receipt.parentCommitId).not.toBe(initial);
    expect(await commitCount()).toBe(before + 1);
    expect(await versionCountTotal()).toBe(versionsBefore);
  });
  it('restore of a snapshot citing withdrawn evidence is refused', async () => {
    const withAct = await mergeChange((s) => {
      s.acts.push(actOn(historyIds.loopA));
    });
    await mergeChange((s) => {
      s.acts = [];
    });
    await withdrawRecord(t.db, ctx, {
      projectId,
      recordId: await recordIdOf(t.db, versionId),
      expectedEvidenceRevision: ev(),
      reason: 'Client asked to remove it',
      idempotencyKey: 'w1',
    });
    evidence = 2;
    const preview = await previewRestore(t.db, ctx, {
      projectId,
      targetCommitId: withAct.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(preview.conflicts.length).toBeGreaterThan(0);
    expect(preview.conflicts.every((conflict) => /withdrawn/.test(conflict.reason))).toBe(true);
    await expect(
      restoreCommit(t.db, ctx, {
        projectId,
        targetCommitId: withAct.commitId,
        expectedMainCommitId: mainId(),
        expectedEvidenceRevision: ev(),
        reviewDigest: preview.digest,
        T,
        message: 'Restore withdrawn',
        idempotencyKey: 's2',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await commitCount()).toBe(3);
  });
  it('foreign history is NOT_FOUND', async () => {
    await expect(
      getCommit(t.db, stranger, { projectId, commitId: mainId() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('restore keeps a withdrawn citation that main still carries unchanged', async () => {
    const withAct = await mergeChange((s) => {
      s.acts.push(actOn(historyIds.loopA));
    });
    await mergeChange((s) => {
      s.loops[1].title = 'Later';
    });
    await withdrawRecord(t.db, ctx, {
      projectId,
      recordId: await recordIdOf(t.db, versionId),
      expectedEvidenceRevision: ev(),
      reason: 'Removed',
      idempotencyKey: 'w2',
    });
    evidence = 2;
    const preview = await previewRestore(t.db, ctx, {
      projectId,
      targetCommitId: withAct.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(preview.conflicts).toEqual([]);
    const receipt = await restoreCommit(t.db, ctx, {
      projectId,
      targetCommitId: withAct.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      reviewDigest: preview.digest,
      T,
      message: 'Restore carried',
      idempotencyKey: 's3',
    });
    expect(receipt).toMatchObject({
      kind: 'restore',
      targetCommitId: withAct.commitId,
      evidenceRevision: 2,
    });
    expect((await mainSnapshot()).loops[1].title).toBe('Original B');
  });
  it('preview and receipt are schema-valid, retries replay, and stale or tampered applies conflict', async () => {
    const first = await mergeChange((s) => {
      s.loops[0].title = 'First';
    });
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    expect(CommitPreviewSchema.parse(preview)).toEqual(preview);
    expect(preview).toMatchObject({
      projectId,
      kind: 'revert',
      targetCommitId: first.commitId,
      mainCommitId: mainId(),
      evidenceRevision: 1,
      T,
    });
    expect(preview.diff.changes).toEqual([
      expect.objectContaining({ collection: 'loops', id: historyIds.loopA, kind: 'changed' }),
    ]);
    const input = {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      reviewDigest: preview.digest,
      T,
      message: 'Revert first',
      idempotencyKey: 'v2',
    };
    await expect(
      revertCommit(t.db, ctx, {
        ...input,
        reviewDigest: 'f'.repeat(64),
        idempotencyKey: 'v-tampered',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const receipt = await revertCommit(t.db, ctx, input);
    expect(CommitReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt).toMatchObject({
      projectId,
      parentCommitId: first.commitId,
      sequence: 2,
      kind: 'revert',
      proposalId: null,
      targetCommitId: first.commitId,
      evidenceRevision: 1,
      idempotencyKey: 'v2',
    });
    expect(await revertCommit(t.db, ctx, input)).toEqual(receipt);
    expect(await commitCount()).toBe(3);
    await expect(revertCommit(t.db, ctx, { ...input, idempotencyKey: 'v3' })).rejects.toMatchObject(
      {
        code: 'CONFLICT',
        extras: { details: { actualMainCommitId: receipt.commitId, actualEvidenceRevision: 1 } },
      },
    );
  });
  it('a revert of the initial commit is VALIDATION', async () => {
    const initial = await initialCommitId();
    await expect(
      previewRevert(t.db, ctx, {
        projectId,
        targetCommitId: initial,
        expectedMainCommitId: mainId(),
        expectedEvidenceRevision: ev(),
        T,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      proposalFromInverse(t.db, ctx, {
        projectId,
        targetCommitId: initial,
        expectedMainCommitId: mainId(),
        expectedEvidenceRevision: ev(),
        idempotencyKey: 'pi-initial',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('a blocked revert refuses apply, and its draft carries the proposed inverse based on main', async () => {
    const first = await mergeChange((s) => {
      s.loops[0].title = 'First';
      s.loops[1].title = 'First B';
    });
    await mergeChange((s) => {
      s.loops[0].title = 'Touched later';
    });
    const preview = await previewRevert(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      T,
    });
    await expect(
      revertCommit(t.db, ctx, {
        projectId,
        targetCommitId: first.commitId,
        expectedMainCommitId: mainId(),
        expectedEvidenceRevision: ev(),
        reviewDigest: preview.digest,
        T,
        message: 'Blocked',
        idempotencyKey: 'v4',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const draft = await proposalFromInverse(t.db, ctx, {
      projectId,
      targetCommitId: first.commitId,
      expectedMainCommitId: mainId(),
      expectedEvidenceRevision: ev(),
      idempotencyKey: 'pi2',
    });
    expect(draft).toMatchObject({
      baseCommitId: mainId(),
      revision: 0,
      evidenceRevision: 1,
      status: 'draft',
    });
    expect(draft.candidate.loops.map((loop) => loop.title).sort()).toEqual([
      'Original B',
      'Touched later',
    ]);
  });
  it('restore cannot target a foreign commit and history is NOT_FOUND for a stranger', async () => {
    const other = await seedHistoryProject(t.db, ctx);
    await expect(
      previewRestore(t.db, ctx, {
        projectId,
        targetCommitId: other.mainId,
        expectedMainCommitId: mainId(),
        expectedEvidenceRevision: ev(),
        T,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listHistory(t.db, stranger, { projectId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('getCommit returns the summary without a snapshot and the diff against its parent', async () => {
    const first = await mergeChange((s) => {
      s.loops[0].title = 'First';
    });
    const result = await getCommit(t.db, ctx, { projectId, commitId: first.commitId });
    const { diff, ...rest } = result;
    expect(GetCommitResultSchema.parse(rest)).toEqual(rest);
    expect(result.commit).not.toHaveProperty('snapshot');
    expect(result.commit).toMatchObject({ id: first.commitId, kind: 'merge', sequence: 1 });
    expect(diff.changes).toEqual([
      expect.objectContaining({ collection: 'loops', id: historyIds.loopA, kind: 'changed' }),
    ]);
    const initial = await getCommit(t.db, ctx, { projectId, commitId: await initialCommitId() });
    expect(
      initial.diff.changes
        .filter((change) => change.kind === 'added')
        .map((change) => change.collection)
        .sort(),
    ).toEqual(['departments', 'loops', 'loops']);
  });
  it('history pages stay within 50 items and 50,000 bytes and list every commit newest first exactly once', async () => {
    for (let index = 0; index < 24; index++)
      await mergeChange(
        (s) => {
          s.loops[0].title = `Title ${index}`;
        },
        `${index} ${'m'.repeat(1990)}`,
      );
    const seen: number[] = [];
    let cursor: string | null = null,
      pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listHistory>> = await listHistory(t.db, ctx, {
        projectId,
        cursor,
      });
      expect(ListHistoryResultSchema.parse(page)).toEqual(page);
      expect(utf8Bytes(JSON.stringify(page))).toBeLessThanOrEqual(50_000);
      expect(page.items.length).toBeGreaterThan(0);
      seen.push(...page.items.map((item) => item.sequence));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(Array.from({ length: 25 }, (_, index) => 24 - index));
    await expect(listHistory(t.db, ctx, { projectId, cursor: 'bad' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
