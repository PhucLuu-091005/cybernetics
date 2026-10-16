import Link from 'next/link';
import { Fragment } from 'react';
import type { Act, ActorContext, GraphSnapshot, ProposalReview } from '../../../../../contracts';
import { GraphScreen } from '../../../../../components/graph/GraphScreen';
import { shortStamp } from '../../../../../components/graph/labels';
import { ChangeSetActions } from '../../../../../components/review-queue/ChangeSetActions';
import { changeSetState } from '../../../../../components/review-queue/state';
import { changeSetGraph } from '../../../../../components/review/change-set-graph';
import { CitedSources } from '../../../../../components/review/CitedSources';
import { capRecordIds, namesFrom } from '../../../../../components/review/describe';
import { DiffView } from '../../../../../components/review/DiffView';
import { EffectsTable } from '../../../../../components/review/EffectsTable';
import { OmittedRecordsNote } from '../../../../../components/review/fields';
import { AuthorBadge } from '../../../../../components/review/ProposalFrame';
import { getApp } from '../../../../../server/app';
import { evaluationTime, getGraphView, resolveView } from '../../../../../server/domain/graph';
import { diffProposal, getProposal } from '../../../../../server/domain/proposals';
import { readCitedRecords } from '../../../../../server/domain/records';
import { AppError } from '../../../../../server/errors';
import { notFoundOn } from '../../../../../server/http/rsc';

type Props = {
  projectId: string;
  projectTitle: string;
  proposalId: string;
  actor: ActorContext;
  current: { mainCommitId: string; evidenceRevision: number; snapshot: GraphSnapshot };
  pendingRecords: number;
  timeZone: string;
};

export async function ChangeSetDetail({
  projectId,
  projectTitle,
  proposalId,
  actor,
  current,
  pendingRecords,
  timeZone,
}: Props) {
  const db = getApp().db;
  const proposal = await notFoundOn(getProposal(db, actor, { projectId, proposalId }));
  if (proposal.status !== 'draft')
    return (
      <p>
        This change set is no longer open.{' '}
        <Link className="lnk" href={`/projects/${projectId}/history`}>
          See Activity
        </Link>
      </p>
    );

  let review: ProposalReview | null = null;
  try {
    review = await diffProposal(db, actor, { projectId, proposalId });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'CONFLICT') throw error;
  }
  const graph = review
    ? await getGraphView(db, actor, {
        projectId,
        view: { kind: 'proposal', proposalId: proposal.id, proposalRevision: proposal.revision },
        T: review.T,
      }).catch((error) => {
        if (error instanceof AppError && error.code === 'CONFLICT') return null;
        throw error;
      })
    : null;
  const state = changeSetState(proposal, current, review ? review.conflicts.length : null);

  const changedActs = review
    ? review.diff.changes
        .filter((change) => change.collection === 'acts' && change.after !== null)
        .map((change) => change.after as Act)
    : [];
  const wanted = capRecordIds([
    ...changedActs.map((act) => act.citation.recordVersionId),
    ...(review?.diff.changes ?? [])
      .filter((change) => change.collection === 'recordDecisions')
      .map((change) => change.id),
  ]);
  const base =
    !review || review.baseCommitId === current.mainCommitId
      ? current.snapshot
      : (
          await notFoundOn(
            resolveView(db, actor, projectId, { kind: 'commit', commitId: review.baseCommitId }),
          )
        ).snapshot;
  const cited = await readCitedRecords(db, actor, { projectId, recordVersionIds: wanted.ids });
  const embed =
    review && graph
      ? {
          graph,
          ...changeSetGraph(
            proposal,
            { mainCommitId: graph.mainCommitId, evidenceRevision: graph.evidenceRevision },
            review.diff.changes,
          ),
        }
      : null;
  const names = namesFrom(
    [proposal.candidate, base, current.snapshot],
    Object.fromEntries([...cited].map(([versionId, record]) => [versionId, record.title])),
  );

  return (
    <>
      <ChangeSetActions
        key={review?.digest ?? `${proposal.id}:${proposal.revision}`}
        projectId={projectId}
        proposal={{ id: proposal.id, revision: proposal.revision, title: proposal.title }}
        state={state}
        review={
          review && {
            mainCommitId: review.mainCommitId,
            proposalRevision: review.proposalRevision,
            evidenceRevision: review.evidenceRevision,
            digest: review.digest,
            T: review.T,
          }
        }
        current={{ mainCommitId: current.mainCommitId, evidenceRevision: current.evidenceRevision }}
        T={evaluationTime(proposal.candidate)}
      >
        <div className="stack" style={{ gap: 6 }}>
          <h2>{proposal.title}</h2>
          <div className="row" style={{ fontSize: 13 }}>
            <AuthorBadge author={proposal.author} viewerUserId={actor.userId} prefix="By" />
          </div>
          {proposal.rationale.trim() && <p className="faint">{proposal.rationale}</p>}
        </div>
      </ChangeSetActions>
      {review && (
        <>
          <OmittedRecordsNote omitted={wanted.omitted} />
          <section className="box" aria-labelledby="what-changes">
            <div className="box-h">
              <h3 id="what-changes">What changes</h3>
              <Link className="btn" href={`/projects/${projectId}/proposals/${proposal.id}`}>
                Edit
              </Link>
            </div>
            <DiffView changes={review.diff.changes} names={names} />
          </section>
          {embed && (
            <section className="box" aria-labelledby="on-graph">
              <div className="box-h">
                <h3 id="on-graph">On the graph</h3>
                <Link
                  className="lnk"
                  href={`/projects/${projectId}/graph?${new URLSearchParams({ proposal: proposal.id, rev: String(proposal.revision) })}`}
                >
                  Open full graph
                </Link>
              </div>
              <div className="review-graph">
                <GraphScreen
                  key={`review-${proposal.id}-${proposal.revision}-${embed.graph.T}`}
                  {...embed.props}
                  projectId={projectId}
                  title={projectTitle}
                  context={proposal.candidate.context}
                  engine={embed.graph.engine}
                  pendingEvidenceCount={embed.graph.pendingEvidenceCount}
                  sources={embed.graph.sources}
                  snapshot={{
                    acts: proposal.candidate.acts,
                    recordDecisions: proposal.candidate.recordDecisions,
                  }}
                  initialFocus={embed.focus}
                  heading="Change set graph"
                  headingLevel={4}
                  readOnly
                  listInitiallyClosed
                />
              </div>
            </section>
          )}
          <section className="box" aria-labelledby="loop-effects">
            <h3 id="loop-effects">Effect on the loops</h3>
            <EffectsTable
              effects={review.effects}
              loopTitles={names.loops}
              T={shortStamp(review.T, timeZone)}
            />
          </section>
          <section className="box" aria-labelledby="quotes">
            <h3 id="quotes">Quotes</h3>
            <CitedSources acts={changedActs} cited={cited} names={names} timeZone={timeZone} />
          </section>
          {pendingRecords > 0 && (
            <p className="faint" style={{ fontSize: 13 }}>
              {pendingRecords} new {pendingRecords === 1 ? 'record is' : 'records are'} not reviewed
              yet. You can approve this change set before them.
            </p>
          )}
          <details key={proposal.id} className="tech">
            <summary>Technical details</summary>
            <dl className="kv">
              <dt>Based on version</dt>
              <dd className="id" title={review.baseCommitId}>
                {review.baseCommitId.slice(0, 7)}
              </dd>
              <dt>Approved graph now</dt>
              <dd className="id" title={review.mainCommitId}>
                {review.mainCommitId.slice(0, 7)}
              </dd>
              <dt>Change set revision</dt>
              <dd>{review.proposalRevision}</dd>
              <dt>Evidence revision</dt>
              <dd>{review.evidenceRevision}</dd>
              <dt>Evaluated at</dt>
              <dd>
                {shortStamp(review.T, timeZone)} {timeZone}
              </dd>
              <dt>Snapshot hash</dt>
              <dd className="digest">
                {review.snapshotHash.slice(0, 8)}…{review.snapshotHash.slice(-4)}
              </dd>
              <dt>Review digest</dt>
              <dd className="digest">{review.digest}</dd>
              {changedActs.map((act) => (
                <Fragment key={act.id}>
                  <dt>Quote offsets</dt>
                  <dd>
                    {names.records[act.citation.recordVersionId] ?? 'unknown record'}, offsets{' '}
                    {act.citation.start}–{act.citation.end}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </details>
        </>
      )}
    </>
  );
}
