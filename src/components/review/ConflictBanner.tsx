import type { ReactNode } from 'react';
import type { ApiError } from '../inbox/api';

function WarningIcon() {
  return (
    <svg
      className="ic"
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ color: 'var(--danger)', marginTop: 2 }}
    >
      <path d="M8 1l7 13H1z" fill="currentColor" />
      <path d="M8 6v4M8 11.5v1" stroke="var(--surface)" strokeWidth="1.6" />
    </svg>
  );
}

const revisionDetails = (details: Record<string, unknown> | undefined): string[] => {
  if (!details) return [];
  const lines: string[] = [];
  if (typeof details.actualMainCommitId === 'string')
    lines.push(`main is now ${details.actualMainCommitId.slice(0, 7)}`);
  if (typeof details.actualProposalRevision === 'number')
    lines.push(`the draft is at revision ${details.actualProposalRevision}`);
  if (typeof details.actualEvidenceRevision === 'number')
    lines.push(`evidence is at revision ${details.actualEvidenceRevision}`);
  if (typeof details.status === 'string' && details.status !== 'draft')
    lines.push(`the proposal is ${details.status}`);
  return lines;
};

/** Conflicts stay on screen next to the kept draft; nothing here retries or discards work on its own. */
export function ConflictBanner({
  title,
  message,
  error,
  actions,
}: {
  title: string;
  message?: ReactNode;
  error?: ApiError | null;
  actions?: ReactNode;
}) {
  const facts = revisionDetails(error?.details);
  return (
    <div className="banner" role="alert">
      <WarningIcon />
      <div style={{ flex: 1, minWidth: 220 }}>
        <b>{title}</b>
        {message && <p style={{ fontSize: 13 }}>{message}</p>}
        {error && (
          <p style={{ fontSize: 13 }}>
            {error.message.replace(/\.?$/, '.')}
            {facts.length ? ` Now ${facts.join(', ')}.` : ''}
          </p>
        )}
        {error?.errors?.length ? (
          <ul className="errs">
            {error.errors.map((item) => (
              <li key={`${item.path}:${item.message}`}>
                {item.path ? `${item.path}: ` : ''}
                {item.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
