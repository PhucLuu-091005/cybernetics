'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createDraft, updateDraft, type ApiError, type Basis } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';
import { MY_REVIEW_TITLE, reviewHref } from './state';

type Props = {
  projectId: string;
  recordVersionId: string;
  target: { id: string; revision: number } | null;
  basis: Basis;
  citedByVisibleAct: boolean;
};

export function IgnoreRecord({
  projectId,
  recordVersionId,
  target,
  basis,
  citedByVisibleAct,
}: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<{ id: string; revision: number } | null>(null);

  const ignore = async () => {
    setBusy(true);
    setFailure(null);
    let draft = target ?? created;
    if (!draft) {
      const result = await createDraft(projectId, basis, MY_REVIEW_TITLE);
      if (!result.ok) {
        setFailure(result.error);
        setBusy(false);
        return;
      }
      draft = { id: result.data.id, revision: result.data.revision };
      setCreated(draft);
    }
    const result = await updateDraft(projectId, draft, basis.evidenceRevision, [
      {
        op: 'put',
        collection: 'recordDecisions',
        value: { recordVersionId, disposition: 'ignored', reason: reason.trim() },
      },
    ]);
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setCreated(null);
    router.push(reviewHref(projectId, { tab: 'records' }));
    router.refresh();
  };

  const reload = () => {
    if (created && !target) {
      router.push(reviewHref(projectId, { tab: 'records' }));
    }
    router.refresh();
  };

  return (
    <div className="stack">
      {failure && (
        <ConflictBanner
          title={
            failure.status === 409
              ? 'Conflict: something changed since this page loaded.'
              : 'The record was not ignored.'
          }
          message="Your reason is kept. Reload, then ignore it again."
          error={failure}
          actions={
            <button className="btn" type="button" onClick={reload}>
              Reload
            </button>
          }
        />
      )}
      <div className="row">
        <input
          className="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={2000}
          placeholder="Reason to ignore, for example: auto-reply"
          aria-label="Reason to ignore"
        />
        <button
          className="btn"
          type="button"
          disabled={!hydrated || busy || !reason.trim() || citedByVisibleAct}
          onClick={ignore}
        >
          Ignore
        </button>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        {citedByVisibleAct
          ? 'Acts cite this record. Hide or remove them in the change set before you ignore it.'
          : `Your decisions go into your change set "${MY_REVIEW_TITLE}". The graph changes when you approve it.`}
      </p>
    </div>
  );
}
