import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { mainSnapshotJson } from '../../support/evidence';
import { headOf, ingestEnvelope, larkspurRecords, larkspurT, mergeOperations, rekey, seedLarkspur, type LarkspurSeed } from '../../support/seed';
import proposals from '../../../fixtures/proposals.json';
import { uuidFromKey } from '../../../scripts/build-fixtures';
import { previewRevert, revertCommit } from '../../../src/server/domain/commits';
import { getInboxHints, listInbox } from '../../../src/server/domain/inbox';
import { ingestRecords, withdrawRecord } from '../../../src/server/domain/records';
import { ListInboxResultSchema, type ActorContext, type GraphOperation, type ListInboxInput, type ListInboxResult, type RecordInput } from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('inbox', () => {
  let t: TestDb, ctx: ActorContext, seed: LarkspurSeed, projectId: string;
  const T = larkspurT;
  const itemOf = async (recordVersionId: string, view: Partial<ListInboxInput> = {}): Promise<ListInboxResult['items'][number] | undefined> => {
    let cursor: string | null | undefined;
    do {
      const page = await listInbox(t.db, ctx, { projectId, cursor, ...view });
      expect(ListInboxResultSchema.parse(page)).toEqual(page);
      const hit = page.items.find(item => item.recordVersionId === recordVersionId);
      if (hit) return hit;
      cursor = page.nextCursor;
    } while (cursor);
    return undefined;
  };
  const stateOf = async (recordVersionId: string, view: Partial<ListInboxInput> = {}) => (await itemOf(recordVersionId, view))?.state;
  const ingestOne = async (record: RecordInput) => {
    const item = (await ingestRecords(t.db, ctx, ingestEnvelope(projectId, [record]))).items[0];
    if (item.decision === 'invalid') throw new Error('Test record is invalid');
    return item.recordVersionId;
  };
  const versionOfAct = (key: string) => seed.snapshot.acts.find(act => act.id === uuidFromKey(`act:${key}`))!.citation.recordVersionId;
  const inputOf = (versionId: string) => seed.inputs.get(versionId)!;
  const withdraw = async (versionId: string) => withdrawRecord(t.db, ctx, { projectId, recordId: seed.recordIds.get(versionId)!, expectedEvidenceRevision: (await headOf(t.db, projectId)).evidenceRevision, reason: 'Source asked to withdraw', idempotencyKey: randomUUID() });
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
  });
  afterAll(async () => { await t?.close(); });
  beforeEach(async () => {
    seed = await seedLarkspur(t.db, ctx);
    projectId = seed.projectId;
  });

  it('import and hint reads do not alter main', async () => {
    const before = await mainSnapshotJson(t.db, projectId);
    const parent = inputOf(versionOfAct('secret:0'));
    const reply = await ingestOne({ ...parent, externalId: `${parent.externalId}.reply`, threadExternalId: parent.threadExternalId, parentExternalId: parent.externalId, bodyText: 'Any update on the secret rotation?', occurredAt: '2026-10-09T10:00:00+07:00' });
    const hints = await getInboxHints(t.db, ctx, { projectId, recordVersionId: reply });
    expect(hints).toContainEqual(expect.objectContaining({ kind: 'parent', recordVersionId: versionOfAct('secret:0') }));
    expect(hints.some(hint => hint.kind === 'author' && hint.reason.length > 0)).toBe(true);
    expect(hints.every(hint => hint.recordVersionId !== reply)).toBe(true);
    expect(await mainSnapshotJson(t.db, projectId)).toEqual(before);
    expect(await stateOf(reply)).toBe('pending');
  });
  it('a new version is pending even when the old version is included', async () => {
    const oldVersionId = versionOfAct('go-live:0');
    const newVersionIdOfIncludedRecord = await ingestOne({ ...inputOf(oldVersionId), bodyText: `${inputOf(oldVersionId).bodyText} (edited)` });
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
    expect(page.items.every(item => item.state === 'pending')).toBe(true);
  });
  it('decisions are commit-specific: revert makes a decision pending again', async () => {
    const agent = proposals.find(item => item.key === 'agent-incident-follow-up')!;
    const operations = rekey(agent.operations as GraphOperation[], seed.versionIds);
    const included = (operations.find(op => op.op === 'put' && op.collection === 'recordDecisions') as { value: { recordVersionId: string } }).value.recordVersionId;
    expect(await stateOf(included)).toBe('pending');
    const merge = await mergeOperations(t.db, ctx, projectId, operations, 'Include the follow-up');
    expect(await stateOf(included)).toBe('included');
    expect(await stateOf(included, { commitId: seed.seedCommitId })).toBe('pending');
    const { mainCommitId, evidenceRevision } = await headOf(t.db, projectId);
    const preview = await previewRevert(t.db, ctx, { projectId, targetCommitId: merge.commitId, expectedMainCommitId: mainCommitId, expectedEvidenceRevision: evidenceRevision, T });
    await revertCommit(t.db, ctx, { projectId, targetCommitId: merge.commitId, expectedMainCommitId: mainCommitId, expectedEvidenceRevision: evidenceRevision, reviewDigest: preview.digest, T, message: 'Revert the follow-up', idempotencyKey: randomUUID() });
    expect(await stateOf(included)).toBe('pending');
  });
  it('a withdrawn referenced item stays reconciliation-needed until the graph removes its acts', async () => {
    const versionId = versionOfAct('go-live:0');
    await withdraw(versionId);
    expect(await itemOf(versionId)).toMatchObject({ state: 'withdrawn', proposedDisposition: 'included', header: expect.stringContaining('Unavailable evidence') });
    const acts = seed.snapshot.acts.filter(act => act.citation.recordVersionId === versionId);
    await mergeOperations(t.db, ctx, projectId, [
      ...acts.map((act): GraphOperation => ({ op: 'remove', collection: 'acts', id: act.id })),
      { op: 'put', collection: 'recordDecisions', value: { recordVersionId: versionId, disposition: 'ignored', reason: 'Withdrawn by the source' } },
    ], 'Reconcile withdrawn evidence');
    expect(await stateOf(versionId)).toBe('ignored');
    expect(await stateOf(versionId, { commitId: seed.seedCommitId })).toBe('withdrawn');
  });
  it('a proposal view needs its revision and pages are bounded', async () => {
    await expect(listInbox(t.db, ctx, { projectId, proposalId: randomUUID() })).rejects.toMatchObject({ code: 'VALIDATION' });
    const first = await listInbox(t.db, ctx, { projectId });
    expect(first.items).toHaveLength(50);
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(50_000);
    const all: string[] = []; let cursor: string | null | undefined;
    do { const page = await listInbox(t.db, ctx, { projectId, cursor }); all.push(...page.items.map(item => item.recordVersionId)); cursor = page.nextCursor; } while (cursor);
    expect(new Set(all).size).toBe(larkspurRecords.length);
  });
});
