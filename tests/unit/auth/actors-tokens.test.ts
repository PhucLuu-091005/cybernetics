import { describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createIdentityServices } from '../../../src/server/http/actors';
import { createTokenService } from '../../../src/server/domain/tokens/service';
import { signLocalSession } from '../../../src/server/http/local-session';
import { TestIdentityStore } from './test-store';
const now = Date.parse('2026-10-13T00:00:00Z');
const env = { mode: 'local' as const, appOrigin: 'http://localhost:3000', localSessionSecret: 'ab'.repeat(32) };
async function setup() {
  const store = new TestIdentityStore(); const userId = randomUUID(), workspaceId = randomUUID(), projectId = randomUUID();
  await store.bootstrapLocalIdentity({ userId, workspaceId, subject: `local:${userId}` }); store.projects.set(projectId, workspaceId);
  const services = createIdentityServices({ store, env, now: () => now });
  const ctx = { kind: 'user' as const, userId, workspaceId, projectId, scopes: ['project:read' as const, 'graph:merge' as const], requestId: 'test' };
  const tokens = createTokenService(store, () => now);
  const request = (secret?: string, method = 'GET') => new Request(`${env.appOrigin}/api/projects/${projectId}`, { method, headers: secret ? { authorization: `Bearer ${secret}` } : { cookie: `promise_local_session=${signLocalSession({ userId, workspaceId, expiresAt: now + 60_000 }, env.localSessionSecret)}`, origin: env.appOrigin } });
  return { store, userId, workspaceId, projectId, services, ctx, tokens, request };
}
describe('browser identity and scoped authorization', () => {
  it('resolves a signed user and project through current membership', async () => {
    const s = await setup(); const actor = await s.services.getBrowserActor(s.request());
    expect(actor).toMatchObject({ kind: 'user', userId: s.userId, workspaceId: s.workspaceId, projectId: s.projectId });
    s.store.memberships.clear(); await expect(s.services.getBrowserActor(s.request())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('resolves the workspace before a project is selected', async () => {
    const s = await setup();
    await expect(s.services.getBrowserActor(new Request(env.appOrigin, { headers: s.request().headers }))).resolves.toMatchObject({ projectId: null, workspaceId: s.workspaceId });
  });
  it('rejects a signed session for an unknown persisted identity', async () => {
    const s = await setup(); s.store.identities.clear();
    await expect(s.services.getBrowserActor(s.request())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('rejects a foreign project and mutation Origin', async () => {
    const s = await setup(); const other = randomUUID(); s.store.projects.set(other, randomUUID());
    await expect(s.services.getBrowserActor(new Request(`${env.appOrigin}/api/projects/${other}`, { headers: s.request().headers }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const request = s.request(undefined, 'POST'); request.headers.set('origin', 'https://evil.example');
    await expect(s.services.getBrowserActor(request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
describe('hashed project agent tokens', () => {
  it('creates 30-day tokens with read/import/propose only and stores only a hash', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-1' });
    expect(created.token.scopes).toEqual(['project:read', 'records:import', 'graph:propose']);
    expect(created.token.expiresAt).toBe('2026-11-12T00:00:00.000Z');
    expect(created.secret).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);
    expect([...s.store.tokens.values()][0].idempotencyKey).toBe('create-1');
    expect(JSON.stringify([...s.store.tokens.values()])).not.toContain(created.secret);
    expect(s.store.tokens.has(createHash('sha256').update(created.secret).digest('hex'))).toBe(true);
    await expect(s.services.getTokenActor(s.request(created.secret), 'project:read')).resolves.toMatchObject({ kind: 'agent', projectId: s.projectId });
    await expect(s.services.getTokenActor(s.request(created.secret), 'graph:merge')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('conflicts on repeated creation keys without persisting or replaying a secret', async () => {
    const s = await setup(); const input = { projectId: s.projectId, label: 'Once', idempotencyKey: 'once' };
    const first = await s.tokens.createToken(s.ctx, input);
    await expect(s.tokens.createToken(s.ctx, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.store.tokens.size).toBe(1);
    expect(JSON.stringify([...s.store.tokens.values()])).not.toContain(first.secret);
  });
  it('returns the authoritative first revocation timestamp on retry', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'revoke-create' });
    const input = { projectId: s.projectId, tokenId: created.token.id, idempotencyKey: 'revoke-once' };
    const result = await s.tokens.revokeToken(s.ctx, input);
    const later = createTokenService(s.store, () => now + 60_000);
    const retried = await later.revokeToken(s.ctx, input);
    expect(result).toMatchObject({ projectId: s.projectId, tokenId: created.token.id, revokedAt: '2026-10-13T00:00:00.000Z', requestId: 'test' });
    expect(retried).toEqual(result);
  });
  it('allows explicit human merge grants but agents cannot create or revoke tokens', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Granted', idempotencyKey: 'grant', scopes: ['graph:merge'] });
    const actor = await s.services.getTokenActor(s.request(created.secret), 'graph:merge');
    await expect(s.tokens.createToken(actor, { projectId: s.projectId, label: 'Elevate', idempotencyKey: 'elevate' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.tokens.revokeToken(actor, { projectId: s.projectId, tokenId: created.token.id, idempotencyKey: 'revoke' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects revoked, expired, removed-member and wrong-project tokens on every call', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-1' });
    await s.tokens.revokeToken(s.ctx, { projectId: s.projectId, tokenId: created.token.id, idempotencyKey: 'revoke' });
    await expect(s.services.getTokenActor(s.request(created.secret), 'project:read')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const second = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-2' });
    const expired = createIdentityServices({ store: s.store, env, now: () => now + 31 * 86_400_000 });
    await expect(expired.getTokenActor(s.request(second.secret), 'project:read')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(s.services.getTokenActor(new Request(`${env.appOrigin}/api/projects/${randomUUID()}`, { headers: { authorization: `Bearer ${second.secret}` } }), 'project:read')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    s.store.memberships.clear(); await expect(s.services.getTokenActor(s.request(second.secret), 'project:read')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects foreign creation/revocation and past expiry', async () => {
    const s = await setup();
    await expect(s.tokens.createToken(s.ctx, { projectId: randomUUID(), label: 'Foreign', idempotencyKey: 'foreign' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Expired', idempotencyKey: 'expired', expiresAt: '2026-10-12T00:00:00Z' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(s.tokens.revokeToken(s.ctx, { projectId: s.projectId, tokenId: randomUUID(), idempotencyKey: 'revoke' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects foreign Origin and nonloopback transport for local token calls', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-1' });
    const badOrigin = s.request(created.secret); badOrigin.headers.set('origin', 'https://evil.example');
    await expect(s.services.getTokenActor(badOrigin, 'project:read')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.services.getTokenActor(new Request(`https://evil.example/api/projects/${s.projectId}`, { headers: s.request(created.secret).headers }), 'project:read')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects local token verification when production mode is enabled', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-1' });
    vi.stubEnv('NODE_ENV', 'production');
    try { await expect(s.services.getTokenActor(s.request(created.secret), 'project:read')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); } finally { vi.unstubAllEnvs(); }
  });
  it('counts denied scope attempts toward the token call budget', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-1' });
    for (let i = 0; i < 60; i++) await expect(s.services.getTokenActor(s.request(created.secret), 'graph:merge')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(s.services.getTokenActor(s.request(created.secret), 'project:read')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('limits token calls at sixty per minute', async () => {
    const s = await setup(); const created = await s.tokens.createToken(s.ctx, { projectId: s.projectId, label: 'Agent', idempotencyKey: 'create-1' });
    for (let i = 0; i < 60; i++) await s.services.getTokenActor(s.request(created.secret), 'project:read');
    await expect(s.services.getTokenActor(s.request(created.secret), 'project:read')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
