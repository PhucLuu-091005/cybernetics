import type { ActorContext, EngineInput, GraphSnapshot, Project, ViewSelection } from '../../../contracts';
import { AppError } from '../../errors';
import type { Db, Tx } from '../../db/tx';
import { requireProject } from '../access';
import { loadCommit } from '../commits/store';
import { toProject } from '../projects';
import { findProposal } from '../proposals/read';
import { loadRecordMetadata } from '../records/metadata';

export type ResolvedView = { project: Project; snapshot: GraphSnapshot; commitId: string | null; proposalId: string | null; proposalRevision: number | null };

export async function resolveView(db: Db | Tx, ctx: ActorContext, projectId: string, view: ViewSelection): Promise<ResolvedView> {
  const project = toProject(await requireProject(db, ctx, projectId));
  if (view.kind === 'proposal') {
    const row = await findProposal(db, project.id, view.proposalId, false);
    if (row.revision !== view.proposalRevision) throw new AppError('CONFLICT', 'Proposal changed since the selected revision', { details: { actualProposalRevision: row.revision, status: row.status } });
    return { project, snapshot: row.candidate, commitId: null, proposalId: row.id, proposalRevision: row.revision };
  }
  const commit = await loadCommit(db, project.id, view.kind === 'commit' ? view.commitId : project.mainCommitId);
  return { project, snapshot: commit.snapshot, commitId: commit.id, proposalId: null, proposalRevision: null };
}

export function evaluationTime(snapshot: GraphSnapshot, explicit?: string): string {
  return explicit ?? snapshot.context.asOfOverride ?? new Date().toISOString();
}

/** Every cited version is loaded, including ones after T and hidden acts, because the engine rejects a citation without metadata; withdrawn versions arrive with a null body so every view masks them. */
export async function hydrateEngineInput(db: Db | Tx, projectId: string, snapshot: GraphSnapshot, T: string): Promise<EngineInput> {
  const metadata = await loadRecordMetadata(db, projectId, snapshot.acts.map(act => act.citation.recordVersionId));
  return { snapshot, T, records: [...metadata.values()].map(({ recordVersionId, occurredAt, bodyText, digest, withdrawn, quotedRanges }) => ({ recordVersionId, occurredAt, bodyText, digest, withdrawn, quotedRanges })) };
}
