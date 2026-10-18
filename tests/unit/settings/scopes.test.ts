import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_SCOPES,
  SCOPE_GROUPS,
  SCOPE_INFO,
  ScopeSchema,
  scopeBlock,
  type Creator,
  type Scope,
} from '../../../src/contracts';
import {
  allowedScopes,
  firstScopes,
  permissionShort,
  selectAllState,
  toggleAll,
} from '../../../src/components/settings/scopes';

const lead: Creator = {
  member: true,
  rights: { viewMain: true, create: true, merge: true, manage: true },
};
const writer: Creator = {
  member: true,
  rights: { viewMain: true, create: true, merge: false, manage: false },
};
const reader: Creator = {
  member: false,
  rights: { viewMain: true, create: false, merge: false, manage: false },
};

describe('token scopes', () => {
  it('has one scope per right, keeps the two first scopes and their default', () => {
    expect(ScopeSchema.options).toEqual([
      'project:read',
      'queue:add',
      'queue:dismiss',
      'crs:edit',
      'crs:ready',
      'crs:comment',
      'crs:merge',
      'crs:close',
      'members:manage',
      'teams:manage',
      'project:lead',
    ]);
    expect(DEFAULT_AGENT_SCOPES).toEqual(['project:read', 'queue:add']);
  });
  it('has no scope that manages tokens or deletes the project', () => {
    expect(ScopeSchema.options.some((scope) => /token|delete/.test(scope))).toBe(false);
  });
  it('gives every scope a group, a title, a short name and one line of what the agent can do', () => {
    expect(SCOPE_INFO.map((info) => info.scope)).toEqual(ScopeSchema.options);
    for (const info of SCOPE_INFO) {
      expect(SCOPE_GROUPS).toContain(info.group);
      expect(info.title.length).toBeGreaterThan(3);
      expect(info.short.length).toBeLessThanOrEqual(14);
      expect(info.text).toMatch(/\.$/);
      expect(info.text.length).toBeLessThanOrEqual(90);
    }
    expect(SCOPE_GROUPS).toEqual([
      'Read',
      'Queue',
      'Change requests',
      'People and teams',
      'Project',
    ]);
  });
  it('blocks a scope whose right the creator does not hold, with the reason', () => {
    const merge = SCOPE_INFO.find((info) => info.scope === 'crs:merge')!;
    expect(scopeBlock(merge, lead)).toBeNull();
    expect(scopeBlock(merge, writer)).toBe('You do not have the Merge right in this project');
    const members = SCOPE_INFO.find((info) => info.scope === 'members:manage')!;
    expect(scopeBlock(members, writer)).toBe('Only the project lead can do this');
    const comment = SCOPE_INFO.find((info) => info.scope === 'crs:comment')!;
    expect(scopeBlock(comment, reader)).toBe('Only members of the project can do this');
    expect(allowedScopes(lead)).toEqual(ScopeSchema.options);
    expect(allowedScopes(writer)).toEqual([
      'project:read',
      'queue:add',
      'queue:dismiss',
      'crs:edit',
      'crs:ready',
      'crs:comment',
      'crs:close',
    ]);
    expect(allowedScopes(reader)).toEqual(['project:read']);
  });
  it('starts a new token with the default scopes the creator may give', () => {
    expect([...firstScopes(writer)]).toEqual(['project:read', 'queue:add']);
    expect([...firstScopes(reader)]).toEqual(['project:read']);
  });
});

describe('Select all', () => {
  const allowed: Scope[] = ['project:read', 'queue:add', 'crs:edit'];
  it('is checked, unchecked or mixed from the allowed scopes', () => {
    expect(selectAllState(new Set(), allowed)).toBe('none');
    expect(selectAllState(new Set<Scope>(['queue:add']), allowed)).toBe('some');
    expect(selectAllState(new Set(allowed), allowed)).toBe('all');
    expect(selectAllState(new Set(), [])).toBe('none');
  });
  it('selects every allowed scope from none or some, and clears them from all', () => {
    expect([...toggleAll(new Set(), allowed)]).toEqual(allowed);
    expect([...toggleAll(new Set<Scope>(['crs:edit']), allowed)].sort()).toEqual(
      [...allowed].sort(),
    );
    expect([...toggleAll(new Set(allowed), allowed)]).toEqual([]);
  });
});

describe('short permissions', () => {
  it('names the scopes in the catalogue order, or all of them in one phrase', () => {
    expect(permissionShort(['queue:add', 'project:read'])).toBe('Read, Add to Queue');
    expect(permissionShort([...ScopeSchema.options])).toBe('All permissions');
    expect(permissionShort([])).toBe('No permissions');
  });
});
