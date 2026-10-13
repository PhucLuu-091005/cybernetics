import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../contracts';
import { shortStamp } from '../../../../../components/graph/labels';
import { CreateProposalForm } from '../../../../../components/review/CreateProposalForm';
import { AuthorBadge } from '../../../../../components/review/ProposalFrame';
import { getApp } from '../../../../../server/app';
import { resolveView } from '../../../../../server/domain/graph';
import { listProjects } from '../../../../../server/domain/projects';
import { listProposals } from '../../../../../server/domain/proposals';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Proposals · Promise Graph' };
const STATUS_ORDER = { draft: 0, merged: 1, closed: 2 } as const;

export default async function ProposalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/proposals`);
  const db = getApp().db;
  const [main, projects, page] = await Promise.all([notFoundOn(resolveView(db, actor, id, { kind: 'main' })), listProjects(db, actor), notFoundOn(listProposals(db, actor, { projectId: id }))]);
  const project = projects.find(item => item.id === id);
  if (!project) notFound();
  const { mainCommitId, evidenceRevision } = main.project, timeZone = main.snapshot.context.timeZone;
  const proposals = [...page.items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project, time zone {timeZone}</small></div>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Proposals</h1>
          <p>A proposal is a draft copy of the graph. Edits, inbox decisions and agent submissions go into drafts. Main changes only when a person reviews a draft and merges it.</p>
        </div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <section className="tablewrap" aria-labelledby="proposal-list">
            <h2 id="proposal-list" className="sr">All proposals</h2>
            <table>
              <thead><tr><th>Title</th><th>Status</th><th>Author</th><th>Revision</th><th>Base</th><th>Updated</th></tr></thead>
              <tbody>
                {proposals.map(proposal => (
                  <tr key={proposal.id}>
                    <td><Link className="lnk" href={`/projects/${id}/proposals/${proposal.id}`}>{proposal.title}</Link></td>
                    <td><span className={proposal.status === 'draft' ? 'badge b-draft' : 'badge'}>{proposal.status}</span></td>
                    <td><AuthorBadge author={proposal.author} viewerUserId={actor.userId} prefix="By" /></td>
                    <td>{proposal.revision}</td>
                    <td>{proposal.status !== 'draft' ? <span className="faint">n/a</span> : proposal.baseCommitId === mainCommitId ? 'current main' : <span className="warn">stale, rebase needed</span>}</td>
                    <td className="faint">{shortStamp(proposal.updatedAt, timeZone)}</td>
                  </tr>
                ))}
                {proposals.length === 0 && <tr><td colSpan={6} className="faint">No proposals yet.</td></tr>}
              </tbody>
            </table>
            {page.nextCursor && <p className="faint" style={{ fontSize: 12, padding: '6px 10px' }}>Older proposals exist; this list shows the newest page.</p>}
          </section>
          <CreateProposalForm projectId={id} basis={{ mainCommitId, evidenceRevision }} />
        </div>
      </div>
    </>
  );
}
