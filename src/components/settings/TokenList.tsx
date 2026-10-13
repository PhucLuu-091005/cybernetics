'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AgentToken, RevokeAgentTokenResult } from '../../contracts';
import { shortDay } from '../graph/labels';
import { send, type ApiError } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';

function TokenRow({ projectId, token, now, timeZone }: { projectId: string; token: AgentToken; now: string; timeZone: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  // One key per row: a retried revocation returns the first revocation time instead of acting twice.
  const [revokeKey] = useState(() => crypto.randomUUID());
  const expired = token.revokedAt === null && Date.parse(token.expiresAt) <= Date.parse(now);
  const revoke = async () => {
    setBusy(true);
    setFailure(null);
    const result = await send<RevokeAgentTokenResult>(`/api/v1/projects/${projectId}/agent-tokens/${token.id}`, 'DELETE', { idempotencyKey: revokeKey });
    setBusy(false);
    if (result.ok) { setConfirming(false); router.refresh(); }
    else setFailure(result.error);
  };
  return (
    <tr className={token.revokedAt || expired ? 'inactive' : undefined}>
      <td><span className="id">{token.prefix}…</span><br /><span className="faint">{token.label}</span></td>
      <td><div className="scopes">{token.scopes.map(scope => <span key={scope} className={scope === 'graph:merge' ? 'chip risk' : 'chip'}>{scope}</span>)}</div></td>
      <td>{token.revokedAt ? `Revoked ${shortDay(token.revokedAt, timeZone)}` : expired ? `Expired ${shortDay(token.expiresAt, timeZone)}` : shortDay(token.expiresAt, timeZone, true)}</td>
      <td>
        {!token.revokedAt && !expired && (confirming
          ? <div className="row">
              <button className="btn" type="button" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={busy} onClick={revoke}>Confirm revoke</button>
              <button className="btn" type="button" disabled={busy} onClick={() => setConfirming(false)}>Keep</button>
            </div>
          : <button className="btn" type="button" disabled={!hydrated} onClick={() => setConfirming(true)}>Revoke</button>)}
        {failure && <ConflictBanner title="The token was not revoked." error={failure} />}
      </td>
    </tr>
  );
}

export function TokenList({ projectId, tokens, now, timeZone, more }: { projectId: string; tokens: AgentToken[]; now: string; timeZone: string; more: boolean }) {
  return (
    <section className="tablewrap" aria-labelledby="token-list">
      <h2 id="token-list" className="sr">Your tokens for this project</h2>
      <table>
        <thead><tr><th>Token</th><th>Scopes</th><th>Expires</th><th><span className="sr">Actions</span></th></tr></thead>
        <tbody>
          {tokens.map(token => <TokenRow key={token.id} projectId={projectId} token={token} now={now} timeZone={timeZone} />)}
          {tokens.length === 0 && <tr><td colSpan={4} className="faint">No tokens yet. Create one to connect your agent.</td></tr>}
        </tbody>
      </table>
      {more && <p className="faint" style={{ fontSize: 12, padding: '6px 10px' }}>Older tokens exist; this list shows the newest page.</p>}
    </section>
  );
}
