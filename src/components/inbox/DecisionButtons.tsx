'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { InboxState } from '../../contracts';
import { createDraft, updateDraft, type ApiError, type Basis } from './api';
import { inboxHref } from './links';

type Props = {
  projectId: string;
  recordVersionId: string;
  state: InboxState;
  proposal: { id: string; revision: number; status: 'draft' | 'merged' | 'closed' } | null;
  basis: Basis;
  decision: 'included' | 'ignored' | null;
  citedByVisibleAct: boolean;
};

/** There is no inbox flag: each decision is a recordDecisions put in a draft proposal, created from main when none is selected. */
export function DecisionButtons({ projectId, recordVersionId, state, proposal, basis, decision, citedByVisibleAct }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // A draft created before a failed update is reused on retry instead of creating another one.
  const [created, setCreated] = useState<{ id: string; revision: number } | null>(null);

  if (proposal && proposal.status !== 'draft') return <p className="faint" style={{ fontSize: 13 }}>This proposal is {proposal.status}. Select a draft or main to add decisions.</p>;

  const decide = async (disposition: 'included' | 'ignored') => {
    setBusy(true);
    setFailure(null);
    let target = proposal ?? created;
    if (!target) {
      const draft = await createDraft(projectId, basis, 'Inbox review');
      if (!draft.ok) { setFailure(draft.error); setBusy(false); return; }
      target = { id: draft.data.id, revision: draft.data.revision };
      setCreated(target);
    }
    const result = await updateDraft(projectId, target, basis.evidenceRevision, [{ op: 'put', collection: 'recordDecisions', value: { recordVersionId, disposition, reason: disposition === 'ignored' ? reason.trim() : '' } }]);
    setBusy(false);
    if (!result.ok) { setFailure(result.error); return; }
    setReason('');
    setCreated(null);
    router.push(inboxHref(projectId, { state, proposal: target.id, r: recordVersionId }));
  };
  const reload = () => {
    setFailure(null);
    if (created && !proposal) router.push(inboxHref(projectId, { state, proposal: created.id, r: recordVersionId }));
    else router.refresh();
  };

  const includeHint = decision === 'included' ? 'Already included in this view.' : citedByVisibleAct ? null : 'Including needs an act that cites this record. Select a span of the text and start an act.';
  const ignoreHint = citedByVisibleAct ? 'Visible acts cite this record. Hide or remove them in the proposal before you ignore it.' : null;
  return (
    <div className="stack">
      {failure && (
        <div className="banner" role="alert">
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{failure.status === 409 ? 'Conflict: the draft or the evidence changed since this page loaded.' : 'The decision was not saved.'}</b>
            <p style={{ fontSize: 13 }}>{failure.message.replace(/\.?$/, '.')} {failure.status === 409 ? 'Your reason is kept. Reload to see the current revisions, then submit again.' : ''}</p>
            {failure.errors?.length ? <ul className="errs">{failure.errors.map(error => <li key={`${error.path}:${error.message}`}>{error.message}</li>)}</ul> : null}
          </div>
          {failure.status === 409 && <button className="btn" type="button" onClick={reload}>Reload</button>}
        </div>
      )}
      <div className="row">
        <button className="btn btn-draft" type="button" disabled={busy || includeHint !== null} onClick={() => decide('included')}>Include in proposal</button>
        <input className="reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} placeholder="Reason to ignore" aria-label="Reason to ignore" />
        <button className="btn" type="button" disabled={busy || !reason.trim() || ignoreHint !== null} onClick={() => decide('ignored')}>Ignore in proposal</button>
      </div>
      {(includeHint || ignoreHint) && <p className="faint" style={{ fontSize: 12 }}>{[includeHint, ignoreHint].filter(Boolean).join(' ')}</p>}
      <p className="faint" style={{ fontSize: 12 }}>{proposal ? 'Decisions go into the selected draft.' : 'The first decision creates a draft from current main. Main does not change until a person merges it.'}</p>
    </div>
  );
}
