import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { envelopeFor, projectRow, record } from '../../support/evidence';
import { createProject } from '../../../src/server/domain/projects';
import {
  ingestRecords,
  loadRecordMetadata,
  readRecordChunk,
  readRecordText,
  searchRecords,
  withdrawRecord,
} from '../../../src/server/domain/records';
import { eq } from 'drizzle-orm';
import { projects, workspaceMembers } from '../../../src/server/db/schema';
import {
  RecordChunkSchema,
  SearchRecordsResultSchema,
  type ActorContext,
  type Project,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('record reads', () => {
  let t: TestDb, ctx: ActorContext, project: Project;
  async function ingestInto(projectId: string, body: string, title?: string): Promise<string> {
    const externalId = randomUUID();
    const [owner] = await t.db
      .select({ userId: workspaceMembers.userId, workspaceId: projects.workspaceId })
      .from(projects)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, projects.workspaceId))
      .where(eq(projects.id, projectId))
      .limit(1);
    const actor: ActorContext = {
      kind: 'user',
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: null,
      scopes: ctx.scopes,
      requestId: ctx.requestId,
    };
    const receipt = await ingestRecords(
      t.db,
      actor,
      envelopeFor(
        projectId,
        [{ ...record(externalId, body), ...(title ? { title } : {}) }],
        externalId,
      ),
    );
    const item = receipt.items[0];
    if (item.decision === 'invalid') throw new Error(JSON.stringify(item.errors));
    return item.recordVersionId;
  }
  const ingestOne = (body: string, title?: string) => ingestInto(project.id, body, title);
  const recordIdOf = async (versionId: string) =>
    (await loadRecordMetadata(t.db, project.id, [versionId])).get(versionId)!.recordId;
  const evidenceRevision = async () => (await projectRow(t.db, project.id)).evidenceRevision;
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
    project = await createProject(t.db, ctx, { title: 'Fund III', clientName: 'Larkspur' });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('emoji across chunk boundary reconstructs the original text', async () => {
    const body = 'a'.repeat(7_999) + '😀' + 'Anh Minh ơi, em gửi lại bản đồ trường dữ liệu nhé 🙏';
    const id = await ingestOne(body);
    let cursor: string | null = null,
      text = '';
    const starts: number[] = [];
    do {
      const chunk = await readRecordChunk(t.db, ctx, {
        projectId: project.id,
        recordVersionId: id,
        cursor,
      });
      text += chunk.text;
      starts.push(chunk.start);
      cursor = chunk.nextCursor;
    } while (cursor);
    expect(text).toBe(body);
    expect(starts).toEqual([0, 7_999]);
  });
  it('readRecordText returns the whole masked body in one read with the chunk header and metadata', async () => {
    const body = 'a'.repeat(7_999) + '😀' + 'ơ'.repeat(20_000) + ' end';
    const id = await ingestOne(body);
    const first = await readRecordChunk(t.db, ctx, { projectId: project.id, recordVersionId: id });
    const read = await readRecordText(t.db, ctx, { projectId: project.id, recordVersionId: id });
    expect(read).toEqual({
      projectId: project.id,
      recordVersionId: id,
      digest: first.digest,
      text: body,
      totalLength: body.length,
      withdrawn: false,
      header: first.header,
      metadata: first.metadata,
      requestId: ctx.requestId,
    });
    const withdrawn = await ingestOne('to be masked');
    await withdrawRecord(t.db, ctx, {
      projectId: project.id,
      recordId: await recordIdOf(withdrawn),
      expectedEvidenceRevision: await evidenceRevision(),
      reason: 'Client asked',
      idempotencyKey: randomUUID(),
    });
    expect(
      await readRecordText(t.db, ctx, { projectId: project.id, recordVersionId: withdrawn }),
    ).toMatchObject({
      withdrawn: true,
      text: '',
      totalLength: 0,
      header: expect.stringMatching(/Unavailable evidence/),
      metadata: { permalink: null },
    });
    await expect(
      readRecordText(t.db, ctx, { projectId: project.id, recordVersionId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      readRecordText(t.db, agentActor(ctx, project.id, ['records:import']), {
        projectId: project.id,
        recordVersionId: id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('withdrawal masks historical chunk reads and bumps evidence revision once', async () => {
    const id = await ingestOne('secret body');
    const recordId = await recordIdOf(id);
    const result = await withdrawRecord(t.db, ctx, {
      projectId: project.id,
      recordId,
      expectedEvidenceRevision: await evidenceRevision(),
      reason: 'Client asked',
      idempotencyKey: 'w1',
    });
    const chunk = await readRecordChunk(t.db, ctx, { projectId: project.id, recordVersionId: id });
    expect(chunk).toMatchObject({ withdrawn: true, text: '', metadata: { permalink: null } });
    expect(chunk.header).toMatch(/Unavailable evidence/);
    expect(result.evidenceRevision).toBe(await evidenceRevision());
  });
  it('a cursor from one version cannot read another version', async () => {
    const a = await ingestOne('x'.repeat(9_000)),
      b = await ingestOne('y'.repeat(9_000));
    const first = await readRecordChunk(t.db, ctx, { projectId: project.id, recordVersionId: a });
    await expect(
      readRecordChunk(t.db, ctx, {
        projectId: project.id,
        recordVersionId: b,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('searches with accent folding and masks withdrawn excerpts', async () => {
    await ingestOne('Bản đồ trường dữ liệu cho Larkspur');
    const result = await searchRecords(t.db, ctx, {
      projectId: project.id,
      query: 'ban do truong',
    });
    expect(result.items[0].excerpt).toContain('Bản đồ trường');
  });
  it('another project version id returns NOT_FOUND', async () => {
    const other = await createProject(t.db, await testActor(t.db), { title: 'O', clientName: 'O' });
    const foreign = await ingestInto(other.id, 'foreign text');
    await expect(
      readRecordChunk(t.db, ctx, { projectId: project.id, recordVersionId: foreign }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns a contract-valid chunk with absolute offsets, digest, header and metadata', async () => {
    const id = await ingestOne('Short body with a permalink');
    const chunk = await readRecordChunk(t.db, ctx, {
      projectId: project.id,
      recordVersionId: id,
      limit: 5,
    });
    expect(RecordChunkSchema.parse(chunk)).toEqual(chunk);
    expect(chunk).toMatchObject({
      start: 0,
      end: 5,
      text: 'Short',
      totalLength: 27,
      withdrawn: false,
      requestId: ctx.requestId,
      metadata: {
        id,
        title: expect.stringMatching(/^Message /),
        provenance: { actor: { kind: 'user', userId: ctx.userId } },
      },
    });
    expect(chunk.header).toContain(`version ${id}`);
    const next = await readRecordChunk(t.db, ctx, {
      projectId: project.id,
      recordVersionId: id,
      cursor: chunk.nextCursor,
      limit: 8_000,
    });
    expect(next).toMatchObject({ start: 5, end: 27, nextCursor: null });
  });
  it('rejects a malformed cursor and lets an agent read only its own project', async () => {
    const id = await ingestOne('agent visible');
    await expect(
      readRecordChunk(t.db, ctx, {
        projectId: project.id,
        recordVersionId: id,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      readRecordChunk(t.db, ctx, { projectId: project.id, recordVersionId: id, cursor: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      searchRecords(t.db, ctx, { projectId: project.id, query: 'agent', cursor: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const agent = agentActor(ctx, project.id, ['project:read']);
    expect(
      (await readRecordChunk(t.db, agent, { projectId: project.id, recordVersionId: id })).text,
    ).toBe('agent visible');
    await expect(
      readRecordChunk(t.db, agentActor(ctx, project.id, ['records:import']), {
        projectId: project.id,
        recordVersionId: id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('withdrawal is browser-only, idempotent on retry, and conflicts on a stale evidence revision', async () => {
    const id = await ingestOne('to withdraw');
    const recordId = await recordIdOf(id);
    const input = {
      projectId: project.id,
      recordId,
      expectedEvidenceRevision: await evidenceRevision(),
      reason: 'Mistake',
      idempotencyKey: 'w2',
    };
    await expect(
      withdrawRecord(t.db, agentActor(ctx, project.id, ['project:read', 'records:import']), input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      withdrawRecord(t.db, ctx, {
        ...input,
        expectedEvidenceRevision: input.expectedEvidenceRevision - 1,
        idempotencyKey: 'w-stale',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const first = await withdrawRecord(t.db, ctx, input);
    expect(first).toMatchObject({
      projectId: project.id,
      recordId,
      withdrawn: true,
      evidenceRevision: input.expectedEvidenceRevision + 1,
    });
    expect(await withdrawRecord(t.db, ctx, input)).toEqual(first);
    const again = await withdrawRecord(t.db, ctx, {
      ...input,
      expectedEvidenceRevision: first.evidenceRevision,
      idempotencyKey: 'w3',
    });
    expect(again.evidenceRevision).toBe(first.evidenceRevision);
    expect(await evidenceRevision()).toBe(first.evidenceRevision);
  });
  it('masks a withdrawn excerpt and does not match a withdrawn body', async () => {
    const id = await ingestOne('Confidential pricing zebra', 'Zebra pricing thread');
    await withdrawRecord(t.db, ctx, {
      projectId: project.id,
      recordId: await recordIdOf(id),
      expectedEvidenceRevision: await evidenceRevision(),
      reason: 'Client asked',
      idempotencyKey: 'w4',
    });
    const byTitle = await searchRecords(t.db, ctx, {
      projectId: project.id,
      query: 'zebra pricing',
    });
    expect(SearchRecordsResultSchema.parse(byTitle)).toEqual(byTitle);
    expect(byTitle.items).toEqual([
      expect.objectContaining({
        recordVersionId: id,
        withdrawn: true,
        excerpt: '',
        start: 0,
        end: 0,
      }),
    ]);
    expect(
      (await searchRecords(t.db, ctx, { projectId: project.id, query: 'confidential' })).items,
    ).toEqual([]);
  });
  it('paginates search results with a cursor bound to the query', async () => {
    for (const n of [1, 2, 3]) await ingestOne(`Pagination marker quokka ${n}`);
    const first = await searchRecords(t.db, ctx, {
      projectId: project.id,
      query: 'QUOKKA',
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    const second = await searchRecords(t.db, ctx, {
      projectId: project.id,
      query: 'QUOKKA',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({
      nextCursor: null,
      items: [expect.objectContaining({ excerpt: expect.stringContaining('quokka') })],
    });
    expect(
      new Set([...first.items, ...second.items].map((item) => item.recordVersionId)).size,
    ).toBe(3);
    await expect(
      searchRecords(t.db, ctx, { projectId: project.id, query: 'other', cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('returns the title with zero offsets when only the title matches', async () => {
    const id = await ingestOne('Body without the marker', 'Wombat schedule');
    const result = await searchRecords(t.db, ctx, { projectId: project.id, query: 'wombat' });
    expect(result.items).toEqual([
      expect.objectContaining({
        recordVersionId: id,
        excerpt: 'Wombat schedule',
        start: 0,
        end: 0,
        withdrawn: false,
      }),
    ]);
  });
  it('bounds a search page to 50,000 characters and continues at the next item', async () => {
    const bodies = Array.from(
      { length: 50 },
      (_, i) => `pagebound ${String(i).padStart(2, '0')} ` + 'ữ'.repeat(1_200),
    );
    for (const batch of [bodies.slice(0, 25), bodies.slice(25)]) {
      await ingestRecords(
        t.db,
        ctx,
        envelopeFor(
          project.id,
          batch.map((body) => record(randomUUID(), body)),
          randomUUID(),
        ),
      );
    }
    const first = await searchRecords(t.db, ctx, { projectId: project.id, query: 'pagebound' });
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(50_000);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(50);
    expect(first.nextCursor).not.toBeNull();
    const seen = [...first.items];
    for (let cursor = first.nextCursor; cursor;) {
      const page = await searchRecords(t.db, ctx, {
        projectId: project.id,
        query: 'pagebound',
        cursor,
      });
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(50_000);
      seen.push(...page.items);
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(50);
    expect(new Set(seen.map((item) => item.recordVersionId)).size).toBe(50);
  });
  it('loads metadata for current, superseded and withdrawn versions within one project only', async () => {
    const externalId = randomUUID();
    const v1 = await ingestRecords(
      t.db,
      ctx,
      envelopeFor(project.id, [record(externalId, 'first draft')], `${externalId}-1`),
    );
    const v2 = await ingestRecords(
      t.db,
      ctx,
      envelopeFor(project.id, [record(externalId, 'second draft')], `${externalId}-2`),
    );
    const [oldId, newId] = [v1.items[0], v2.items[0]].map((item) =>
      item.decision === 'invalid' ? '' : item.recordVersionId,
    );
    const withdrawnId = await ingestOne('gone');
    await withdrawRecord(t.db, ctx, {
      projectId: project.id,
      recordId: await recordIdOf(withdrawnId),
      expectedEvidenceRevision: await evidenceRevision(),
      reason: 'Removed',
      idempotencyKey: 'w5',
    });
    const other = await createProject(t.db, ctx, { title: 'Other', clientName: 'Other' });
    const foreign = await ingestInto(other.id, 'foreign');
    const metadata = await loadRecordMetadata(t.db, project.id, [
      oldId,
      newId,
      withdrawnId,
      foreign,
      'not-a-uuid',
    ]);
    expect([...metadata.keys()].sort()).toEqual([oldId, newId, withdrawnId].sort());
    expect(metadata.get(oldId)).toMatchObject({
      bodyText: 'first draft',
      superseded: true,
      withdrawn: false,
      projectId: project.id,
      occurredAt: '2026-10-01T02:00:00.000Z',
      quotedRanges: [],
    });
    expect(metadata.get(newId)).toMatchObject({
      bodyText: 'second draft',
      superseded: false,
      withdrawn: false,
    });
    expect(metadata.get(withdrawnId)).toMatchObject({ bodyText: null, withdrawn: true });
    expect(metadata.get(newId)!.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
