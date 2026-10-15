import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { IdSchema, type EscalationAnalysis, type GraphSnapshot } from '../../../../../../contracts';
import { AnswerDraft } from '../../../../../../components/escalations/AnswerDraft';
import { actorLabel, type CitedAct } from '../../../../../../components/escalations/CitationChip';
import { ClaimList } from '../../../../../../components/escalations/ClaimList';
import { renderMarkers } from '../../../../../../components/escalations/markers';
import {
  ACT_LABEL,
  partyName,
  shortDay,
  shortStamp,
  type Directory,
} from '../../../../../../components/graph/labels';
import { capRecordIds } from '../../../../../../components/review/describe';
import { getApp } from '../../../../../../server/app';
import { getEscalation } from '../../../../../../server/domain/escalations';
import { resolveView } from '../../../../../../server/domain/graph';
import { readCitedRecords, type CitedRecord } from '../../../../../../server/domain/records';
import { notFoundOn, requireActor } from '../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Escalation · Promise Graph' };

function citedActIds(analysis: EscalationAnalysis): string[] {
  const ids = analysis.claims.flatMap((claim) => [
    ...claim.supportingActIds,
    ...claim.contradictingActIds,
  ]);
  for (const part of renderMarkers(analysis.answerText))
    if (part.kind === 'act') ids.push(part.actId);
  return [...new Set(ids)];
}

/** Citations resolve against the pinned commit, so a chip shows the act the analysis cited even after main changed it. */
function resolveActs(
  ids: string[],
  snapshot: GraphSnapshot,
  records: Map<string, CitedRecord>,
  graphHref: string,
): Record<string, CitedAct> {
  const acts = new Map(snapshot.acts.map((act) => [act.id, act]));
  const directory: Directory = {
    people: new Map(snapshot.context.people.map((person) => [person.id, person])),
    departments: new Map(
      snapshot.context.departments.map((department) => [department.id, department]),
    ),
  };
  const timeZone = snapshot.context.timeZone,
    resolved: Record<string, CitedAct> = {};
  for (const id of ids) {
    const act = acts.get(id);
    if (!act) continue;
    const record = records.get(act.citation.recordVersionId);
    const name = partyName(act.actor, directory),
      type = ACT_LABEL[act.type].toLowerCase();
    const quote = record?.bodyText?.slice(act.citation.start, act.citation.end) ?? null;
    resolved[id] = {
      actId: id,
      quote,
      chip: record
        ? `${name}, ${shortDay(record.occurredAt, timeZone)}: ${type}`
        : `${name}: ${type}`,
      plain: record
        ? `${name}, ${shortDay(record.occurredAt, timeZone, true)}, ${type}`
        : `${name}, ${type}`,
      title: `${name}${record ? `, ${shortStamp(record.occurredAt, timeZone)}` : ''}: ${quote ?? 'the cited record is unavailable'}`,
      href: act.loopId ? `${graphHref}&loop=${act.loopId}` : graphHref,
    };
  }
  return resolved;
}

export default async function EscalationPage({
  params,
}: {
  params: Promise<{ id: string; escalationId: string }>;
}) {
  const { id, escalationId } = await params;
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(escalationId).success) notFound();
  const actor = await requireActor(`/projects/${id}/escalations/${escalationId}`);
  const db = getApp().db;
  const [main, read] = await Promise.all([
    notFoundOn(resolveView(db, actor, id, { kind: 'main' })),
    notFoundOn(getEscalation(db, actor, { projectId: id, escalationId })),
  ]);
  const { project } = main,
    timeZone = main.snapshot.context.timeZone;
  const latest = read.analyses[0] ?? null;
  let acts: Record<string, CitedAct> = {};
  if (latest) {
    const pinned = await notFoundOn(
      resolveView(db, actor, id, { kind: 'commit', commitId: latest.graphCommitId }),
    );
    const ids = citedActIds(latest),
      byId = new Map(pinned.snapshot.acts.map((act) => [act.id, act]));
    const records = await readCitedRecords(db, actor, {
      projectId: id,
      recordVersionIds: capRecordIds(
        ids.flatMap((actId) => byId.get(actId)?.citation.recordVersionId ?? []),
      ).ids,
    });
    acts = resolveActs(
      ids,
      pinned.snapshot,
      records,
      `/projects/${id}/graph?escalation=${escalationId}`,
    );
  }
  const { escalation } = read;
  const approval = latest?.approval;

  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>{project.title}</b>
          <small>
            {project.clientName} project, time zone {timeZone}
          </small>
        </div>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Escalation</h1>
          <Link className="lnk" href={`/projects/${id}/escalations`}>
            All escalations
          </Link>
          {latest && (
            <Link className="lnk" href={`/projects/${id}/graph?escalation=${escalationId}`}>
              Show cited loops in the graph
            </Link>
          )}
        </div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <section className="card pad stack" aria-labelledby="complaint-head">
              <div className="row">
                <h2 id="complaint-head">Complaint</h2>
                <span className="faint" style={{ fontSize: 12 }}>
                  opened by {actorLabel(escalation.author, actor.userId)},{' '}
                  {shortStamp(escalation.createdAt, timeZone)}
                </span>
              </div>
              <p
                className="quote"
                style={{ fontSize: 17, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                data-testid="complaint"
              >
                “{escalation.complaint}”
              </p>
            </section>
            {latest ? (
              <ClaimList claims={latest.claims} acts={acts} />
            ) : (
              <p className="card pad faint" style={{ fontSize: 13 }}>
                No analysis yet. Ask your agent to call save_escalation_analysis with a token that
                has the escalations:write scope. The app never runs an analysis itself.
              </p>
            )}
          </div>
          <div className="stack">
            {latest && (
              <AnswerDraft
                projectId={id}
                escalationId={escalationId}
                complaint={escalation.complaint}
                acts={acts}
                stale={read.stale}
                basis={{ mainCommitId: read.mainCommitId, evidenceRevision: read.evidenceRevision }}
                analysis={{
                  id: latest.id,
                  revision: latest.revision,
                  graphCommitId: latest.graphCommitId,
                  evidenceRevision: latest.evidenceRevision,
                  answerText: latest.answerText,
                  contentHash: latest.contentHash,
                }}
                authorLabel={actorLabel(latest.author, actor.userId)}
                approvalLabel={
                  approval
                    ? `Approved by ${actorLabel(approval.actor, actor.userId)}, ${shortStamp(approval.approvedAt, timeZone)}.`
                    : null
                }
              />
            )}
            {read.analyses.length > 0 && (
              <section className="card pad" aria-labelledby="revisions-head">
                <h3 id="revisions-head" style={{ marginBottom: 6 }}>
                  Analysis history
                </h3>
                <ol
                  className="plain-list"
                  aria-label="Analysis history"
                  style={{ listStyle: 'none', paddingLeft: 0 }}
                >
                  {read.analyses.map((analysis, index) => (
                    <li key={analysis.id}>
                      {shortStamp(analysis.createdAt, timeZone)} by{' '}
                      {actorLabel(analysis.author, actor.userId)}: {analysis.claims.length}{' '}
                      {analysis.claims.length === 1 ? 'claim' : 'claims'}
                      {index === 0 ? ', latest' : ''}
                      {analysis.approval ? ', approved' : ''}
                    </li>
                  ))}
                </ol>
                {read.nextCursor && (
                  <p className="faint" style={{ fontSize: 12 }}>
                    Older analyses exist. This list shows the newest page.
                  </p>
                )}
                <details className="tech">
                  <summary>Technical details</summary>
                  <dl className="kv">
                    {read.analyses.map((analysis) => (
                      <Fragment key={analysis.id}>
                        <dt>Revision {analysis.revision}</dt>
                        <dd>
                          graph version <span className="id">{analysis.graphCommitId}</span>,
                          evidence revision {analysis.evidenceRevision}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                </details>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
