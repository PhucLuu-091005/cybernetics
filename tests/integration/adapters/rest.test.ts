import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { record } from '../../support/evidence';
import { T, ingestText, proposalIds, putAct, putLoop, quote, seedProject } from '../../support/proposals';
import { configureApp, resetApp } from '../../../src/server/app';
import { SESSION_COOKIE, signSession } from '../../../src/server/http/session';
import { createProject, emptySnapshot } from '../../../src/server/domain/projects';
import { createProposal, reviewProposal, updateProposal } from '../../../src/server/domain/proposals';
import { openEscalation } from '../../../src/server/domain/escalations';
import type { ActorContext } from '../../../src/contracts';

const origin = 'http://localhost:3000';
const secret = 'rest-adapter-test-secret-of-32-bytes!';
const apiRoot = join(process.cwd(), 'src/app/api/v1');
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', Handler>> & { runtime?: string };
type Reply = { status: number; headers: Headers; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const expectedRoutes = [
  '/projects', '/projects/:projectId', '/projects/:projectId/records', '/projects/:projectId/records/:recordId', '/projects/:projectId/record-versions/:versionId',
  '/projects/:projectId/inbox', '/projects/:projectId/inbox/:versionId/hints', '/projects/:projectId/graph', '/projects/:projectId/loops/:loopId',
  '/projects/:projectId/commits', '/projects/:projectId/commits/:commitId', '/projects/:projectId/proposals', '/projects/:projectId/proposals/:proposalId',
  '/projects/:projectId/proposals/:proposalId/diff', '/projects/:projectId/proposals/:proposalId/merge', '/projects/:projectId/proposals/:proposalId/close',
  '/projects/:projectId/proposals/:proposalId/rebase-preview', '/projects/:projectId/proposals/:proposalId/rebase', '/projects/:projectId/proposals/from-inverse',
  '/projects/:projectId/revert-preview', '/projects/:projectId/revert', '/projects/:projectId/restore-preview', '/projects/:projectId/restore',
  '/projects/:projectId/escalations', '/projects/:projectId/escalations/:escalationId', '/projects/:projectId/escalations/:escalationId/analyses',
  '/projects/:projectId/escalations/:escalationId/analyses/:analysisId/approval', '/projects/:projectId/agent-tokens', '/projects/:projectId/agent-tokens/:tokenId',
];

function routeFiles(): string[] {
  try { return (readdirSync(apiRoot, { recursive: true }) as string[]).filter(file => file.endsWith(`${sep}route.ts`) || file === 'route.ts'); }
  catch { return []; }
}
const patternOf = (file: string) => `/${relative(apiRoot, join(apiRoot, file)).split(sep).slice(0, -1).join('/')}`.replace(/\[(\w+)\]/g, ':$1').replace(/\/$/, '');

describe.skipIf(!process.env.TEST_DATABASE_URL)('REST adapters', () => {
  let t: TestDb, ctx: ActorContext, projectId: string, mainId: string, versionId: string;
  const routes: { pattern: string; module: RouteModule }[] = [];
  const cookieFor = (userId: string) => `${SESSION_COOKIE}=${signSession({ userId, expiresAt: Date.now() + 600_000 }, secret)}`;
  function resolve(path: string): { module: RouteModule; params: Record<string, string> } {
    const segments = path.split('/').filter(Boolean);
    const candidates = routes.flatMap(({ pattern, module }) => {
      const parts = pattern.split('/').filter(Boolean), params: Record<string, string> = {};
      if (parts.length !== segments.length) return [];
      for (const [index, part] of parts.entries()) {
        if (part.startsWith(':')) params[part.slice(1)] = segments[index];
        else if (part !== segments[index]) return [];
      }
      return [{ module, params, literals: parts.filter(part => !part.startsWith(':')).length }];
    }).sort((a, b) => b.literals - a.literals);
    if (!candidates.length) throw new Error(`No route for ${path}`);
    return candidates[0];
  }
  async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts: { origin?: string; cookie?: string | null; raw?: string } = {}): Promise<Reply> {
    const { module, params } = resolve(path.split('?')[0]);
    const handler = module[method];
    if (!handler) throw new Error(`No ${method} handler for ${path}`);
    const headers: Record<string, string> = {};
    const cookie = opts.cookie === undefined ? cookieFor(ctx.userId) : opts.cookie;
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') { headers.origin = opts.origin ?? origin; headers['content-type'] = 'application/json'; }
    const request = new Request(`${origin}/api/v1${path}`, { method, headers, body: method === 'GET' ? undefined : opts.raw ?? JSON.stringify(body ?? {}) });
    const response = await handler(request, { params: Promise.resolve(params) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const reviewedProposal = async (title: string) => {
    const proposal = await createProposal(t.db, ctx, { projectId, baseCommitId: mainId, title, expectedEvidenceRevision: 1, idempotencyKey: `c-${title}` });
    await updateProposal(t.db, ctx, { projectId, proposalId: proposal.id, expectedProposalRevision: 0, expectedEvidenceRevision: 1, operations: [putLoop(title), putAct(versionId, quote)], idempotencyKey: `u-${title}` });
    return reviewProposal(t.db, ctx, { projectId, proposalId: proposal.id, expectedMainCommitId: mainId, expectedProposalRevision: 1, expectedEvidenceRevision: 1, T });
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local'); vi.stubEnv('NEXT_PUBLIC_APP_URL', origin); vi.stubEnv('SESSION_SECRET', secret);
    configureApp({ db: t.db });
    for (const file of routeFiles()) routes.push({ pattern: patternOf(file), module: await import(join(apiRoot, file)) as RouteModule });
    ctx = await testActor(t.db);
  });
  afterAll(async () => { vi.unstubAllEnvs(); resetApp(); await t?.close(); });
  beforeEach(async () => {
    // Each test starts with a fresh per-user rate-limit window; limits are covered by the actor tests.
    delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown }).promiseRateLimiter;
    ({ projectId, mainId, versionId } = await seedProject(t.db, ctx));
  });

  it('exposes every SRD 11 route on the Node runtime', () => {
    expect(routes.map(route => route.pattern).sort()).toEqual([...expectedRoutes].sort());
    for (const route of routes) expect(route.module.runtime, route.pattern).toBe('nodejs');
  });
  it('paste import returns 201-equivalent receipt and leaves main unchanged', async () => {
    const before = await call('GET', `/projects/${projectId}/graph`);
    const receipt = await call('POST', `/projects/${projectId}/records`, { source: 'paste', sourceLabel: 'paste', records: [record('x', 'Any update on the secret renewal?')], idempotencyKey: 'p1' });
    expect(receipt.status).toBe(200);
    expect((await call('GET', `/projects/${projectId}/graph`)).body.commitId).toBe(before.body.commitId);
  });
  it('rejects a mutation without the app Origin', async () => {
    const body = { source: 'paste', sourceLabel: 'paste', records: [record('y', 'Please confirm the cutover window.')], idempotencyKey: 'p2' };
    const response = await call('POST', `/projects/${projectId}/records`, body, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
  });
  it('returns 404 for a foreign project and 409 with actual revisions for a stale merge', async () => {
    const stranger = await testActor(t.db);
    const foreignProjectId = (await createProject(t.db, stranger, { title: 'Foreign', clientName: 'Other' })).id;
    const review = await reviewedProposal('Stale');
    const proposalId = review.proposalId;
    await ingestText(t.db, ctx, projectId, 'Unrelated evidence that moves the evidence revision');
    const staleMergeBody = { expectedMainCommitId: review.mainCommitId, expectedProposalRevision: review.proposalRevision, expectedEvidenceRevision: review.evidenceRevision, reviewDigest: review.digest, T: review.T, message: 'Merge stale', idempotencyKey: 'm-stale' };
    expect((await call('GET', `/projects/${foreignProjectId}/graph`)).status).toBe(404);
    const stale = await call('POST', `/projects/${projectId}/proposals/${proposalId}/merge`, staleMergeBody);
    expect(stale.status).toBe(409);
    expect(stale.body.details).toHaveProperty('actualMainCommitId');
  });
  it('creates a token with default scopes and shows the secret once', async () => {
    const created = await call('POST', `/projects/${projectId}/agent-tokens`, { label: 'Claude', idempotencyKey: 't1' });
    expect(created.body.token.scopes).toEqual(['project:read', 'records:import', 'graph:propose']);
    expect(created.body.secret).toMatch(/^inv_/);
    const list = await call('GET', `/projects/${projectId}/agent-tokens`);
    expect(JSON.stringify(list.body)).not.toContain(created.body.secret);
    expect((await call('POST', `/projects/${projectId}/agent-tokens`, { label: 'Claude', idempotencyKey: 't1' })).status).toBe(409);
  });
  it('every protected response is private, no-store', async () => {
    expect((await call('GET', `/projects/${projectId}/inbox`)).headers.get('cache-control')).toBe('private, no-store');
  });

  it('lists tokens without hashes, pages them and revokes idempotently', async () => {
    const first = await call('POST', `/projects/${projectId}/agent-tokens`, { label: 'A', scopes: ['project:read'], idempotencyKey: 'ta' });
    await call('POST', `/projects/${projectId}/agent-tokens`, { label: 'B', idempotencyKey: 'tb' });
    const page = await call('GET', `/projects/${projectId}/agent-tokens?limit=1`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ projectId, items: [expect.any(Object)], nextCursor: expect.any(String) });
    expect(Object.keys(page.body.items[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'label', 'prefix', 'projectId', 'revokedAt', 'scopes', 'userId']);
    const rest = await call('GET', `/projects/${projectId}/agent-tokens?limit=1&cursor=${page.body.nextCursor}`);
    expect(rest.body.nextCursor).toBeNull();
    expect(new Set([page.body.items[0].id, rest.body.items[0].id]).size).toBe(2);
    expect([page.body.items[0].id, rest.body.items[0].id]).toContain(first.body.token.id);
    const revoked = await call('DELETE', `/projects/${projectId}/agent-tokens/${first.body.token.id}`, { idempotencyKey: 'r1' });
    expect(revoked.status).toBe(200);
    expect((await call('DELETE', `/projects/${projectId}/agent-tokens/${first.body.token.id}`, { idempotencyKey: 'r1' })).body.revokedAt).toBe(revoked.body.revokedAt);
    const after = await call('GET', `/projects/${projectId}/agent-tokens`);
    expect(after.body.items.find((token: { id: string }) => token.id === first.body.token.id).revokedAt).toBe(revoked.body.revokedAt);
  });
  it('takes the project scope from the route and rejects a different body projectId', async () => {
    const other = (await seedProject(t.db, ctx)).projectId;
    const response = await call('POST', `/projects/${projectId}/records`, { projectId: other, source: 'paste', sourceLabel: 'paste', records: [record('z', 'Hello')], idempotencyKey: 'p3' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION', requestId: expect.any(String) });
  });
  it('maps oversized, malformed and non-paste bodies and missing sessions to error codes', async () => {
    const records = `/projects/${projectId}/records`;
    const huge = await call('POST', records, undefined, { raw: JSON.stringify({ source: 'paste', sourceLabel: 'paste', records: [], idempotencyKey: 'big', pad: 'x'.repeat(2 * 1024 * 1024) }) });
    expect(huge).toMatchObject({ status: 413, body: { code: 'LIMIT_EXCEEDED' } });
    expect(await call('POST', records, undefined, { raw: '{"source":' })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    expect(await call('POST', records, undefined, { raw: '[]' })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    expect(await call('POST', records, { source: 'slack', sourceLabel: 'paste', records: [record('s', 'Hello')], idempotencyKey: 'p4' })).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    const anonymous = await call('GET', `/projects/${projectId}/inbox`, undefined, { cookie: null });
    expect(anonymous).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } });
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
  });
  it('runs the proposal lifecycle through REST with query-string reads', async () => {
    const created = await call('POST', `/projects/${projectId}/proposals`, { baseCommitId: mainId, title: 'Via REST', expectedEvidenceRevision: 1, idempotencyKey: 'rc' });
    expect(created.status).toBe(201);
    const proposalId = created.body.id;
    const updated = await call('PATCH', `/projects/${projectId}/proposals/${proposalId}`, { expectedProposalRevision: 0, expectedEvidenceRevision: 1, operations: [putLoop('Via REST'), putAct(versionId, quote)], idempotencyKey: 'ru' });
    expect(updated.body.revision).toBe(1);
    const view = await call('GET', `/projects/${projectId}/graph?proposalId=${proposalId}&proposalRevision=1&T=${encodeURIComponent(T)}`);
    expect(view.body).toMatchObject({ proposalId, proposalRevision: 1, T });
    const loop = await call('GET', `/projects/${projectId}/loops/${proposalIds.loop}?proposalId=${proposalId}&proposalRevision=1`);
    expect(loop.body.loop.loop.id).toBe(proposalIds.loop);
    const diff = await call('GET', `/projects/${projectId}/proposals/${proposalId}/diff?expectedMainCommitId=${mainId}&expectedProposalRevision=1&expectedEvidenceRevision=1&T=${encodeURIComponent(T)}`);
    expect(diff.status).toBe(200);
    const merged = await call('POST', `/projects/${projectId}/proposals/${proposalId}/merge`, { expectedMainCommitId: mainId, expectedProposalRevision: 1, expectedEvidenceRevision: 1, reviewDigest: diff.body.digest, T, message: 'Merge via REST', idempotencyKey: 'rm' });
    expect(merged).toMatchObject({ status: 200, body: { kind: 'merge', proposalId } });
    const history = await call('GET', `/projects/${projectId}/commits?limit=1`);
    expect(history.body.items[0].id).toBe(merged.body.commitId);
    expect((await call('GET', `/projects/${projectId}/proposals?status=merged`)).body.items.map((item: { id: string }) => item.id)).toEqual([proposalId]);
    expect((await call('GET', `/projects/${projectId}/graph?proposalId=${proposalId}`)).status).toBe(400);
  });
  it('reviews a proposal at its current revisions when the diff omits expected revisions', async () => {
    const review = await reviewedProposal('Current');
    const diff = await call('GET', `/projects/${projectId}/proposals/${review.proposalId}/diff?T=${encodeURIComponent(T)}`);
    expect(diff).toMatchObject({ status: 200, body: { proposalId: review.proposalId, mainCommitId: mainId, proposalRevision: 1, evidenceRevision: 1, T, digest: review.digest } });
    expect((await call('GET', `/projects/${projectId}/proposals/${review.proposalId}/diff?expectedProposalRevision=1`)).status).toBe(400);
  });
  it('pages the escalation list with a cursor', async () => {
    for (const complaint of ['First complaint', 'Second complaint']) await openEscalation(t.db, ctx, { projectId, complaint, idempotencyKey: complaint });
    const first = await call('GET', `/projects/${projectId}/escalations?limit=1`);
    expect(first.body).toMatchObject({ projectId, items: [{ complaint: 'Second complaint' }], nextCursor: expect.any(String) });
    const second = await call('GET', `/projects/${projectId}/escalations?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body).toMatchObject({ items: [{ complaint: 'First complaint' }], nextCursor: null });
    const opened = await call('POST', `/projects/${projectId}/escalations`, { complaint: 'Third complaint', idempotencyKey: 'e3' });
    expect(opened.status).toBe(201);
    expect((await call('GET', `/projects/${projectId}/escalations/${opened.body.id}`)).body.escalation.id).toBe(opened.body.id);
  });
  it('lists and creates projects in the session workspace', async () => {
    const created = await call('POST', '/projects', { title: 'New via REST', clientName: 'Client' });
    expect(created).toMatchObject({ status: 201, body: { title: 'New via REST', workspaceId: ctx.workspaceId } });
    const list = await call('GET', '/projects');
    expect(list.body.items.map((project: { id: string }) => project.id)).toContain(created.body.id);
    expect((await call('GET', `/projects/${created.body.id}`)).body.project.id).toBe(created.body.id);
  });
  it('rejects a snapshot in a REST project creation, so main always starts empty', async () => {
    const before = (await call('GET', '/projects')).body.items.length;
    const snapshot = { ...emptySnapshot(), acts: [], loops: [{ ...(putLoop('Smuggled') as { value: object }).value }] };
    const response = await call('POST', '/projects', { title: 'Smuggled graph', clientName: 'Client', snapshot });
    expect(response).toMatchObject({ status: 400, body: { code: 'VALIDATION', errors: [expect.objectContaining({ path: expect.any(String) })] } });
    expect((await call('GET', '/projects')).body.items).toHaveLength(before);
  });
});
