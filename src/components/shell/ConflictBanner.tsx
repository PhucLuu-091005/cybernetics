import type { ApiError } from './api';

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

/** The failed form stays filled next to this banner; nothing here retries or discards work on its own. */
export function ConflictBanner({ title, error }: { title: string; error: ApiError }) {
  return (
    <div className="banner" role="alert">
      <WarningIcon />
      <div style={{ flex: 1, minWidth: 220 }}>
        <b>{title}</b>
        <p style={{ fontSize: 13 }}>{error.message.replace(/\.?$/, '.')}</p>
        {error.errors?.length ? (
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
    </div>
  );
}
