import {
  DEFAULT_AGENT_SCOPES,
  SCOPE_INFO,
  scopeBlock,
  type Creator,
  type Scope,
} from '../../contracts';

type AllState = 'all' | 'some' | 'none';

export const allowedScopes = (creator: Creator): Scope[] =>
  SCOPE_INFO.filter((info) => scopeBlock(info, creator) === null).map((info) => info.scope);

export const firstScopes = (creator: Creator): ReadonlySet<Scope> => {
  const allowed = allowedScopes(creator);
  return new Set(DEFAULT_AGENT_SCOPES.filter((scope) => allowed.includes(scope)));
};

export function selectAllState(selected: ReadonlySet<Scope>, allowed: readonly Scope[]): AllState {
  const on = allowed.filter((scope) => selected.has(scope)).length;
  if (on === 0) return 'none';
  return on === allowed.length ? 'all' : 'some';
}

/** From none or some it selects every allowed scope; from all it clears them. */
export function toggleAll(selected: ReadonlySet<Scope>, allowed: readonly Scope[]): Set<Scope> {
  if (selectAllState(selected, allowed) === 'all')
    return new Set([...selected].filter((scope) => !allowed.includes(scope)));
  return new Set([...selected, ...allowed]);
}

export function permissionShort(scopes: readonly Scope[]): string {
  if (SCOPE_INFO.every((info) => scopes.includes(info.scope))) return 'All permissions';
  const names = SCOPE_INFO.filter((info) => scopes.includes(info.scope)).map((info) => info.short);
  return names.length ? names.join(', ') : 'No permissions';
}
