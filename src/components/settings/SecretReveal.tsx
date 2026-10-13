'use client';
import { useState } from 'react';
import { copyText, mcpConfig } from './McpSnippet';

/** The secret lives only in the creating component's state; closing this panel or reloading the page discards it. */
export function SecretReveal({ secret, label, endpoint, onClose }: { secret: string; label: string; endpoint: string; onClose: () => void }) {
  const [status, setStatus] = useState('');
  return (
    <div className="stack" role="region" aria-label="New token secret">
      <p style={{ fontWeight: 700 }}>Copy the secret for “{label}” now. It is shown once.</p>
      <div className="secret" data-testid="token-secret">{secret}</div>
      <div className="row">
        <button className="btn" type="button" onClick={async () => setStatus(await copyText(secret, 'Secret copied.'))}>Copy secret</button>
        <button className="btn" type="button" onClick={async () => setStatus(await copyText(mcpConfig(endpoint, secret), 'Config with this secret copied.'))}>Copy config with this secret</button>
        <span className="faint" role="status" style={{ fontSize: 12 }}>{status}</span>
      </div>
      <div className="row">
        <button className="btn btn-ink" type="button" onClick={onClose}>I copied it, hide the secret</button>
        <span className="faint" style={{ fontSize: 12 }}>If you lose it, revoke the token and create a new one.</span>
      </div>
    </div>
  );
}
