'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { DEFAULT_AGENT_SCOPES, type Scope, type TokenCreated } from '../../contracts';
import { send, type ApiError } from '../shell/api';
import { ConflictBanner } from '../shell/ConflictBanner';
import { useHydrated } from '../shell/hydrated';
import { SCOPE_INFO as SCOPES } from '../../contracts';
import { SecretReveal } from './SecretReveal';

export type ExpiryOption = { days: number; label: string };

export function TokenCreate({
  projectId,
  endpoint,
  expiryOptions,
}: {
  projectId: string;
  endpoint: string;
  expiryOptions: ExpiryOption[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(expiryOptions[0].days);
  const [scopes, setScopes] = useState<ReadonlySet<Scope>>(() => new Set(DEFAULT_AGENT_SCOPES));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<{ secret: string; label: string } | null>(null);
  const toggle = (scope: Scope, on: boolean) =>
    setScopes((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim() || !scopes.size) return;
    setBusy(true);
    setFailure(null);
    // A reused creation key answers CONFLICT and never replays the secret (SRD 3), so every attempt gets a fresh key.
    const result = await send<TokenCreated>(`/api/v1/projects/${projectId}/agent-tokens`, 'POST', {
      label: label.trim(),
      scopes: SCOPES.map((item) => item.scope).filter((scope) => scopes.has(scope)),
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      idempotencyKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setCreated({ secret: result.data.secret, label: result.data.token.label });
    setLabel('');
    router.refresh();
  };
  return (
    <form className="pg-sec pg-create" aria-label="Create a token" onSubmit={submit}>
      <h2>Create a token</h2>
      {failure && <ConflictBanner title="The token was not created." error={failure} />}
      <div className="pg-form">
        <label className="field pg-grow">
          Label
          <input
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Claude Code, release review"
          />
        </label>
        <label className="field">
          Expires
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {expiryOptions.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="pg-scopes">
        <legend>Permissions</legend>
        {SCOPES.map(({ scope, title, text }) => (
          <label key={scope} className="pg-scope">
            <input
              type="checkbox"
              checked={scopes.has(scope)}
              disabled={!hydrated}
              onChange={(event) => toggle(scope, event.target.checked)}
            />
            <span>
              <b>{title}</b> <span className="id faint">{scope}</span>
              <small>{text}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        className="btn btn-ink"
        type="submit"
        disabled={!hydrated || busy || created !== null || !label.trim() || !scopes.size}
      >
        Create token
      </button>
      {created && (
        <SecretReveal
          secret={created.secret}
          label={created.label}
          endpoint={endpoint}
          onClose={() => setCreated(null)}
        />
      )}
    </form>
  );
}
