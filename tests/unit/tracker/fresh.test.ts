import { describe, expect, it } from 'vitest';
import { freshLabel } from '../../../src/components/tracker/fresh';

const shown = { version: 'm1.q1.c1.p1', crCount: 4 };

describe('freshLabel', () => {
  it('says nothing while the screen shows the latest version', () => {
    expect(freshLabel(shown, { version: 'm1.q1.c1.p1', crCount: 4 })).toBeNull();
  });

  it('counts the new change requests when only the change requests changed', () => {
    expect(freshLabel(shown, { version: 'm1.q1.c2.p1', crCount: 5 })).toBe('1 new change request');
    expect(freshLabel(shown, { version: 'm1.q1.c2.p1', crCount: 6 })).toBe('2 new change requests');
    expect(freshLabel(shown, { version: 'm1.q1.c2.p1', crCount: 4 })).toBe(
      'Change requests changed',
    );
  });

  it('names Main first, then the Queue, and says New changes for anything else', () => {
    expect(freshLabel(shown, { version: 'm2.q1.c2.p1', crCount: 4 })).toBe('Main changed');
    expect(freshLabel(shown, { version: 'm1.q2.c1.p1', crCount: 4 })).toBe('The Queue changed');
    expect(freshLabel(shown, { version: 'm1.q1.c1.p2', crCount: 4 })).toBe('New changes');
    expect(freshLabel(shown, { version: 'm1.q2.c2.p1', crCount: 5 })).toBe('New changes');
  });
});
