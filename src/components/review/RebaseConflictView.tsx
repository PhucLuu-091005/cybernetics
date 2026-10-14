'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Conflict, ConflictResolution, Proposal, RebasePreview } from '../../contracts';
import { send, type ApiError } from '../inbox/api';
import { ConflictBanner } from './ConflictBanner';
import { entityTitle, fieldLines, newestImage, type Names } from './describe';
import { useHydrated } from './hydrated';

type Choice = { choice: 'main' | 'proposal' | 'replacement'; text: string; quote: string };
type Props = {
  projectId: string;
  preview: Pick<
    RebasePreview,
    | 'proposalId'
    | 'baseCommitId'
    | 'mainCommitId'
    | 'proposalRevision'
    | 'evidenceRevision'
    | 'T'
    | 'digest'
    | 'conflicts'
  >;
  names: Names;
  kept: { proposal: string[]; main: string[] };
};
const key = (conflict: Pick<Conflict, 'collection' | 'id'>) =>
  `${conflict.collection}/${conflict.id}`;

function Side({
  testId,
  heading,
  lines,
  highlight,
}: {
  testId: string;
  heading: string;
  lines: { field: string; label: string; value: string }[];
  highlight: boolean;
}) {
  return (
    <div data-testid={testId}>
      <h4>{heading}</h4>
      {lines.map((line) => (
        <div key={line.field}>
          {line.label && <span className="faint">{line.label} </span>}
          <span className={highlight ? 'hl' : undefined}>{line.value}</span>
        </div>
      ))}
    </div>
  );
}

function parseReplacement(
  conflict: Conflict,
  choice: Choice,
): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(choice.text), error: null };
  } catch {
    return {
      value: null,
      error: `The replacement for ${conflict.collection} ${conflict.id.slice(0, 8)} is not valid JSON.`,
    };
  }
}

/** SRD 6.4: base, main and proposal side by side; every conflict needs an explicit choice and nothing applies until all have one. */
export function RebaseConflictView({ projectId, preview, names, kept }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const choose = (conflict: Conflict, next: Partial<Choice>) =>
    setChoices((current) => {
      const previous = current[key(conflict)] ?? {
        choice: 'proposal',
        text: JSON.stringify(conflict.proposed ?? conflict.main, null, 2),
        quote: '',
      };
      return { ...current, [key(conflict)]: { ...previous, ...next } };
    });
  const parsed = preview.conflicts.map((conflict) => {
    const choice = choices[key(conflict)];
    return {
      conflict,
      choice,
      replacement: choice?.choice === 'replacement' ? parseReplacement(conflict, choice) : null,
    };
  });
  const ready = parsed.every((item) => item.choice && !item.replacement?.error);

  const apply = async () => {
    const resolutions: ConflictResolution[] = parsed.map(({ conflict, choice, replacement }) =>
      choice.choice === 'replacement'
        ? {
            collection: conflict.collection,
            id: conflict.id,
            choice: 'replacement',
            value: replacement!.value as never,
            ...(conflict.collection === 'acts' && choice.quote ? { quote: choice.quote } : {}),
          }
        : { collection: conflict.collection, id: conflict.id, choice: choice.choice },
    );
    setBusy(true);
    setFailure(null);
    const result = await send<Proposal>(
      `/api/v1/projects/${projectId}/proposals/${preview.proposalId}/rebase`,
      'POST',
      {
        expectedMainCommitId: preview.mainCommitId,
        expectedProposalRevision: preview.proposalRevision,
        expectedEvidenceRevision: preview.evidenceRevision,
        reviewDigest: preview.digest,
        T: preview.T,
        resolutions,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    setBusy(false);
    if (result.ok)
      router.push(`/projects/${projectId}/proposals/${preview.proposalId}/review?rebased=1`);
    else setFailure(result.error);
  };

  return (
    <div className="stack">
      {failure && (
        <ConflictBanner
          title={
            failure.status === 409
              ? 'Conflict: the rebase inputs changed.'
              : 'The rebase was not applied.'
          }
          message="Your choices are kept. Preview the rebase again if main, the draft or the evidence moved."
          error={failure}
          actions={
            <button className="btn" type="button" onClick={() => router.refresh()}>
              Preview again
            </button>
          }
        />
      )}
      {(kept.proposal.length > 0 || kept.main.length > 0) && (
        <p className="ok" style={{ fontSize: 13 }}>
          ✓ {kept.proposal.length + kept.main.length} one-sided{' '}
          {kept.proposal.length + kept.main.length === 1 ? 'change is' : 'changes are'} kept
          automatically:{' '}
          {[
            ...kept.proposal.map((item) => `${item} (proposal)`),
            ...kept.main.map((item) => `${item} (main)`),
          ]
            .slice(0, 8)
            .join(', ')}
          {kept.proposal.length + kept.main.length > 8 ? ', and more' : ''}.
        </p>
      )}
      {preview.conflicts.length === 0 && (
        <p style={{ fontSize: 13 }}>
          No entity changed on both sides. Applying moves the draft onto main{' '}
          {preview.mainCommitId.slice(0, 7)} and raises its revision.
        </p>
      )}
      {parsed.map(({ conflict, choice, replacement }) => {
        const title = entityTitle(
          conflict.collection,
          conflict.id,
          newestImage(conflict.proposed, conflict.main, conflict.base),
          names,
        );
        const [base, main, proposed] = fieldLines(
          conflict.collection,
          [conflict.base, conflict.main, conflict.proposed],
          names,
        );
        const name = `conflict-${key(conflict)}`;
        return (
          <div key={key(conflict)} role="group" aria-label={`Conflict: ${title}`}>
            <h3 style={{ margin: '0 0 6px' }}>
              {title}{' '}
              <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
                {conflict.reason}
              </span>
            </h3>
            <div className="conf">
              <Side
                testId="side-base"
                heading={`Base ${preview.baseCommitId.slice(0, 7)}`}
                lines={base}
                highlight={false}
              />
              <Side
                testId="side-main"
                heading={`Main ${preview.mainCommitId.slice(0, 7)}`}
                lines={main}
                highlight
              />
              <Side
                testId="side-proposal"
                heading={`Your proposal r${preview.proposalRevision}`}
                lines={proposed}
                highlight
              />
              <div className="choices" role="radiogroup" aria-label={`Resolution for ${title}`}>
                {(['main', 'proposal', 'replacement'] as const).map((option) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name={name}
                      value={option}
                      disabled={!hydrated}
                      checked={choice?.choice === option}
                      onChange={() => choose(conflict, { choice: option })}
                    />{' '}
                    {option === 'main'
                      ? 'Keep main'
                      : option === 'proposal'
                        ? 'Keep proposal'
                        : 'Replace with'}
                  </label>
                ))}
              </div>
              {choice?.choice === 'replacement' && (
                <div className="choices" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
                  <label className="field">
                    Replacement value (JSON, validated on apply)
                    <textarea
                      className="id"
                      rows={8}
                      value={choice.text}
                      onChange={(event) => choose(conflict, { text: event.target.value })}
                    />
                  </label>
                  {conflict.collection === 'acts' && (
                    <label className="field">
                      Exact quote of the cited text
                      <input
                        value={choice.quote}
                        maxLength={400}
                        onChange={(event) => choose(conflict, { quote: event.target.value })}
                      />
                    </label>
                  )}
                  {replacement?.error && <span className="bad">{replacement.error}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 4 }}>
        <button
          className="btn btn-draft"
          type="button"
          disabled={!hydrated || busy || !ready}
          onClick={apply}
        >
          Apply resolutions to the draft
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          {ready
            ? `Ready. Applying moves the draft base to ${preview.mainCommitId.slice(0, 7)} and its revision to ${preview.proposalRevision + 1}. Then review the fresh diff.`
            : 'Choose a resolution for each conflict. After applying, review a fresh diff before you merge.'}
        </span>
      </div>
    </div>
  );
}
