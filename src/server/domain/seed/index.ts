import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import goldFixture from '../../../../fixtures/gold.json' with { type: 'json' };
import historyFixture from '../../../../fixtures/history.json' with { type: 'json' };
import mainSnapshot from '../../../../fixtures/main-snapshot.json' with { type: 'json' };
import projectFixture from '../../../../fixtures/project.json' with { type: 'json' };
import proposalsFixture from '../../../../fixtures/proposals.json' with { type: 'json' };
import recordsFixture from '../../../../fixtures/records.json' with { type: 'json' };
import { uuidFromKey } from '../../../../scripts/build-fixtures';
import type { Act, ActorContext, ClaimInput, CommitReceipt, GraphContext, GraphOperation, GraphSnapshot, IngestEnvelope, Project, RecordInput } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { graphCommits, projects } from '../../db/schema';
import { joinTransaction, type Db, type Tx } from '../../db/tx';
import { diffSnapshots } from '../../graph/diff';
import { requireProject } from '../access';
import { previewRevert, revertCommit } from '../commits';
import { openEscalation, saveEscalationAnalysis } from '../escalations';
import { createProject, toProject } from '../projects';
import { createProposal, mergeProposal, reviewProposal, updateProposal } from '../proposals';
import { ingestRecords, withdrawRecord } from '../records';

export const LARKSPUR_T = '2026-10-09T18:00:00+07:00';
export const SANDBOX_TITLE = projectFixture.larkspur.title;
/** Operations training is a healthy closed loop; its withdrawn delivery report shows unavailable evidence without moving any gold state. */
export const SANDBOX_WITHDRAWN_RECORD_KEY = 'record-version:training:2';
export const larkspurRecords = recordsFixture.filter(item => item.projectKey === 'larkspur') as { recordVersionId: string; source: 'agent'; sourceLabel: string; record: RecordInput }[];
export const fixtureSnapshot = mainSnapshot as GraphSnapshot;

/** Ingestion assigns record version IDs; every other fixture UUID maps through `entityId`. */
export type FixtureIds = { versionIds: ReadonlyMap<string, string>; entityId(fixtureId: string): string };
export type LarkspurSeed = {
  projectId: string;
  initialCommitId: string;
  /** The commit holding the fixture main snapshot. */
  seedCommitId: string;
  evidenceRevision: number;
  snapshot: GraphSnapshot;
  ids: FixtureIds;
  /** Fixture recordVersionId → ingested recordVersionId. */
  versionIds: Map<string, string>;
  /** Ingested recordVersionId → recordId. */
  recordIds: Map<string, string>;
  /** Ingested recordVersionId → fixture record input. */
  inputs: Map<string, RecordInput>;
  pendingVersionIds: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function rekeyFixture<T>(value: T, ids: FixtureIds): T {
  return JSON.parse(JSON.stringify(value), (_key, item) => typeof item === 'string' && UUID.test(item) ? ids.versionIds.get(item) ?? ids.entityId(item) : item) as T;
}
export async function headOf(db: Db, projectId: string): Promise<{ mainCommitId: string; evidenceRevision: number; snapshot: GraphSnapshot }> {
  const [row] = await db.select({ mainCommitId: projects.mainCommitId, evidenceRevision: projects.evidenceRevision, snapshot: graphCommits.snapshot }).from(projects)
    .innerJoin(graphCommits, eq(graphCommits.id, projects.mainCommitId)).where(eq(projects.id, projectId));
  return { mainCommitId: row.mainCommitId!, evidenceRevision: row.evidenceRevision, snapshot: row.snapshot };
}
export function ingestEnvelope(projectId: string, items: RecordInput[], idempotencyKey = randomUUID()): IngestEnvelope {
  return { projectId, source: 'agent', sourceLabel: items[0].sourceLabel, records: items as IngestEnvelope['records'], idempotencyKey };
}
const putOrder = ['loops', 'acts', 'annotations', 'recordDecisions'];
/**
 * Acts need their verbatim quote, which only the ingested bodies can supply.
 * mergeOperations validates every 100-operation batch on its own, so referenced entities come first: context, loops, acts, annotations, decisions.
 */
export function operationsBetween(before: GraphSnapshot, after: GraphSnapshot, bodies: ReadonlyMap<string, string>): GraphOperation[] {
  const contextFields = new Set<string>(), operations: GraphOperation[] = [];
  const rank = (op: GraphOperation) => op.op === 'set_context' ? -1 : op.op === 'put' ? putOrder.indexOf(op.collection) : 2 * putOrder.length - putOrder.indexOf(op.collection);
  for (const change of diffSnapshots(before, after).changes) {
    if (change.collection === 'context' || change.collection === 'people' || change.collection === 'departments' || change.collection === 'milestones') {
      const field = (change.collection === 'context' ? change.id : change.collection) as keyof GraphContext;
      if (!contextFields.has(field)) operations.push({ op: 'set_context', field, value: after.context[field] } as GraphOperation);
      contextFields.add(field);
    } else if (change.kind === 'removed') operations.push({ op: 'remove', collection: change.collection, id: change.id });
    else if (change.collection === 'acts') {
      const act = change.after as Act, body = bodies.get(act.citation.recordVersionId);
      if (body === undefined) throw new Error(`Seed act ${act.id} cites a record version that was not ingested`);
      operations.push({ op: 'put', collection: 'acts', value: act, quote: body.slice(act.citation.start, act.citation.end) });
    } else operations.push({ op: 'put', collection: change.collection, value: change.after } as GraphOperation);
  }
  return operations.sort((a, b) => rank(a) - rank(b));
}
/** Applies the operations through the normal proposal, review and merge path, in batches of at most 100. */
export async function mergeOperations(db: Db, ctx: ActorContext, projectId: string, operations: GraphOperation[], message = 'Merge operations', T = LARKSPUR_T): Promise<CommitReceipt> {
  const { mainCommitId, evidenceRevision } = await headOf(db, projectId);
  const proposal = await createProposal(db, ctx, { projectId, baseCommitId: mainCommitId, title: message.slice(0, 200), expectedEvidenceRevision: evidenceRevision, idempotencyKey: randomUUID() });
  let revision = 0;
  for (let index = 0; index < operations.length || revision === 0; index += 100) {
    await updateProposal(db, ctx, { projectId, proposalId: proposal.id, expectedProposalRevision: revision, expectedEvidenceRevision: evidenceRevision, operations: operations.slice(index, index + 100), idempotencyKey: randomUUID() });
    revision++;
  }
  const review = await reviewProposal(db, ctx, { projectId, proposalId: proposal.id, expectedMainCommitId: mainCommitId, expectedProposalRevision: revision, expectedEvidenceRevision: evidenceRevision, T });
  return mergeProposal(db, ctx, { projectId, proposalId: proposal.id, expectedMainCommitId: mainCommitId, expectedProposalRevision: revision, expectedEvidenceRevision: evidenceRevision, reviewDigest: review.digest, T, message, idempotencyKey: randomUUID() });
}

/**
 * Larkspur project: an initial commit with the fixture calendar, then one merge that adds people, departments, milestones and the main snapshot.
 * `per-project` re-keys fixture UUIDs by project so two sandboxes never share entity IDs; tests keep the fixture IDs to compare with gold directly.
 */
export async function seedLarkspur(db: Db, ctx: ActorContext, entityIds: 'fixture' | 'per-project' = 'fixture'): Promise<LarkspurSeed> {
  const initial: GraphSnapshot = { ...structuredClone(fixtureSnapshot), context: { ...structuredClone(fixtureSnapshot.context), people: [], departments: [], milestones: [] }, acts: [], loops: [], annotations: [], recordDecisions: [] };
  const project = await createProject(db, ctx, { title: SANDBOX_TITLE, clientName: projectFixture.larkspur.clientName, snapshot: initial });
  const versionIds = new Map<string, string>(), recordIds = new Map<string, string>(), inputs = new Map<string, RecordInput>();
  const ids: FixtureIds = { versionIds, entityId: entityIds === 'per-project' ? id => uuidFromKey(`${project.id}:${id}`) : id => id };
  for (let index = 0; index < larkspurRecords.length; index += 25) {
    const batch = larkspurRecords.slice(index, index + 25);
    const receipt = await ingestRecords(db, ctx, ingestEnvelope(project.id, batch.map(item => item.record)));
    receipt.items.forEach((item, position) => {
      if (item.decision === 'invalid') throw new Error(`Fixture record ${batch[position].recordVersionId} is invalid: ${JSON.stringify(item.errors)}`);
      versionIds.set(batch[position].recordVersionId, item.recordVersionId);
      recordIds.set(item.recordVersionId, item.recordId);
      inputs.set(item.recordVersionId, batch[position].record);
    });
  }
  const snapshot = rekeyFixture(fixtureSnapshot, ids);
  const bodies = new Map([...inputs].map(([id, input]) => [id, input.bodyText]));
  const receipt = await mergeOperations(db, ctx, project.id, operationsBetween(initial, snapshot, bodies), 'Seed Larkspur main snapshot');
  const pendingVersionIds = projectFixture.larkspur.pendingRecordVersionIds.map(id => versionIds.get(id)!);
  return { projectId: project.id, initialCommitId: project.mainCommitId, seedCommitId: receipt.commitId, evidenceRevision: receipt.evidenceRevision, snapshot, ids, versionIds, recordIds, inputs, pendingVersionIds };
}

/** Draft answers for the gold escalations; {act:<fixture id>} becomes an [act:<sandbox id>] marker. Gold stays the single source of claims and verdicts. */
const ESCALATION_ANSWERS: Record<string, string> = {
  'go-live-slip': 'Fundline did commit to go-live by 30 September {act:94f5c370-711a-4039-9e20-a02d1fd5e70d}. The slip was announced before that date: on 12 September Minh asked to move go-live to 15 October {act:fe8cb040-d525-4e8b-9009-a911e6098e6b}, and Sarah agreed the next morning {act:94e84396-211b-4c56-95bb-1464890069cc}.',
  'dynamics-scope': 'The evidence points both ways. Quang answered the phase 1 request with a hedge that the client could read as a yes {act:34ea80c9-52b5-4f2d-812d-7620d6929478}, while the statement of work schedules the Dynamics CRM sync for phase 2 {act:32ff2949-ea99-4272-94ba-9481ca5265b5}.',
  'sync-incident': 'The sync did drop 40 investors. Quang told Larkspur IT about it on 22 September, in the same message that asked Tom to renew the client secret {act:55e19ec6-af3e-4d9e-b2e0-aa6825a7bfb9}. The root cause report Daniel promised for 3 October never arrived {act:5e5b6b44-de1f-4701-8d3c-ff4e54e77328}.',
};

async function seedEscalations(db: Db, ctx: ActorContext, projectId: string, ids: FixtureIds): Promise<void> {
  for (const fixture of goldFixture.escalations) {
    const { mainCommitId, evidenceRevision } = await headOf(db, projectId);
    const escalation = await openEscalation(db, ctx, { projectId, complaint: fixture.complaint, idempotencyKey: randomUUID() });
    const claims: ClaimInput[] = fixture.claims.map(({ id, text, type, supportingActIds, contradictingActIds }) => rekeyFixture({ id, text, type, timeWindow: null, supportingActIds, contradictingActIds, openQuestions: [] }, ids));
    const answerText = ESCALATION_ANSWERS[fixture.key].replace(/\{act:([0-9a-f-]{36})\}/g, (_marker, id: string) => `[act:${rekeyFixture(id, ids)}]`);
    await saveEscalationAnalysis(db, ctx, { projectId, escalationId: escalation.id, graphCommitId: mainCommitId, expectedMainCommitId: mainCommitId, expectedEvidenceRevision: evidenceRevision, expectedAnalysisRevision: null, claims, answerText, idempotencyKey: randomUUID() });
  }
}

/**
 * SRD 3: the first sign-in copies the Larkspur demo into the new user's workspace inside the provisioning transaction.
 * History, the revert, the drafts and the escalation analyses go through the same domain paths a person uses, so the sandbox can never hold a state the app could not produce.
 */
export async function seedSandbox(tx: Tx, ctx: ActorContext & { kind: 'user' }): Promise<Project> {
  const db = joinTransaction(tx);
  const seed = await seedLarkspur(db, ctx, 'per-project');
  const { projectId, ids } = seed;
  const bodies = new Map([...seed.inputs].map(([id, input]) => [id, input.bodyText]));
  const commitIds = new Map<string, string>();
  let parent = seed.snapshot;
  for (const entry of historyFixture) {
    const expected = rekeyFixture(entry.snapshot as GraphSnapshot, ids);
    if (entry.kind === 'merge') commitIds.set(entry.key, (await mergeOperations(db, ctx, projectId, operationsBetween(parent, expected, bodies), entry.message)).commitId);
    else {
      const { mainCommitId, evidenceRevision } = await headOf(db, projectId), targetCommitId = commitIds.get(entry.targetKey!)!;
      const basis = { projectId, targetCommitId, expectedMainCommitId: mainCommitId, expectedEvidenceRevision: evidenceRevision, T: LARKSPUR_T };
      const preview = await previewRevert(db, ctx, basis);
      if (preview.conflicts.length) throw new Error(`Seed revert ${entry.key} conflicts: ${JSON.stringify(preview.conflicts.map(item => `${item.collection}/${item.id}`))}`);
      commitIds.set(entry.key, (await revertCommit(db, ctx, { ...basis, reviewDigest: preview.digest, message: entry.message, idempotencyKey: randomUUID() })).commitId);
    }
    if (canonicalHash((await headOf(db, projectId)).snapshot) !== canonicalHash(expected)) throw new Error(`Seed commit ${entry.key} does not reproduce the fixture history`);
    parent = expected;
  }
  const withdrawn = ids.versionIds.get(uuidFromKey(SANDBOX_WITHDRAWN_RECORD_KEY))!;
  await withdrawRecord(db, ctx, { projectId, recordId: seed.recordIds.get(withdrawn)!, expectedEvidenceRevision: (await headOf(db, projectId)).evidenceRevision, reason: 'Withdrawn at the source; the sandbox keeps the act to show unavailable evidence.', idempotencyKey: randomUUID() });
  const { mainCommitId, evidenceRevision } = await headOf(db, projectId);
  for (const fixture of proposalsFixture) {
    const proposal = await createProposal(db, ctx, { projectId, baseCommitId: mainCommitId, title: fixture.title, rationale: fixture.rationale, expectedEvidenceRevision: evidenceRevision, idempotencyKey: randomUUID() });
    await updateProposal(db, ctx, { projectId, proposalId: proposal.id, expectedProposalRevision: 0, expectedEvidenceRevision: evidenceRevision, operations: rekeyFixture(fixture.operations as GraphOperation[], ids), idempotencyKey: randomUUID() });
  }
  await seedEscalations(db, ctx, projectId, ids);
  return toProject(await requireProject(db, ctx, projectId));
}
