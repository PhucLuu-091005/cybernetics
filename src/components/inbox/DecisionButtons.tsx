'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { InboxState } from '../../contracts';
import { MY_REVIEW_TITLE } from '../review-queue/state';
import { createDraft, updateDraft, type ApiError, type Basis } from './api';
import { inboxHref } from './links';

type Props = {
  projectId: string;
  recordVersionId: string;
  state: InboxState;
  proposal: { id: string; revision: number; status: 'draft' | 'merged' | 'closed' } | null;
  myReview: { id: string; revision: number } | null;
  basis: Basis;
  decision: 'included' | 'ignored' | null;
  citedByVisibleAct: boolean;
};

/** There is no inbox flag: each decision is a recordDecisions put in a draft proposal; from the approved graph it goes into "My review", which the first decision creates. */
export function DecisionButtons({
  projectId,
  recordVersionId,
  state,
  proposal,
  myReview,
  basis,
  decision,
  citedByVisibleAct,
}: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // A draft created before a failed update is reused on retry instead of creating another one.
  const [created, setCreated] = useState<{ id: string; revision: number } | null>(null);

  if (proposal && proposal.status !== 'draft')
    return (
      <p className="faint" style={{ fontSize: 13 }}>
        This change set is closed. Select an open change set to add decisions.
      </p>
    );

  const decide = async (disposition: 'included' | 'ignored') => {
    setBusy(true);
    setFailure(null);
    let target = proposal ?? myReview ?? created;
    if (!target) {
      const draft = await createDraft(projectId, basis, MY_REVIEW_TITLE);
      if (!draft.ok) {
        setFailure(draft.error);
        setBusy(false);
        return;
      }
      target = { id: draft.data.id, revision: draft.data.revision };
      setCreated(target);
    }
    const result = await updateDraft(projectId, target, basis.evidenceRevision, [
      {
        op: 'put',
        collection: 'recordDecisions',
        value: {
          recordVersionId,
          disposition,
          reason: disposition === 'ignored' ? reason.trim() : '',
        },
      },
    ]);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setReason('');
    setCreated(null);
    router.push(inboxHref(projectId, { state, proposal: target.id, r: recordVersionId }));
  };
  const reload = () => {
    setFailure(null);
    if (created && !proposal)
      router.push(inboxHref(projectId, { state, proposal: created.id, r: recordVersionId }));
    else router.refresh();
  };

  // Main cannot hold a draft act, so including always starts from a selected draft whose act cites the record.
  const includeHint = !proposal
    ? 'To include it, select a quote and add an act.'
    : decision === 'included'
      ? 'Already included in this change set.'
      : citedByVisibleAct
        ? null
        : 'No act in this change set cites this record yet. Select a quote and add an act.';
  const ignoreHint = citedByVisibleAct
    ? 'Acts cite this record. Hide or remove them in the change set before you ignore it.'
    : null;
  return (
    <div className="stack">
      {failure && (
        <div className="banner" role="alert">
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>
              {failure.status === 409
                ? 'Conflict: the change set or the records changed since this page loaded.'
                : 'The decision was not saved.'}
            </b>
            <p style={{ fontSize: 13 }}>
              {failure.message.replace(/\.?$/, '.')}{' '}
              {failure.status === 409
                ? 'Your reason is kept. Reload to see the current revisions, then submit again.'
                : ''}
            </p>
            {failure.errors?.length ? (
              <ul className="errs">
                {failure.errors.map((error) => (
                  <li key={`${error.path}:${error.message}`}>{error.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {failure.status === 409 && (
            <button className="btn" type="button" onClick={reload}>
              Reload
            </button>
          )}
        </div>
      )}
      <div className="row">
        <button
          className="btn btn-draft"
          type="button"
          disabled={busy || includeHint !== null}
          onClick={() => decide('included')}
        >
          Include
        </button>
        <input
          className="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          placeholder="Reason to ignore"
          aria-label="Reason to ignore"
        />
        <button
          className="btn"
          type="button"
          disabled={busy || !reason.trim() || ignoreHint !== null}
          onClick={() => decide('ignored')}
        >
          Ignore
        </button>
      </div>
      {(includeHint || ignoreHint) && (
        <p className="faint" style={{ fontSize: 12 }}>
          {[includeHint, ignoreHint].filter(Boolean).join(' ')}
        </p>
      )}
      <p className="faint" style={{ fontSize: 12 }}>
        {proposal
          ? 'Decisions go into the selected change set.'
          : myReview
            ? `Your decisions go into your change set "${MY_REVIEW_TITLE}". The graph changes when a person approves it.`
            : `Your first decision creates the change set "${MY_REVIEW_TITLE}". The graph changes when a person approves it.`}
      </p>
    </div>
  );
}
