import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../contracts';
import { actorLabel } from '../../../../../components/escalations/CitationChip';
import { ComplaintForm } from '../../../../../components/escalations/ComplaintForm';
import { shortStamp } from '../../../../../components/graph/labels';
import { getApp } from '../../../../../server/app';
import { listEscalations } from '../../../../../server/domain/escalations';
import { getProject } from '../../../../../server/domain/graph';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Escalations · Promise Graph' };
const EXCERPT = 160;

export default async function EscalationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/escalations`);
  const db = getApp().db;
  const [{ project, context }, page] = await Promise.all([notFoundOn(getProject(db, actor, { projectId: id })), notFoundOn(listEscalations(db, actor, { projectId: id }))]);

  return (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project, time zone {context.timeZone}</small></div>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Escalations</h1>
          <p>Open a client complaint, then let your agent save claims, cited acts and an answer draft. The app derives each verdict from the cited acts, marks an analysis stale when main or the evidence moves, and never sends the answer.</p>
        </div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <section className="tablewrap" aria-labelledby="escalation-list">
            <h2 id="escalation-list" className="sr">All escalations</h2>
            <table>
              <thead><tr><th>Complaint</th><th>Opened by</th><th>Opened</th><th>Analysis</th></tr></thead>
              <tbody>
                {page.items.map(escalation => (
                  <tr key={escalation.id}>
                    <td><Link className="lnk" href={`/projects/${id}/escalations/${escalation.id}`}>{escalation.complaint.length > EXCERPT ? `${escalation.complaint.slice(0, EXCERPT)}…` : escalation.complaint}</Link></td>
                    <td>{actorLabel(escalation.author, actor.userId)}</td>
                    <td className="faint">{shortStamp(escalation.createdAt, context.timeZone)}</td>
                    <td>{escalation.latestAnalysisRevision === null ? <span className="faint">no analysis yet</span> : `revision ${escalation.latestAnalysisRevision}`}</td>
                  </tr>
                ))}
                {page.items.length === 0 && <tr><td colSpan={4} className="faint">No complaints yet.</td></tr>}
              </tbody>
            </table>
            {page.nextCursor && <p className="faint" style={{ fontSize: 12, padding: '6px 10px' }}>Older complaints exist; this list shows the newest page.</p>}
          </section>
          <ComplaintForm projectId={id} />
        </div>
      </div>
    </>
  );
}
