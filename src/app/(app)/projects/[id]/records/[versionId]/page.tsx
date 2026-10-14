import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../../contracts';
import { RecordViewer } from '../../../../../../components/inbox/RecordViewer';
import { inboxHref } from '../../../../../../components/inbox/links';
import { getApp } from '../../../../../../server/app';
import { resolveView } from '../../../../../../server/domain/graph';
import { listProjects } from '../../../../../../server/domain/projects';
import { notFoundOn, requireActor } from '../../../../../../server/http/rsc';
import { loadViewedRecord } from '../viewed-record';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Record · Promise Graph' };

export default async function RecordPage({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const { id, versionId } = await params;
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(versionId).success) notFound();
  const actor = await requireActor(`/projects/${id}/records/${versionId}`);
  const db = getApp().db;
  const [main, projects] = await Promise.all([
    notFoundOn(resolveView(db, actor, id, { kind: 'main' })),
    listProjects(db, actor),
  ]);
  const project = projects.find((item) => item.id === id);
  if (!project) notFound();
  const { snapshot, project: head } = main;
  const timeZone = snapshot.context.timeZone;
  const { record, hints } = await loadViewedRecord(
    actor,
    id,
    versionId,
    timeZone,
    (hinted) => `/projects/${id}/records/${hinted}`,
  );
  const decision =
    snapshot.recordDecisions.find((item) => item.recordVersionId === versionId) ?? null;

  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>{project.title}</b>
          <small>
            {project.clientName} project, time zone {timeZone}
          </small>
        </div>
        <span className="sp" />
        <Link
          className="btn"
          href={inboxHref(id, { state: 'pending', proposal: null, r: versionId })}
        >
          Review in inbox
        </Link>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Record</h1>
          <p className="id" title={record.header}>
            {record.header}
          </p>
        </div>
        <div className="card pad" style={{ maxWidth: 900 }}>
          <RecordViewer
            projectId={id}
            record={record}
            state={null}
            decision={decision}
            hints={hints}
            proposalId={null}
            basis={{ mainCommitId: head.mainCommitId, evidenceRevision: head.evidenceRevision }}
          />
        </div>
      </div>
    </>
  );
}
