import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import records from '../../fixtures/records.json';
import mainSnapshot from '../../fixtures/main-snapshot.json';
import projectFixture from '../../fixtures/project.json';
import type { ActorContext, CommitReceipt, GraphOperation, GraphSnapshot, IngestEnvelope, RecordInput } from '../../src/contracts';
import { createProject, emptySnapshot } from '../../src/server/domain/projects';
import { createProposal, mergeProposal, reviewProposal, updateProposal } from '../../src/server/domain/proposals';
import { ingestRecords } from '../../src/server/domain/records';
import { graphCommits, projects } from '../../src/server/db/schema';
import type { Db } from '../../src/server/db/tx';

export const larkspurT = '2026-10-09T18:00:00+07:00';
export const larkspurRecords = records.filter(item => item.projectKey === 'larkspur') as { recordVersionId: string; source: 'agent'; sourceLabel: string; record: RecordInput }[];
export const fixtureSnapshot = mainSnapshot as GraphSnapshot;
export type LarkspurSeed = {
  projectId: string;
  initialCommitId: string;
  /** The commit holding the fixture main snapshot. */
  seedCommitId: string;
  evidenceRevision: number;
  snapshot: GraphSnapshot;
  /** Fixture recordVersionId → ingested recordVersionId. */
  versionIds: Map<string, string>;
  /** Ingested recordVersionId → recordId. */
  recordIds: Map<string, string>;
  /** Ingested recordVersionId → fixture record input. */
  inputs: Map<string, RecordInput>;
  pendingVersionIds: string[];
};

/** Fixture IDs are hashes of story keys; ingest assigns new ones, so every recordVersionId is rewritten through the map. */
export function rekey<T>(value: T, versionIds: Map<string, string>): T {
  return JSON.parse(JSON.stringify(value), (key, item) => key === 'recordVersionId' && typeof item === 'string' ? versionIds.get(item) ?? item : item) as T;
}
export async function headOf(db: Db, projectId: string): Promise<{ mainCommitId: string; evidenceRevision: number; snapshot: GraphSnapshot }> {
  const [row] = await db.select({ mainCommitId: projects.mainCommitId, evidenceRevision: projects.evidenceRevision, snapshot: graphCommits.snapshot }).from(projects)
    .innerJoin(graphCommits, eq(graphCommits.id, projects.mainCommitId)).where(eq(projects.id, projectId));
  return { mainCommitId: row.mainCommitId!, evidenceRevision: row.evidenceRevision, snapshot: row.snapshot };
}
export function ingestEnvelope(projectId: string, items: RecordInput[], idempotencyKey = randomUUID()): IngestEnvelope {
  return { projectId, source: 'agent', sourceLabel: items[0].sourceLabel, records: items as IngestEnvelope['records'], idempotencyKey };
}
/** Applies the operations through the normal proposal, review and merge path, in batches of at most 100. */
export async function mergeOperations(db: Db, ctx: ActorContext, projectId: string, operations: GraphOperation[], message = 'Merge operations', T = larkspurT): Promise<CommitReceipt> {
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

/** Larkspur project: an initial commit with the fixture calendar, people and departments, then one merge that adds the fixture main snapshot. */
export async function seedLarkspur(db: Db, ctx: ActorContext): Promise<LarkspurSeed> {
  const { people, departments, milestones, ...calendar } = fixtureSnapshot.context;
  const initial = emptySnapshot();
  initial.context = { ...initial.context, ...calendar, people, departments, milestones: [] };
  const project = await createProject(db, ctx, { title: projectFixture.larkspur.title, clientName: projectFixture.larkspur.clientName, snapshot: initial });
  const versionIds = new Map<string, string>(), recordIds = new Map<string, string>(), inputs = new Map<string, RecordInput>();
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
  const snapshot = rekey(fixtureSnapshot, versionIds);
  const bodies = new Map([...inputs].map(([id, input]) => [id, input.bodyText]));
  const operations: GraphOperation[] = [
    { op: 'set_context', field: 'milestones', value: milestones },
    ...snapshot.loops.map((value): GraphOperation => ({ op: 'put', collection: 'loops', value })),
    ...snapshot.acts.map((value): GraphOperation => ({ op: 'put', collection: 'acts', value, quote: bodies.get(value.citation.recordVersionId)!.slice(value.citation.start, value.citation.end) })),
    ...snapshot.recordDecisions.map((value): GraphOperation => ({ op: 'put', collection: 'recordDecisions', value })),
  ];
  const receipt = await mergeOperations(db, ctx, project.id, operations, 'Seed Larkspur main snapshot');
  const pendingVersionIds = projectFixture.larkspur.pendingRecordVersionIds.map(id => versionIds.get(id)!);
  return { projectId: project.id, initialCommitId: project.mainCommitId, seedCommitId: receipt.commitId, evidenceRevision: receipt.evidenceRevision, snapshot, versionIds, recordIds, inputs, pendingVersionIds };
}
