import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '../../../../review.css';
import {
  IdSchema,
  type ActorContext,
  type GraphSnapshot,
  type RecordDecision,
} from '../../../../../contracts';
import { shortStamp } from '../../../../../components/graph/labels';
import { InboxList } from '../../../../../components/inbox/InboxList';
import { CreateProposalForm } from '../../../../../components/review/CreateProposalForm';
import { QueueList, type SetRow } from '../../../../../components/review-queue/QueueList';
import {
  changeSetState,
  parseReviewQuery,
  reviewHref,
} from '../../../../../components/review-queue/state';
import { Popover } from '../../../../../components/shell/Popover';
import { getApp } from '../../../../../server/app';
import { readInboxView, type InboxView } from '../../../../../server/domain/inbox';
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
  const { main, drafts, myReview, myCandidate, myDecisions, pendingRecords } = await notFoundOn(
    reviewQueue(db, actor, id),
  );
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
      view: { kind: 'main' },
      state: 'pending',
      limit: 50,
      ...(query.r ? { recordVersionId: query.r } : {}),
    }),
  );
  const records = inbox.page.items.filter((item) => !myDecisions.has(item.recordVersionId));
  const first = records[0]?.recordVersionId;
  const picked: InboxView['selected'] = query.r
    ? inbox.selected
    : first
      ? { recordVersionId: first, state: 'pending', decision: null, citedByVisibleAct: false }
      : null;
  const selected = picked && withMyReview(picked, myDecisions, myCandidate ?? main.snapshot);
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
  const [approved, rejected] = await Promise.all([
    noticeProposal(actor, id, raw.approved),
    noticeProposal(actor, id, raw.rejected),
  ]);

  return (
    <>
      <header className="topbar">
        <div className="proj">
          <b>Review</b>
          <small>{main.project.title}</small>
        </div>
        <span className="sp" />
        <Popover className="filter-pop new-set" summaryClassName="btn" summary="New change set">
          <div className="filter-body">
            <CreateProposalForm
              projectId={id}
              basis={{
                mainCommitId: current.mainCommitId,
                evidenceRevision: current.evidenceRevision,
              }}
            />
          </div>
        </Popover>
      </header>
      {approved?.status === 'merged' && (
        <p className="card pad notice-draft queue-notice" role="status">
          Approved: {approved.title}.{' '}
          <Link className="lnk" href={`/projects/${id}/graph`}>
            View on graph
          </Link>
        </p>
      )}
      {rejected?.status === 'closed' && (
        <p className="card pad notice-draft queue-notice" role="status">
          Rejected: {rejected.title}.
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
          query={{ ...query, item }}
          sets={sets}
          recordCount={pendingRecords}
          records={
            <InboxList
              projectId={id}
              items={records}
              query={{ state: 'pending', proposal: null }}
              selectedId={selected?.recordVersionId ?? null}
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
                projectTitle={main.project.title}
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
              inbox={{ ...inbox, page: { ...inbox.page, items: records }, selected }}
              myReview={myReview}
              timeZone={timeZone}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** The notices name a change set from the URL, so an unknown id shows nothing. */
async function noticeProposal(actor: ActorContext, projectId: string, raw: Search[string]) {
  if (typeof raw !== 'string' || !IdSchema.safeParse(raw).success) return null;
  return getProposal(getApp().db, actor, { projectId, proposalId: raw }).catch((error) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
    throw error;
  });
}

/** The list reads the approved graph, so a record that My review decides takes its state and decision from My review, and the ignore check reads the acts there. */
function withMyReview(
  selected: NonNullable<InboxView['selected']>,
  myDecisions: Map<string, RecordDecision>,
  target: GraphSnapshot,
): NonNullable<InboxView['selected']> {
  const id = selected.recordVersionId;
  const mine = selected.state === 'pending' ? myDecisions.get(id) : undefined;
  return {
    ...selected,
    ...(mine && { state: mine.disposition, decision: mine }),
    citedByVisibleAct: target.acts.some(
      (act) => !act.hidden && act.citation.recordVersionId === id,
    ),
  };
}
