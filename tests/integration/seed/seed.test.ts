import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import gold from '../../../fixtures/gold.json';
import history from '../../../fixtures/history.json';
import proposals from '../../../fixtures/proposals.json';
import records from '../../../fixtures/records.json';
import { uuidFromKey } from '../../../scripts/build-fixtures';
import type { ActorContext, GraphSnapshot } from '../../../src/contracts';
import { canonicalHash } from '../../../src/lib/canonical-json';
import { seedOnUserCreated } from '../../../src/server/app';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { graphCommits, projects, recordVersions, records as recordRows, users } from '../../../src/server/db/schema';
import { requireProject } from '../../../src/server/domain/access';
import { listHistory } from '../../../src/server/domain/commits';
import { getEscalation, listEscalations } from '../../../src/server/domain/escalations';
import { getGraphView } from '../../../src/server/domain/graph';
import { listProjects } from '../../../src/server/domain/projects';
import { diffProposal, listProposals, mergeProposal, previewRebase, reviewProposal } from '../../../src/server/domain/proposals';
import { rekeyFixture, SANDBOX_TITLE, SANDBOX_WITHDRAWN_RECORD_KEY } from '../../../src/server/domain/seed';
import { browserScopes } from '../../../src/server/http/identity-store';
import { createTestDatabase, type TestDb } from '../../support/db';

const stableKinds = (changes: { collection: string; id: string; kind: string }[]) =>
  changes.map(({ collection, id, kind }) => `${collection}/${id}/${kind}`).sort();

describe.skipIf(!process.env.TEST_DATABASE_URL)('seeded sandbox', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase(); });
  afterAll(async () => { await t?.close(); });
  const seededStore = () => new DbIdentityStore(t.db, { onUserCreated: seedOnUserCreated });
  const actorFor = async (userId: string, projectId: string | null = null): Promise<ActorContext> => {
    const session = await new DbIdentityStore(t.db).resolveSessionUser(userId);
    return { kind: 'user', userId, workspaceId: session!.defaultWorkspaceId, projectId, scopes: [...browserScopes], requestId: randomUUID() };
  };
  /** Ingestion assigns version IDs, so the fixture mapping is recovered through each record's stable external ID. */
  const fixtureIds = async (projectId: string) => {
    const rows = await t.db.select({ externalId: recordRows.externalId, versionId: recordVersions.id }).from(recordVersions)
      .innerJoin(recordRows, and(eq(recordRows.projectId, recordVersions.projectId), eq(recordRows.id, recordVersions.recordId))).where(eq(recordVersions.projectId, projectId));
    const byExternal = new Map(rows.map(row => [row.externalId, row.versionId]));
    const versionIds = new Map(records.filter(item => item.projectKey === 'larkspur').map(item => [item.recordVersionId, byExternal.get(item.record.externalId)!]));
    return { versionIds, entityId: (id: string) => uuidFromKey(`${projectId}:${id}`) };
  };
  const mainSnapshot = async (projectId: string): Promise<GraphSnapshot> => {
    const [row] = await t.db.select({ snapshot: graphCommits.snapshot }).from(projects).innerJoin(graphCommits, eq(graphCommits.id, projects.mainCommitId)).where(eq(projects.id, projectId));
    return row.snapshot;
  };

  it('a new Google user gets an isolated seeded project with all seven breakdowns', async () => {
    const store = seededStore();
    const a = await store.provisionUser({ subject: 'google:a', email: 'a@x.example', name: 'A' });
    const b = await store.provisionUser({ subject: 'google:b', email: 'b@x.example', name: 'B' });
    const [pa] = await listProjects(t.db, await actorFor(a.userId)), [pb] = await listProjects(t.db, await actorFor(b.userId));
    expect(pa.id).not.toBe(pb.id);
    const graph = await getGraphView(t.db, await actorFor(a.userId, pa.id), { projectId: pa.id, view: { kind: 'main' } });
    expect(Object.entries(graph.engine.counts.breakdowns).filter(([, n]) => n > 0)).toHaveLength(7);
    expect(graph.pendingEvidenceCount).toBe(4);
    await expect(requireProject(t.db, await actorFor(b.userId), pa.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('builds main through real commits that equal the fixture history head, re-keyed per project, with gold unchanged', async () => {
    const started = performance.now();
    const { userId } = await seededStore().provisionUser({ subject: `google:${randomUUID()}`, email: 'c@x.example', name: 'C' });
    console.log(`first sign-in with sandbox seed: ${Math.round(performance.now() - started)} ms`);
    const ctx = await actorFor(userId);
    const [project] = await listProjects(t.db, ctx);
    expect(project.title).toBe(SANDBOX_TITLE);
    const ids = await fixtureIds(project.id);
    expect([...ids.versionIds.values()].every(Boolean)).toBe(true);
    const main = await mainSnapshot(project.id);
    expect(canonicalHash(main)).toBe(canonicalHash(rekeyFixture(history[2].snapshot as GraphSnapshot, ids)));
    expect(main.loops.map(loop => loop.id)).not.toContain(uuidFromKey('loop:go-live'));

    const commits = (await listHistory(t.db, ctx, { projectId: project.id })).items.reverse();
    expect(commits.map(commit => commit.kind)).toEqual(['initial', 'merge', 'merge', 'merge', 'revert']);
    expect(commits.map(commit => commit.message).slice(2)).toEqual(history.map(item => item.message));
    expect(commits[4].targetCommitId).toBe(commits[2].id);
    expect(commits.slice(1, 4).every(commit => commit.proposalId !== null)).toBe(true);

    const graph = await getGraphView(t.db, ctx, { projectId: project.id, view: { kind: 'main' } });
    const derived = graph.engine.loops.map(loop => ({ id: loop.loop.id, state: loop.state, breakdowns: loop.breakdowns.map(item => item.type).sort() })).sort((x, y) => x.id.localeCompare(y.id));
    const expected = Object.entries(gold.loops).map(([id, loop]) => ({ id: ids.entityId(id), state: loop.state, breakdowns: [...loop.breakdowns].sort() })).sort((x, y) => x.id.localeCompare(y.id));
    expect(derived).toEqual(expected);
    expect(graph.engine.unavailableEvidenceCount).toBe(1);
    expect(graph.pendingEvidenceCount).toBe(4);
  });

  it('withdraws one cited record of a healthy closed loop, never a pending one', async () => {
    const { userId } = await seededStore().provisionUser({ subject: `google:${randomUUID()}`, email: null, name: 'D' });
    const ctx = await actorFor(userId);
    const [project] = await listProjects(t.db, ctx);
    const ids = await fixtureIds(project.id);
    const withdrawn = await t.db.select({ id: recordRows.id, reason: recordRows.withdrawnReason }).from(recordRows).where(and(eq(recordRows.projectId, project.id), isNotNull(recordRows.withdrawnAt)));
    expect(withdrawn).toHaveLength(1);
    const versionId = ids.versionIds.get(uuidFromKey(SANDBOX_WITHDRAWN_RECORD_KEY))!;
    const [version] = await t.db.select({ recordId: recordVersions.recordId }).from(recordVersions).where(eq(recordVersions.id, versionId));
    expect(withdrawn[0].id).toBe(version.recordId);
    expect(withdrawn[0].reason).not.toBe('');
    const graph = await getGraphView(t.db, ctx, { projectId: project.id, view: { kind: 'main' } });
    const act = graph.engine.loops.flatMap(loop => loop.acts.map(item => ({ loop, item }))).find(({ item }) => item.citation.recordVersionId === versionId)!;
    expect(act.item.unavailable).toBe(true);
    expect(act.loop).toMatchObject({ state: 'closed', breakdowns: [] });
  });

  it('creates the three fixture drafts on the head; the competing pair conflicts after one merges', async () => {
    const { userId } = await seededStore().provisionUser({ subject: `google:${randomUUID()}`, email: null, name: 'E' });
    const ctx = await actorFor(userId);
    const [project] = await listProjects(t.db, ctx);
    const ids = await fixtureIds(project.id);
    const drafts = (await listProposals(t.db, ctx, { projectId: project.id, status: 'draft' })).items;
    expect(drafts.map(item => item.title).sort()).toEqual(proposals.map(item => item.title).sort());
    for (const fixture of proposals) {
      const draft = drafts.find(item => item.title === fixture.title)!;
      expect(draft).toMatchObject({ rationale: fixture.rationale, baseCommitId: project.mainCommitId });
      const review = await diffProposal(t.db, ctx, { projectId: project.id, proposalId: draft.id });
      expect(stableKinds(review.diff.changes)).toEqual(stableKinds(rekeyFixture(fixture.expectedDiff, ids)));
      expect(review.effects).toEqual([]);
    }
    const [first, second] = proposals.map(fixture => drafts.find(item => item.title === fixture.title)!);
    const T = gold.T, head = { projectId: project.id, expectedMainCommitId: project.mainCommitId, expectedEvidenceRevision: project.evidenceRevision };
    const review = await reviewProposal(t.db, ctx, { ...head, proposalId: first.id, expectedProposalRevision: first.revision, T });
    const merged = await mergeProposal(t.db, ctx, { ...head, proposalId: first.id, expectedProposalRevision: first.revision, reviewDigest: review.digest, T, message: first.title, idempotencyKey: randomUUID() });
    const rebase = await previewRebase(t.db, ctx, { projectId: project.id, proposalId: second.id, expectedMainCommitId: merged.commitId, expectedEvidenceRevision: project.evidenceRevision, expectedProposalRevision: second.revision, T });
    expect(rebase.conflicts.map(item => `${item.collection}/${item.id}`)).toEqual([`loops/${ids.entityId(uuidFromKey('loop:crm-sync'))}`]);
  });

  it('opens the three SRD 15 escalations, each with one current saved analysis whose verdicts equal gold', async () => {
    const { userId } = await seededStore().provisionUser({ subject: `google:${randomUUID()}`, email: null, name: 'G' });
    const ctx = await actorFor(userId);
    const [project] = await listProjects(t.db, ctx);
    const ids = await fixtureIds(project.id);
    const listed = (await listEscalations(t.db, ctx, { projectId: project.id })).items;
    expect(listed.map(item => item.complaint).sort()).toEqual(gold.escalations.map(item => item.complaint).sort());
    for (const fixture of gold.escalations) {
      const escalation = listed.find(item => item.complaint === fixture.complaint)!;
      expect(escalation.latestAnalysisRevision).toBe(1);
      const view = await getEscalation(t.db, ctx, { projectId: project.id, escalationId: escalation.id });
      expect(view.stale).toBe(false);
      expect(view.analyses).toHaveLength(1);
      const [analysis] = view.analyses;
      expect(analysis).toMatchObject({ graphCommitId: project.mainCommitId, evidenceRevision: project.evidenceRevision, approval: null });
      expect(analysis.claims.map(({ id, text, verdict, supportingActIds, contradictingActIds }) => ({ id, text, verdict, supportingActIds, contradictingActIds })))
        .toEqual(fixture.claims.map(claim => ({ id: ids.entityId(claim.id), text: claim.text, verdict: claim.verdict, supportingActIds: claim.supportingActIds.map(ids.entityId), contradictingActIds: claim.contradictingActIds.map(ids.entityId) })));
      for (const actId of analysis.claims.flatMap(claim => [...claim.supportingActIds, ...claim.contradictingActIds])) expect(analysis.answerText).toContain(`[act:${actId}]`);
    }
  });

  it('runs inside the provisioning transaction, so a failure after the seed leaves no user, project or record', async () => {
    const counts = async () => (await t.db.execute<{ projects: number; versions: number }>(sql`select (select count(*)::int from projects) as projects, (select count(*)::int from record_versions) as versions`)).rows[0];
    const before = await counts();
    const failing = new DbIdentityStore(t.db, { onUserCreated: async (tx, ids) => { await seedOnUserCreated(tx, ids); throw new Error('after seed'); } });
    const subject = `google:${randomUUID()}`;
    await expect(failing.provisionUser({ subject, email: null, name: 'F' })).rejects.toThrow('after seed');
    expect(await t.db.select({ id: users.id }).from(users).where(eq(users.subject, subject))).toEqual([]);
    expect(await counts()).toEqual(before);
  });
});
