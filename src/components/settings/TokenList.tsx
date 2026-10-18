'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AgentToken, KeyKind, RevokeAgentTokenResult } from '../../contracts';
import { KEY_COPY } from './copy';
import { shortDay, shortStamp } from './dates';
import { send, type ApiError } from '../shell/api';
import { ConflictBanner } from '../shell/ConflictBanner';
import { useHydrated } from '../shell/hydrated';
import { Pager } from '../shell/Pager';
import { permissionShort } from './scopes';

function TokenRow({
  api,
  token,
  now,
  timeZone,
}: {
  api: string;
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
    const result = await send<RevokeAgentTokenResult>(`${api}/${token.id}`, 'DELETE', {
      idempotencyKey: revokeKey,
    });
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
    <div className={`pg-trow${token.revokedAt || expired ? ' inactive' : ''}`} role="row">
      <span className="pg-tname" role="cell">
        <b className="pg-token">{token.label}</b>
        <span className="id faint">{token.prefix}…</span>
      </span>
      <span className="pg-tperm" role="cell" title={permissionShort(token.scopes)}>
        {permissionShort(token.scopes)}
      </span>
      <span className="pg-tcell" role="cell">
        <span className="pg-cap">Last call</span>
        <span data-testid="last-call">
          {token.lastUsedAt ? shortStamp(token.lastUsedAt, timeZone) : 'Never'}
        </span>
      </span>
      <span className="pg-tcell" role="cell">
        <span className="pg-cap">Expires</span>
        {token.revokedAt
          ? `Revoked ${shortDay(token.revokedAt, timeZone)}`
          : expired
            ? `Expired ${shortDay(token.expiresAt, timeZone)}`
            : shortDay(token.expiresAt, timeZone, true)}
      </span>
      <span className="pg-tacts" role="cell">
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
      </span>
    </div>
  );
}

export function TokenList({
  kind = 'project',
  api,
  tokens,
  now,
  timeZone,
  basePath,
  nextCursor,
  paged,
}: {
  kind?: KeyKind;
  api: string;
  tokens: AgentToken[];
  now: string;
  timeZone: string;
  basePath: string;
  nextCursor: string | null;
  paged: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const copy = KEY_COPY[kind];
  return (
    <section className="pg-sec" aria-labelledby="token-list">
      <div className="pg-sec-head">
        <h2 id="token-list">
          {copy.list} <span className="pg-count">{tokens.length}</span>
        </h2>
        <button
          type="button"
          className="btn sm btn-quiet"
          disabled={!hydrated}
          onClick={() => router.refresh()}
        >
          Check again
        </button>
      </div>
      <p className="pg-lede">{copy.lede}</p>
      <div className="pg-tokens" role="table" aria-label={copy.table}>
        <div className="pg-trow pg-cols" role="row">
          <span role="columnheader">{copy.column}</span>
          <span role="columnheader">Permissions</span>
          <span role="columnheader">Last call</span>
          <span role="columnheader">Expires</span>
          <span role="columnheader">
            <span className="sr">Actions</span>
          </span>
        </div>
        {tokens.map((token) => (
          <TokenRow key={token.id} api={api} token={token} now={now} timeZone={timeZone} />
        ))}
        {tokens.length === 0 && (
          <div className="pg-empty" role="row">
            <span role="cell">{copy.empty}</span>
          </div>
        )}
      </div>
      <Pager basePath={basePath} nextCursor={nextCursor} paged={paged} noun="tokens" />
    </section>
  );
}
