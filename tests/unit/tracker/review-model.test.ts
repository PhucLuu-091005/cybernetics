import { describe, expect, it } from 'vitest';
import {
  LARKSPUR_MEMBERS,
  LARKSPUR_OWNER,
  larkspurCrs,
} from '../../../src/server/tracker/seed/larkspur';
import { liveOps, mainState, type Commit } from '../../../src/tracker/clash';
import { queueFromRows, replayOps, type Op } from '../../../src/tracker/ops';
import type { Cr, Member, Resolution, TrackerPayload } from '../../../src/tracker/payload';
import { reviewModel } from '../../../src/tracker/review';
import {
  at,
  larkspurBase,
  larkspurQueueRows,
  makeOp,
  TIME_ZONE,
} from '../../support/tracker-fixture';

const base = larkspurBase();
const queue = queueFromRows(larkspurQueueRows());
const members: Member[] = LARKSPUR_MEMBERS.map((m) => ({
  id: m.key,
  name: m.name,
  roleLabel: m.roleLabel,
  color: m.color,
  userId: null,
}));

function described(commits: readonly Commit[], ops: readonly Op[], upto?: number): Op[] {
  const { entries } = replayOps(mainState(base, queue, commits, upto), ops, TIME_ZONE);
  return entries.map(({ i, skipped, ...d }) => {
    if (skipped) throw new Error(`Fixture op ${i} does not apply`);
    return { ...ops[i], d };
  });
}

function makeCr(num: number, partial: Partial<Cr> & Pick<Cr, 'author' | 'ops'>): Cr {
  return {
    id: `cr${num}`,
    num,
    title: `Change request ${num}`,
    editor: partial.author,
    status: 'ready',
    revision: 1,
    createdAt: at('2026-10-09T15:00'),
    updatedAt: at('2026-10-09T15:00'),
    mergedRev: null,
    mergedBy: null,
    mergedAt: null,
    closedBy: null,
    closedAt: null,
    closedRev: null,
    resolutions: [],
    shares: [],
    asks: [],
    comments: [],
    ...partial,
  };
}

function commitOf(cr: Cr, rev: number, ops: Op[], resolutions: Resolution[] = []): Commit {
  return {
    rev,
    crId: cr.id,
    crNum: cr.num,
    mergedBy: LARKSPUR_OWNER,
    mergedAt: at('2026-10-09T17:00'),
    ops,
    resolutions,
  };
}

function seed() {
  const [s1, s2, s3, s4] = larkspurCrs();
  const cr1 = makeCr(1, {
    title: s1.title,
    author: s1.author,
    status: 'merged',
    ops: described([], s1.ops),
    mergedRev: 1,
    mergedBy: LARKSPUR_OWNER,
    mergedAt: s1.mergedAt,
  });
  const c1 = commitOf(cr1, 1, described([], s1.ops));
  const commits = [c1];
  const cr2 = makeCr(2, { title: s2.title, author: s2.author, ops: described(commits, s2.ops) });
  const cr3 = makeCr(3, { title: s3.title, author: s3.author, ops: described(commits, s3.ops) });
  const cr4 = makeCr(4, {
    title: s4.title,
    author: s4.author,
    status: 'draft',
    ops: described(commits, s4.ops),
    shares: s4.shares,
  });
  return { cr1, cr2, cr3, cr4, commits };
}

function payload(crs: Cr[], commits: Commit[], me = LARKSPUR_OWNER): TrackerPayload {
  return {
    project: {
      id: 'p1',
      title: 'Larkspur',
      clientName: 'Larkspur Capital',
      timeZone: TIME_ZONE,
      windowStart: null,
      asOf: null,
      demo: true,
      ownerMemberId: LARKSPUR_OWNER,
    },
    members,
    me: members.find((m) => m.id === me) ?? null,
    base,
    queue,
    commits,
    crs,
  };
}

/** Main after #2 merges, so #3 clashes with it on the PG-203 name. */
function afterTwoMerges() {
  const { cr1, cr2, cr3, cr4, commits } = seed();
  const c2 = commitOf(cr2, 2, described(commits, liveOps(cr2.ops, commits), 1));
  const merged2: Cr = { ...cr2, status: 'merged', mergedRev: 2, mergedBy: LARKSPUR_OWNER };
  return { crs: [cr1, merged2, cr3, cr4], commits: [...commits, c2], cr3 };
}

const titleOf = (state: { workItems: Array<{ id: string; title: string }> }, id: string) =>
  state.workItems.find((w) => w.id === id)?.title;

describe('reviewModel', () => {
  it('returns null for a number that names no change request', () => {
    const { cr1, commits } = seed();
    expect(reviewModel(payload([cr1], commits), 9, {})).toBeNull();
  });

  it('shows a ready CR as the latest Main before and Main plus its live ops after', () => {
    const { cr1, cr2, cr3, cr4, commits } = seed();
    const model = reviewModel(payload([cr1, cr2, cr3, cr4], commits), 2, {});
    if (!model) throw new Error('no model');
    expect(model.cr.num).toBe(2);
    expect(model.before).toEqual(mainState(base, queue, commits));
    expect(model.before.workItems.some((w) => w.id === 'q1')).toBe(false);
    expect(titleOf(model.after, 'q1')).toBe('PG-204 Tax ID format check');
    expect(titleOf(model.after, 'pg203')).toBe('PG-203 Country list field (multi-select)');
    expect(model.marks.workItems).toEqual(new Set(['q1', 'pg203']));
    expect(model.changes.map((c) => c.d)).toEqual([
      {
        item: 'PG-204 Tax ID format check',
        change: 'placed',
        before: 'Queue',
        after: 'Engineering, after Analyse the CRS and FATCA rules',
      },
      {
        item: 'PG-203 Country list field (multi-select)',
        change: 'renamed',
        before: 'PG-203 Country list field type',
        after: 'PG-203 Country list field (multi-select)',
      },
    ]);
    expect(model.changes.map((c) => [c.opIndex, c.workItemId, c.title, c.skipped])).toEqual([
      [0, 'q1', 'PG-204 Tax ID format check', false],
      [1, 'pg203', 'PG-203 Country list field (multi-select)', false],
    ]);
    expect(model.clashes).toEqual([]);
    expect(model.dropped).toEqual([]);
    expect(model.owner).toBe(true);
    expect(model.canMerge).toBe(true);
  });

  it('lets only the owner merge, only a ready CR, and only one with a live change', () => {
    const { cr1, cr2, cr3, cr4, commits } = seed();
    const crs = [cr1, cr2, cr3, cr4];
    const asLan = reviewModel(payload(crs, commits, 'lan'), 2, {});
    expect(asLan?.owner).toBe(false);
    expect(asLan?.canMerge).toBe(false);
    expect(reviewModel(payload(crs, commits), 4, {})?.canMerge).toBe(false);
    const empty = makeCr(5, { author: 'lan', ops: [] });
    expect(reviewModel(payload([...crs, empty], commits), 5, {})?.canMerge).toBe(false);
  });

  it('describes each live change against the latest Main and drops a change Main already has', () => {
    const { cr1, commits } = seed();
    const same = makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }, 0, 'lan');
    const place = makeOp('place', { itemId: 'q2', teamId: 'implementation' }, 0, 'lan');
    const cr = makeCr(5, { author: 'lan', ops: [same, place] });
    const model = reviewModel(payload([cr1, cr], commits), 5, {});
    expect(model?.changes.map((c) => [c.opIndex, c.op, c.d.item])).toEqual([
      [1, place, 'Investor statement template'],
    ]);
  });

  it('finds the event quote, the date reason and the spot each change points at', () => {
    const { cr1, commits } = seed();
    const kind = makeOp('kind', { eventId: 'p31', kind: 'issue' }, 1, 'quang');
    const cr = makeCr(5, { author: 'quang', ops: [kind] });
    const kindModel = reviewModel(payload([cr1, cr], commits), 5, {});
    expect(kindModel?.changes[0]).toMatchObject({
      workItemId: 'pg203',
      milestoneId: null,
      event: { id: 'p31', kind: 'issue', by: 'lan' },
    });

    const model = reviewModel(payload([cr1], commits), 1, {});
    const [attach, move] = model?.changes ?? [];
    expect(attach).toMatchObject({
      workItemId: 'golive',
      milestoneId: null,
      event: { id: 'qe3', workItemId: 'golive' },
    });
    expect(move).toMatchObject({
      workItemId: null,
      milestoneId: 'golive',
      event: null,
      d: {
        change: 'planned date moved',
        why: 'The CRS section is not ready. Sarah agreed on 13 September.',
      },
    });
  });

  it('reports a clash with its label, both sides and the author of the Main change', () => {
    const { crs, commits, cr3 } = afterTwoMerges();
    const model = reviewModel(payload(crs, commits), 3, {});
    if (!model) throw new Error('no model');
    expect(model.clashes).toHaveLength(1);
    const [clash] = model.clashes;
    expect(clash).toMatchObject({
      key: 'loop:pg203:title',
      index: 1,
      label: 'PG-203 Country list field type · name',
      fromAuthor: 'lan',
      mainVal: 'PG-203 Country list field (multi-select)',
      crVal: 'PG-203 Country list field type, on staging',
    });
    expect(clash.commit.crNum).toBe(2);
    expect(clash.x).toBe(cr3.ops[1]);
    expect(model.changes.map((c) => c.clash?.key ?? null)).toEqual([null, 'loop:pg203:title']);
    expect(model.changes[1].d.before).toBe('PG-203 Country list field (multi-select)');
    expect(model.canMerge).toBe(false);
  });

  it('applies the picks to After and keeps only the picks of current clashes', () => {
    const { crs, commits } = afterTwoMerges();
    const p = payload(crs, commits);
    const keepMain = reviewModel(p, 3, { 'loop:pg203:title': 'main', 'loop:gone:title': 'cr' });
    expect(keepMain?.picks).toEqual({ 'loop:pg203:title': 'main' });
    expect(keepMain?.canMerge).toBe(true);
    expect(keepMain?.changes).toHaveLength(2);
    expect(titleOf(keepMain!.after, 'pg203')).toBe('PG-203 Country list field (multi-select)');
    expect(keepMain?.after.events.some((e) => e.id === 'qd1')).toBe(true);

    const keepCr = reviewModel(p, 3, { 'loop:pg203:title': 'cr' });
    expect(keepCr?.canMerge).toBe(true);
    expect(titleOf(keepCr!.after, 'pg203')).toBe('PG-203 Country list field type, on staging');
  });

  it('shows a merged CR as Main around its merge, with the ops of its commit and the dropped picks', () => {
    const { crs, commits, cr3 } = afterTwoMerges();
    const resolution: Resolution = {
      key: 'loop:pg203:title',
      label: 'PG-203 Country list field type · name',
      chose: 'main',
      mainVal: 'PG-203 Country list field (multi-select)',
      crVal: 'PG-203 Country list field type, on staging',
      from: 2,
      by: LARKSPUR_OWNER,
    };
    const kept = liveOps(cr3.ops, commits, { 'loop:pg203:title': 'main' });
    const c3 = commitOf(cr3, 3, described(commits, kept), [resolution]);
    const merged: Cr = {
      ...cr3,
      status: 'merged',
      mergedRev: 3,
      mergedBy: LARKSPUR_OWNER,
      resolutions: [resolution],
    };
    const all = [...commits, c3];
    const model = reviewModel(payload([...crs.filter((c) => c.num !== 3), merged], all), 3, {
      'loop:pg203:title': 'cr',
    });
    if (!model) throw new Error('no model');
    expect(model.before).toEqual(mainState(base, queue, all, 2));
    expect(model.after).toEqual(mainState(base, queue, all, 3));
    expect(model.changes.map((c) => [c.opIndex, c.d.item, c.d.change])).toEqual([
      [0, 'Delivery by Quang Nguyễn', 'added'],
    ]);
    expect(model.changes[0].event).toMatchObject({
      id: 'qd1',
      text: 'The country list field is on staging.',
    });
    expect(model.dropped).toEqual([resolution]);
    expect(model.clashes).toEqual([]);
    expect(model.picks).toEqual({});
    expect(model.canMerge).toBe(false);
  });

  it('keeps a picked CR value out of the dropped list of a merged CR', () => {
    const { cr1, commits } = seed();
    const kept: Resolution = {
      key: 'ms:golive:date',
      label: 'Go-live and first close · planned date',
      chose: 'cr',
      mainVal: '20 Oct',
      crVal: '15 Oct',
      from: 9,
      by: LARKSPUR_OWNER,
    };
    const model = reviewModel(payload([{ ...cr1, resolutions: [kept] }], commits), 1, {});
    expect(model?.dropped).toEqual([]);
    expect(model?.before).toEqual(mainState(base, queue, commits, 0));
    expect(model?.changes.map((c) => c.opIndex)).toEqual([0, 1]);
  });

  it('shows a closed CR as Main at its close revision plus its ops', () => {
    const { cr1, cr2, cr3, commits } = seed();
    const closed: Cr = { ...cr2, status: 'closed', closedRev: 1, closedBy: LARKSPUR_OWNER };
    const later = [...commits, commitOf(cr3, 2, described(commits, cr3.ops))];
    const model = reviewModel(payload([cr1, closed, cr3], later), 2, {});
    if (!model) throw new Error('no model');
    expect(model.before).toEqual(mainState(base, queue, later, 1));
    expect(titleOf(model.before, 'pg203')).toBe('PG-203 Country list field type');
    expect(titleOf(model.after, 'pg203')).toBe('PG-203 Country list field (multi-select)');
    expect(titleOf(model.after, 'q1')).toBe('PG-204 Tax ID format check');
    expect(model.changes.map((c) => c.opIndex)).toEqual([0, 1]);
    expect(model.clashes).toEqual([]);
    expect(model.canMerge).toBe(false);
  });

  it('marks a change that no longer applies as skipped', () => {
    const { cr1, commits } = seed();
    const gone = makeOp('attach', { eventId: 'nope', workItemId: 'pg203' }, 1, 'lan');
    const cr = makeCr(5, { author: 'lan', ops: [gone] });
    const model = reviewModel(payload([cr1, cr], commits), 5, {});
    expect(model?.changes[0]).toMatchObject({ skipped: true, opIndex: 0 });
    expect(model?.changes[0].d.change).toBe('skipped (depends on a removed change)');
  });
});
