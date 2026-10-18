import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { projectRow, record } from '../../support/evidence';
import { ingestText, proposalIds, putAct, putLoop, seedProject } from '../../support/proposals';
import { larkspurT, seedLarkspur } from '../../support/seed';
import {
  configureApp,
  createAgentToken,
  resetApp,
  revokeAgentToken,
} from '../../../src/server/app';
import { agentTokens } from '../../../src/server/db/schema';
import { createProject } from '../../../src/server/domain/projects';
import { AppError } from '../../../src/server/errors';
import { toolError, toolResult } from '../../../src/server/mcp/results';
import { DELETE, GET, POST } from '../../../src/app/mcp/route';
import type { ActorContext, GraphOperation, Scope, TokenCreated } from '../../../src/contracts';

const origin = 'http://localhost:3000';
type Structured = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Structured; content?: unknown };

describe('MCP result envelopes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const ctx: ActorContext = {
    kind: 'agent',
    userId: randomUUID(),
    tokenId: randomUUID(),
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    scopes: ['project:read'],
    requestId: 'req-1',
  };
  it('adds projectId and requestId and mirrors structured content as JSON text', () => {
    const result = toolResult(ctx, { items: [1] });
    expect(result.structuredContent).toEqual({
      projectId: ctx.projectId,
      items: [1],
      requestId: 'req-1',
    });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent) },
    ]);
  });
  it('refuses a result over 50,000 characters instead of truncating it', () => {
    expect(() => toolResult(ctx, { text: 'x'.repeat(50_000) })).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
  });
  it('maps domain errors and hides internal error text', () => {
    const known = toolError(
      new AppError('CONFLICT', 'Main moved', { details: { actualMainCommitId: 'c' } }),
      'req-2',
    );
    expect(known).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'CONFLICT',
        message: 'Main moved',
        details: { actualMainCommitId: 'c' },
        requestId: 'req-2',
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hidden = toolError(new Error('relation "graph_commits" password=hunter2'), 'req-3');
    expect(hidden.structuredContent).toEqual({
      code: 'INTERNAL',
      message: 'Internal error',
      requestId: 'req-3',
    });
    expect(JSON.stringify(hidden)).not.toContain('hunter2');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('MCP adapter', () => {
  let t: TestDb, ownerCtx: ActorContext, projectId: string, defaultToken: TokenCreated;
  const route = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.method === 'GET'
      ? GET()
      : request.method === 'DELETE'
        ? DELETE()
        : POST(request);
  };
  const connect = async (secret: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
        fetch: route,
      }),
    );
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolReply;
  const token = (scopes: Scope[], label = randomUUID()) =>
    createAgentToken(ownerCtx, { projectId, label, scopes, idempotencyKey: label });
  const mainId = async () => (await projectRow(t.db, projectId)).mainCommitId as string;
  const ev = async () => (await projectRow(t.db, projectId)).evidenceRevision;
  const opsForVersion = (versionId: string, text: string): GraphOperation[] => [
    putLoop('Send the mapping'),
    putAct(versionId, text, {
      citation: { recordVersionId: versionId, start: 0, end: text.length },
    }),
  ];
  const importArgs = (key: string) => ({
    source: 'agent',
    sourceLabel: 'notion',
    records: [record(`r-${key}`, 'Please share the cutover checklist.')],
    idempotencyKey: key,
  });
  const proposalFor = async (client: Client, text: string, key: string) => {
    const imported = await call(client, 'import_records', {
      source: 'agent',
      sourceLabel: 'notion',
      records: [record(key, text)],
      idempotencyKey: `i-${key}`,
    });
    const versionId = imported.structuredContent.items[0].recordVersionId;
    const proposal = await call(client, 'create_proposal', {
      baseCommitId: await mainId(),
      title: `Proposal ${key}`,
      expectedEvidenceRevision: await ev(),
      idempotencyKey: `c-${key}`,
    });
    const updated = await call(client, 'update_proposal', {
      proposalId: proposal.structuredContent.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: await ev(),
      operations: opsForVersion(versionId, text),
      idempotencyKey: `u-${key}`,
    });
    expect(updated.isError).toBeFalsy();
    return { versionId, proposalId: proposal.structuredContent.id as string };
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', 'mcp-adapter-test-secret-of-32-bytes!');
    configureApp({ db: t.db });
    ownerCtx = await testActor(t.db);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetApp();
    await t?.close();
  });
  beforeEach(async () => {
    delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown }).promiseRateLimiter;
    ({ projectId } = await seedProject(t.db, ownerCtx));
    defaultToken = await createAgentToken(ownerCtx, {
      projectId,
      label: 'Claude',
      idempotencyKey: randomUUID(),
    });
  });

  it('runs import → read → propose → diff end to end', async () => {
    const client = await connect(defaultToken.secret);
    const before = JSON.stringify(await projectRow(t.db, projectId));
    const imported = await call(client, 'import_records', {
      source: 'agent',
      sourceLabel: 'notion',
      records: [record('n1', 'We will send the mapping by 20 October.')],
      idempotencyKey: 'i1',
    });
    expect(imported.structuredContent).toMatchObject({
      projectId,
      requestId: expect.any(String),
      evidenceRevision: 2,
    });
    expect((await projectRow(t.db, projectId)).mainCommitId).toBe(JSON.parse(before).mainCommitId);
    const versionId = imported.structuredContent.items[0].recordVersionId;
    const chunk = await call(client, 'get_record', { recordVersionId: versionId });
    expect(chunk.structuredContent.text).toContain('mapping');
    const proposal = await call(client, 'create_proposal', {
      baseCommitId: await mainId(),
      title: 'Agent proposal',
      expectedEvidenceRevision: await ev(),
      idempotencyKey: 'c1',
    });
    expect(proposal.structuredContent).not.toHaveProperty('candidate');
    const badQuote = await call(client, 'update_proposal', {
      proposalId: proposal.structuredContent.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: await ev(),
      operations: [
        putLoop(),
        putAct(versionId, 'We will send nothing.', {
          citation: { recordVersionId: versionId, start: 0, end: 39 },
        }),
      ],
      idempotencyKey: 'u0',
    });
    expect(badQuote).toMatchObject({ isError: true, structuredContent: { code: 'VALIDATION' } });
    const updated = await call(client, 'update_proposal', {
      proposalId: proposal.structuredContent.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: await ev(),
      operations: opsForVersion(versionId, 'We will send the mapping by 20 October.'),
      idempotencyKey: 'u1',
    });
    expect(updated.isError).toBeFalsy();
    expect(updated.structuredContent).toMatchObject({
      id: proposal.structuredContent.id,
      revision: 1,
      projectId,
      requestId: expect.any(String),
    });
    const diff = await call(client, 'diff_proposal', { proposalId: proposal.structuredContent.id });
    expect(diff.structuredContent.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(diff.structuredContent).toMatchObject({
      projectId,
      proposalRevision: 1,
      mainCommitId: await mainId(),
      evidenceRevision: await ev(),
      citedRecordVersionIds: [versionId],
    });
    expect(diff.structuredContent).not.toHaveProperty('diff');
    expect(diff.structuredContent).toMatchObject({
      conflicts: [],
      conflictCount: 0,
      diffSummary: {
        counts: {
          loops: { added: 1, removed: 0, changed: 0 },
          acts: { added: 1, removed: 0, changed: 0 },
        },
        added: expect.arrayContaining([`acts/${proposalIds.act}`]),
      },
    });
    const read = await call(client, 'get_proposal', { proposalId: proposal.structuredContent.id });
    expect(read.structuredContent).toMatchObject({
      projectId,
      proposal: { id: proposal.structuredContent.id, revision: 1 },
    });
    expect(read.structuredContent.proposal).not.toHaveProperty('candidate');
    const snapshot = await call(client, 'get_snapshot', {
      view: { kind: 'proposal', proposalId: proposal.structuredContent.id, proposalRevision: 1 },
      collection: 'acts',
    });
    expect(snapshot.structuredContent.items).toHaveLength(1);
  });
  it('summarizes the seeded merge diff within 50,000 characters and restores with the preview digest', async () => {
    const seed = await seedLarkspur(t.db, ownerCtx);
    projectId = seed.projectId;
    const granted = await connect((await token(['project:read', 'graph:merge'])).secret);
    const acts = seed.snapshot.acts.length;
    const commit = await call(granted, 'get_commit', { commitId: seed.seedCommitId });
    expect(commit.isError).toBeFalsy();
    expect(JSON.stringify(commit.structuredContent).length).toBeLessThan(50_000);
    expect(commit.structuredContent).not.toHaveProperty('diff');
    expect(commit.structuredContent).toMatchObject({
      commit: { id: seed.seedCommitId },
      diffSummary: { counts: { acts: { added: acts, removed: 0, changed: 0 } } },
    });
    expect(commit.structuredContent.diffSummary.added).toHaveLength(50);
    const basis = {
      targetCommitId: seed.initialCommitId,
      expectedMainCommitId: seed.seedCommitId,
      expectedEvidenceRevision: seed.evidenceRevision,
      T: larkspurT,
    };
    const preview = await call(granted, 'preview_restore', basis);
    expect(preview.isError).toBeFalsy();
    expect(JSON.stringify(preview.structuredContent).length).toBeLessThan(50_000);
    expect(preview.structuredContent).not.toHaveProperty('diff');
    expect(preview.structuredContent).toMatchObject({
      conflicts: [],
      conflictCount: 0,
      mainCommitId: seed.seedCommitId,
      diffSummary: { counts: { acts: { added: 0, removed: acts, changed: 0 } } },
    });
    const revert = await call(granted, 'preview_revert', {
      ...basis,
      targetCommitId: seed.seedCommitId,
    });
    expect(revert.isError).toBeFalsy();
    expect(revert.structuredContent.diffSummary.counts.acts).toEqual({
      added: 0,
      removed: acts,
      changed: 0,
    });
    const receipt = await call(granted, 'restore_commit', {
      ...basis,
      reviewDigest: preview.structuredContent.digest,
      message: 'Restore the empty graph',
      idempotencyKey: 'restore-initial',
    });
    expect(receipt.isError).toBeFalsy();
    expect(receipt.structuredContent).toMatchObject({
      projectId,
      kind: 'restore',
      targetCommitId: seed.initialCommitId,
      parentCommitId: seed.seedCommitId,
    });
    expect(await mainId()).toBe(receipt.structuredContent.commitId);
  });
  it('default token merge is FORBIDDEN and a granted token merges explicitly', async () => {
    const agent = await connect(defaultToken.secret);
    const { proposalId } = await proposalFor(
      agent,
      'We will deliver the report by 22 October.',
      'm1',
    );
    const review = (await call(agent, 'diff_proposal', { proposalId })).structuredContent;
    const merge = {
      proposalId,
      expectedMainCommitId: review.mainCommitId,
      expectedProposalRevision: review.proposalRevision,
      expectedEvidenceRevision: review.evidenceRevision,
      reviewDigest: review.digest,
      T: review.T,
      message: 'Agent merge',
      idempotencyKey: 'mk',
    };
    const denied = await call(agent, 'merge_proposal', merge);
    expect(denied).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN', requestId: expect.any(String) },
    });
    expect(await mainId()).toBe(review.mainCommitId);
    const granted = await connect(
      (await token(['project:read', 'graph:propose', 'graph:merge'])).secret,
    );
    const receipt = await call(granted, 'merge_proposal', merge);
    expect(receipt.isError).toBeFalsy();
    expect(receipt.structuredContent).toMatchObject({
      projectId,
      kind: 'merge',
      proposalId,
      parentCommitId: review.mainCommitId,
      requestId: expect.any(String),
    });
    expect(await mainId()).toBe(receipt.structuredContent.commitId);
  });
  it('revoked token cannot replay a receipt', async () => {
    const created = await token(['project:read', 'records:import']);
    const client = await connect(created.secret);
    const first = await call(client, 'import_records', importArgs('r-key'));
    expect(first.isError).toBeFalsy();
    await revokeAgentToken(ownerCtx, {
      projectId,
      tokenId: created.token.id,
      idempotencyKey: 'rv1',
    });
    await expect(call(client, 'import_records', importArgs('r-key'))).rejects.toThrow(
      /401|UNAUTHENTICATED/,
    );
    await expect(
      connect(created.secret).then((c) =>
        c.callTool({ name: 'import_records', arguments: importArgs('r-key') }),
      ),
    ).rejects.toThrow(/401|UNAUTHENTICATED/);
  });
  it('a foreign version id is NOT_FOUND and a long record pages without loss', async () => {
    const client = await connect(defaultToken.secret);
    const stranger = await testActor(t.db);
    const foreign = await createProject(t.db, stranger, { title: 'Foreign', clientName: 'Other' });
    const foreignVersion = await ingestText(
      t.db,
      stranger,
      foreign.id,
      'Foreign evidence that must stay hidden.',
    );
    const hidden = await call(client, 'get_record', { recordVersionId: foreignVersion });
    expect(hidden).toMatchObject({ isError: true, structuredContent: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(hidden)).not.toContain('Foreign evidence');
    const long = `xxxxx${'Map 🙏 ok '.repeat(1999)}abcde`;
    expect(long).toHaveLength(20_000);
    const imported = await call(client, 'import_records', {
      source: 'agent',
      sourceLabel: 'notion',
      records: [record('long', long)],
      idempotencyKey: 'long',
    });
    const versionId = imported.structuredContent.items[0].recordVersionId;
    let text = '',
      cursor: string | null = null,
      calls = 0;
    do {
      const chunk: ToolReply = await call(client, 'get_record', {
        recordVersionId: versionId,
        ...(cursor ? { cursor } : {}),
      });
      expect(chunk.structuredContent.start).toBe(text.length);
      expect(chunk.structuredContent.text.length).toBeLessThanOrEqual(8000);
      text += chunk.structuredContent.text;
      cursor = chunk.structuredContent.nextCursor;
      calls++;
    } while (cursor);
    expect(calls).toBe(3);
    expect(text).toBe(long);
  });
  it('accepts only agent or paste imports in P0; native connector sources are VALIDATION', async () => {
    const client = await connect(defaultToken.secret);
    const before = await ev();
    for (const source of ['slack', 'gmail']) {
      const reply = await call(client, 'import_records', {
        ...importArgs(`native-${source}`),
        source,
        records: [
          { ...record(`n-${source}`, 'Looks done.'), permalink: 'https://evil.example/phish' },
        ],
      });
      expect(reply).toMatchObject({ isError: true, structuredContent: { code: 'VALIDATION' } });
    }
    expect(await ev()).toBe(before);
    expect(
      (await call(client, 'import_records', { ...importArgs('paste-ok'), source: 'paste' }))
        .isError,
    ).toBeFalsy();
  });
  it('lists all tools and none accepts a projectId argument', async () => {
    const { tools } = await (await connect(defaultToken.secret)).listTools();
    expect(tools).toHaveLength(24);
    for (const tool of tools)
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('projectId');
    expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(50_000);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'apply_rebase',
      'close_proposal',
      'create_proposal',
      'diff_proposal',
      'get_commit',
      'get_graph',
      'get_loop',
      'get_project',
      'get_proposal',
      'get_record',
      'get_snapshot',
      'import_records',
      'list_history',
      'list_inbox',
      'list_loops',
      'list_milestones',
      'merge_proposal',
      'preview_rebase',
      'preview_restore',
      'preview_revert',
      'restore_commit',
      'revert_commit',
      'search_records',
      'update_proposal',
    ]);
  });
  it('rejects a projectId argument and checks scope per tool, including import without project:read', async () => {
    const client = await connect(defaultToken.secret);
    const project = await call(client, 'get_project', {});
    expect(project.structuredContent).toMatchObject({
      projectId,
      project: { id: projectId },
      requestId: expect.any(String),
    });
    const smuggled = await call(client, 'get_project', { projectId: randomUUID() });
    expect(smuggled).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'VALIDATION',
        errors: [expect.objectContaining({ path: expect.any(String) })],
      },
    });
    const importer = await connect((await token(['records:import'])).secret);
    expect((await call(importer, 'import_records', importArgs('only-import'))).isError).toBeFalsy();
    expect(await call(importer, 'get_project', {})).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN' },
    });
  });
  it('lists no escalation tool', async () => {
    const { tools } = await (await connect(defaultToken.secret)).listTools();
    expect(tools.map((tool) => tool.name).filter((name) => name.includes('escalation'))).toEqual(
      [],
    );
  });
  it('a token with no scope left authenticates and every tool refuses it', async () => {
    const created = await token(['project:read']);
    await t.db.update(agentTokens).set({ scopes: [] }).where(eq(agentTokens.id, created.token.id));
    const client = await connect(created.secret);
    const { tools } = await client.listTools();
    for (const { name } of tools) {
      const reply = await call(client, name);
      expect(reply).toMatchObject({ isError: true, structuredContent: { code: 'FORBIDDEN' } });
      expect(JSON.stringify(reply.content)).toMatch(/Scope \S+ is required/);
    }
  });
  it('marks successful responses private and uncacheable', async () => {
    const rpc = (id: number, method: string, params: Record<string, unknown>) =>
      POST(
        new Request(`${origin}/mcp`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${defaultToken.secret}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        }),
      );
    for (const response of [
      await rpc(1, 'tools/list', {}),
      await rpc(2, 'tools/call', { name: 'get_project', arguments: {} }),
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('vary')).toContain('Authorization');
      expect((await response.json()).result).toBeDefined();
    }
  });
  it('answers only POST and rejects an unknown token or foreign Host', async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
    await expect(connect(`inv_${'A'.repeat(43)}`)).rejects.toThrow(/401|UNAUTHENTICATED/);
    const response = await POST(
      new Request(`${origin}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${defaultToken.secret}`,
          host: 'evil.example',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: '{}',
      }),
    );
    expect(response.status).toBe(403);
  });
});
