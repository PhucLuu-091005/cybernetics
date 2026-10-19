import { describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { Creator, Scope } from '../../../src/contracts';
import { createIdentityServices } from '../../../src/server/http/actors';
import { createTokenService } from '../../../src/server/domain/tokens/service';
import { signSession } from '../../../src/server/http/session';
import type { AuthEnvironment } from '../../../src/server/env';
import { memoryStore } from './test-store';
const now = Date.parse('2026-10-13T00:00:00Z');
const LEAD: Creator = {
  member: true,
  rights: { viewMain: true, create: true, merge: true, manage: true },
};
const env: AuthEnvironment = {
  mode: 'local',
  appOrigin: 'http://localhost:3000',
  sessionSecret: 'ab'.repeat(32),
  google: null,
};
async function setup() {
  const store = memoryStore();
  const projectId = randomUUID();
  const { userId } = await store.provisionUser({
    subject: 'local:dev',
    email: null,
    name: 'Local developer',
  });
  const workspaceId = (await store.resolveSessionUser(userId))!.defaultWorkspaceId;
  store.projects.set(projectId, { workspaceId });
  const services = createIdentityServices({ store, env, now: () => now });
  const ctx = {
    kind: 'user' as const,
    userId,
    workspaceId,
    projectId,
    scopes: ['project:read' as const, 'queue:add' as const],
    requestId: 'test',
  };
  const tokens = createTokenService(
    store,
    async () => LEAD,
    () => now,
  );
  const request = (secret?: string, method = 'GET') =>
    new Request(`${env.appOrigin}/api/projects/${projectId}`, {
      method,
      headers: secret
        ? { authorization: `Bearer ${secret}` }
        : {
            cookie: `pg_session=${signSession({ userId, expiresAt: now + 60_000 }, env.sessionSecret)}`,
            origin: env.appOrigin,
          },
    });
  return { store, userId, workspaceId, projectId, services, ctx, tokens, request };
}
describe('browser identity and scoped authorization', () => {
  it('resolves a signed user and project through current membership', async () => {
    const s = await setup();
    const actor = await s.services.getBrowserActor(s.request());
    expect(actor).toMatchObject({
      kind: 'user',
      userId: s.userId,
      workspaceId: s.workspaceId,
      projectId: s.projectId,
    });
    s.store.memberships.clear();
    await expect(s.services.getBrowserActor(s.request())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('resolves the workspace before a project is selected', async () => {
    const s = await setup();
    await expect(
      s.services.getBrowserActor(new Request(env.appOrigin, { headers: s.request().headers })),
    ).resolves.toMatchObject({ projectId: null, workspaceId: s.workspaceId });
  });
  it('rejects a signed session for an unknown persisted identity', async () => {
    const s = await setup();
    s.store.users.clear();
    await expect(s.services.getBrowserActor(s.request())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
  it('rejects a foreign project and mutation Origin', async () => {
    const s = await setup();
    const other = randomUUID();
    s.store.projects.set(other, { workspaceId: randomUUID() });
    await expect(
      s.services.getBrowserActor(
        new Request(`${env.appOrigin}/api/projects/${other}`, { headers: s.request().headers }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const request = s.request(undefined, 'POST');
    request.headers.set('origin', 'https://evil.example');
    await expect(s.services.getBrowserActor(request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
describe('multi-workspace browser actors', () => {
  const env: AuthEnvironment = {
    mode: 'google',
    appOrigin: 'https://pg.example',
    sessionSecret: 's'.repeat(32),
    google: { clientId: 'id', clientSecret: 'secret' },
  };
  const signedRequest = (userId: string, path: string) =>
    new Request(`https://pg.example${path}`, {
      headers: {
        cookie: `pg_session=${signSession({ userId, expiresAt: 2_000 }, env.sessionSecret)}`,
      },
    });
  it('lets one user act in two workspaces through project membership', async () => {
    const store = memoryStore();
    const { userId } = await store.provisionUser({ subject: 'google:1', email: null, name: 'A' });
    const other = randomUUID();
    store.memberships.add(`${userId}:${other}`);
    const project = randomUUID();
    store.projects.set(project, { workspaceId: other });
    const services = createIdentityServices({ store, env, now: () => 1_000 });
    const actor = await services.getBrowserActor(
      signedRequest(userId, `/api/v1/projects/${project}/graph`),
    );
    expect(actor).toMatchObject({ kind: 'user', userId, workspaceId: other, projectId: project });
  });
  it('returns 404 for a project in a workspace the user does not belong to', async () => {
    const store = memoryStore();
    const { userId } = await store.provisionUser({ subject: 'google:1', email: null, name: 'A' });
    const project = randomUUID();
    store.projects.set(project, { workspaceId: randomUUID() });
    const services = createIdentityServices({ store, env, now: () => 1_000 });
    await expect(
      services.getBrowserActor(signedRequest(userId, `/api/v1/projects/${project}/graph`)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('opens a project that the store grants through a project member, outside the workspaces of the user', async () => {
    const base = memoryStore();
    const { userId } = await base.provisionUser({ subject: 'google:1', email: null, name: 'A' });
    const workspaceId = randomUUID();
    const store = {
      ...base,
      resolveProject: async (_userId: string, projectId: string) => ({ workspaceId, projectId }),
    };
    const services = createIdentityServices({ store, env, now: () => 1_000 });
    const projectId = randomUUID();
    await expect(
      services.getBrowserActor(signedRequest(userId, `/api/v1/projects/${projectId}/graph`)),
    ).resolves.toMatchObject({ kind: 'user', workspaceId, projectId });
  });
  it('returns 404 for a no-project request when the user lacks default-workspace membership', async () => {
    const store = memoryStore();
    const { userId } = await store.provisionUser({ subject: 'google:1', email: null, name: 'A' });
    store.memberships.clear();
    const services = createIdentityServices({ store, env, now: () => 1_000 });
    await expect(
      services.getBrowserActor(signedRequest(userId, '/api/v1/projects')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
describe('hashed project agent tokens', () => {
  it('creates 30-day tokens with read and queue scopes only and stores only a hash', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'create-1',
    });
    expect(created.token.scopes).toEqual(['project:read', 'queue:add']);
    expect(created.token.expiresAt).toBe('2026-11-12T00:00:00.000Z');
    expect(created.secret).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);
    expect([...s.store.tokens.values()][0].idempotencyKey).toBe('create-1');
    expect(JSON.stringify([...s.store.tokens.values()])).not.toContain(created.secret);
    expect(s.store.tokens.has(createHash('sha256').update(created.secret).digest('hex'))).toBe(
      true,
    );
    await expect(
      s.services.getTokenActor(s.request(created.secret), 'project:read'),
    ).resolves.toMatchObject({ kind: 'agent', projectId: s.projectId });
  });
  it('conflicts on repeated creation keys without persisting or replaying a secret', async () => {
    const s = await setup();
    const input = { projectId: s.projectId, label: 'Once', idempotencyKey: 'once' };
    const first = await s.tokens.createToken(s.ctx, input);
    await expect(s.tokens.createToken(s.ctx, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.store.tokens.size).toBe(1);
    expect(JSON.stringify([...s.store.tokens.values()])).not.toContain(first.secret);
  });
  it('returns the authoritative first revocation timestamp on retry', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'revoke-create',
    });
    const input = {
      projectId: s.projectId,
      tokenId: created.token.id,
      idempotencyKey: 'revoke-once',
    };
    const result = await s.tokens.revokeToken(s.ctx, input);
    const later = createTokenService(
      s.store,
      async () => LEAD,
      () => now + 60_000,
    );
    const retried = await later.revokeToken(s.ctx, input);
    expect(result).toMatchObject({
      projectId: s.projectId,
      tokenId: created.token.id,
      revokedAt: '2026-10-13T00:00:00.000Z',
      requestId: 'test',
    });
    expect(retried).toEqual(result);
  });
  it('agents cannot create, revoke or list tokens', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Granted',
      idempotencyKey: 'grant',
      scopes: ['queue:add'],
    });
    const actor = await s.services.getTokenActor(s.request(created.secret), 'queue:add');
    await expect(
      s.tokens.createToken(actor, {
        projectId: s.projectId,
        label: 'Elevate',
        idempotencyKey: 'elevate',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      s.tokens.revokeToken(actor, {
        projectId: s.projectId,
        tokenId: created.token.id,
        idempotencyKey: 'revoke',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.tokens.listTokens(actor, { projectId: s.projectId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('lists the owner project tokens without hashes or secrets and rejects a foreign project', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'list-1',
    });
    const listed = await s.tokens.listTokens(s.ctx, { projectId: s.projectId });
    expect(listed).toEqual({
      projectId: s.projectId,
      items: [created.token],
      nextCursor: null,
      requestId: 'test',
    });
    expect(listed.items[0]).toMatchObject({ label: 'Agent', prefix: created.secret.slice(0, 8) });
    expect(JSON.stringify(listed)).not.toContain(
      createHash('sha256').update(created.secret).digest('hex'),
    );
    await expect(
      s.tokens.listTokens(s.ctx, { projectId: s.projectId, cursor: 'forged' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(s.tokens.listTokens(s.ctx, { projectId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('rejects revoked, expired, removed-member and wrong-project tokens on every call', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'create-1',
    });
    await s.tokens.revokeToken(s.ctx, {
      projectId: s.projectId,
      tokenId: created.token.id,
      idempotencyKey: 'revoke',
    });
    await expect(
      s.services.getTokenActor(s.request(created.secret), 'project:read'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const second = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'create-2',
    });
    const expired = createIdentityServices({
      store: s.store,
      env,
      now: () => now + 31 * 86_400_000,
    });
    await expect(
      expired.getTokenActor(s.request(second.secret), 'project:read'),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      s.services.getTokenActor(
        new Request(`${env.appOrigin}/api/projects/${randomUUID()}`, {
          headers: { authorization: `Bearer ${second.secret}` },
        }),
        'project:read',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    s.store.memberships.clear();
    await expect(
      s.services.getTokenActor(s.request(second.secret), 'project:read'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects foreign creation/revocation and past expiry', async () => {
    const s = await setup();
    await expect(
      s.tokens.createToken(s.ctx, {
        projectId: randomUUID(),
        label: 'Foreign',
        idempotencyKey: 'foreign',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      s.tokens.createToken(s.ctx, {
        projectId: s.projectId,
        label: 'Expired',
        idempotencyKey: 'expired',
        expiresAt: '2026-10-12T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      s.tokens.revokeToken(s.ctx, {
        projectId: s.projectId,
        tokenId: randomUUID(),
        idempotencyKey: 'revoke',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects foreign Origin and nonloopback transport for local token calls', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'create-1',
    });
    const badOrigin = s.request(created.secret);
    badOrigin.headers.set('origin', 'https://evil.example');
    await expect(s.services.getTokenActor(badOrigin, 'project:read')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      s.services.getTokenActor(
        new Request(`https://evil.example/api/projects/${s.projectId}`, {
          headers: s.request(created.secret).headers,
        }),
        'project:read',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects local token verification when production mode is enabled', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'create-1',
    });
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(
        s.services.getTokenActor(s.request(created.secret), 'project:read'),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('verifies a token without a scope check when the caller passes no scope, and still rejects revoked tokens', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Writer',
      scopes: ['queue:add'],
      idempotencyKey: 'create-1',
    });
    const request = new Request(`${env.appOrigin}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.secret}` },
    });
    await expect(s.services.getTokenActor(request, null)).resolves.toMatchObject({
      kind: 'agent',
      projectId: s.projectId,
      scopes: ['queue:add'],
    });
    await s.tokens.revokeToken(s.ctx, {
      projectId: s.projectId,
      tokenId: created.token.id,
      idempotencyKey: 'revoke-1',
    });
    await expect(s.services.getTokenActor(request, null)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
  it('counts denied scope attempts toward the token call budget', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      scopes: ['queue:add'],
      idempotencyKey: 'create-1',
    });
    for (let i = 0; i < 60; i++)
      await expect(
        s.services.getTokenActor(s.request(created.secret), 'project:read'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      s.services.getTokenActor(s.request(created.secret), 'queue:add'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('limits token calls at sixty per minute', async () => {
    const s = await setup();
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'create-1',
    });
    for (let i = 0; i < 60; i++)
      await s.services.getTokenActor(s.request(created.secret), 'project:read');
    await expect(
      s.services.getTokenActor(s.request(created.secret), 'project:read'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('last call of a token', () => {
  async function lastCallSetup(scopes?: Scope[]) {
    const s = await setup();
    let clock = now;
    const services = createIdentityServices({ store: s.store, env, now: () => clock });
    const created = await s.tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Agent',
      idempotencyKey: 'last-call',
      ...(scopes ? { scopes } : {}),
    });
    const stored = () =>
      s.store.tokens.get(createHash('sha256').update(created.secret).digest('hex'))!;
    return {
      ...s,
      services,
      created,
      stored,
      advance: (ms: number) => (clock += ms),
      call: (scope: Scope | null = 'project:read') =>
        services.getTokenActor(s.request(created.secret), scope),
    };
  }
  it('starts as never and records the first authenticated call', async () => {
    const s = await lastCallSetup();
    expect(s.created.token.lastUsedAt).toBeNull();
    expect(s.stored().lastUsedAt).toBeNull();
    await s.call();
    expect(s.stored().lastUsedAt).toBe('2026-10-13T00:00:00.000Z');
  });
  it('records the last call at most once a minute', async () => {
    const s = await lastCallSetup();
    await s.call();
    const first = s.stored().lastUsedAt;
    expect(first).not.toBeNull();
    s.advance(30_000);
    await s.call();
    expect(s.stored().lastUsedAt).toBe(first);
    s.advance(31_000);
    await s.call();
    expect(s.stored().lastUsedAt).toBe('2026-10-13T00:01:01.000Z');
  });
  it('records a call that fails on scope, because the agent still reached the app', async () => {
    const s = await lastCallSetup(['project:read']);
    await expect(s.call('queue:add')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(s.stored().lastUsedAt).toBe('2026-10-13T00:00:00.000Z');
  });
  it('records a call that passes no scope', async () => {
    const s = await lastCallSetup();
    await s.call(null);
    expect(s.stored().lastUsedAt).toBe('2026-10-13T00:00:00.000Z');
  });
  it('does not record a call that fails authentication', async () => {
    const s = await lastCallSetup();
    await s.tokens.revokeToken(s.ctx, {
      projectId: s.projectId,
      tokenId: s.created.token.id,
      idempotencyKey: 'revoke-last-call',
    });
    await expect(s.call()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(s.stored().lastUsedAt).toBeNull();
  });
  it('lists the last call of each token', async () => {
    const s = await lastCallSetup();
    await s.call();
    const listed = await s.tokens.listTokens(s.ctx, { projectId: s.projectId });
    expect(listed.items[0].lastUsedAt).toBe('2026-10-13T00:00:00.000Z');
  });
});

describe('token creation and the rights of the creator today', () => {
  const writer: Creator = {
    member: true,
    rights: { viewMain: true, create: true, merge: false, manage: false },
  };
  const reader: Creator = {
    member: false,
    rights: { viewMain: true, create: false, merge: false, manage: false },
  };
  it('refuses a scope whose right the creator does not hold, with the reason the page shows', async () => {
    const s = await setup();
    const tokens = createTokenService(
      s.store,
      async () => writer,
      () => now,
    );
    const base = { projectId: s.projectId, label: 'Agent' };
    await expect(
      tokens.createToken(s.ctx, {
        ...base,
        scopes: ['project:read', 'crs:merge'],
        idempotencyKey: 'merge',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'You do not have the Merge right in this project',
      extras: { errors: [{ path: 'scopes', message: expect.stringContaining('crs:merge') }] },
    });
    const ok = await tokens.createToken(s.ctx, {
      ...base,
      scopes: ['crs:edit'],
      idempotencyKey: 'edit',
    });
    expect(ok.token.scopes).toEqual(['crs:edit']);
  });
  it('gives a token without scopes the default scopes that the creator may give', async () => {
    const s = await setup();
    const tokens = createTokenService(
      s.store,
      async () => reader,
      () => now,
    );
    const made = await tokens.createToken(s.ctx, {
      projectId: s.projectId,
      label: 'Reader agent',
      idempotencyKey: 'reader',
    });
    expect(made.token.scopes).toEqual(['project:read']);
    await expect(
      tokens.createToken(s.ctx, {
        projectId: s.projectId,
        label: 'Reader agent',
        scopes: ['queue:add'],
        idempotencyKey: 'reader-queue',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Only members of the project can do this',
    });
  });
});
describe('personal keys', () => {
  const personalRequest = (secret: string, path = '/mcp') =>
    new Request(`${env.appOrigin}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });
  it('opens no project until a call names one, and then only a project its person can open', async () => {
    const s = await setup();
    const created = await s.tokens.createPersonalKey(s.ctx, {
      label: 'Laptop',
      idempotencyKey: 'p1',
    });
    expect(created.token).toMatchObject({
      kind: 'personal',
      projectId: null,
      scopes: ['project:read', 'queue:add'],
    });
    await expect(
      s.services.getTokenActor(personalRequest(created.secret), null),
    ).resolves.toMatchObject({
      kind: 'agent',
      key: 'personal',
      keyLabel: 'Laptop',
      projectId: null,
    });
    await expect(
      s.services.getTokenActor(
        personalRequest(created.secret, `/api/projects/${s.projectId}`),
        null,
      ),
    ).resolves.toMatchObject({ projectId: s.projectId, workspaceId: s.workspaceId });
    const foreign = randomUUID();
    s.store.projects.set(foreign, { workspaceId: randomUUID() });
    await expect(
      s.services.getTokenActor(personalRequest(created.secret, `/api/projects/${foreign}`), null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('asks the creator rights across all projects, and refuses agents', async () => {
    const s = await setup();
    const asked: Array<string | null> = [];
    const tokens = createTokenService(
      s.store,
      async (_ctx, projectId) => {
        asked.push(projectId);
        return {
          member: true,
          rights: { viewMain: true, create: true, merge: false, manage: false },
        };
      },
      () => now,
    );
    await expect(
      tokens.createPersonalKey(s.ctx, { label: 'L', scopes: ['crs:merge'], idempotencyKey: 'm' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'You do not have the Merge right in any of your projects',
    });
    expect(asked).toEqual([null]);
    const created = await tokens.createPersonalKey(s.ctx, {
      label: 'L',
      scopes: ['crs:edit'],
      idempotencyKey: 'e',
    });
    const actor = await s.services.getTokenActor(personalRequest(created.secret), null);
    await expect(
      tokens.createPersonalKey(actor, { label: 'Up', idempotencyKey: 'up' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(tokens.listPersonalKeys(actor, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      tokens.revokePersonalKey(actor, { tokenId: created.token.id, idempotencyKey: 'r' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await tokens.listPersonalKeys(s.ctx, {})).items.map((key) => key.id)).toEqual([
      created.token.id,
    ]);
  });
});
describe('photo reads', () => {
  it('count against their own larger limit, so a page of avatars leaves the read limit alone', async () => {
    const s = await setup();
    const photo = () =>
      s.services.getBrowserActor(
        new Request(`${env.appOrigin}/api/v1/avatars/x/y`, { headers: s.request().headers }),
        'photo',
      );
    for (let i = 0; i < 1200; i++) await photo();
    await expect(photo()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(s.services.getBrowserActor(s.request())).resolves.toMatchObject({
      kind: 'user',
    });
  });
});
describe('version checks', () => {
  it('count against their own light limit, so open tabs leave the read limit alone', async () => {
    const s = await setup();
    const check = () =>
      s.services.getBrowserActor(
        new Request(`${env.appOrigin}/api/v1/me/keys`, { headers: s.request().headers }),
        'poll',
      );
    for (let i = 0; i < 600; i++) await check();
    await expect(check()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(s.services.getBrowserActor(s.request())).resolves.toMatchObject({
      kind: 'user',
    });
  });
});
