import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { escalationAnalyses, escalations } from '../../../src/server/db/schema';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { mergeSnapshotChange } from '../../support/history';
import { headOf, larkspurT, seedLarkspur, type LarkspurSeed } from '../../support/seed';
import { uuidFromKey } from '../../../scripts/build-fixtures';
import {
  getGraph,
  getGraphView,
  getLoop,
  getProject,
  getSnapshotPage,
  listLoops,
  listMilestones,
} from '../../../src/server/domain/graph';
import { createProposal, updateProposal } from '../../../src/server/domain/proposals';
import { withdrawRecord } from '../../../src/server/domain/records';
import {
  GetGraphResultSchema,
  GetLoopResultSchema,
  GetProjectResultSchema,
  GraphViewSchema,
  SnapshotPageSchema,
  type ActorContext,
  type GraphSnapshot,
} from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('graph reads', () => {
  let t: TestDb,
    ctx: ActorContext,
    seed: LarkspurSeed,
    projectId: string,
    main: string,
    firstCommitId: string,
    proposalId: string,
    citedVersionId: string,
    citedRecordId: string;
  const T = larkspurT;
  const mainId = () => main;
  const tables = [
    'projects',
    'records',
    'record_versions',
    'graph_commits',
    'graph_proposals',
    'mutation_receipts',
    'escalations',
    'escalation_analyses',
    'agent_tokens',
  ];
  const tableCounts = async () =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (name) => [
          name,
          (await t.db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${name}`)))
            .rows[0].n,
        ]),
      ),
    );
  const mergeChange = async (mutate: (snapshot: GraphSnapshot) => void) => {
    main = (await mergeSnapshotChange(t.db, ctx, projectId, mutate)).commitId;
  };
  const withdraw = async (recordId: string) =>
    withdrawRecord(t.db, ctx, {
      projectId,
      recordId,
      expectedEvidenceRevision: (await headOf(t.db, projectId)).evidenceRevision,
      reason: 'Source asked to withdraw',
      idempotencyKey: randomUUID(),
    });
  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    seed = await seedLarkspur(t.db, ctx);
    ({ projectId, seedCommitId: firstCommitId } = seed);
    main = firstCommitId;
    const act = seed.snapshot.acts.find((item) => item.id === uuidFromKey('act:go-live:0'))!;
    citedVersionId = act.citation.recordVersionId;
    citedRecordId = seed.recordIds.get(citedVersionId)!;
    const proposal = await createProposal(t.db, ctx, {
      projectId,
      baseCommitId: main,
      title: 'Extra loop',
      expectedEvidenceRevision: seed.evidenceRevision,
      idempotencyKey: randomUUID(),
    });
    const department = seed.snapshot.context.departments.find((item) => item.side === 'vendor')!;
    await updateProposal(t.db, ctx, {
      projectId,
      proposalId: proposal.id,
      expectedProposalRevision: 0,
      expectedEvidenceRevision: seed.evidenceRevision,
      operations: [
        {
          op: 'put',
          collection: 'loops',
          value: {
            id: randomUUID(),
            title: 'Extra loop',
            customer: { kind: 'side', side: 'client' },
            performer: { kind: 'side', side: 'vendor' },
            performerDepartmentId: department.id,
            milestoneId: null,
          },
        },
      ],
      idempotencyKey: randomUUID(),
    });
    proposalId = proposal.id;
  });

  it('main and proposal views are distinguished and reads never write', async () => {
    const before = await tableCounts();
    const main = await getGraphView(t.db, ctx, { projectId, view: { kind: 'main' }, T });
    const draft = await getGraphView(t.db, ctx, {
      projectId,
      view: { kind: 'proposal', proposalId, proposalRevision: 1 },
      T,
    });
    expect(main.engine.loops.length).not.toBe(draft.engine.loops.length);
    expect(main).toMatchObject({ commitId: mainId(), proposalId: null });
    expect(await tableCounts()).toEqual(before);
  });
  it('historical commit view uses its own pinned context and the explicit T', async () => {
    await mergeChange((s) => {
      s.context.replyWindowDays = 10;
    });
    const old = await getGraphView(t.db, ctx, {
      projectId,
      view: { kind: 'commit', commitId: firstCommitId },
      T,
    });
    expect(old.snapshot.context.replyWindowDays).toBe(2);
    expect(old.T).toBe(T);
  });
  it('graph view names the source of every cited record version', async () => {
    const view = await getGraphView(t.db, ctx, { projectId, view: { kind: 'main' }, T });
    const cited = new Set(view.snapshot.acts.map((act) => act.citation.recordVersionId));
    expect(new Set(Object.keys(view.sources))).toEqual(cited);
    expect(view.sources[citedVersionId]).toMatchObject({
      source: expect.stringMatching(/^(paste|agent|slack|gmail)$/),
      sourceLabel: expect.any(String),
    });
    expect(GraphViewSchema.parse(view)).toEqual(view);
  });

  it('withdrawn text is masked in every view including old commits', async () => {
    await withdraw(citedRecordId);
    for (const view of [{ kind: 'main' }, { kind: 'commit', commitId: firstCommitId }] as const) {
      const graph = await getGraphView(t.db, ctx, { projectId, view, T });
      const act = graph.engine.loops
        .flatMap((loop) => loop.acts)
        .find((item) => item.citation.recordVersionId === citedVersionId)!;
      expect(act).toMatchObject({ quote: null, unavailable: true });
      expect(graph.sources[citedVersionId].permalink).toBeNull();
      expect(graph.sources[citedVersionId].sourceLabel.length).toBeGreaterThan(0);
    }
  });
  it('paginates loops without losing entities', async () => {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await getGraph(t.db, ctx, {
        projectId,
        view: { kind: 'main' },
        T,
        cursor,
        limit: 7,
      });
      ids.push(...page.loops.map((loop) => loop.loop.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(30);
  });

  it('a graph view is schema-valid and matches the fixture gold at T', async () => {
    const view = await getGraphView(t.db, ctx, { projectId, view: { kind: 'main' }, T });
    expect(GraphViewSchema.parse(view)).toEqual(view);
    expect(view).toMatchObject({
      mainCommitId: mainId(),
      evidenceRevision: seed.evidenceRevision,
      pendingEvidenceCount: 4,
      T,
      proposalRevision: null,
    });
    expect(view.people).toEqual(view.snapshot.context.people);
    expect(
      view.engine.loops
        .find((loop) => loop.loop.id === uuidFromKey('loop:secret'))
        ?.breakdowns.map((item) => item.type),
    ).toEqual(['unanswered_request']);
  });
  it('T falls back to the snapshot asOfOverride', async () => {
    const view = await getGraphView(t.db, ctx, { projectId, view: { kind: 'main' } });
    expect(view.T).toBe(seed.snapshot.context.asOfOverride);
  });
  it('a stale proposal revision conflicts and an unknown commit is not found', async () => {
    await expect(
      getGraphView(t.db, ctx, {
        projectId,
        view: { kind: 'proposal', proposalId, proposalRevision: 0 },
        T,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      getGraphView(t.db, ctx, { projectId, view: { kind: 'commit', commitId: randomUUID() }, T }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('graph pages stay within the budget and cursors are bound to their view', async () => {
    const first = await getGraph(t.db, ctx, { projectId, view: { kind: 'main' }, T, limit: 50 });
    expect(GetGraphResultSchema.parse(first)).toEqual(first);
    expect(first.milestones.length + first.loops.length).toBeLessThanOrEqual(50);
    expect(first.nextCursor).not.toBeNull();
    await expect(
      getGraph(t.db, ctx, {
        projectId,
        view: { kind: 'proposal', proposalId, proposalRevision: 1 },
        T,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      getGraph(t.db, ctx, {
        projectId,
        view: { kind: 'main' },
        T: '2026-10-01T00:00:00Z',
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const milestones = await listMilestones(t.db, ctx, { projectId, view: { kind: 'main' }, T });
    expect(milestones.items).toHaveLength(seed.snapshot.context.milestones.length);
  });
  it('lists loops by state, department, milestone and accent-folded quote text, and reads one loop', async () => {
    const promised = await listLoops(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      T,
      states: ['promised'],
    });
    expect(promised.loops.map((loop) => loop.loop.id).sort()).toEqual(
      [
        uuidFromKey('loop:go-live'),
        uuidFromKey('loop:crm-sync'),
        uuidFromKey('loop:incident-report'),
      ].sort(),
    );
    const secret = await getLoop(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      T,
      loopId: uuidFromKey('loop:secret'),
    });
    const quoted = secret.loop.acts[0].quote!.slice(0, 20).toUpperCase();
    expect(
      (
        await listLoops(t.db, ctx, { projectId, view: { kind: 'main' }, T, query: quoted })
      ).loops.map((loop) => loop.loop.id),
    ).toContain(uuidFromKey('loop:secret'));
    const department = secret.loop.loop.performerDepartmentId,
      milestone = secret.loop.loop.milestoneId!;
    const filtered = await listLoops(t.db, ctx, {
      projectId,
      view: { kind: 'main' },
      T,
      departmentIds: [department],
      milestoneId: milestone,
    });
    expect(
      filtered.loops.every(
        (loop) =>
          loop.loop.performerDepartmentId === department && loop.loop.milestoneId === milestone,
      ),
    ).toBe(true);
    await expect(
      getLoop(t.db, ctx, { projectId, view: { kind: 'main' }, T, loopId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('a loop read carries up to 300 characters of context around each quote, the permalink and the source, masked after withdrawal', async () => {
    const loopId = uuidFromKey('loop:go-live');
    const reads = await Promise.all(
      [loopId, uuidFromKey('loop:secret')].map((id) =>
        getLoop(t.db, ctx, { projectId, view: { kind: 'main' }, T, loopId: id }),
      ),
    );
    for (const read of reads) expect(GetLoopResultSchema.parse(read)).toEqual(read);
    const acts = reads.flatMap((read) => read.loop.acts);
    expect(acts.some((act) => act.permalink?.startsWith('https://'))).toBe(true);
    for (const act of acts) {
      const input = seed.inputs.get(act.citation.recordVersionId)!;
      const { before, after } = act.context!;
      expect(before.length + after.length).toBeLessThanOrEqual(300);
      expect(
        input.bodyText.slice(act.citation.start - before.length, act.citation.end + after.length),
      ).toBe(`${before}${act.quote}${after}`);
      expect(before.length).toBe(
        Math.min(act.citation.start, 300 - Math.min(150, input.bodyText.length - act.citation.end)),
      );
      expect(act.permalink).toBe(input.permalink ?? null);
      expect(act).toMatchObject({ source: 'agent', sourceLabel: input.sourceLabel });
    }
    await withdraw(citedRecordId);
    const masked = (
      await getLoop(t.db, ctx, { projectId, view: { kind: 'main' }, T, loopId })
    ).loop.acts.find((act) => act.citation.recordVersionId === citedVersionId)!;
    expect(masked).toMatchObject({
      quote: null,
      unavailable: true,
      context: null,
      permalink: null,
    });
  });
  it('snapshot pages cover each collection without loss', async () => {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await getSnapshotPage(t.db, ctx, {
        projectId,
        view: { kind: 'main' },
        collection: 'acts',
        cursor,
      });
      expect(SnapshotPageSchema.parse(page)).toEqual(page);
      ids.push(...page.items.map((item) => (item as { id: string }).id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(seed.snapshot.acts.length);
    const context = await getSnapshotPage(t.db, ctx, {
      projectId,
      view: { kind: 'commit', commitId: firstCommitId },
      collection: 'context',
    });
    expect(context.items).toEqual([
      expect.objectContaining({ replyWindowDays: 2, timeZone: 'Asia/Ho_Chi_Minh' }),
    ]);
  });
  it('project summary reports pending evidence and analysis freshness', async () => {
    const summary = await getProject(t.db, ctx, { projectId });
    expect(GetProjectResultSchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      project: { id: projectId, mainCommitId: mainId(), evidenceRevision: seed.evidenceRevision },
      pendingEvidenceCount: 4,
      analysisFreshness: 'none',
    });
    const author = { kind: 'user' as const, userId: ctx.userId },
      workspaceId = summary.project.workspaceId;
    const [escalation] = await t.db
      .insert(escalations)
      .values({ workspaceId, projectId, complaint: 'Late report', author })
      .returning();
    await t.db.insert(escalationAnalyses).values({
      workspaceId,
      projectId,
      escalationId: escalation.id,
      revision: 1,
      graphCommitId: mainId(),
      evidenceRevision: seed.evidenceRevision,
      claims: [],
      answerText: 'Draft',
      author,
      contentHash: 'a'.repeat(64),
    });
    expect((await getProject(t.db, ctx, { projectId })).analysisFreshness).toBe('current');
    await withdraw(citedRecordId);
    expect((await getProject(t.db, ctx, { projectId })).analysisFreshness).toBe('stale');
  });
});
