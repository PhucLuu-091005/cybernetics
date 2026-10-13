import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IdSchema, TimestampSchema, type ActorContext, type ActorReference } from '../../../../../contracts';
import { GraphHeader, type HeadCommit } from '../../../../../components/graph/GraphHeader';
import { GraphScreen } from '../../../../../components/graph/GraphScreen';
import { citedLoops, parseFilters } from '../../../../../components/graph/filters';
import { shortStamp } from '../../../../../components/graph/labels';
import { getApp } from '../../../../../server/app';
import { listHistory } from '../../../../../server/domain/commits';
import { getEscalation } from '../../../../../server/domain/escalations';
import { getGraphView } from '../../../../../server/domain/graph';
import { listProjects } from '../../../../../server/domain/projects';
import { AppError } from '../../../../../server/errors';
import { requireActor } from '../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Graph · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;
const VERB = { initial: 'created', merge: 'merged', revert: 'reverted', restore: 'restored' } as const;

function toSearch(raw: Search): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  return search;
}
const author = (actor: ActorReference, viewer: ActorContext) => actor.kind === 'agent' ? 'an agent' : actor.userId === viewer.userId ? 'you' : 'a workspace member';
async function notFoundOn<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') notFound(); throw error; }
}

export default async function GraphPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/graph`);
  const db = getApp().db, search = toSearch(raw), filters = parseFilters(search);
  const t = search.get('t'), T = t && TimestampSchema.safeParse(t).success ? t : undefined;
  const [view, projects, history] = await Promise.all([
    notFoundOn(getGraphView(db, actor, { projectId: id, view: { kind: 'main' }, ...(T ? { T } : {}) })),
    listProjects(db, actor),
    notFoundOn(listHistory(db, actor, { projectId: id, limit: 1 })),
  ]);
  const project = projects.find(item => item.id === id);
  if (!project) notFound();
  const timeZone = view.snapshot.context.timeZone;
  const latest = history.items[0];
  const head: HeadCommit = latest && latest.id === view.mainCommitId
    ? { id: latest.id, verb: VERB[latest.kind], at: shortStamp(latest.createdAt, timeZone), by: author(latest.actor, actor) }
    : { id: view.mainCommitId, verb: 'current', at: '', by: null };

  let escalationLoopIds: string[] | null = null;
  if (filters.escalationId) {
    try {
      const escalation = await getEscalation(db, actor, { projectId: id, escalationId: filters.escalationId, limit: 1 });
      const claims = escalation.analyses[0]?.claims ?? [];
      escalationLoopIds = [...citedLoops(view.engine, claims.flatMap(claim => [...claim.supportingActIds, ...claim.contradictingActIds]))];
    } catch (error) { if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error; }
  }

  return (
    <>
      <GraphHeader key={`header-${view.T}`} projectId={id} title={project.title} clientName={project.clientName} timeZone={timeZone} windowStart={view.snapshot.context.windowStart} T={view.T} explicitT={T !== undefined}
        head={head} evidenceRevision={view.evidenceRevision} pendingEvidenceCount={view.pendingEvidenceCount} />
      <GraphScreen key={`screen-${view.T}`} projectId={id} title={project.title} clientName={project.clientName} context={view.snapshot.context} engine={view.engine}
        pendingEvidenceCount={view.pendingEvidenceCount} initialFilters={filters} escalationLoopIds={escalationLoopIds} />
    </>
  );
}
