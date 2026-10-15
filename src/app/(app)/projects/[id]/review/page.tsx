import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../../../review.css';
import { IdSchema } from '../../../../../contracts';
import { shortStamp } from '../../../../../components/graph/labels';
import { InboxList } from '../../../../../components/inbox/InboxList';
import { CreateProposalForm } from '../../../../../components/review/CreateProposalForm';
import { QueueList, type SetRow } from '../../../../../components/review-queue/QueueList';
import {
  changeSetState,
  parseReviewQuery,
  reviewHref,
} from '../../../../../components/review-queue/state';
import { getApp } from '../../../../../server/app';
import { readInboxView } from '../../../../../server/domain/inbox';
import { getProposal } from '../../../../../server/domain/proposals';
import { AppError } from '../../../../../server/errors';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';
import { reviewQueue } from '../review-count';
import { ChangeSetDetail } from './change-set-detail';
import { RecordDetail } from './record-detail';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/review`);
  const db = getApp().db;
  const { main, drafts, myReview, pendingRecords } = await notFoundOn(reviewQueue(db, actor, id));
  const current = {
    mainCommitId: main.project.mainCommitId,
    evidenceRevision: main.project.evidenceRevision,
    snapshot: main.snapshot,
  };
  const timeZone = main.snapshot.context.timeZone;
  const query = parseReviewQuery(raw, drafts.items.length > 0);
  const inbox = await notFoundOn(
    readInboxView(db, actor, {
      projectId: id,
      view: myReview ? { kind: 'proposal', proposalId: myReview.id } : { kind: 'main' },
      state: 'pending',
      limit: 50,
      ...(query.r ? { recordVersionId: query.r } : { selectFirst: true }),
    }),
  );
  const sets: SetRow[] = [...drafts.items]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      author: draft.author,
      authorName:
        draft.author.kind === 'user' && draft.author.userId === actor.userId
          ? 'you'
          : 'A workspace member',
      when: shortStamp(draft.updatedAt, timeZone),
      state: changeSetState(draft, current, null),
    }));
  const item = query.tab === 'sets' ? (query.item ?? sets[0]?.id ?? null) : null;
  const approvedId =
    typeof raw.approved === 'string' && IdSchema.safeParse(raw.approved).success
      ? raw.approved
      : null;
  const approved = approvedId
    ? await getProposal(db, actor, { projectId: id, proposalId: approvedId }).catch((error) => {
        if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
        throw error;
      })
    : null;

  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>Review</b>
          <small>{main.project.title}</small>
        </div>
        <span className="sp" />
        <details className="filter-pop new-set">
          <summary className="btn">New change set</summary>
          <div className="filter-body">
            <CreateProposalForm
              projectId={id}
              basis={{
                mainCommitId: current.mainCommitId,
                evidenceRevision: current.evidenceRevision,
              }}
            />
          </div>
        </details>
      </header>
      {approved?.status === 'merged' && (
        <p className="card pad notice-draft queue-notice" role="status">
          Approved: {approved.title}.{' '}
          <Link className="lnk" href={`/projects/${id}/graph`}>
            View on graph
          </Link>
        </p>
      )}
      {raw.updated === '1' && (
        <p className="card pad notice-draft queue-notice" role="status">
          Updated. Check the changes again, then approve.
        </p>
      )}
      <div className="queue">
        <QueueList
          projectId={id}
          query={query}
          sets={sets}
          recordCount={pendingRecords}
          records={
            <InboxList
              projectId={id}
              items={inbox.page.items}
              query={{ state: 'pending', proposal: null }}
              selectedId={inbox.selected?.recordVersionId ?? null}
              timeZone={timeZone}
              hrefFor={(r) => reviewHref(id, { tab: 'records', r })}
              emptyText="No new records. Everything is decided."
            />
          }
        />
        <div className="queue-detail">
          {query.tab === 'sets' ? (
            item ? (
              <ChangeSetDetail
                projectId={id}
                proposalId={item}
                actor={actor}
                current={current}
                pendingRecords={pendingRecords}
                timeZone={timeZone}
              />
            ) : (
              <p className="faint">
                No open change sets. Agents and people create them; you approve them here.
              </p>
            )
          ) : (
            <RecordDetail
              projectId={id}
              actor={actor}
              inbox={inbox}
              myReview={myReview}
              timeZone={timeZone}
            />
          )}
        </div>
      </div>
    </>
  );
}
