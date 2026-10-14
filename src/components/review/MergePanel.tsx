'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CommitReceipt, Proposal } from '../../contracts';
import { send, updateDraft, type ApiError } from '../inbox/api';
import { ConflictBanner } from './ConflictBanner';
import { useHydrated } from './hydrated';

type ReviewBasis = {
  mainCommitId: string;
  proposalRevision: number;
  evidenceRevision: number;
  digest: string;
  T: string;
};
type Props = {
  projectId: string;
  proposalId: string;
  review: ReviewBasis;
  pendingEvidenceCount: number;
  defaultMessage: string;
  blocked: string | null;
  rebaseHref: string;
};

/** SRD 6.3: merge sends the reviewed head, draft revision, evidence revision and digest; any drift answers CONFLICT and changes nothing. */
export function MergePanel({
  projectId,
  proposalId,
  review,
  pendingEvidenceCount,
  defaultMessage,
  blocked,
  rebaseHref,
}: Props) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(pendingEvidenceCount === 0);
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const hydrated = useHydrated();

  const merge = async () => {
    setBusy(true);
    setFailure(null);
    const result = await send<CommitReceipt>(
      `/api/v1/projects/${projectId}/proposals/${proposalId}/merge`,
      'POST',
      {
        expectedMainCommitId: review.mainCommitId,
        expectedProposalRevision: review.proposalRevision,
        expectedEvidenceRevision: review.evidenceRevision,
        reviewDigest: review.digest,
        T: review.T,
        message: message.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setBusy(false);
    if (result.ok) router.push(`/projects/${projectId}/history/${result.data.commitId}`);
    else setFailure(result.error);
  };
  const mainMoved =
    typeof failure?.details?.actualMainCommitId === 'string' &&
    failure.details.actualMainCommitId !== review.mainCommitId;
  const plural = pendingEvidenceCount === 1 ? 'record is' : 'records are';

  return (
    <div className="card pad stack">
      {failure &&
        (failure.status === 409 ? (
          mainMoved ? (
            <ConflictBanner
              title="Conflict: main moved since your review."
              message={
                <>
                  Your draft revision {review.proposalRevision} is kept. It is no longer based on
                  main, so a merge needs a rebase onto current main and then a fresh review.
                </>
              }
              error={failure}
              actions={
                <Link className="btn btn-ink" href={rebaseHref}>
                  Preview rebase
                </Link>
              }
            />
          ) : (
            <ConflictBanner
              title="Conflict: the draft or the evidence changed since your review."
              message={
                <>
                  Your draft revision {review.proposalRevision} is kept. Refresh the review, check
                  the changes again, then merge.
                </>
              }
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
                  Refresh review
                </button>
              }
            />
          )
        ) : (
          <ConflictBanner title="The merge did not happen." error={failure} />
        ))}
      {pendingEvidenceCount > 0 && (
        <label
          className="row"
          style={{ fontSize: 13, alignItems: 'flex-start', gap: 8, flexWrap: 'nowrap' }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={!hydrated}
            onChange={(event) => setAcknowledged(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            I understand that {pendingEvidenceCount} {plural} still pending review. Merging a partly
            reviewed corpus is allowed.
          </span>
        </label>
      )}
      <label className="field">
        Commit message
        <input
          value={message}
          maxLength={2000}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <button
        className="btn btn-ink"
        type="button"
        disabled={!hydrated || busy || blocked !== null || !acknowledged || !message.trim()}
        onClick={merge}
      >
        Merge into main
      </button>
      {blocked && (
        <p className="warn" style={{ fontSize: 13 }}>
          {blocked}
        </p>
      )}
      <p className="faint" style={{ fontSize: 12 }}>
        Merge sends the expected head, proposal revision, evidence revision and the review digest.
        Exactly one of two parallel merges succeeds.
      </p>
    </div>
  );
}

/** SRD 6.1: a zero-operation update pins the current evidence revision and refreshes the review basis without changing the graph. */
export function AcknowledgeEvidence({
  projectId,
  proposal,
  evidenceRevision,
}: {
  projectId: string;
  proposal: Pick<Proposal, 'id' | 'revision'>;
  evidenceRevision: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const hydrated = useHydrated();
  const acknowledge = async () => {
    setBusy(true);
    const result = await updateDraft(projectId, proposal, evidenceRevision, []);
    setBusy(false);
    if (result.ok) router.refresh();
    else setFailure(result.error);
  };
  return (
    <div className="stack">
      {failure && (
        <ConflictBanner
          title="The acknowledgement was not saved."
          error={failure}
          actions={
            <button className="btn" type="button" onClick={() => router.refresh()}>
              Reload
            </button>
          }
        />
      )}
      <button
        className="btn btn-draft"
        type="button"
        disabled={busy || !hydrated}
        onClick={acknowledge}
      >
        Acknowledge evidence revision {evidenceRevision}
      </button>
    </div>
  );
}
