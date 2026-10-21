import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_SCOPES, ScopeSchema } from '../../../src/contracts';
import { SCOPES, permissionTitles } from '../../../src/components/settings/scopes';

describe('permission titles', () => {
  it('gives every scope one plain title', () => {
    expect(SCOPES.map((item) => item.scope)).toEqual(ScopeSchema.options);
    expect(SCOPES.map((item) => item.title)).toEqual(['Read the project', 'Add to the Queue']);
  });
  it('offers only the read and Queue scopes, and a new token gets both', () => {
    expect(ScopeSchema.options).toEqual(['project:read', 'queue:add']);
    expect(DEFAULT_AGENT_SCOPES).toEqual(['project:read', 'queue:add']);
  });
  it('joins the titles in a fixed order and names an empty list', () => {
    expect(permissionTitles(['queue:add', 'project:read'])).toBe(
      'Read the project, Add to the Queue',
    );
    expect(permissionTitles([])).toBe('No permissions');
  });
});
