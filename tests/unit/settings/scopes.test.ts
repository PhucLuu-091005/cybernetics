import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SCOPES, ScopeSchema } from '../../../src/contracts';
import { SCOPES, permissionTitles } from '../../../src/components/settings/scopes';

describe('permission titles', () => {
  it('gives every scope one plain title, and only the merge scope carries the risk flag', () => {
    expect(SCOPES.map((item) => item.scope)).toEqual(ScopeSchema.options);
    expect(SCOPES.map((item) => item.title)).toEqual([
      'Read the project',
      'Add records',
      'Suggest changes',
      'Approve without you',
    ]);
    expect(SCOPES.filter((item) => item.risk).map((item) => item.scope)).toEqual(['graph:merge']);
  });
  it('leaves the risk scope out of the defaults', () => {
    expect(DEFAULT_AGENT_SCOPES).not.toContain('graph:merge');
  });
  it('joins the titles in a fixed order and names an empty list', () => {
    expect(permissionTitles(['graph:merge', 'project:read'])).toBe(
      'Read the project, Approve without you',
    );
    expect(permissionTitles([])).toBe('No permissions');
  });
});
