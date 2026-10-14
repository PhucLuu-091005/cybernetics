import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema, type Act } from '../../../../../../contracts';
import { GraphScreen } from '../../../../../../components/graph/GraphScreen';
import { parseFilters } from '../../../../../../components/graph/filters';
import { shortStamp } from '../../../../../../components/graph/labels';
import { parseCite } from '../../../../../../components/inbox/selection';
import type { CitedText } from '../../../../../../components/review/ActEditor';
import {
  capRecordIds,
  changeItems,
  namesFrom,
  proposalHighlights,
} from '../../../../../../components/review/describe';
import { OmittedRecordsNote } from '../../../../../../components/review/fields';
import { ProposalFrame } from '../../../../../../components/review/ProposalFrame';
import { ProposalWorkspace } from '../../../../../../components/review/ProposalWorkspace';
import { getApp } from '../../../../../../server/app';
import { getGraphView, resolveView } from '../../../../../../server/domain/graph';
import { listProjects } from '../../../../../../server/domain/projects';
import { getProposal } from '../../../../../../server/domain/proposals';
import { readCitedRecords } from '../../../../../../server/domain/records';
import { diffSnapshots } from '../../../../../../server/graph/diff';
import { notFoundOn, requireActor } from '../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Proposal · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; proposalId: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ id, proposalId }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(proposalId).success) notFound();
  const actor = await requireActor(`/projects/${id}/proposals/${proposalId}`);
  const db = getApp().db;
  const [proposal, projects] = await Promise.all([
    notFoundOn(getProposal(db, actor, { projectId: id, proposalId })),
    listProjects(db, actor),
  ]);
  const project = projects.find((item) => item.id === id);
  if (!project) notFound();
  const [view, base] = await Promise.all([
    notFoundOn(
      getGraphView(db, actor, {
        projectId: id,
        view: { kind: 'proposal', proposalId, proposalRevision: proposal.revision },
      }),
    ),
    notFoundOn(resolveView(db, actor, id, { kind: 'commit', commitId: proposal.baseCommitId })),
  ]);
  const candidate = proposal.candidate,
    timeZone = candidate.context.timeZone;
  const changes = diffSnapshots(base.snapshot, candidate).changes;
  const cite =
    proposal.status === 'draft' ? parseCite(typeof raw.cite === 'string' ? raw.cite : null) : null;

  const changedActs = new Map(
    changes
      .filter((change) => change.collection === 'acts' && change.after !== null)
      .map((change) => [change.id, change.after as Act]),
  );
  const wanted = capRecordIds([
    ...(cite ? [cite.recordVersionId] : []),
    ...[...changedActs.values()].map((act) => act.citation.recordVersionId),
    ...changes
      .filter((change) => change.collection === 'recordDecisions')
      .map((change) => change.id),
  ]);
  const cited = await readCitedRecords(db, actor, { projectId: id, recordVersionIds: wanted.ids });
  // A citation from another project or a missing version never reaches the editor.
  const usableCite = cite && cited.has(cite.recordVersionId) ? cite : null;
  const records: Record<string, CitedText> = Object.fromEntries(
    [...cited].map(([versionId, record]) => [
      versionId,
      {
        title: record.title,
        author: record.author,
        when: `${shortStamp(record.occurredAt, timeZone)} ${timeZone}`,
        text: record.bodyText,
        quotedRanges: record.quotedRanges,
      },
    ]),
  );
  const names = namesFrom(
    [candidate, base.snapshot],
    Object.fromEntries([...cited].map(([versionId, record]) => [versionId, record.title])),
  );
  const highlights = proposalHighlights(changes);
  const citeAuthor = usableCite ? cited.get(usableCite.recordVersionId)?.author : undefined;
  const citeActor = citeAuthor
    ? (candidate.context.people.find(
        (person) => person.name === citeAuthor && person.side !== 'unknown',
      )?.id ?? null)
    : null;
  const href = `/projects/${id}/proposals/${proposal.id}`;
  const basis = { mainCommitId: view.mainCommitId, evidenceRevision: view.evidenceRevision };

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
        <Link className="btn" href={`/projects/${id}/proposals`}>
          All proposals
        </Link>
      </header>
      <div className="screen" style={{ paddingBottom: 0 }}>
        <ProposalFrame
          projectId={id}
          proposal={proposal}
          mainCommitId={view.mainCommitId}
          evidenceRevision={view.evidenceRevision}
          viewerUserId={actor.userId}
          actions={
            <>
              <Link
                className="btn"
                href={`/projects/${id}/graph?${new URLSearchParams({ proposal: proposal.id, rev: String(proposal.revision) }).toString()}`}
              >
                Open in graph view
              </Link>
              <Link className="btn btn-draft" href={`${href}/review`}>
                Review changes
              </Link>
            </>
          }
        >
          <ProposalWorkspace
            projectId={id}
            target={{
              kind: 'proposal',
              basis,
              proposalId: proposal.id,
              revision: proposal.revision,
              status: proposal.status,
            }}
            changes={changeItems(changes, names)}
            acts={Object.fromEntries(changedActs)}
            citations={candidate.acts.map((act) => ({
              id: act.id,
              hidden: act.hidden,
              recordVersionId: act.citation.recordVersionId,
            }))}
            records={records}
            decisions={Object.fromEntries(
              candidate.recordDecisions.map((decision) => [
                decision.recordVersionId,
                decision.disposition,
              ]),
            )}
            loops={[...candidate.loops].sort((a, b) => a.title.localeCompare(b.title))}
            people={candidate.context.people}
            departments={candidate.context.departments}
            milestones={candidate.context.milestones}
            cite={usableCite}
            citeActor={citeActor}
          />
        </ProposalFrame>
        <OmittedRecordsNote omitted={wanted.omitted} />
        {cite && !usableCite && (
          <p className="bad" style={{ fontSize: 13 }}>
            The citation in the link does not name a record of this project, so the editor ignores
            it.
          </p>
        )}
        <h2 style={{ margin: '6px 0 4px', fontSize: 14 }}>
          Candidate graph at T = {shortStamp(view.T, timeZone)}{' '}
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            violet halo marks changed loops
          </span>
        </h2>
      </div>
      <GraphScreen
        key={`candidate-${proposal.id}-${view.T}`}
        projectId={id}
        title={project.title}
        context={candidate.context}
        engine={view.engine}
        pendingEvidenceCount={view.pendingEvidenceCount}
        sources={view.sources}
        initialFilters={parseFilters(new URLSearchParams())}
        escalation={null}
        view={{ kind: 'proposal', proposalId: proposal.id, proposalRevision: proposal.revision }}
        snapshot={candidate}
        edit={{
          kind: 'proposal',
          basis,
          proposalId: proposal.id,
          revision: proposal.revision,
          status: proposal.status,
        }}
        changedLoopIds={highlights.loopIds}
        agentActIds={proposal.author.kind === 'agent' ? highlights.actIds : []}
        heading="Candidate graph"
        headingLevel={2}
      />
    </>
  );
}
