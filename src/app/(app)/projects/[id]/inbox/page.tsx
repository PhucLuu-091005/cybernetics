import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IdSchema, InboxStateSchema, type InboxState, type Proposal } from '../../../../../contracts';
import { DecisionButtons } from '../../../../../components/inbox/DecisionButtons';
import { InboxList } from '../../../../../components/inbox/InboxList';
import { INBOX_STATES, STATE_LABEL, inboxHref, type InboxQuery } from '../../../../../components/inbox/links';
import { PasteForm } from '../../../../../components/inbox/PasteForm';
import { RecordViewer } from '../../../../../components/inbox/RecordViewer';
import { getApp } from '../../../../../server/app';
import { resolveView } from '../../../../../server/domain/graph';
import { countInbox, listInbox } from '../../../../../server/domain/inbox';
import { listProjects } from '../../../../../server/domain/projects';
import { getProposal, listProposals } from '../../../../../server/domain/proposals';
import { AppError } from '../../../../../server/errors';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';
import { loadViewedRecord } from '../records/viewed-record';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inbox · Promise Graph' };
type Search = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 20;
const one = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

function LockIcon() {
  return <svg className="ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

export default async function InboxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const [{ id }, raw] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/inbox`);
  const db = getApp().db;
  const stateParam = InboxStateSchema.safeParse(one(raw.state));
  const state: InboxState = stateParam.success ? stateParam.data : 'pending';
  const proposalParam = one(raw.proposal), selectedParam = one(raw.r);
  if (proposalParam !== undefined && !IdSchema.safeParse(proposalParam).success) notFound();
  const proposal: Proposal | null = proposalParam ? await notFoundOn(getProposal(db, actor, { projectId: id, proposalId: proposalParam })) : null;
  const view = proposal ? { proposalId: proposal.id, proposalRevision: proposal.revision } : {};
  const query: InboxQuery = { state, proposal: proposal?.id ?? null };

  const list = async (cursor: string | undefined) => notFoundOn(listInbox(db, actor, { projectId: id, state, limit: PAGE_SIZE, ...view, ...(cursor ? { cursor } : {}) }));
  const cursor = one(raw.cursor);
  const [page, counts, projects, drafts, snapshot] = await Promise.all([
    // A cursor binds the view and the evidence revision, so after new evidence the list restarts at the first page.
    list(cursor).catch(error => { if (cursor && error instanceof AppError && error.code === 'VALIDATION') return list(undefined); throw error; }),
    notFoundOn(countInbox(db, actor, { projectId: id, ...view })),
    listProjects(db, actor),
    notFoundOn(listProposals(db, actor, { projectId: id, status: 'draft' })),
    proposal ? Promise.resolve(proposal.candidate) : notFoundOn(resolveView(db, actor, id, { kind: 'main' })).then(resolved => resolved.snapshot),
  ]);
  const project = projects.find(item => item.id === id);
  if (!project) notFound();
  const timeZone = snapshot.context.timeZone;
  const basis = { mainCommitId: page.mainCommitId, evidenceRevision: page.evidenceRevision };

  const selectedId = selectedParam && IdSchema.safeParse(selectedParam).success ? selectedParam : page.items[0]?.recordVersionId ?? null;
  const viewed = selectedId ? await loadViewedRecord(actor, id, selectedId, timeZone, versionId => inboxHref(id, { ...query, r: versionId })) : null;
  const decision = selectedId ? snapshot.recordDecisions.find(item => item.recordVersionId === selectedId) ?? null : null;
  const cited = selectedId !== null && snapshot.acts.some(act => !act.hidden && act.citation.recordVersionId === selectedId);
  const selectedState = page.items.find(item => item.recordVersionId === selectedId)?.state ?? null;

  return (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project, time zone {timeZone}</small></div>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Inbox</h1>
          <p>Imported records wait here. Review states come from the selected graph. Including or ignoring a record adds an operation to a proposal and never writes to main.</p>
        </div>
        {proposal ? (
          <div className="pframe">
            <div className="pband" aria-hidden="true" />
            <div className="phead">
              <span className="badge b-draft">Proposal, {proposal.status}</span>
              <h2 style={{ fontSize: 15 }}>{proposal.title}</h2>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12 }}><span className="faint">Based on </span><span className="id" title={proposal.baseCommitId}>{proposal.baseCommitId.slice(0, 7)}</span>{proposal.baseCommitId === page.mainCommitId ? <span className="faint"> (current main)</span> : null}</span>
              <span style={{ fontSize: 12 }}><span className="faint">Revision </span><b>{proposal.revision}</b></span>
              <span style={{ fontSize: 12 }}><span className="faint">Evidence revision </span><b>{page.evidenceRevision}</b></span>
              <Link className="btn btn-draft" href={`/projects/${id}/proposals/${proposal.id}`}>Open proposal</Link>
              <Link className="btn" href={inboxHref(id, { state, proposal: null })}>Main view</Link>
            </div>
          </div>
        ) : (
          <div className="status">
            <span className="badge b-main"><LockIcon />Main, read-only</span>
            <span><span className="k">Head commit </span><span className="id v" title={page.mainCommitId}>{page.mainCommitId.slice(0, 7)}</span></span>
            <span><span className="k">Evidence revision </span><span className="v">{page.evidenceRevision}</span></span>
            <span style={{ flex: 1 }} />
            {drafts.items.length > 0 && (
              <form method="get" className="tctl review-in">
                <input type="hidden" name="state" value={state} />
                <label htmlFor="review-in">Review in</label>
                <select id="review-in" name="proposal" defaultValue="">
                  <option value="" disabled>Choose a draft</option>
                  {drafts.items.map(draft => <option key={draft.id} value={draft.id}>{draft.title} (revision {draft.revision})</option>)}
                </select>
                <button className="btn" type="submit">Open</button>
              </form>
            )}
          </div>
        )}
        <nav className="tabs" role="tablist" aria-label="Review states">
          {INBOX_STATES.map(name => (
            <Link key={name} role="tab" aria-selected={name === state} href={inboxHref(id, { state: name, proposal: query.proposal })}>{STATE_LABEL[name]}<span className="c">{counts[name]}</span></Link>
          ))}
        </nav>
        <div className="inbox">
          <div className="stack">
            <InboxList projectId={id} items={page.items} query={query} selectedId={selectedId} timeZone={timeZone} />
            {(cursor || page.nextCursor) && (
              <div className="row" style={{ fontSize: 13 }}>
                {cursor && <Link className="btn" href={inboxHref(id, query)}>First page</Link>}
                {page.nextCursor && <Link className="btn" href={inboxHref(id, { ...query, cursor: page.nextCursor })}>Next page</Link>}
              </div>
            )}
            <PasteForm projectId={id} timeZone={timeZone} mainCommitId={page.mainCommitId} proposalId={query.proposal} />
          </div>
          <div className="card pad">
            {viewed ? (
              <RecordViewer key={`${viewed.record.id}:${proposal?.id ?? 'main'}`} projectId={id} record={viewed.record} state={selectedState} decision={decision} hints={viewed.hints} proposalId={proposal?.status === 'draft' ? proposal.id : null} basis={basis}>
                <DecisionButtons key={viewed.record.id} projectId={id} recordVersionId={viewed.record.id} state={state}
                  proposal={proposal ? { id: proposal.id, revision: proposal.revision, status: proposal.status } : null} basis={basis} decision={decision?.disposition ?? null} citedByVisibleAct={cited} />
              </RecordViewer>
            ) : <p className="faint">Select a record to read its original text.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
