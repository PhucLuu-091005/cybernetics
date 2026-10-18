'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import {
  SCOPE_GROUP_NOTE,
  SCOPE_GROUPS,
  SCOPE_INFO,
  scopeBlock,
  type Creator,
  type Scope,
  type TokenCreated,
} from '../../contracts';
import { send, type ApiError } from '../shell/api';
import { ConflictBanner } from '../shell/ConflictBanner';
import { useHydrated } from '../shell/hydrated';
import { Checkbox } from '../tracker/Checkbox';
import { Select } from '../tracker/Select';
import { allowedScopes, firstScopes, selectAllState, toggleAll } from './scopes';
import { SecretReveal } from './SecretReveal';

export type ExpiryOption = { days: number; label: string };

export function TokenCreate({
  projectId,
  endpoint,
  expiryOptions,
  creator,
}: {
  projectId: string;
  endpoint: string;
  expiryOptions: ExpiryOption[];
  creator: Creator;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const id = useId();
  const allowed = allowedScopes(creator);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(expiryOptions[0].days);
  const [scopes, setScopes] = useState<ReadonlySet<Scope>>(() => firstScopes(creator));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<{ secret: string; label: string } | null>(null);
  const all = selectAllState(scopes, allowed);
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
      scopes: SCOPE_INFO.map((info) => info.scope).filter((scope) => scopes.has(scope)),
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
      {created && (
        <SecretReveal
          secret={created.secret}
          label={created.label}
          endpoint={endpoint}
          onClose={() => setCreated(null)}
        />
      )}
      {failure && <ConflictBanner title="The token was not created." error={failure} />}
      <div className="pg-form">
        <label className="field pg-grow">
          Label
          <input
            value={label}
            // Hydration resets a controlled value, so text typed before it would be lost.
            disabled={!hydrated}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Claude Code, release review"
          />
        </label>
        <label className="field pg-expiry">
          Expires
          <Select
            label="Expires"
            value={String(days)}
            disabled={!hydrated}
            onChange={(value) => setDays(Number(value))}
            options={expiryOptions.map((option) => ({
              value: String(option.days),
              label: option.label,
            }))}
          />
        </label>
      </div>
      <fieldset className="pg-scopes" aria-describedby={`${id}-hint`}>
        <legend>Permissions</legend>
        <p className="pg-hint" id={`${id}-hint`}>
          Each permission is one of your own rights. The agent can never manage tokens, delete the
          project or hand over the project lead.
        </p>
        <div className="pg-all">
          <Checkbox
            checked={all === 'all'}
            mixed={all === 'some'}
            disabled={!hydrated || allowed.length === 0}
            onChange={() => setScopes((current) => toggleAll(current, allowed))}
          >
            <b>Select all</b>
          </Checkbox>
          <span className="pg-count">
            {allowed.filter((scope) => scopes.has(scope)).length} of {allowed.length}
          </span>
        </div>
        {SCOPE_GROUPS.map((group) => (
          <div className="pg-group" key={group} role="group" aria-label={group}>
            <h3>{group}</h3>
            {SCOPE_GROUP_NOTE[group] && <p className="pg-warn">{SCOPE_GROUP_NOTE[group]}</p>}
            {SCOPE_INFO.filter((info) => info.group === group).map((info) => {
              const blocked = scopeBlock(info, creator);
              return (
                <Checkbox
                  key={info.scope}
                  className={`pg-scope${blocked ? ' off' : ''}`}
                  checked={!blocked && scopes.has(info.scope)}
                  disabled={!hydrated || blocked !== null}
                  onChange={(on) => toggle(info.scope, on)}
                >
                  <span className="pg-scope-text">
                    <b>{info.title}</b> <span className="id faint">{info.scope}</span>
                    <small>{info.text}</small>
                    {blocked && <small className="pg-why">{blocked}.</small>}
                  </span>
                </Checkbox>
              );
            })}
          </div>
        ))}
      </fieldset>
      <button
        className="btn btn-ink"
        type="submit"
        disabled={!hydrated || busy || created !== null || !label.trim() || !scopes.size}
      >
        Create token
      </button>
    </form>
  );
}
