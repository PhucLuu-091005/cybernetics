import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Commit } from '../../../contracts';
import { AppError } from '../../errors';
import { graphCommits, projects } from '../../db/schema';
import { isId, toIso, type Db, type Tx } from '../../db/tx';

export type CommitInput = Omit<Commit, 'id' | 'createdAt'> & { workspaceId: string };
const toCommit = (row: typeof graphCommits.$inferSelect): Commit => ({
  id: row.id,
  projectId: row.projectId,
  sequence: row.sequence,
  parentId: row.parentId,
  snapshot: row.snapshot,
  snapshotHash: row.snapshotHash,
  actor: row.actor,
  message: row.message,
  createdAt: toIso(row.createdAt),
  kind: row.kind,
  proposalId: row.proposalId,
  targetCommitId: row.targetCommitId,
  reviewedEvidenceRevision: row.reviewedEvidenceRevision,
});

export async function loadCommit(
  db: Db | Tx,
  projectId: string,
  commitId: string,
): Promise<Commit> {
  const [row] =
    isId(projectId) && isId(commitId)
      ? await db
          .select()
          .from(graphCommits)
          .where(and(eq(graphCommits.projectId, projectId), eq(graphCommits.id, commitId)))
          .limit(1)
      : [];
  if (!row) throw new AppError('NOT_FOUND', 'Commit not found');
  return toCommit(row);
}
export async function insertCommit(tx: Tx, input: CommitInput): Promise<Commit> {
  const [row] = await tx
    .insert(graphCommits)
    .values({ id: randomUUID(), ...input })
    .returning();
  return toCommit(row);
}
export async function advanceMain(
  tx: Tx,
  projectId: string,
  expected: string,
  next: string,
): Promise<void> {
  const moved = await tx
    .update(projects)
    .set({ mainCommitId: next })
    .where(and(eq(projects.id, projectId), eq(projects.mainCommitId, expected)))
    .returning({ id: projects.id });
  if (!moved.length)
    throw new AppError('CONFLICT', 'Main moved since the expected commit', {
      details: { expectedMainCommitId: expected },
    });
}
