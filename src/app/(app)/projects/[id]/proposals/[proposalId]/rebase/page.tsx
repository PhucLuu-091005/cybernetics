import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema, type RebasePreview } from '../../../../../../../contracts';
import { ConflictBanner } from '../../../../../../../components/review/ConflictBanner';
import { capRecordIds, entityTitle, namesFrom, newestImage } from '../../../../../../../components/review/describe';
import { OmittedRecordsNote } from '../../../../../../../components/review/fields';
import { ProposalFrame } from '../../../../../../../components/review/ProposalFrame';
import { RebaseConflictView } from '../../../../../../../components/review/RebaseConflictView';
import { getApp } from '../../../../../../../server/app';
import { evaluationTime, resolveView } from '../../../../../../../server/domain/graph';
import { listProjects } from '../../../../../../../server/domain/projects';
import { getProposal, previewRebase } from '../../../../../../../server/domain/proposals';
import { readCitedRecords } from '../../../../../../../server/domain/records';
import { AppError } from '../../../../../../../server/errors';
import { diffSnapshots } from '../../../../../../../server/graph/diff';
import { notFoundOn, requireActor } from '../../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rebase · Promise Graph' };

export default async function RebasePage({ params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id, proposalId } = await params;
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(proposalId).success) notFound();
  const actor = await requireActor(`/projects/${id}/proposals/${proposalId}/rebase`);
  const db = getApp().db;
  const [proposal, projects, main] = await Promise.all([notFoundOn(getProposal(db, actor, { projectId: id, proposalId })), listProjects(db, actor), notFoundOn(resolveView(db, actor, id, { kind: 'main' }))]);
  const project = projects.find(item => item.id === id);
  if (!project) notFound();
  const href = `/projects/${id}/proposals/${proposal.id}`;

  let preview: RebasePreview | null = null, problem: string | null = null;
  if (proposal.status !== 'draft') problem = `This proposal is ${proposal.status}. Only a draft can be rebased.`;
  else {
    try {
      preview = await previewRebase(db, actor, { projectId: id, proposalId, expectedMainCommitId: main.project.mainCommitId, expectedProposalRevision: proposal.revision, expectedEvidenceRevision: main.project.evidenceRevision, T: evaluationTime(proposal.candidate) });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error;
      problem = 'Main, the draft or the evidence changed while the preview loaded. Reload the page.';
    }
  }

  let body: React.ReactNode = <ConflictBanner title="No rebase preview." message={problem} />;
  if (preview) {
    const base = preview.baseCommitId === main.project.mainCommitId ? main : await notFoundOn(resolveView(db, actor, id, { kind: 'commit', commitId: preview.baseCommitId }));
    const decisionIds = preview.conflicts.filter(conflict => conflict.collection === 'recordDecisions').map(conflict => conflict.id);
    const proposalChanges = diffSnapshots(base.snapshot, proposal.candidate).changes, mainChanges = diffSnapshots(base.snapshot, main.snapshot).changes;
    for (const change of [...proposalChanges, ...mainChanges]) if (change.collection === 'recordDecisions') decisionIds.push(change.id);
    const wanted = capRecordIds(decisionIds);
    const cited = await readCitedRecords(db, actor, { projectId: id, recordVersionIds: wanted.ids });
    const names = namesFrom([proposal.candidate, main.snapshot, base.snapshot], Object.fromEntries([...cited].map(([versionId, record]) => [versionId, record.title])));
    const conflicted = new Set(preview.conflicts.map(conflict => `${conflict.collection}/${conflict.id}`));
    const label = (changes: typeof proposalChanges) => changes.filter(change => !conflicted.has(`${change.collection}/${change.id}`)).map(change => entityTitle(change.collection, change.id, newestImage(change.after, change.before), names));
    body = (
      <>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12, maxWidth: '72ch' }}>Base <span className="id">{preview.baseCommitId.slice(0, 7)}</span>, main <span className="id">{preview.mainCommitId.slice(0, 7)}</span>, proposal revision {preview.proposalRevision}. One-sided changes are kept. {preview.conflicts.length ? `${preview.conflicts.length} ${preview.conflicts.length === 1 ? 'entity changed' : 'entities changed'} on both sides, so you choose.` : ''} Nothing is dropped and nothing is merged until a fresh review.</p>
        <OmittedRecordsNote omitted={wanted.omitted} />
        <RebaseConflictView key={preview.digest} projectId={id} preview={preview} names={names} kept={{ proposal: label(proposalChanges), main: label(mainChanges) }} />
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project</small></div>
        <span className="sp" />
        <Link className="btn" href={`${href}/review`}>Back to the review</Link>
      </header>
      <div className="screen">
        <div className="screen-head"><h1>Rebase onto current main</h1></div>
        <ProposalFrame projectId={id} proposal={proposal} mainCommitId={main.project.mainCommitId} evidenceRevision={main.project.evidenceRevision} viewerUserId={actor.userId} level={2} rebaseLink={false} />
        {body}
      </div>
    </>
  );
}
