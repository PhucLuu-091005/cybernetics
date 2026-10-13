import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, testActor, agentActor, type TestDb } from '../../support/db';
import { createProject } from '../../../src/server/domain/projects';
import { withTransaction } from '../../../src/server/db/tx';
import { actorKey, withReceipt } from '../../../src/server/db/receipts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('mutation receipts', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase(); });
  afterAll(async () => { await t?.close(); });

  it('replays the stored result for the same key and input, and conflicts on different input', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'R', clientName: 'R' });
    let runs = 0;
    const run = (input: unknown) => withTransaction(t.db, tx => withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'test', idempotencyKey: 'k1', input }, async () => ({ n: ++runs })));
    expect(await run({ a: 1 })).toEqual({ n: 1 });
    expect(await run({ a: 1 })).toEqual({ n: 1 });
    await expect(run({ a: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(runs).toBe(1);
  });
  it('keys receipts by actor and operation, and stores nothing when the run fails', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'S', clientName: 'S' });
    const agent = agentActor(ctx, project.id, ['project:read']);
    expect(actorKey(ctx)).toBe(`user:${ctx.userId}`);
    expect(actorKey(agent)).toBe(`token:${agent.kind === 'agent' ? agent.tokenId : ''}`);
    let runs = 0;
    const run = (key: string, operation: string, fail = false) => withTransaction(t.db, tx => withReceipt(tx, { projectId: project.id, actorKey: key, operation, idempotencyKey: 'k', input: { same: true } }, async () => { runs++; if (fail) throw new Error('boom'); return runs; }));
    await expect(run(actorKey(ctx), 'a', true)).rejects.toThrow('boom');
    expect(await run(actorKey(ctx), 'a')).toBe(2);
    expect(await run(actorKey(agent), 'a')).toBe(3);
    expect(await run(actorKey(ctx), 'b')).toBe(4);
    expect(await run(actorKey(ctx), 'a')).toBe(2);
  });
  it('serializes concurrent requests with the same key so run executes once and both results match', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'C', clientName: 'C' });
    let runs = 0;
    const call = () => withTransaction(t.db, tx => withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'race', idempotencyKey: 'same', input: { a: 1 } }, async () => {
      runs++; await new Promise(resolve => setTimeout(resolve, 150)); return { n: runs };
    }));
    const [first, second] = await Promise.all([call(), call()]);
    expect(runs).toBe(1);
    expect(first).toEqual({ n: 1 });
    expect(second).toEqual(first);
  });
  it('returns the JSON form on the first call and rejects an undefined result', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'J', clientName: 'J' });
    const call = (idempotencyKey: string, result: unknown) => withTransaction(t.db, tx => withReceipt(tx, { projectId: project.id, actorKey: actorKey(ctx), operation: 'json', idempotencyKey, input: {} }, async () => result));
    const first = await call('j1', { a: 1, dropped: undefined });
    expect(first).toStrictEqual({ a: 1 });
    expect(await call('j1', { a: 1, dropped: undefined })).toStrictEqual(first);
    await expect(call('j2', undefined)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
