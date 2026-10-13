import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Act, ActorContext, CommitReceipt, GraphOperation, GraphSnapshot, Loop } from '../../src/contracts';
import { createProject, emptySnapshot } from '../../src/server/domain/projects';
import { createProposal, mergeProposal, reviewProposal, updateProposal } from '../../src/server/domain/proposals';
import { graphCommits, recordVersions } from '../../src/server/db/schema';
import type { Db } from '../../src/server/db/tx';
import { diffSnapshots } from '../../src/server/graph/diff';
import { projectRow } from './evidence';
import { T, body, ingestText, proposalIds, quote } from './proposals';

export const historyIds = {
  loopA: '60000000-0000-4000-8000-000000000001',
  loopB: '60000000-0000-4000-8000-000000000002',
  newLoop: '60000000-0000-4000-8000-000000000003',
  newAct: '60000000-0000-4000-8000-000000000004',
};
export const originalTitle = 'Original A';

export function historyLoop(id: string, title: string): Loop {
  return { id, title, customer: { kind: 'side', side: 'client' }, performer: { kind: 'side', side: 'vendor' }, performerDepartmentId: proposalIds.department, milestoneId: null };
}
export function historyAct(versionId: string, loopId: string | null, overrides: Partial<Act> = {}): Act {
  const start = body.indexOf(quote);
  return { id: historyIds.newAct, citation: { recordVersionId: versionId, start, end: start + quote.length }, type: 'request', actor: { kind: 'side', side: 'client' }, customer: { kind: 'side', side: 'client' }, performer: { kind: 'side', side: 'vendor' }, action: 'Confirm the go-live date', due: null, hedged: false, loopId, hidden: false, origin: 'human', confidence: null, ...overrides };
}
export async function seedHistoryProject(db: Db, ctx: ActorContext): Promise<{ projectId: string; mainId: string; versionId: string }> {
  const snapshot = emptySnapshot();
  snapshot.context.departments = [{ id: proposalIds.department, name: 'Delivery', side: 'vendor', order: 0 }];
  snapshot.loops = [historyLoop(historyIds.loopA, originalTitle), historyLoop(historyIds.loopB, 'Original B')];
  const project = await createProject(db, ctx, { title: 'History', clientName: 'Larkspur', snapshot });
  const versionId = await ingestText(db, ctx, project.id, body);
  return { projectId: project.id, mainId: project.mainCommitId, versionId };
}
/** Every act in these fixtures cites the shared seed body, so its quote is the cited slice. */
export function operationsBetween(before: GraphSnapshot, after: GraphSnapshot): GraphOperation[] {
  return diffSnapshots(before, after).changes.map((change): GraphOperation => {
    if (change.collection === 'people' || change.collection === 'departments' || change.collection === 'milestones') return { op: 'set_context', field: change.collection, value: after.context[change.collection] } as GraphOperation;
    if (change.collection === 'context') return { op: 'set_context', field: change.id, value: change.after } as GraphOperation;
    if (change.kind === 'removed') return { op: 'remove', collection: change.collection, id: change.id };
    if (change.collection === 'acts') {
      const act = change.after as Act;
      return { op: 'put', collection: 'acts', value: act, quote: body.slice(act.citation.start, act.citation.end) };
    }
    return { op: 'put', collection: change.collection, value: change.after } as GraphOperation;
  });
}
export async function mainState(db: Db, projectId: string): Promise<{ mainId: string; evidenceRevision: number; snapshot: GraphSnapshot }> {
  const project = await projectRow(db, projectId);
  const [commit] = await db.select().from(graphCommits).where(and(eq(graphCommits.projectId, projectId), eq(graphCommits.id, project.mainCommitId!)));
  return { mainId: commit.id, evidenceRevision: project.evidenceRevision, snapshot: commit.snapshot };
}
export async function mergeSnapshotChange(db: Db, ctx: ActorContext, projectId: string, mutate: (snapshot: GraphSnapshot) => void, message = 'Merge change'): Promise<CommitReceipt> {
  const { mainId, evidenceRevision, snapshot } = await mainState(db, projectId);
  const next = structuredClone(snapshot);
  mutate(next);
  const proposal = await createProposal(db, ctx, { projectId, baseCommitId: mainId, title: 'Change', expectedEvidenceRevision: evidenceRevision, idempotencyKey: randomUUID() });
  await updateProposal(db, ctx, { projectId, proposalId: proposal.id, expectedProposalRevision: 0, expectedEvidenceRevision: evidenceRevision, operations: operationsBetween(snapshot, next), idempotencyKey: randomUUID() });
  const review = await reviewProposal(db, ctx, { projectId, proposalId: proposal.id, expectedMainCommitId: mainId, expectedProposalRevision: 1, expectedEvidenceRevision: evidenceRevision, T });
  return mergeProposal(db, ctx, { projectId, proposalId: proposal.id, expectedMainCommitId: mainId, expectedProposalRevision: 1, expectedEvidenceRevision: evidenceRevision, reviewDigest: review.digest, T, message, idempotencyKey: randomUUID() });
}
export async function commitsIn(db: Db, projectId: string) {
  return db.select().from(graphCommits).where(eq(graphCommits.projectId, projectId)).orderBy(graphCommits.sequence);
}
export async function versionsIn(db: Db, projectId: string): Promise<number> {
  return (await db.select({ id: recordVersions.id }).from(recordVersions).where(eq(recordVersions.projectId, projectId))).length;
}
export async function recordIdOf(db: Db, versionId: string): Promise<string> {
  const [version] = await db.select({ recordId: recordVersions.recordId }).from(recordVersions).where(eq(recordVersions.id, versionId));
  return version.recordId;
}
