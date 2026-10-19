'use client';
import { useEffect, useRef, useState } from 'react';
import type { KeyKind } from '../../contracts';
import { KEY_COPY } from './copy';
import { copyText, mcpConfig } from './McpSnippet';

/** The secret lives only in the creating component's state; closing this panel or reloading the page discards it. */
export function SecretReveal({
  secret,
  label,
  endpoint,
  kind,
  onClose,
}: {
  secret: string;
  label: string;
  endpoint: string;
  kind: KeyKind;
  onClose: () => void;
}) {
  const { noun } = KEY_COPY[kind];
  const [status, setStatus] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // The form is long, so the one-time secret must come into view by itself.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={ref} className="pg-secret" role="region" aria-label={`New ${noun} secret`}>
      <p>
        <b>Copy the secret for “{label}” now. It is shown once.</b>
      </p>
      <div className="secret" data-testid="token-secret">
        {secret}
      </div>
      <div className="pg-acts">
        <button
          className="btn"
          type="button"
          onClick={async () => setStatus(await copyText(secret, 'Secret copied.'))}
        >
          Copy secret
        </button>
        <button
          className="btn"
          type="button"
          onClick={async () =>
            setStatus(
              await copyText(mcpConfig(endpoint, secret), 'Config with this secret copied.'),
            )
          }
        >
          Copy config with this secret
        </button>
        <span className="pg-status" role="status">
          {status}
        </span>
      </div>
      <p className="pg-hint">
        Ask your agent to list its tools. Then press Check again: Last call shows the time of that
        call.
      </p>
      <div className="pg-acts">
        <button className="btn btn-ink" type="button" onClick={onClose}>
          I copied it, hide the secret
        </button>
        <span className="pg-status">If you lose it, revoke the {noun} and create a new one.</span>
      </div>
    </div>
  );
}
