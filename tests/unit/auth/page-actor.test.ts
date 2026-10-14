import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../../src/server/db/tx';
import { configureApp, resetApp } from '../../../src/server/app';
import { createIdentityServices } from '../../../src/server/http/actors';
import type { RateLimiter } from '../../../src/server/http/rate-limit';
import { signSession } from '../../../src/server/http/session';
import type { AuthEnvironment } from '../../../src/server/env';
import { memoryStore, type MemoryStore } from './test-store';

const secret = 'cd'.repeat(32);
const env: AuthEnvironment = {
  mode: 'local',
  appOrigin: 'http://localhost:3000',
  sessionSecret: secret,
  google: null,
};
const page = vi.hoisted(() => ({ cookie: '', memos: [] as Map<string, unknown>[] }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost:3000' }),
  cookies: async () => ({ getAll: () => [{ name: 'pg_session', value: page.cookie }] }),
}));
// React provides the request scope in a server render; this stand-in scopes the memo to one test, which plays one page render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<string, R>();
    page.memos.push(memo as Map<string, unknown>);
    return (...args: A) => {
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key)!;
    };
  },
}));
const { optionalActor, requireActor } = await import('../../../src/server/http/rsc');

describe('page actor: one session resolution and one read charge per request', () => {
  let store: MemoryStore,
    userId: string,
    projectId: string,
    consume: ReturnType<typeof vi.fn<RateLimiter['consume']>>;
  beforeEach(async () => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', env.appOrigin);
    vi.stubEnv('SESSION_SECRET', secret);
    store = memoryStore();
    ({ userId } = await store.provisionUser({
      subject: 'local:dev',
      email: null,
      name: 'Local developer',
    }));
    projectId = randomUUID();
    store.projects.set(projectId, {
      workspaceId: (await store.resolveSessionUser(userId))!.defaultWorkspaceId,
    });
    page.cookie = signSession({ userId, expiresAt: Date.now() + 60_000 }, secret);
    page.memos.forEach((memo) => memo.clear());
    consume = vi.fn<RateLimiter['consume']>();
    (globalThis as { promiseRateLimiter?: RateLimiter }).promiseRateLimiter = { consume };
    configureApp({ db: {} as Db, identity: store, pool: {} as never });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetApp();
    delete (globalThis as { promiseRateLimiter?: RateLimiter }).promiseRateLimiter;
  });

  it('the layout and the page share one session read and one rate-limit charge', async () => {
    const layout = await requireActor('/');
    const inbox = await requireActor(`/projects/${projectId}/inbox`);
    await optionalActor(`/projects/${projectId}/inbox`);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(`user:${userId}:read`, 60, expect.any(Number));
    expect(layout).toMatchObject({ userId, projectId: null });
    expect(inbox).toMatchObject({ userId, projectId });
  });
  it('a foreign project still answers 404 without a second charge', async () => {
    await requireActor('/');
    const foreign = randomUUID();
    store.projects.set(foreign, { workspaceId: randomUUID() });
    await expect(requireActor(`/projects/${foreign}/inbox`)).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
    expect(consume).toHaveBeenCalledTimes(1);
  });
});

describe('browser actor split', () => {
  it('the session step charges the limit once and the project step never charges', async () => {
    const store = memoryStore(),
      consume = vi.fn();
    const { userId } = await store.provisionUser({
      subject: 'local:dev',
      email: null,
      name: 'Local developer',
    });
    const workspaceId = (await store.resolveSessionUser(userId))!.defaultWorkspaceId,
      projectId = randomUUID();
    store.projects.set(projectId, { workspaceId });
    const services = createIdentityServices({ store, env, limiter: { consume } });
    const request = new Request(`${env.appOrigin}/api/v1/projects/${projectId}`, {
      headers: {
        cookie: `pg_session=${signSession({ userId, expiresAt: Date.now() + 60_000 }, secret)}`,
      },
    });
    const session = await services.resolveBrowserSession(request);
    expect(consume).toHaveBeenCalledTimes(1);
    await expect(services.resolveBrowserProject(session, projectId)).resolves.toMatchObject({
      kind: 'user',
      userId,
      workspaceId,
      projectId,
    });
    await expect(services.resolveBrowserProject(session, null)).resolves.toMatchObject({
      projectId: null,
      workspaceId,
    });
    await expect(services.resolveBrowserProject(session, randomUUID())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(consume).toHaveBeenCalledTimes(1);
    await expect(services.getBrowserActor(request)).resolves.toMatchObject({ projectId });
    expect(consume).toHaveBeenCalledTimes(2);
  });
});
