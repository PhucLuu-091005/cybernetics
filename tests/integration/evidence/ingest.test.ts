import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { envelopeFor, mainSnapshotJson, projectRow, record, versionCount } from '../../support/evidence';
import { createProject } from '../../../src/server/domain/projects';
import { ingestRecords } from '../../../src/server/domain/records';
import { recordVersions, records } from '../../../src/server/db/schema';
import { IngestReceiptSchema, type ActorContext, type Project } from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('record ingest', () => {
  let t: TestDb, ctx: ActorContext, project: Project;
  const envelope = (items: unknown[], key: string) => envelopeFor(project.id, items, key);
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
    project = await createProject(t.db, ctx, { title: 'Fund III', clientName: 'Larkspur' });
  });
  afterAll(async () => { await t?.close(); });

  it('creates pending evidence and leaves main byte-for-byte unchanged', async () => {
    const before = await mainSnapshotJson(t.db, project.id);
    const receipt = await ingestRecords(t.db, ctx, envelope([record('m1', 'Can you send the CRM mapping by Friday?')], 'k1'));
    expect(receipt.items[0]).toMatchObject({ decision: 'new' });
    expect(receipt.evidenceRevision).toBe(1);
    expect(await mainSnapshotJson(t.db, project.id)).toBe(before);
  });
  it('does not bump evidence revision for a duplicate-only batch', async () => {
    await ingestRecords(t.db, ctx, envelope([record('m2', 'x')], 'k2'));
    const again = await ingestRecords(t.db, ctx, envelope([record('m2', 'x')], 'k3'));
    expect(again.items[0].decision).toBe('duplicate');
    expect(again.evidenceRevision).toBe((await projectRow(t.db, project.id)).evidenceRevision);
  });
  it('creates a new version for a metadata-only change and keeps the old version', async () => {
    await ingestRecords(t.db, ctx, envelope([record('m3', 'body')], 'k4'));
    const changed = await ingestRecords(t.db, ctx, envelope([{ ...record('m3', 'body'), title: 'Renamed' }], 'k5'));
    expect(changed.items[0].decision).toBe('new_version');
    expect(await versionCount(t.db, 'm3')).toBe(2);
  });
  it('commits valid items and reports invalid ones in the same batch', async () => {
    const receipt = await ingestRecords(t.db, ctx, envelope([record('m4', 'ok'), { title: '' }], 'k6'));
    expect(receipt.items.map(item => item.decision)).toEqual(['new', 'invalid']);
  });
  it('returns the same receipt for a retry and CONFLICT for a changed payload with the same key', async () => {
    const first = await ingestRecords(t.db, ctx, envelope([record('m5', 'a')], 'k7'));
    expect(await ingestRecords(t.db, ctx, envelope([record('m5', 'a')], 'k7'))).toEqual(first);
    await expect(ingestRecords(t.db, ctx, envelope([record('m5', 'b')], 'k7'))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('refuses more than 25 records and an agent without records:import', async () => {
    await expect(ingestRecords(t.db, ctx, envelope(Array.from({ length: 26 }, (_, i) => record(`b${i}`, 'x')), 'k8'))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(ingestRecords(t.db, agentActor(ctx, project.id, ['project:read']), envelope([record('m6', 'x')], 'k9'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('bumps evidence revision once per material batch and stamps every new version with it', async () => {
    const before = (await projectRow(t.db, project.id)).evidenceRevision;
    const receipt = await ingestRecords(t.db, ctx, envelope([record('n1', 'one'), record('n2', 'two'), { ...record('n1', 'one'), title: 'Edited in batch' }], 'k10'));
    expect(IngestReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt).toMatchObject({ projectId: project.id, mainCommitId: project.mainCommitId, requestId: ctx.requestId, idempotencyKey: 'k10', evidenceRevision: before + 1 });
    expect(receipt.items.map(item => item.decision)).toEqual(['new', 'new', 'new_version']);
    const stamped = await t.db.select({ evidenceRevision: recordVersions.evidenceRevision }).from(recordVersions).where(inArray(recordVersions.externalId, ['n1', 'n2']));
    expect(stamped.map(row => row.evidenceRevision)).toEqual([before + 1, before + 1, before + 1]);
    const [n1] = await t.db.select().from(records).where(eq(records.externalId, 'n1'));
    const third = receipt.items[2];
    expect(third.decision !== 'invalid' && n1.currentVersionId === third.recordVersionId && n1.id === third.recordId).toBe(true);
  });
  it('deduplicates a record without external id by source and digest', async () => {
    const { externalId: _ignored, ...anonymous } = record('unused', 'Pasted without an id');
    void _ignored;
    const first = await ingestRecords(t.db, ctx, envelope([anonymous], 'k11'));
    const second = await ingestRecords(t.db, ctx, envelope([anonymous], 'k12'));
    expect(first.items[0]).toMatchObject({ decision: 'new' });
    expect(second.items[0]).toMatchObject({ decision: 'duplicate', recordVersionId: first.items[0].decision === 'new' ? first.items[0].recordVersionId : null });
    expect(second.evidenceRevision).toBe(first.evidenceRevision);
  });
  it('resolves a date-only record in the main snapshot time zone and lets an item inherit the envelope source label', async () => {
    const { occurredAt: _ignored, sourceLabel: _label, ...dateOnly } = record('d1', 'Dated only');
    void [_ignored, _label];
    const receipt = await ingestRecords(t.db, ctx, envelope([{ ...dateOnly, occurredDate: '2026-10-01' }], 'k13'));
    expect(receipt.items[0].decision).toBe('new');
    const [version] = await t.db.select().from(recordVersions).where(eq(recordVersions.externalId, 'd1'));
    expect(version).toMatchObject({ timePrecision: 'day', occurredDate: '2026-10-01', occurredTimeZone: 'Asia/Ho_Chi_Minh', sourceLabel: 'Paste' });
    expect(new Date(version.occurredAt).toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });
  it('reports field errors for an invalid item and rejects another project as NOT_FOUND', async () => {
    const receipt = await ingestRecords(t.db, ctx, envelope(['not an object'], 'k14'));
    expect(receipt.items[0]).toMatchObject({ decision: 'invalid', errors: [expect.objectContaining({ message: expect.any(String) })] });
    expect(receipt.evidenceRevision).toBe((await projectRow(t.db, project.id)).evidenceRevision);
    const stranger = await testActor(t.db);
    await expect(ingestRecords(t.db, stranger, envelope([record('s1', 'x')], 'k15'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
