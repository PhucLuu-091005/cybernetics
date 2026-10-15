'use client';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import type { CommitPreview, CommitReceipt, Proposal } from '../../contracts';
import { send, type ApiError, type Basis } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { describeEntity, entityTitle, newestImage, type Names } from '../review/describe';
import { ChangeCells } from '../review/DiffView';
import { useHydrated } from '../review/hydrated';
import { COLLECTION } from './CommitDiff';

export type LaterCommit = { id: string; message: string; keys: string[] };
type Props = {
  projectId: string;
  target: { id: string; message: string; kind: 'initial' | 'merge' | 'revert' | 'restore' };
  touched: string[];
  /** Oldest first, so the restore list can name the latest later commit that touched an entity. */
  later: LaterCommit[];
  basis: Basis;
  T: string;
  names: Names;
};
type Kind = 'revert' | 'restore';
const quoted = (message: string) => `“${message}”`;

/** SRD 6.5: revert and restore always show their diff first, then apply as a new commit with the previewed head, evidence and digest. */
export function RevertRestorePreview({
  projectId,
  target,
  touched,
  later,
  basis,
  T,
  names,
}: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [preview, setPreview] = useState<CommitPreview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    error: ApiError;
    during: 'preview' | 'apply' | 'inverse';
  } | null>(null);

  const load = async (kind: Kind) => {
    setBusy(true);
    setFailure(null);
    const result = await send<CommitPreview>(
      `/api/v1/projects/${projectId}/${kind}-preview`,
      'POST',
      {
        targetCommitId: target.id,
        expectedMainCommitId: basis.mainCommitId,
        expectedEvidenceRevision: basis.evidenceRevision,
        T,
      },
    );
    setBusy(false);
    if (!result.ok) {
      setPreview(null);
      setFailure({ error: result.error, during: 'preview' });
      return;
    }
    setPreview(result.data);
    setMessage(
      kind === 'revert' ? `Undo ${quoted(target.message)}` : `Go back to ${quoted(target.message)}`,
    );
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setFailure(null);
    const result = await send<CommitReceipt>(
      `/api/v1/projects/${projectId}/${preview.kind}`,
      'POST',
      {
        targetCommitId: target.id,
        expectedMainCommitId: preview.mainCommitId,
        expectedEvidenceRevision: preview.evidenceRevision,
        reviewDigest: preview.digest,
        T: preview.T,
        message: message.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setBusy(false);
    if (result.ok) router.push(`/projects/${projectId}/history/${result.data.commitId}`);
    else setFailure({ error: result.error, during: 'apply' });
  };
  const inverse = async () => {
    setBusy(true);
    setFailure(null);
    const result = await send<Proposal>(
      `/api/v1/projects/${projectId}/proposals/from-inverse`,
      'POST',
      {
        targetCommitId: target.id,
        expectedMainCommitId: basis.mainCommitId,
        expectedEvidenceRevision: basis.evidenceRevision,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setBusy(false);
    if (result.ok) router.push(`/projects/${projectId}/proposals/${result.data.id}`);
    else setFailure({ error: result.error, during: 'inverse' });
  };

  const touchedSet = new Set(touched);
  const preserved = later.filter((commit) => commit.keys.some((key) => !touchedSet.has(key)));
  const source = (key: string) => [...later].reverse().find((commit) => commit.keys.includes(key));
  const blocked = preview !== null && (preview.conflicts.length > 0 || preview.candidate === null);
  const disabled = !hydrated || busy;

  return (
    <>
      <div className="row">
        <button
          className="btn"
          type="button"
          disabled={disabled || target.kind === 'initial'}
          aria-pressed={preview?.kind === 'revert'}
          onClick={() => load('revert')}
        >
          Preview undo
        </button>
        <button
          className="btn"
          type="button"
          disabled={disabled}
          aria-pressed={preview?.kind === 'restore'}
          onClick={() => load('restore')}
        >
          Preview go back
        </button>
      </div>
      {failure && (
        <ConflictBanner
          title={
            failure.error.status === 409
              ? 'Conflict: the graph or the records changed since this page loaded.'
              : failure.during === 'preview'
                ? 'The preview failed.'
                : 'Nothing was applied.'
          }
          error={failure.error}
          message={
            failure.error.status === 409 ? 'Nothing changed. Reload to preview again.' : undefined
          }
          actions={
            failure.error.status === 409 ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setFailure(null);
                  setPreview(null);
                  router.refresh();
                }}
              >
                Reload
              </button>
            ) : undefined
          }
        />
      )}
      {preview && (
        <section
          className={`card pad stack preview-${preview.kind}`}
          aria-label={`${preview.kind === 'revert' ? 'Undo preview' : 'Go back preview'}`}
        >
          <h2>{preview.kind === 'revert' ? 'Undo preview' : 'Go back preview'}</h2>
          {blocked ? (
            <>
              <p style={{ fontSize: 13 }}>
                <b className="bad">The {preview.kind} conflicts with later changes.</b>{' '}
                {preview.conflicts.length}{' '}
                {preview.conflicts.length === 1 ? 'item blocks' : 'items block'} the apply:
              </p>
              <ul className="plain-list">
                {preview.conflicts.map((conflict) => (
                  <li key={`${conflict.collection}/${conflict.id}`}>
                    {entityTitle(
                      conflict.collection,
                      conflict.id,
                      newestImage(conflict.main, conflict.proposed, conflict.base),
                      names,
                    )}
                    : <span className="faint">{conflict.reason}</span>
                  </li>
                ))}
              </ul>
              {preview.kind === 'revert' && (
                <div className="row">
                  <button
                    className="btn btn-draft"
                    type="button"
                    disabled={disabled}
                    onClick={inverse}
                  >
                    Create a change set that undoes it
                  </button>
                  <span className="faint" style={{ fontSize: 12 }}>
                    The change set undoes what is safe to undo and keeps the approved graph for each
                    conflicting item, so you resolve them explicitly before an approval.
                  </span>
                </div>
              )}
            </>
          ) : preview.kind === 'revert' ? (
            <>
              <p style={{ fontSize: 13 }}>
                Touched items: {preview.diff.changes.length}. The approved graph still matches this
                version&apos;s result for every touched item, so the inverse applies without
                conflict.
              </p>
              <div className="tablewrap" style={{ border: 0 }}>
                <table aria-label="Touched items">
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Item</th>
                      <th>Approved graph now</th>
                      <th>After undo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.diff.changes.map((change) => (
                      <tr key={`${change.collection}/${change.id}`}>
                        <td>{COLLECTION[change.collection]}</td>
                        <td>
                          {entityTitle(
                            change.collection,
                            change.id,
                            newestImage(change.before, change.after),
                            names,
                          )}
                        </td>
                        <ChangeCells change={change} names={names} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ok" style={{ fontSize: 13 }} data-testid="preserved">
                {preserved.length ? (
                  <>
                    ✓ Unrelated later work stays:{' '}
                    {preserved.map((commit) => quoted(commit.message)).join(', ')}.
                  </>
                ) : (
                  '✓ No later version changed other items.'
                )}
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13 }}>
                Going back copies this version into a new version on top of the approved graph.{' '}
                {preview.diff.changes.length
                  ? 'It replaces later interpretation:'
                  : 'The approved graph already matches this version, so going back changes nothing.'}
              </p>
              <ul className="plain-list" data-testid="removed-later">
                {preview.diff.changes.map((change) => {
                  const { kind, name } = describeEntity(
                    change.collection,
                    change.id,
                    newestImage(change.before, change.after),
                    names,
                  );
                  const from = source(`${change.collection}/${change.id}`);
                  const verb =
                    change.kind === 'removed'
                      ? 'Removes'
                      : change.kind === 'added'
                        ? 'Adds back'
                        : 'Changes';
                  return (
                    <li
                      key={`${change.collection}/${change.id}`}
                      className={
                        change.kind === 'removed'
                          ? 'diff-rem'
                          : change.kind === 'added'
                            ? 'diff-add'
                            : 'diff-chg'
                      }
                    >
                      {verb} {kind.toLowerCase()}: {name}
                      {from ? ` (from ${quoted(from.message)})` : ''}
                    </li>
                  );
                })}
              </ul>
              <p className="faint" style={{ fontSize: 12 }}>
                Activity, records and token settings stay. Going back is blocked when a citation in
                the old snapshot is withdrawn.
              </p>
            </>
          )}
          <p className="faint" style={{ fontSize: 12 }}>
            No record and no version is deleted.
          </p>
          <details className="tech">
            <summary>Technical details</summary>
            <dl className="kv">
              <dt>On top of version</dt>
              <dd className="id">{preview.mainCommitId}</dd>
              <dt>Evidence revision</dt>
              <dd>{preview.evidenceRevision}</dd>
              <dt>Preview digest</dt>
              <dd className="digest">{preview.digest}</dd>
              {(preview.kind === 'revert' ? preserved : later).map((commit) => (
                <Fragment key={commit.id}>
                  <dt>{quoted(commit.message)}</dt>
                  <dd className="id">{commit.id}</dd>
                </Fragment>
              ))}
            </dl>
          </details>
          {!blocked && (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: 1 }}>
                Note
                <input
                  value={message}
                  maxLength={2000}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <button
                className="btn btn-ink"
                type="button"
                disabled={disabled || !message.trim()}
                onClick={apply}
              >
                Apply {preview.kind === 'revert' ? 'undo' : 'go back'} as a new version
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
