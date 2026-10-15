'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AgentToken, RevokeAgentTokenResult } from '../../contracts';
import { shortDay, shortStamp } from '../graph/labels';
import { send, type ApiError } from '../inbox/api';
import { ConflictBanner } from '../review/ConflictBanner';
import { useHydrated } from '../review/hydrated';
import { Pager } from '../shell/Pager';
import { permissionTitles } from './scopes';

function TokenRow({
  projectId,
  token,
  now,
  timeZone,
}: {
  projectId: string;
  token: AgentToken;
  now: string;
  timeZone: string;
}) {
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
    const result = await send<RevokeAgentTokenResult>(
      `/api/v1/projects/${projectId}/agent-tokens/${token.id}`,
      'DELETE',
      { idempotencyKey: revokeKey },
    );
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      router.refresh();
    } else setFailure(result.error);
  };
  return (
    <tr className={token.revokedAt || expired ? 'inactive' : undefined}>
      <td>
        <span className="id">{token.prefix}…</span>
        <br />
        <span className="faint">{token.label}</span>
      </td>
      <td>{permissionTitles(token.scopes)}</td>
      <td data-testid="last-call">
        {token.lastUsedAt ? shortStamp(token.lastUsedAt, timeZone) : 'Never'}
      </td>
      <td>
        {token.revokedAt
          ? `Revoked ${shortDay(token.revokedAt, timeZone)}`
          : expired
            ? `Expired ${shortDay(token.expiresAt, timeZone)}`
            : shortDay(token.expiresAt, timeZone, true)}
      </td>
      <td>
        {!token.revokedAt &&
          !expired &&
          (confirming ? (
            <div className="row">
              <button
                className="btn"
                type="button"
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                disabled={busy}
                onClick={revoke}
              >
                Confirm revoke
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              className="btn"
              type="button"
              disabled={!hydrated}
              onClick={() => setConfirming(true)}
            >
              Revoke
            </button>
          ))}
        {failure && <ConflictBanner title="The token was not revoked." error={failure} />}
      </td>
    </tr>
  );
}

export function TokenList({
  projectId,
  tokens,
  now,
  timeZone,
  basePath,
  nextCursor,
  paged,
}: {
  projectId: string;
  tokens: AgentToken[];
  now: string;
  timeZone: string;
  basePath: string;
  nextCursor: string | null;
  paged: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  return (
    <section className="tablewrap" aria-labelledby="token-list">
      <h2 id="token-list" className="sr">
        Your tokens for this project
      </h2>
      <button type="button" className="btn" disabled={!hydrated} onClick={() => router.refresh()}>
        Check again
      </button>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Permissions</th>
            <th>Last call</th>
            <th>Expires</th>
            <th>
              <span className="sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              projectId={projectId}
              token={token}
              now={now}
              timeZone={timeZone}
            />
          ))}
          {tokens.length === 0 && (
            <tr>
              <td colSpan={5} className="faint">
                No tokens yet. Create one to connect your agent.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager basePath={basePath} nextCursor={nextCursor} paged={paged} noun="tokens" />
    </section>
  );
}
