import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { createProject } from '../../../src/server/domain/projects';

const secret = 'app-wiring-test-secret-of-32-bytes!!';
const state = globalThis as typeof globalThis & {
  promiseApp?: unknown;
  promiseIdentityStore?: unknown;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('app composition root', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    delete state.promiseApp;
    delete state.promiseIdentityStore;
    await t?.close();
  });

  it('resolves browser and token actors in fresh module state without a prior getApp call', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'Wired', clientName: 'W' });
    vi.stubEnv('DATABASE_URL', t.url);
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SESSION_SECRET', secret);
    delete state.promiseApp;
    delete state.promiseIdentityStore;
    vi.resetModules();
    const app = await import('../../../src/server/app');
    const { SESSION_COOKIE, signSession } = await import('../../../src/server/http/session');
    try {
      const cookie = `${SESSION_COOKIE}=${signSession({ userId: ctx.userId, expiresAt: Date.now() + 60_000 }, secret)}`;
      expect(
        await app.browserActor(
          new Request('http://localhost:3000/api/projects', { headers: { cookie } }),
        ),
      ).toMatchObject({
        kind: 'user',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        projectId: null,
      });
      const created = await app.createAgentToken(ctx, {
        projectId: project.id,
        label: 'Codex',
        idempotencyKey: 'wire-1',
      });
      const bearer = () =>
        new Request('http://localhost:3000/api/mcp', {
          headers: { authorization: `Bearer ${created.secret}` },
        });
      expect(await app.tokenActor(bearer(), 'project:read')).toMatchObject({
        kind: 'agent',
        tokenId: created.token.id,
        projectId: project.id,
        workspaceId: ctx.workspaceId,
      });
      expect(
        (
          await app.revokeAgentToken(ctx, {
            projectId: project.id,
            tokenId: created.token.id,
            idempotencyKey: 'wire-r1',
          })
        ).tokenId,
      ).toBe(created.token.id);
      await expect(app.tokenActor(bearer(), 'project:read')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    } finally {
      await app.getApp().pool.end();
    }
  });
});
