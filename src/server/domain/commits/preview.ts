import type { z } from 'zod';
import { EntityCollectionSchema, IdSchema, PreviewRevertInputSchema, RevertCommitInputSchema, type ActorContext, type Commit, type CommitPreview, type CommitReceipt, type Conflict, type FieldError, type GraphSnapshot } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { actorKey, withReceipt } from '../../db/receipts';
import { lockProject, withTransaction, type Db, type ProjectRow, type Tx } from '../../db/tx';
import { diffSnapshots } from '../../graph/diff';
import { entityAt } from '../../graph/rebase';
import { citedVersionIds, validateSnapshot } from '../../graph/validate';
import { requireScope } from '../../http/scopes';
import { actorReference, requireProject } from '../access';
import { toProject } from '../projects';
import { assertValidCandidate } from '../proposals/update';
import { invalid, loadRecordMetadata } from '../records/metadata';
import { advanceMain, insertCommit, loadCommit } from './store';

export type CommitCandidate = { snapshot: GraphSnapshot | null; conflicts: Conflict[] };
export type CommitOperation = { kind: 'revert' | 'restore'; compute(db: Db | Tx, projectId: string, target: Commit, main: Commit): Promise<CommitCandidate> };
type Prepared = { target: Commit; main: Commit; candidate: GraphSnapshot | null; blocking: Conflict[]; conflicts: Conflict[]; digest: string; evidenceRevision: number };
export const WITHDRAWN_REASON = 'Cites withdrawn evidence; resolve it in a proposal first';

export function assertExpectedHead(projectRow: ProjectRow, expected: { mainCommitId: string; evidenceRevision: number }): void {
  const { mainCommitId, evidenceRevision } = toProject(projectRow);
  if (expected.mainCommitId !== mainCommitId || expected.evidenceRevision !== evidenceRevision) throw new AppError('CONFLICT', 'Main or evidence changed since the expected values', { details: { actualMainCommitId: mainCommitId, actualEvidenceRevision: evidenceRevision } });
}
export async function parentOf(db: Db | Tx, projectId: string, target: Commit): Promise<Commit> {
  if (target.kind === 'initial' || target.parentId === null) throw new AppError('VALIDATION', 'The initial commit cannot be reverted', { errors: [{ path: 'targetCommitId', message: 'Choose a commit that has a parent' }] });
  return loadCommit(db, projectId, target.parentId);
}

/** Validation errors become per-entity conflicts so a preview shows what blocks the apply before anyone tries it. */
function validationConflicts(errors: FieldError[], main: GraphSnapshot, candidate: GraphSnapshot): Conflict[] {
  const conflicts = new Map<string, Conflict>();
  for (const error of errors) {
    const [root, id] = error.path.split('.');
    const collection = EntityCollectionSchema.safeParse(root);
    const located = collection.success && collection.data !== 'context' && IdSchema.safeParse(id).success;
    const reason = /withdrawn record version/.test(error.message) ? WITHDRAWN_REASON : error.message;
    const key = located ? `${root}/${id}` : `context/${error.path || 'snapshot'}`;
    const previous = conflicts.get(key);
    if (previous) { if (!previous.reason.includes(reason)) previous.reason += ` ${reason}`; continue; }
    conflicts.set(key, located && collection.success
      ? { collection: collection.data, id, base: null, main: structuredClone(entityAt(main, collection.data, id)), proposed: structuredClone(entityAt(candidate, collection.data, id)), reason }
      : { collection: 'context', id: error.path || 'snapshot', base: null, main: null, proposed: null, reason });
  }
  return [...conflicts.values()];
}

async function prepare(db: Db | Tx, projectRow: ProjectRow, operation: CommitOperation, input: { targetCommitId: string; expectedMainCommitId: string; expectedEvidenceRevision: number }): Promise<Prepared> {
  assertExpectedHead(projectRow, { mainCommitId: input.expectedMainCommitId, evidenceRevision: input.expectedEvidenceRevision });
  const { id: projectId, mainCommitId, evidenceRevision } = toProject(projectRow);
  const target = await loadCommit(db, projectId, input.targetCommitId);
  const main = await loadCommit(db, projectId, mainCommitId);
  const { snapshot: candidate, conflicts: blocking } = await operation.compute(db, projectId, target, main);
  const invalidEntities = candidate ? validationConflicts(validateSnapshot(candidate, await loadRecordMetadata(db, projectId, citedVersionIds(candidate)), main.snapshot), main.snapshot, candidate) : [];
  const digest = canonicalHash({ kind: operation.kind, targetCommitId: target.id, mainCommitId: main.id, evidenceRevision, candidateHash: candidate ? canonicalHash(candidate) : null });
  return { target, main, candidate, blocking, conflicts: [...blocking, ...invalidEntities], digest, evidenceRevision };
}

export async function previewCommit(db: Db, ctx: ActorContext, operation: CommitOperation, raw: z.input<typeof PreviewRevertInputSchema>): Promise<CommitPreview> {
  requireScope(ctx, 'project:read');
  const parsed = PreviewRevertInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid(`Invalid ${operation.kind} preview`, parsed.error);
  const input = parsed.data;
  return db.transaction(async tx => {
    const projectRow = await requireProject(tx, ctx, input.projectId);
    const { target, main, candidate, conflicts, digest, evidenceRevision } = await prepare(tx, projectRow, operation, input);
    return {
      projectId: projectRow.id, kind: operation.kind, targetCommitId: target.id, mainCommitId: main.id, evidenceRevision, T: input.T, digest,
      candidate, conflicts, diff: candidate ? diffSnapshots(main.snapshot, candidate) : { changes: [] }, requestId: ctx.requestId,
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

export async function applyCommit(db: Db, ctx: ActorContext, operation: CommitOperation, raw: z.input<typeof RevertCommitInputSchema>): Promise<CommitReceipt> {
  requireScope(ctx, 'graph:merge');
  const parsed = RevertCommitInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid(`Invalid ${operation.kind}`, parsed.error);
  const input = parsed.data;
  return withTransaction(db, async tx => {
    const projectRow = await lockProject(tx, ctx, input.projectId);
    return withReceipt(tx, { projectId: projectRow.id, actorKey: actorKey(ctx), operation: `${operation.kind}_commit`, idempotencyKey: input.idempotencyKey, input }, async () => {
      const { target, main, candidate, blocking, digest, evidenceRevision } = await prepare(tx, projectRow, operation, input);
      if (digest !== input.reviewDigest) throw new AppError('CONFLICT', `Preview digest does not match the current ${operation.kind} inputs; preview again`, { details: { actualMainCommitId: main.id, actualEvidenceRevision: evidenceRevision } });
      if (blocking.length || !candidate) throw new AppError('CONFLICT', `The ${operation.kind} conflicts with later changes; resolve it in a proposal`, { details: { actualMainCommitId: main.id, conflicts: blocking } });
      await assertValidCandidate(tx, projectRow.id, candidate, new Map(), main.snapshot, `The ${operation.kind} result is invalid`);
      const snapshotHash = canonicalHash(candidate);
      const commit = await insertCommit(tx, {
        workspaceId: projectRow.workspaceId, projectId: projectRow.id, sequence: main.sequence + 1, parentId: main.id, snapshot: candidate, snapshotHash, actor: actorReference(ctx),
        message: input.message, kind: operation.kind, proposalId: null, targetCommitId: target.id, reviewedEvidenceRevision: evidenceRevision,
      });
      await advanceMain(tx, projectRow.id, main.id, commit.id);
      return { projectId: projectRow.id, commitId: commit.id, parentCommitId: main.id, sequence: commit.sequence, snapshotHash, evidenceRevision, kind: operation.kind, proposalId: null, targetCommitId: target.id, idempotencyKey: input.idempotencyKey, requestId: ctx.requestId };
    });
  });
}
