import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  IdSchema,
  InboxStateSchema,
  type ActorContext,
  type ActorReference,
  type InboxState,
} from '../../../../../contracts';
import { DecisionButtons } from '../../../../../components/inbox/DecisionButtons';
import { InboxList } from '../../../../../components/inbox/InboxList';
import {
  INBOX_STATES,
  STATE_LABEL,
  inboxHref,
  type InboxQuery,
} from '../../../../../components/inbox/links';
import { PasteForm } from '../../../../../components/inbox/PasteForm';
import { RecordViewer } from '../../../../../components/inbox/RecordViewer';
import { pickMyReview } from '../../../../../components/review-queue/state';
import { getApp } from '../../../../../server/app';
import { readInboxView } from '../../../../../server/domain/inbox';
import { listProjects } from '../../../../../server/domain/projects';
import { listProposals } from '../../../../../server/domain/proposals';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';
import { loadViewedRecord } from '../records/viewed-record';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'All records · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 20;
const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

/** SRD 7.6: proposal mode names its author; an agent author keeps the dashed agent badge from the design. */
function AuthorBadge({ author, viewer }: { author: ActorReference; viewer: ActorContext }) {
  if (author.kind === 'agent')
    return (
      <span className="badge b-agent" title={`Token ${author.tokenId}`}>
        Agent via MCP, token {author.tokenId.slice(0, 8)}
      </span>
    );
  return (
    <span className="badge" style={{ color: 'var(--ink-2)' }}>
      Author: {author.userId === viewer.userId ? 'you' : 'a workspace member'}
    </span>
  );
}

function LockIcon() {
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/inbox`);
  const db = getApp().db;
  const stateParam = InboxStateSchema.safeParse(one(raw.state));
  const state: InboxState = stateParam.success ? stateParam.data : 'pending';
  const proposalParam = one(raw.proposal),
    selectedParam = one(raw.r),
    cursor = one(raw.cursor);
  if (proposalParam !== undefined && !IdSchema.safeParse(proposalParam).success) notFound();
  const requested =
    selectedParam && IdSchema.safeParse(selectedParam).success ? selectedParam : undefined;
  const [inbox, projects, drafts] = await Promise.all([
    notFoundOn(
      readInboxView(db, actor, {
        projectId: id,
        view: proposalParam ? { kind: 'proposal', proposalId: proposalParam } : { kind: 'main' },
        state,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
        ...(requested ? { recordVersionId: requested } : { selectFirst: true }),
      }),
    ),
    listProjects(db, actor),
    proposalParam ? null : notFoundOn(listProposals(db, actor, { projectId: id, status: 'draft' })),
  ]);
  const project = projects.find((item) => item.id === id);
  if (!project) notFound();
  const { proposal, page, counts, selected, timeZone } = inbox;
  const myReview = drafts ? pickMyReview(drafts.items, actor.userId) : null;
  const target = myReview && { id: myReview.id, revision: myReview.revision };
  const query: InboxQuery = { state, proposal: proposal?.id ?? null };
  const basis = { mainCommitId: inbox.mainCommitId, evidenceRevision: inbox.evidenceRevision };
  const selectedId = selected?.recordVersionId ?? requested ?? null;
  const viewed = selectedId
    ? await loadViewedRecord(actor, id, selectedId, timeZone, (versionId) =>
        inboxHref(id, { ...query, r: versionId }),
      )
    : null;

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
          <h1>All records</h1>
          <p>Every imported record and its state. New records are easier to handle in Review.</p>
        </div>
        {proposal ? (
          <div className="pframe">
            <div className="pband" aria-hidden="true" />
            <div className="phead">
              <span className="badge b-draft">
                Change set, {proposal.status === 'draft' ? 'open' : proposal.status}
              </span>
              <h2 style={{ fontSize: 15 }}>{proposal.title}</h2>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12 }}>
                <span className="faint">Based on </span>
                <span className="id" title={proposal.baseCommitId}>
                  {proposal.baseCommitId.slice(0, 7)}
                </span>
                {proposal.baseCommitId === inbox.mainCommitId ? (
                  <span className="faint"> (current)</span>
                ) : null}
              </span>
              <span style={{ fontSize: 12 }}>
                <span className="faint">Revision </span>
                <b>{proposal.revision}</b>
              </span>
              <AuthorBadge author={proposal.author} viewer={actor} />
              <Link className="btn btn-draft" href={`/projects/${id}/proposals/${proposal.id}`}>
                Open change set
              </Link>
              <Link className="btn" href={inboxHref(id, { state, proposal: null })}>
                Approved graph
              </Link>
            </div>
          </div>
        ) : (
          <div className="status">
            <span className="badge b-main">
              <LockIcon />
              Approved graph
            </span>
            <span style={{ flex: 1 }} />
            {drafts && drafts.items.length > 0 && (
              <form method="get" className="tctl review-in">
                <input type="hidden" name="state" value={state} />
                <label htmlFor="review-in">Show as in</label>
                <select id="review-in" name="proposal" defaultValue="">
                  <option value="" disabled>
                    Choose a change set
                  </option>
                  {drafts.items.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.title} (revision {draft.revision})
                    </option>
                  ))}
                </select>
                <button className="btn" type="submit">
                  Open
                </button>
              </form>
            )}
          </div>
        )}
        <nav className="tabs" role="tablist" aria-label="Review states">
          {INBOX_STATES.map((name) => (
            <Link
              key={name}
              role="tab"
              aria-selected={name === state}
              href={inboxHref(id, { state: name, proposal: query.proposal })}
            >
              {STATE_LABEL[name]}
              <span className="c">{counts[name]}</span>
            </Link>
          ))}
        </nav>
        <div className="inbox">
          <div className="stack">
            <InboxList
              projectId={id}
              items={page.items}
              query={query}
              selectedId={selectedId}
              timeZone={timeZone}
            />
            {(cursor || page.nextCursor) && (
              <div className="row" style={{ fontSize: 13 }}>
                {cursor && (
                  <Link className="btn" href={inboxHref(id, query)}>
                    First page
                  </Link>
                )}
                {page.nextCursor && (
                  <Link className="btn" href={inboxHref(id, { ...query, cursor: page.nextCursor })}>
                    Next page
                  </Link>
                )}
              </div>
            )}
            <PasteForm
              projectId={id}
              timeZone={timeZone}
              mainCommitId={inbox.mainCommitId}
              proposalId={query.proposal}
            />
          </div>
          <div className="card pad">
            {viewed ? (
              <RecordViewer
                key={`${viewed.record.id}:${proposal?.id ?? 'main'}`}
                projectId={id}
                record={viewed.record}
                state={selected?.state ?? null}
                decision={selected?.decision ?? null}
                hints={viewed.hints}
                proposalId={
                  proposal
                    ? proposal.status === 'draft'
                      ? proposal.id
                      : null
                    : (target?.id ?? null)
                }
                basis={basis}
              >
                <DecisionButtons
                  key={viewed.record.id}
                  projectId={id}
                  recordVersionId={viewed.record.id}
                  state={state}
                  proposal={
                    proposal
                      ? { id: proposal.id, revision: proposal.revision, status: proposal.status }
                      : null
                  }
                  myReview={target}
                  basis={basis}
                  decision={selected?.decision?.disposition ?? null}
                  citedByVisibleAct={selected?.citedByVisibleAct ?? false}
                />
              </RecordViewer>
            ) : (
              <p className="faint">Select a record to read its original text.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
