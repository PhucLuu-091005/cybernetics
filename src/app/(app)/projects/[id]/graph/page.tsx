import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema, TimestampSchema, type ActorContext } from '../../../../../contracts';
import { GraphScreen } from '../../../../../components/graph/GraphScreen';
import { parseFilters } from '../../../../../components/graph/filters';
import { shortStamp } from '../../../../../components/graph/labels';
import { proposalHighlights } from '../../../../../components/review/describe';
import { ProposalFrame } from '../../../../../components/review/ProposalFrame';
import { TrackerScreen } from '../../../../../components/tracker/TrackerScreen';
import { getApp } from '../../../../../server/app';
import { getGraphView, resolveView } from '../../../../../server/domain/graph';
import { listProjects } from '../../../../../server/domain/projects';
import { getProposal } from '../../../../../server/domain/proposals';
import { diffSnapshots } from '../../../../../server/graph/diff';
import { AppError } from '../../../../../server/errors';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';
import { getTrackerPayload } from '../../../../../server/tracker';
import type { TrackerPayload } from '../../../../../tracker';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Graph · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;

function toSearch(raw: Search): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      search.append(key, item);
  return search;
}

export default async function GraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  const search = toSearch(raw),
    proposalId = search.get('proposal');
  if (proposalId !== null) {
    if (!IdSchema.safeParse(proposalId).success) notFound();
    return <ProposalGraph projectId={id} proposalId={proposalId} search={search} />;
  }
  const actor = await requireActor(`/projects/${id}/graph`);
  const payload = await trackerPayload(actor, id, (await cookies()).get(`pg_act_${id}`)?.value);
  if (!payload)
    return (
      <div className="screen">
        <div className="card pad" role="status">
          <h1>This project has no tracker yet.</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Make a new project from the project menu to start an event tracker.
          </p>
        </div>
      </div>
    );
  return <TrackerScreen payload={payload} projectId={id} serverNow={serverMinute()} />;
}

// A function imported from the client module would be a client reference here, so the page rounds the minute.
const serverMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** The layout already proved the project exists, so NOT_FOUND here means it has no tracker row. */
async function trackerPayload(
  actor: ActorContext,
  projectId: string,
  actAs: string | undefined,
): Promise<TrackerPayload | null> {
  const db = getApp().db;
  try {
    return await getTrackerPayload(db, actor, { projectId, ...(actAs ? { actAs } : {}) });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'NOT_FOUND') return null;
    // A stale act-as cookie (a removed member, a project that left demo mode) must not lock the page.
    if (actAs && (error.code === 'FORBIDDEN' || error.code === 'VALIDATION'))
      return trackerPayload(actor, projectId, undefined);
    throw error;
  }
}

/** SRD 7.6: proposal mode shows the candidate graph with base, author and revision, framed apart from main. */
async function ProposalGraph({
  projectId,
  proposalId,
  search,
}: {
  projectId: string;
  proposalId: string;
  search: URLSearchParams;
}) {
  const actor = await requireActor(`/projects/${projectId}/graph`);
  const db = getApp().db,
    filters = parseFilters(search);
  const t = search.get('t'),
    T = t && TimestampSchema.safeParse(t).success ? t : undefined;
  const [proposal, projects] = await Promise.all([
    notFoundOn(getProposal(db, actor, { projectId, proposalId })),
    listProjects(db, actor),
  ]);
  const project = projects.find((item) => item.id === projectId);
  if (!project) notFound();
  const [view, base] = await Promise.all([
    notFoundOn(
      getGraphView(db, actor, {
        projectId,
        view: { kind: 'proposal', proposalId, proposalRevision: proposal.revision },
        ...(T ? { T } : {}),
      }),
    ),
    notFoundOn(
      resolveView(db, actor, projectId, { kind: 'commit', commitId: proposal.baseCommitId }),
    ),
  ]);
  const highlights = proposalHighlights(diffSnapshots(base.snapshot, proposal.candidate).changes);
  const requested = search.get('rev');
  const href = `/projects/${projectId}/proposals/${proposal.id}`;
  const timeZone = view.snapshot.context.timeZone;
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
        <span className="faint" style={{ fontSize: 12 }}>
          Evaluated at {shortStamp(view.T, timeZone)} {timeZone}
        </span>
      </header>
      <div className="screen" style={{ paddingBottom: 0 }}>
        {requested !== null && Number(requested) !== proposal.revision && (
          <p className="card pad" role="status" style={{ marginBottom: 10, fontSize: 13 }}>
            This change set changed after you opened the link. This view shows its latest state.
          </p>
        )}
        <ProposalFrame
          projectId={projectId}
          proposal={proposal}
          mainCommitId={view.mainCommitId}
          evidenceRevision={view.evidenceRevision}
          viewerUserId={actor.userId}
          level={2}
          actions={
            <>
              <Link className="btn" href={href}>
                Open change set
              </Link>
              <Link className="btn btn-draft" href={`${href}/review`}>
                Review changes
              </Link>
              <Link className="btn" href={`/projects/${projectId}/graph`}>
                Approved graph
              </Link>
            </>
          }
        />
        <p className="faint" style={{ fontSize: 12 }}>
          The violet halo marks loops this change set changes. Edits in the loop panel go into this
          change set; the approved graph does not change until a person approves it.
        </p>
      </div>
      <GraphScreen
        key={`screen-proposal-${proposal.id}-${view.T}`}
        projectId={projectId}
        title={project.title}
        context={view.snapshot.context}
        engine={view.engine}
        pendingEvidenceCount={view.pendingEvidenceCount}
        sources={view.sources}
        initialFilters={filters}
        view={{ kind: 'proposal', proposalId: proposal.id, proposalRevision: proposal.revision }}
        snapshot={view.snapshot}
        edit={{
          kind: 'proposal',
          basis: { mainCommitId: view.mainCommitId, evidenceRevision: view.evidenceRevision },
          proposalId: proposal.id,
          revision: proposal.revision,
          status: proposal.status,
        }}
        changedLoopIds={highlights.loopIds}
        agentActIds={proposal.author.kind === 'agent' ? highlights.actIds : []}
        heading={`Change set: ${proposal.title}`}
      />
    </>
  );
}
