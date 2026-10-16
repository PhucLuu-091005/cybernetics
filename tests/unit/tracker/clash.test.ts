import { describe, expect, it } from 'vitest';
import {
  clashesOf,
  crState,
  liveOps,
  mainState,
  newerOps,
  type Commit,
} from '../../../src/tracker/clash';
import type { Op } from '../../../src/tracker/ops';
import type { Cr } from '../../../src/tracker/payload';
import { at, larkspurBase, larkspurQueueRows, makeOp } from '../../support/tracker-fixture';

const base = larkspurBase();
const rows = larkspurQueueRows();

function commit(rev: number, ops: Op[]): Commit {
  return {
    rev,
    crId: `cr${rev}`,
    crNum: rev,
    mergedBy: 'minh',
    mergedAt: at('2026-10-09T17:00'),
    ops,
    resolutions: [],
  };
}

const rename = (title: string, rev: number, by = 'lan') =>
  makeOp('rename', { workItemId: 'pg203', title }, rev, by);

function cr(partial: Partial<Cr>): Pick<Cr, 'status' | 'ops' | 'mergedRev' | 'closedRev'> {
  return { status: 'draft', ops: [], mergedRev: null, closedRev: null, ...partial };
}

describe('clashesOf', () => {
  it('reports a different change on the same spot that Main took after the CR change', () => {
    const y = rename('PG-203 Country list field type, on staging', 0, 'quang');
    const x = rename('PG-203 Country list field (multi-select)', 0);
    const commits = [commit(1, [y])];
    expect(clashesOf([x], commits)).toEqual([
      { key: 'loop:pg203:title', index: 0, x, y, commit: commits[0] },
    ]);
  });

  it('drops an identical change silently', () => {
    const y = rename('Same name', 0, 'quang');
    const x = rename('Same name', 0);
    const commits = [commit(1, [y])];
    expect(clashesOf([x], commits)).toEqual([]);
    expect(liveOps([x], commits)).toEqual([]);
  });

  it('does not clash with a Main change the editor already saw', () => {
    const commits = [commit(1, [rename('Main name', 0, 'quang')])];
    const x = rename('CR name', 1);
    expect(clashesOf([x], commits)).toEqual([]);
    expect(liveOps([x], commits)).toEqual([x]);
  });

  it('does not clash on two different fields of one work item', () => {
    const commits = [commit(1, [rename('Main name', 0, 'quang')])];
    const x = makeOp('msAdd', { workItemId: 'pg203', milestoneId: 'golive' }, 0);
    expect(clashesOf([x], commits)).toEqual([]);
  });

  it('reports the latest matching Main op', () => {
    const first = rename('First', 0, 'quang');
    const last = rename('Last', 1, 'quang');
    const commits = [commit(1, [first]), commit(2, [makeOp('hide', { eventId: 'x2' }, 1), last])];
    const [clash] = clashesOf([rename('Mine', 0)], commits);
    expect(clash.y).toBe(last);
    expect(clash.commit.rev).toBe(2);
  });

  it('gives the index of the CR op', () => {
    const commits = [commit(1, [rename('Main name', 0, 'quang')])];
    const ops = [makeOp('hide', { eventId: 'x2' }, 0), rename('CR name', 0)];
    expect(clashesOf(ops, commits).map((c) => c.index)).toEqual([1]);
  });
});

describe('liveOps', () => {
  const commits = [commit(1, [rename('Main name', 0, 'quang')])];
  const x = rename('CR name', 0);
  const key = 'loop:pg203:title';

  it('keeps a clashing op without picks', () => {
    expect(liveOps([x], commits)).toEqual([x]);
  });

  it('drops the CR op when the owner picks Main', () => {
    expect(liveOps([x], commits, { [key]: 'main' })).toEqual([]);
  });

  it('keeps the CR op when the owner picks the CR', () => {
    expect(liveOps([x], commits, { [key]: 'cr' })).toEqual([x]);
  });
});

describe('newerOps', () => {
  it('lists the ops of commits after the revision in order', () => {
    const a = rename('A', 0);
    const b = rename('B', 1);
    const c = rename('C', 2);
    const commits = [commit(3, [c]), commit(1, [a]), commit(2, [b])];
    expect(newerOps(commits, 1).map((n) => [n.commit.rev, n.y])).toEqual([
      [2, b],
      [3, c],
    ]);
  });
});

describe('mainState and crState', () => {
  const merge1 = commit(1, [
    makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }, 0),
    makeOp('msDate', {
      milestoneId: 'golive',
      date: '2026-10-15',
      why: 'The CRS section is not ready.',
      by: 'minh',
      at: at('2026-10-08T16:55'),
    }),
  ]);
  const merge2 = commit(2, [rename('PG-203 on staging', 1, 'quang')]);
  const commits = [merge1, merge2];

  it('replays every merge, or the merges up to a revision', () => {
    const latest = mainState(base, rows, commits);
    expect(latest.milestones.find((m) => m.id === 'golive')?.planned).toBe('2026-10-15');
    expect(latest.queue.events.map((e) => e.id)).not.toContain('qe3');
    expect(latest.workItems.find((w) => w.id === 'pg203')?.title).toBe('PG-203 on staging');
    const first = mainState(base, rows, commits, 1);
    expect(first.workItems.find((w) => w.id === 'pg203')?.title).toBe(
      'PG-203 Country list field type',
    );
    expect(mainState(base, rows, commits, 0).queue.events).toHaveLength(4);
  });

  it('shows an open CR as the latest Main plus its live ops', () => {
    const ops = [
      makeOp('place', { itemId: 'q1', teamId: 'engineering' }, 1, 'lan'),
      rename('PG-203 on staging', 1, 'lan'),
    ];
    const view = crState(base, rows, commits, cr({ status: 'ready', ops }));
    expect(view.entries).toHaveLength(1);
    expect(view.state.workItems.find((w) => w.id === 'q1')?.teamId).toBe('engineering');
    expect([...view.marks.workItems]).toEqual(['q1']);
  });

  it('shows a merged CR as Main right after its merge', () => {
    const view = crState(base, rows, commits, cr({ status: 'merged', mergedRev: 1 }));
    expect(view.state.milestones.find((m) => m.id === 'golive')?.planned).toBe('2026-10-15');
    expect(view.state.workItems.find((w) => w.id === 'pg203')?.title).toBe(
      'PG-203 Country list field type',
    );
    expect([...view.marks.milestones]).toEqual(['golive']);
    expect([...view.marks.events]).toEqual(['qe3']);
  });

  it('shows a closed CR as Main at its close revision plus its ops', () => {
    const ops = [rename('Closed name', 0, 'lan')];
    const view = crState(base, rows, commits, cr({ status: 'closed', closedRev: 1, ops }));
    expect(view.state.workItems.find((w) => w.id === 'pg203')?.title).toBe('Closed name');
    expect(view.state.milestones.find((m) => m.id === 'golive')?.planned).toBe('2026-10-15');
  });
});
