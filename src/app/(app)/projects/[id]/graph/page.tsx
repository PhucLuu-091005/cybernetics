import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  IdSchema,
  TimestampSchema,
  type ActorContext,
  type ActorReference,
} from '../../../../../contracts';
import { GraphHeader, type HeadCommit } from '../../../../../components/graph/GraphHeader';
import { GraphScreen, type EscalationFocus } from '../../../../../components/graph/GraphScreen';
import { citedLoops, parseFilters } from '../../../../../components/graph/filters';
import { shortStamp } from '../../../../../components/graph/labels';
import { proposalHighlights } from '../../../../../components/review/describe';
import { ProposalFrame } from '../../../../../components/review/ProposalFrame';
import { getApp } from '../../../../../server/app';
import { listHistory } from '../../../../../server/domain/commits';
import { getEscalation } from '../../../../../server/domain/escalations';
import { getGraphView, resolveView } from '../../../../../server/domain/graph';
import { listProjects } from '../../../../../server/domain/projects';
import { getProposal } from '../../../../../server/domain/proposals';
import { AppError } from '../../../../../server/errors';
import { diffSnapshots } from '../../../../../server/graph/diff';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Graph · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;
const VERB = {
  initial: 'created',
  merge: 'merged',
  revert: 'reverted',
  restore: 'restored',
} as const;

function toSearch(raw: Search): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      search.append(key, item);
  return search;
}
const author = (actor: ActorReference, viewer: ActorContext) =>
  actor.kind === 'agent'
    ? 'an agent'
    : actor.userId === viewer.userId
      ? 'you'
      : 'a workspace member';

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
  const db = getApp().db,
    filters = parseFilters(search);
  const t = search.get('t'),
    T = t && TimestampSchema.safeParse(t).success ? t : undefined;
  const [view, projects, history] = await Promise.all([
    notFoundOn(
      getGraphView(db, actor, { projectId: id, view: { kind: 'main' }, ...(T ? { T } : {}) }),
    ),
    listProjects(db, actor),
    notFoundOn(listHistory(db, actor, { projectId: id, limit: 1 })),
  ]);
  const project = projects.find((item) => item.id === id);
  if (!project) notFound();
  const timeZone = view.snapshot.context.timeZone;
  const latest = history.items[0];
  const head: HeadCommit =
    latest && latest.id === view.mainCommitId
      ? {
          id: latest.id,
          verb: VERB[latest.kind],
          at: shortStamp(latest.createdAt, timeZone),
          by: author(latest.actor, actor),
        }
      : { id: view.mainCommitId, verb: 'current', at: '', by: null };

  let escalation: EscalationFocus | null = null;
  if (filters.escalationId) {
    try {
      const read = await getEscalation(db, actor, {
        projectId: id,
        escalationId: filters.escalationId,
        limit: 1,
      });
      const claims = read.analyses[0]?.claims;
      escalation = claims
        ? {
            state: 'cited',
            loopIds: [
              ...citedLoops(
                view.engine,
                claims.flatMap((claim) => [
                  ...claim.supportingActIds,
                  ...claim.contradictingActIds,
                ]),
              ),
            ],
          }
        : { state: 'no-analysis' };
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error;
      escalation = { state: 'missing' };
    }
  }

  return (
    <>
      <GraphHeader
        key={`header-${view.T}`}
        projectId={id}
        title={project.title}
        clientName={project.clientName}
        timeZone={timeZone}
        windowStart={view.snapshot.context.windowStart}
        T={view.T}
        explicitT={T !== undefined}
        head={head}
        evidenceRevision={view.evidenceRevision}
        pendingEvidenceCount={view.pendingEvidenceCount}
      />
      <GraphScreen
        key={`screen-main-${view.T}`}
        projectId={id}
        title={project.title}
        clientName={project.clientName}
        context={view.snapshot.context}
        engine={view.engine}
        pendingEvidenceCount={view.pendingEvidenceCount}
        initialFilters={filters}
        escalation={escalation}
        view={{ kind: 'main' }}
        snapshot={view.snapshot}
        edit={{
          kind: 'main',
          basis: { mainCommitId: view.mainCommitId, evidenceRevision: view.evidenceRevision },
        }}
      />
    </>
  );
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
            You opened revision {requested}; the draft is now at revision {proposal.revision}. This
            view shows the current revision.
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
                Open proposal
              </Link>
              <Link className="btn btn-draft" href={`${href}/review`}>
                Review changes
              </Link>
              <Link className="btn" href={`/projects/${projectId}/graph`}>
                Main view
              </Link>
            </>
          }
        />
        <p className="faint" style={{ fontSize: 12 }}>
          The violet halo marks loops this proposal changes. Edits in the loop panel go into this
          draft; main does not change until a person merges it.
        </p>
      </div>
      <GraphScreen
        key={`screen-proposal-${proposal.id}-${view.T}`}
        projectId={projectId}
        title={project.title}
        clientName={project.clientName}
        context={view.snapshot.context}
        engine={view.engine}
        pendingEvidenceCount={view.pendingEvidenceCount}
        initialFilters={filters}
        escalation={null}
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
        heading={`Candidate graph for ${proposal.title}`}
      />
    </>
  );
}
