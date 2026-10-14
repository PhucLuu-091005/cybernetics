import { describe, expect, it } from 'vitest';
import type { Conflict, EntityChange } from '../../../src/contracts';
import { summarizeConflicts, summarizeDiff } from '../../../src/server/mcp/diff-summary';

const change = (
  collection: EntityChange['collection'],
  id: string,
  kind: EntityChange['kind'],
): EntityChange => ({ collection, id, kind, before: null, after: null });
const conflict = (id: string): Conflict => ({
  collection: 'loops',
  id,
  base: null,
  main: null,
  proposed: null,
  reason: 'Both sides changed the loop',
});

describe('MCP diff summaries', () => {
  it('counts every change per collection and keeps at most 50 keys per kind', () => {
    const changes = [
      ...Array.from({ length: 120 }, (_, index) =>
        change('acts', `a${String(index).padStart(3, '0')}`, 'added'),
      ),
      change('loops', 'l1', 'removed'),
      change('loops', 'l2', 'changed'),
      change('context', 'timeZone', 'changed'),
    ];
    const summary = summarizeDiff({ changes });
    expect(summary.counts).toEqual({
      acts: { added: 120, removed: 0, changed: 0 },
      loops: { added: 0, removed: 1, changed: 1 },
      context: { added: 0, removed: 0, changed: 1 },
    });
    expect(summary.added).toHaveLength(50);
    expect(summary.added[0]).toBe('acts/a000');
    expect(summary.removed).toEqual(['loops/l1']);
    expect(summary.changed).toEqual(['loops/l2', 'context/timeZone']);
    expect(summary.total).toBe(123);
  });
  it('keeps conflict keys and reasons without entity values, bounded to 50', () => {
    const bounded = summarizeConflicts(
      Array.from({ length: 70 }, (_, index) => conflict(`c${index}`)),
    );
    expect(bounded.conflictCount).toBe(70);
    expect(bounded.conflicts).toHaveLength(50);
    expect(bounded.conflicts[0]).toEqual({
      collection: 'loops',
      id: 'c0',
      reason: 'Both sides changed the loop',
    });
  });
});
