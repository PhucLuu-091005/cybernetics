'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AgentToken, RevokeAgentTokenResult } from '../../contracts';
import { shortDay, shortStamp } from './dates';
import { send, type ApiError } from '../shell/api';
import { ConflictBanner } from '../shell/ConflictBanner';
import { useHydrated } from '../shell/hydrated';
import { Pager } from '../shell/Pager';
import { permissionShort } from './scopes';

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
  // Revoking stays until the refreshed list shows the token revoked, not only until the DELETE answers.
  const [refreshing, startRefresh] = useTransition();
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
    if (result.ok)
      startRefresh(() => {
        setBusy(false);
        setConfirming(false);
        router.refresh();
      });
    else {
      setBusy(false);
      setFailure(result.error);
    }
  };
  return (
    <tr className={token.revokedAt || expired ? 'inactive' : undefined}>
      <td>
        <b className="pg-token">{token.label}</b>
        <span className="id faint">{token.prefix}…</span>
      </td>
      <td>{permissionShort(token.scopes)}</td>
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
          (busy || refreshing ? (
            <span className="pg-status" role="status">
              Revoking…
            </span>
          ) : confirming ? (
            <div className="pg-acts">
              <button className="btn sm btn-danger" type="button" onClick={revoke}>
                Confirm revoke
              </button>
              <button className="btn sm" type="button" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button
              className="btn sm"
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
    <section className="pg-sec" aria-labelledby="token-list">
      <div className="pg-sec-head">
        <h2 id="token-list">Your agent tokens</h2>
        <button
          type="button"
          className="btn sm"
          disabled={!hydrated}
          onClick={() => router.refresh()}
        >
          Check again
        </button>
      </div>
      <div className="pg-scroll">
        <table className="pg-table">
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
      </div>
      <Pager basePath={basePath} nextCursor={nextCursor} paged={paged} noun="tokens" />
    </section>
  );
}
