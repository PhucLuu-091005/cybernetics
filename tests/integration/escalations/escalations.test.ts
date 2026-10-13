import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, agentActor, testActor, type TestDb } from '../../support/db';
import { historyAct, mainState, mergeSnapshotChange, recordIdOf, seedHistoryProject } from '../../support/history';
import { body, ingestText } from '../../support/proposals';
import { approveAnswer, getEscalation, listEscalations, openEscalation, saveEscalationAnalysis } from '../../../src/server/domain/escalations';
import { withdrawRecord } from '../../../src/server/domain/records';
import { escalationAnalyses } from '../../../src/server/db/schema';
import { canonicalHash } from '../../../src/lib/canonical-json';
import { EscalationAnalysisSchema, GetEscalationResultSchema, utf8Bytes, type ActorContext, type ClaimInput, type EscalationAnalysis, type GraphSnapshot, type SaveEscalationAnalysisInput } from '../../../src/contracts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('escalations', () => {
  let t: TestDb, ctx: ActorContext, projectId: string, escalationId: string, citedActId: string, uncitedActId: string, hiddenActId: string, withdrawnActId: string, foreignActId: string, foreignCommitId: string, withdrawnRecordId: string;
  const claimCiting = (supporting: string, contradicting: string[] = []): ClaimInput => ({ id: randomUUID(), text: 'Minh promised go-live by 30 September', type: 'promise', timeWindow: { start: '2026-09-01', end: '2026-09-30' }, supportingActIds: [supporting], contradictingActIds: contradicting, openQuestions: [] });
  const save = async (overrides: Partial<SaveEscalationAnalysisInput>, actor = ctx) => {
    const { mainId, evidenceRevision } = await mainState(t.db, projectId);
    return saveEscalationAnalysis(t.db, actor, { projectId, escalationId, graphCommitId: mainId, expectedMainCommitId: mainId, expectedEvidenceRevision: evidenceRevision, expectedAnalysisRevision: null, claims: [claimCiting(citedActId)], answerText: `Minh committed to 30 September [act:${citedActId}].`, idempotencyKey: randomUUID(), ...overrides });
  };
  const approveInput = (analysis: EscalationAnalysis) => ({ projectId, escalationId, analysisId: analysis.id, expectedAnalysisRevision: analysis.revision, expectedMainCommitId: analysis.graphCommitId, expectedEvidenceRevision: analysis.evidenceRevision, contentHash: analysis.contentHash, idempotencyKey: randomUUID() });
  const ingestOne = (text: string) => ingestText(t.db, ctx, projectId, text);
  const mergeChange = (mutate: (snapshot: GraphSnapshot) => void) => mergeSnapshotChange(t.db, ctx, projectId, mutate);
  const analysisCount = async () => (await t.db.select({ id: escalationAnalyses.id }).from(escalationAnalyses).where(eq(escalationAnalyses.projectId, projectId))).length;

  beforeAll(async () => {
    t = await createTestDatabase();
    ctx = await testActor(t.db);
    const foreign = await seedHistoryProject(t.db, ctx);
    foreignActId = randomUUID();
    foreignCommitId = (await mergeSnapshotChange(t.db, ctx, foreign.projectId, s => { s.acts.push(historyAct(foreign.versionId, s.loops[0].id, { id: foreignActId })); })).commitId;
  });
  afterAll(async () => { await t?.close(); });
  beforeEach(async () => {
    const seed = await seedHistoryProject(t.db, ctx);
    projectId = seed.projectId;
    const withdrawnVersionId = await ingestOne(body);
    withdrawnRecordId = await recordIdOf(t.db, withdrawnVersionId);
    [citedActId, uncitedActId, hiddenActId, withdrawnActId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await mergeChange(s => {
      const loopId = s.loops[0].id;
      s.acts.push(historyAct(seed.versionId, loopId, { id: citedActId }), historyAct(seed.versionId, loopId, { id: uncitedActId }), historyAct(seed.versionId, loopId, { id: hiddenActId, hidden: true }), historyAct(withdrawnVersionId, loopId, { id: withdrawnActId }));
    });
    escalationId = (await openEscalation(t.db, ctx, { projectId, complaint: 'You promised go-live by 30 September and never told us it slipped.', idempotencyKey: randomUUID() })).id;
  });

  it('opening a complaint creates no analysis', async () => {
    const escalation = await openEscalation(t.db, ctx, { projectId, complaint: 'You promised go-live by 30 September and never told us it slipped.', idempotencyKey: 'e1' });
    expect((await getEscalation(t.db, ctx, { projectId, escalationId: escalation.id })).analyses).toEqual([]);
  });
  it('rejects an answer marker that no claim cites, and a foreign act id', async () => {
    await expect(save({ answerText: `See [act:${uncitedActId}]` })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(save({ claims: [claimCiting(foreignActId)] })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('an analysis becomes stale after main or evidence changes', async () => {
    await save({});
    await ingestOne('new evidence');
    expect((await getEscalation(t.db, ctx, { projectId, escalationId })).stale).toBe(true);
  });
  it('an agent cannot approve, and a new revision clears approval', async () => {
    const first = await save({});
    await expect(approveAnswer(t.db, agentActor(ctx, projectId, ['project:read', 'escalations:write']), approveInput(first))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await approveAnswer(t.db, ctx, approveInput(first));
    const second = await save({ expectedAnalysisRevision: first.revision });
    const view = await getEscalation(t.db, ctx, { projectId, escalationId });
    expect(view.analyses.find(analysis => analysis.revision === second.revision)!.approval).toBeNull();
  });
  it('an approval against old pins is refused', async () => {
    const analysis = await save({});
    await mergeChange(s => { s.loops[0].title = 'moved'; });
    await expect(approveAnswer(t.db, ctx, approveInput(analysis))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('saves pinned revisions with derived verdicts and a content hash, and replays a retried key', async () => {
    const { mainId, evidenceRevision } = await mainState(t.db, projectId);
    const claims = [claimCiting(citedActId), claimCiting(citedActId, [uncitedActId]), { ...claimCiting(citedActId), supportingActIds: [], contradictingActIds: [uncitedActId] }, { ...claimCiting(citedActId), supportingActIds: [] }];
    const answerText = `Promised [act:${citedActId}], then moved [act:${uncitedActId}].`;
    const first = await save({ claims, answerText, idempotencyKey: 'save-1' });
    expect(EscalationAnalysisSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({ revision: 1, graphCommitId: mainId, evidenceRevision, approval: null, author: { kind: 'user', userId: ctx.userId } });
    expect(first.claims.map(claim => claim.verdict)).toEqual(['supported', 'contested', 'contradicted', 'insufficient']);
    expect(first.contentHash).toBe(canonicalHash({ claims: first.claims, answerText, graphCommitId: mainId, evidenceRevision }));
    expect(await save({ claims, answerText, idempotencyKey: 'save-1' })).toEqual(first);
    await expect(save({ idempotencyKey: 'save-2' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const second = await save({ expectedAnalysisRevision: 1 });
    expect(second.revision).toBe(2);
    const view = await getEscalation(t.db, ctx, { projectId, escalationId });
    expect(GetEscalationResultSchema.parse(view)).toEqual(view);
    expect(view).toMatchObject({ stale: false, mainCommitId: mainId, evidenceRevision, escalation: { id: escalationId, latestAnalysisRevision: 2 } });
    expect(view.analyses.map(analysis => analysis.revision)).toEqual([2, 1]);
    expect(await listEscalations(t.db, ctx, { projectId })).toEqual([view.escalation]);
  });
  it('rejects hidden, withdrawn and missing acts, malformed markers and stale expected revisions without writing', async () => {
    await withdrawRecord(t.db, ctx, { projectId, recordId: withdrawnRecordId, expectedEvidenceRevision: (await mainState(t.db, projectId)).evidenceRevision, reason: 'Source asked to withdraw', idempotencyKey: randomUUID() });
    for (const actId of [hiddenActId, withdrawnActId, randomUUID()]) await expect(save({ claims: [claimCiting(actId)], answerText: '' })).rejects.toMatchObject({ code: 'VALIDATION' });
    for (const answerText of [`See [act:${citedActId.toUpperCase()}]`, 'See [act:not-a-uuid]', `See [act:${citedActId}`]) await expect(save({ answerText })).rejects.toMatchObject({ code: 'VALIDATION' });
    const { mainId, evidenceRevision } = await mainState(t.db, projectId);
    await expect(save({ expectedMainCommitId: foreignCommitId })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(save({ expectedEvidenceRevision: evidenceRevision + 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(save({ expectedAnalysisRevision: 3 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(save({ graphCommitId: foreignCommitId, expectedMainCommitId: mainId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await analysisCount()).toBe(0);
  });
  it('approval stores actor, pins and hash on the latest current revision only', async () => {
    const first = await save({});
    await expect(approveAnswer(t.db, ctx, { ...approveInput(first), contentHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'CONFLICT' });
    const approved = await approveAnswer(t.db, ctx, approveInput(first));
    expect(approved.approval).toMatchObject({ actor: { kind: 'user', userId: ctx.userId }, contentHash: first.contentHash, mainCommitId: first.graphCommitId, evidenceRevision: first.evidenceRevision });
    expect(EscalationAnalysisSchema.parse(approved)).toEqual(approved);
    await save({ expectedAnalysisRevision: first.revision });
    await expect(approveAnswer(t.db, ctx, approveInput(first))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('pages analyses newest first within the 50,000-character budget', async () => {
    let previous: number | null = null;
    for (let index = 0; index < 4; index++) previous = (await save({ expectedAnalysisRevision: previous, answerText: `${'x'.repeat(19_000)} [act:${citedActId}]` })).revision;
    const revisions: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await getEscalation(t.db, ctx, { projectId, escalationId, cursor });
      expect(utf8Bytes(JSON.stringify(page))).toBeLessThanOrEqual(50_000);
      expect(page.analyses.length).toBeGreaterThan(0);
      revisions.push(...page.analyses.map(analysis => analysis.revision));
      cursor = page.nextCursor;
    } while (cursor);
    expect(revisions).toEqual([4, 3, 2, 1]);
    const other = await openEscalation(t.db, ctx, { projectId, complaint: 'Another complaint', idempotencyKey: randomUUID() });
    await expect(getEscalation(t.db, ctx, { projectId, escalationId: other.id, cursor: (await getEscalation(t.db, ctx, { projectId, escalationId })).nextCursor })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('rejects duplicate claim ids, an act cited twice in one set, and an act on both sides of one claim, without writing', async () => {
    const first = claimCiting(citedActId);
    const invalidClaims: ClaimInput[][] = [
      [first, { ...claimCiting(uncitedActId), id: first.id }],
      [{ ...claimCiting(citedActId), supportingActIds: [citedActId, citedActId] }],
      [claimCiting(citedActId, [citedActId])],
    ];
    for (const claims of invalidClaims) await expect(save({ claims })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await analysisCount()).toBe(0);
  });
  it('refuses an analysis that cannot fit one escalation page and saves one just under the budget', async () => {
    const complaint = 'c'.repeat(20_000);
    const padded = (answerText: string): Partial<SaveEscalationAnalysisInput> => ({ claims: [{ ...claimCiting(citedActId), openQuestions: Array.from({ length: 5 }, () => 'q'.repeat(2_000)) }], answerText });
    const probeId = (await openEscalation(t.db, ctx, { projectId, complaint, idempotencyKey: randomUUID() })).id;
    await save({ escalationId: probeId, ...padded('') });
    const emptyAnswerPage = utf8Bytes(JSON.stringify(await getEscalation(t.db, ctx, { projectId, escalationId: probeId })));
    const targetId = (await openEscalation(t.db, ctx, { projectId, complaint, idempotencyKey: randomUUID() })).id;
    // One byte more than a read result with no cursor could ever hold.
    const overLength = 50_000 - emptyAnswerPage + 1;
    await expect(save({ escalationId: targetId, ...padded('x'.repeat(overLength)) })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect((await t.db.select({ id: escalationAnalyses.id }).from(escalationAnalyses).where(eq(escalationAnalyses.escalationId, targetId))).length).toBe(0);
    // 512 bytes cover the worst-case cursor and the read slack that the save guard reserves.
    const underLength = overLength - 1 - 512;
    const saved = await save({ escalationId: targetId, ...padded('x'.repeat(underLength)) });
    const page = await getEscalation(t.db, ctx, { projectId, escalationId: targetId });
    expect(utf8Bytes(JSON.stringify(page))).toBeLessThanOrEqual(50_000);
    expect(page.nextCursor).toBeNull();
    expect(page.analyses).toEqual([saved]);
    expect(page.analyses[0].answerText).toHaveLength(underLength);
  });
  it('requires escalation scopes and hides other projects', async () => {
    await expect(openEscalation(t.db, agentActor(ctx, projectId, ['project:read']), { projectId, complaint: 'Late', idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save({}, agentActor(ctx, projectId, ['project:read']))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const agentDraft = await save({}, agentActor(ctx, projectId, ['project:read', 'escalations:write']));
    expect(agentDraft.author.kind).toBe('agent');
    const stranger = await testActor(t.db);
    await expect(getEscalation(t.db, stranger, { projectId, escalationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
