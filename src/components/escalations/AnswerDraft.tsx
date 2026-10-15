'use client';
import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useState } from 'react';
import type { EscalationAnalysis } from '../../contracts';
import { send, type ApiError, type Basis } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';
import { CitationChip, type CitedAct } from './CitationChip';
import { answerPlainText, renderMarkers } from './markers';

export const COVERAGE = 'This verdict covers the submitted evidence in this project only.';

type Props = {
  projectId: string;
  escalationId: string;
  complaint: string;
  analysis: Pick<
    EscalationAnalysis,
    'id' | 'revision' | 'graphCommitId' | 'evidenceRevision' | 'answerText' | 'contentHash'
  >;
  authorLabel: string;
  approvalLabel: string | null;
  acts: Readonly<Record<string, CitedAct>>;
  stale: boolean;
  basis: Basis;
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Some browsers start the download after click() returns; revoking at once can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SRD 9: the app never sends the answer; a person copies or downloads it. */
export function AnswerDraft({
  projectId,
  escalationId,
  complaint,
  analysis,
  authorLabel,
  approvalLabel,
  acts,
  stale,
  basis,
}: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const parts = useMemo(() => renderMarkers(analysis.answerText), [analysis.answerText]);
  const plain = useMemo(
    () =>
      answerPlainText(
        analysis.answerText,
        new Map(
          Object.values(acts).map((act) => [act.actId, { label: act.plain, quote: act.quote }]),
        ),
      ),
    [analysis.answerText, acts],
  );
  const pinnedLine = `Analysis ${analysis.revision}, graph version ${analysis.graphCommitId.slice(0, 7)}, evidence revision ${analysis.evidenceRevision}.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      setStatus('Answer copied.');
    } catch {
      setStatus('Copy failed. Select the answer text and copy it by hand.');
    }
  };
  const save = () => {
    download(
      `escalation-${escalationId.slice(0, 8)}-r${analysis.revision}.md`,
      [
        '# Answer draft',
        '',
        `Complaint: "${complaint}"`,
        '',
        plain,
        '',
        COVERAGE,
        pinnedLine,
        '',
      ].join('\n'),
    );
    setStatus('Answer downloaded.');
  };
  const approve = async () => {
    setBusy(true);
    setFailure(null);
    const result = await send<EscalationAnalysis>(
      `/api/v1/projects/${projectId}/escalations/${escalationId}/analyses/${analysis.id}/approval`,
      'POST',
      {
        expectedAnalysisRevision: analysis.revision,
        expectedMainCommitId: basis.mainCommitId,
        expectedEvidenceRevision: basis.evidenceRevision,
        contentHash: analysis.contentHash,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setBusy(false);
    if (result.ok) router.refresh();
    else setFailure(result.error);
  };

  return (
    <section className="card pad stack" aria-labelledby="answer-draft">
      <div className="row">
        <h2 id="answer-draft">Answer draft</h2>
        {stale && (
          <span className="badge b-stale" data-testid="stale-badge">
            Stale
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="faint" style={{ fontSize: 12 }}>
          Analysis {analysis.revision} by {authorLabel}
        </span>
      </div>
      <details>
        <summary>Technical details</summary>
        <dl className="kv">
          <dt>Pinned graph</dt>
          <dd>
            <span className="id" data-testid="pinned-commit" title={analysis.graphCommitId}>
              {analysis.graphCommitId.slice(0, 7)}
            </span>{' '}
            <span className="faint">
              {analysis.graphCommitId === basis.mainCommitId
                ? 'Approved graph'
                : `The approved graph is now ${basis.mainCommitId.slice(0, 7)}`}
            </span>
          </dd>
          <dt>Pinned evidence</dt>
          <dd>
            revision {analysis.evidenceRevision}{' '}
            <span className="faint">
              {analysis.evidenceRevision === basis.evidenceRevision
                ? 'current'
                : `current is ${basis.evidenceRevision}`}
            </span>
          </dd>
        </dl>
      </details>
      <div className="answer" data-testid="answer">
        {parts.length ? (
          parts.map((part, index) =>
            part.kind === 'text' ? (
              <Fragment key={index}>{part.text}</Fragment>
            ) : (
              <CitationChip key={index} actId={part.actId} acts={acts} />
            ),
          )
        ) : (
          <span className="faint">The analysis has no answer text.</span>
        )}
      </div>
      <p style={{ fontSize: 13, fontWeight: 600 }}>{COVERAGE}</p>
      {failure && (
        <ConflictBanner
          title={
            failure.status === 409
              ? 'Approval refused: this analysis is no longer the current one.'
              : 'The answer was not approved.'
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
              Reload
            </button>
          }
        />
      )}
      {approvalLabel && (
        <p className="ok" style={{ fontSize: 13 }} data-testid="approval">
          {approvalLabel}
        </p>
      )}
      <div className="row">
        <button className="btn" type="button" disabled={!hydrated} onClick={copy}>
          Copy answer
        </button>
        <button className="btn" type="button" disabled={!hydrated} onClick={save}>
          Download .md
        </button>
        <span style={{ flex: 1 }} />
        {!approvalLabel && (
          <button
            className="btn btn-ink"
            type="button"
            disabled={!hydrated || busy || stale}
            onClick={approve}
          >
            Approve answer
          </button>
        )}
      </div>
      <p className="faint" role="status" style={{ fontSize: 12, minHeight: '1em' }}>
        {status}
      </p>
      <p className="faint" style={{ fontSize: 12 }}>
        {stale
          ? `Approval needs current pinned inputs. Ask the agent for a new analysis on ${basis.mainCommitId.slice(0, 7)} first. The app never sends the answer.`
          : 'Approval records your name, the time and the content hash. A new analysis clears it. The app never sends the answer.'}
      </p>
    </section>
  );
}
