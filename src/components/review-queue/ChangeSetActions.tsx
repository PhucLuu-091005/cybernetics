'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { CommitReceipt, Proposal, RebasePreview } from '../../contracts';
import { send, updateDraft, type ApiError } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';
import { reviewHref, type ChangeSetState } from './state';

type Review = {
  mainCommitId: string;
  proposalRevision: number;
  evidenceRevision: number;
  digest: string;
  T: string;
};
type Props = {
  projectId: string;
  proposal: { id: string; revision: number; title: string };
  state: ChangeSetState;
  review: Review | null;
  current: { mainCommitId: string; evidenceRevision: number };
  T: string;
  /** The title block; the buttons sit on its right and wrap under it when the pane is narrow. */
  children: ReactNode;
};

export function ChangeSetActions({
  projectId,
  proposal,
  state,
  review,
  current,
  T,
  children,
}: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const base = `/api/v1/projects/${projectId}/proposals/${proposal.id}`;
  const here = reviewHref(projectId, { tab: 'sets', item: proposal.id });
  const run = async (work: () => Promise<{ ok: true } | { ok: false; error: ApiError }>) => {
    setBusy(true);
    setFailure(null);
    const result = await work();
    // A success navigates or remounts this component, so the buttons stay off until then.
    if (!result.ok) {
      setBusy(false);
      setFailure(result.error);
    }
  };

  const approve = () =>
    review &&
    run(async () => {
      const result = await send<CommitReceipt>(`${base}/merge`, 'POST', {
        expectedMainCommitId: review.mainCommitId,
        expectedProposalRevision: review.proposalRevision,
        expectedEvidenceRevision: review.evidenceRevision,
        reviewDigest: review.digest,
        T: review.T,
        message: proposal.title,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.ok) {
        router.push(`${reviewHref(projectId, { tab: 'sets' })}&approved=${proposal.id}`);
        router.refresh();
      }
      return result;
    });

  const reject = () =>
    run(async () => {
      const result = await send<Proposal>(`${base}/close`, 'POST', {
        expectedProposalRevision: proposal.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.ok) {
        router.push(`${reviewHref(projectId, { tab: 'sets' })}&rejected=${proposal.id}`);
        router.refresh();
      } else setConfirmReject(false);
      return result;
    });

  const update = () =>
    run(async () => {
      const preview = await send<RebasePreview>(`${base}/rebase-preview`, 'POST', {
        expectedMainCommitId: current.mainCommitId,
        expectedProposalRevision: proposal.revision,
        expectedEvidenceRevision: current.evidenceRevision,
        T,
      });
      if (!preview.ok) return preview;
      if (preview.data.conflicts.length > 0) {
        router.push(`/projects/${projectId}/proposals/${proposal.id}/rebase`);
        return { ok: true };
      }
      const applied = await send<Proposal>(`${base}/rebase`, 'POST', {
        expectedMainCommitId: preview.data.mainCommitId,
        expectedProposalRevision: preview.data.proposalRevision,
        expectedEvidenceRevision: preview.data.evidenceRevision,
        reviewDigest: preview.data.digest,
        T: preview.data.T,
        resolutions: [],
        idempotencyKey: crypto.randomUUID(),
      });
      if (applied.ok) {
        router.push(`${here}&updated=1`);
        router.refresh();
      }
      return applied;
    });

  const refresh = () =>
    run(async () => {
      const result = await updateDraft(projectId, proposal, current.evidenceRevision, []);
      if (result.ok) router.refresh();
      return result;
    });

  const banner =
    state === 'needs-update' ? (
      <div className="banner warn" role="status">
        <span>The graph changed after this change set was made. Nothing conflicts.</span>
        <button className="btn btn-ink" type="button" disabled={!hydrated || busy} onClick={update}>
          Update to latest
        </button>
      </div>
    ) : state === 'conflict' ? (
      <div className="banner bad" role="status">
        <span>Another approved change touched the same items. Choose which side stays.</span>
        <Link
          className="btn btn-ink"
          href={`/projects/${projectId}/proposals/${proposal.id}/rebase`}
        >
          Resolve conflict
        </Link>
      </div>
    ) : state === 'ready' && review === null ? (
      <div className="banner warn" role="status">
        <span>This change set changed while the page loaded. Reload.</span>
        <button className="btn btn-ink" type="button" onClick={() => router.refresh()}>
          Reload
        </button>
      </div>
    ) : state === 'needs-refresh' ? (
      <div className="banner warn" role="status">
        <span>New records arrived after this change set was made. Refresh to review it again.</span>
        <button
          className="btn btn-ink"
          type="button"
          disabled={!hydrated || busy}
          onClick={refresh}
        >
          Refresh
        </button>
      </div>
    ) : null;

  return (
    <div className="stack">
      <div className="cs-head">
        <div className="cs-title">{children}</div>
        <div className="actions" role="group" aria-label="Change set actions">
          {confirmReject ? (
            <>
              <button className="btn btn-danger" type="button" disabled={busy} onClick={reject}>
                Confirm reject
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => setConfirmReject(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-danger"
              type="button"
              disabled={!hydrated || busy}
              onClick={() => setConfirmReject(true)}
            >
              Reject
            </button>
          )}
          <button
            className="btn btn-ink"
            type="button"
            disabled={!hydrated || busy || state !== 'ready' || review === null}
            onClick={approve}
          >
            Approve
          </button>
        </div>
      </div>
      {banner}
      {failure && (
        <ConflictBanner
          title={
            failure.status === 409
              ? 'Conflict: the graph or this change set changed since this page loaded.'
              : 'That did not work.'
          }
          message="Nothing changed. Reload to see the current state."
          error={failure}
          actions={
            <button
              className="btn"
              type="button"
              onClick={() => {
                setFailure(null);
                router.refresh();
              }}
            >
              Reload
            </button>
          }
        />
      )}
    </div>
  );
}
