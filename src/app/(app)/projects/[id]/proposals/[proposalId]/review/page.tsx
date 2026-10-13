import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema, type Act, type ProposalReview } from '../../../../../../../contracts';
import { shortStamp } from '../../../../../../../components/graph/labels';
import { ConflictBanner } from '../../../../../../../components/review/ConflictBanner';
import { describeEntity, namesFrom } from '../../../../../../../components/review/describe';
import { DiffView } from '../../../../../../../components/review/DiffView';
import { EffectsTable } from '../../../../../../../components/review/EffectsTable';
import { AcknowledgeEvidence, MergePanel } from '../../../../../../../components/review/MergePanel';
import { AuthorBadge, ProposalFrame } from '../../../../../../../components/review/ProposalFrame';
import { quoteContext } from '../../../../../../../lib/quote-context';
import { getApp } from '../../../../../../../server/app';
import { resolveView } from '../../../../../../../server/domain/graph';
import { listProjects } from '../../../../../../../server/domain/projects';
import { diffProposal, getProposal } from '../../../../../../../server/domain/proposals';
import { readCitedRecords } from '../../../../../../../server/domain/records';
import { AppError } from '../../../../../../../server/errors';
import { notFoundOn, requireActor } from '../../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;
const MAX_SOURCES = 20;

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string; proposalId: string }>; searchParams: Promise<Search> }) {
  const [{ id, proposalId }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success || !IdSchema.safeParse(proposalId).success) notFound();
  const actor = await requireActor(`/projects/${id}/proposals/${proposalId}/review`);
  const db = getApp().db;
  const [proposal, projects, main] = await Promise.all([notFoundOn(getProposal(db, actor, { projectId: id, proposalId })), listProjects(db, actor), notFoundOn(resolveView(db, actor, id, { kind: 'main' }))]);
  const project = projects.find(item => item.id === id);
  if (!project) notFound();
  const href = `/projects/${id}/proposals/${proposal.id}`;
  const timeZone = proposal.candidate.context.timeZone;
  const frame = (children: React.ReactNode) => (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project, time zone {timeZone}</small></div>
        <span className="sp" />
        <Link className="btn" href={href}>Back to the proposal</Link>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Review and merge</h1>
          <p>The review binds one view: base, proposal revision, evidence revision, snapshot hash and T. Any change to these makes the merge fail with a conflict, and the draft stays.</p>
        </div>
        <ProposalFrame projectId={id} proposal={proposal} mainCommitId={main.project.mainCommitId} evidenceRevision={main.project.evidenceRevision} viewerUserId={actor.userId} level={2} />
        {children}
      </div>
    </>
  );

  let review: ProposalReview;
  try { review = await diffProposal(db, actor, { projectId: id, proposalId }); }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error;
    if (proposal.status !== 'draft') return frame(<p className="faint">Only a draft can be reviewed and merged. {proposal.mergedCommitId && <Link className="lnk" href={`/projects/${id}/history/${proposal.mergedCommitId}`}>Open the merge commit</Link>}</p>);
    if (proposal.evidenceRevision !== main.project.evidenceRevision) return frame(
      <ConflictBanner title="New evidence is not acknowledged yet." message={<>Evidence moved to revision {main.project.evidenceRevision} after this draft pinned revision {proposal.evidenceRevision}. Acknowledge it to refresh the review basis; the graph does not change.</>}
        actions={<AcknowledgeEvidence projectId={id} proposal={proposal} evidenceRevision={main.project.evidenceRevision} />} />,
    );
    return frame(<ConflictBanner title="The draft changed while the review loaded." message="Reload the page to review the current revision." />);
  }

  const candidate = proposal.candidate;
  const base = review.baseCommitId === main.project.mainCommitId ? main : await notFoundOn(resolveView(db, actor, id, { kind: 'commit', commitId: review.baseCommitId }));
  const changedActs = review.diff.changes.filter(change => change.collection === 'acts' && change.after !== null).map(change => change.after as Act);
  const versionIds = new Set([...changedActs.map(act => act.citation.recordVersionId), ...review.diff.changes.filter(change => change.collection === 'recordDecisions').map(change => change.id)]);
  const cited = await readCitedRecords(db, actor, { projectId: id, recordVersionIds: [...versionIds] });
  const names = namesFrom([candidate, base.snapshot, main.snapshot], Object.fromEntries([...cited].map(([versionId, record]) => [versionId, record.title])));
  const stale = review.baseCommitId !== review.mainCommitId;
  const T = `${shortStamp(review.T, timeZone)}`;

  return frame(
    <>
      {raw.rebased === '1' && <p className="card pad notice-draft" role="status" style={{ marginBottom: 12, fontSize: 13 }}><b>Fresh review required.</b> The rebase moved the draft to revision {review.proposalRevision} on main {review.mainCommitId.slice(0, 7)}. Review this diff again before you merge.</p>}
      {stale && (
        <div style={{ marginBottom: 12 }}>
          <ConflictBanner title="Main moved since this draft was based." message={<>The draft is based on {review.baseCommitId.slice(0, 7)} and main is now {review.mainCommitId.slice(0, 7)}. {review.conflicts.length ? `${review.conflicts.length} ${review.conflicts.length === 1 ? 'entity changed' : 'entities changed'} on both sides.` : 'No entity changed on both sides.'} Rebase onto current main before you merge. Your draft is kept.</>}
            actions={<Link className="btn btn-ink" href={`${href}/rebase`}>Preview rebase</Link>} />
        </div>
      )}
      <div className="grid2">
        <div className="stack">
          <DiffView changes={review.diff.changes} names={names} pendingEvidenceCount={review.pendingEvidenceCount} />
          <EffectsTable effects={review.effects} loopTitles={names.loops} T={T} />
        </div>
        <div className="stack">
          <section className="card pad" aria-labelledby="basis-heading">
            <h2 id="basis-heading" style={{ marginBottom: 8 }}>Review basis</h2>
            <dl className="kv">
              <dt>Base commit</dt><dd className="id" title={review.baseCommitId}>{review.baseCommitId.slice(0, 7)}</dd>
              <dt>Main now</dt><dd className="id" title={review.mainCommitId}>{review.mainCommitId.slice(0, 7)}</dd>
              <dt>Proposal revision</dt><dd>{review.proposalRevision}</dd>
              <dt>Evidence revision</dt><dd>{review.evidenceRevision}</dd>
              <dt>Evaluated at</dt><dd>{T} {timeZone}</dd>
              <dt>Snapshot hash</dt><dd className="digest">{review.snapshotHash.slice(0, 8)}…{review.snapshotHash.slice(-4)}</dd>
              <dt>Review digest</dt><dd className="digest">{review.digest}</dd>
              <dt>Author</dt><dd><AuthorBadge author={review.author} viewerUserId={actor.userId} prefix="Proposed by" /></dd>
            </dl>
          </section>
          <section className="card pad" aria-labelledby="sources-heading">
            <h2 id="sources-heading" style={{ marginBottom: 8 }}>Cited sources</h2>
            <div className="stack" style={{ gap: 8 }}>
              {changedActs.length === 0 && <p className="faint" style={{ fontSize: 13 }}>No added or changed act in this proposal.</p>}
              {changedActs.slice(0, MAX_SOURCES).map(act => {
                const record = cited.get(act.citation.recordVersionId), body = record?.bodyText ?? null;
                const context = body === null ? null : quoteContext(body, act.citation.start, act.citation.end);
                return (
                  <div key={act.id}>
                    {body === null || context === null
                      ? <div className="quote"><span className="badge b-stale">Unavailable evidence</span></div>
                      : <div className="quote" style={{ fontSize: 14 }}>{context.before}<mark>{body.slice(act.citation.start, act.citation.end)}</mark>{context.after}</div>}
                    <div className="faint" style={{ fontSize: 12 }}>{describeEntity('acts', act.id, act, names).name}; {record ? `${record.author}, ${record.sourceLabel} “${record.title}”, ${shortStamp(record.occurredAt, timeZone)}` : 'unknown record'}, offsets {act.citation.start}–{act.citation.end}, quote verified on save</div>
                  </div>
                );
              })}
              {changedActs.length > MAX_SOURCES && <p className="faint" style={{ fontSize: 12 }}>{changedActs.length - MAX_SOURCES} more cited acts are not shown.</p>}
            </div>
          </section>
          <MergePanel projectId={id} proposalId={proposal.id} review={{ mainCommitId: review.mainCommitId, proposalRevision: review.proposalRevision, evidenceRevision: review.evidenceRevision, digest: review.digest, T: review.T }}
            pendingEvidenceCount={review.pendingEvidenceCount} defaultMessage={proposal.title} rebaseHref={`${href}/rebase`}
            blocked={stale ? 'Merge needs a rebase onto current main first.' : null} />
        </div>
      </div>
    </>,
  );
}
