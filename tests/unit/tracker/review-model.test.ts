import { describe, expect, it } from 'vitest';
import {
  LARKSPUR_MEMBERS,
  LARKSPUR_OWNER,
  larkspurCrs,
} from '../../../src/server/tracker/seed/larkspur';
import { liveOps, mainState, type Commit } from '../../../src/tracker/clash';
import { queueFromRows, replayOps, type Op } from '../../../src/tracker/ops';
import type { Cr, Member, Resolution, TrackerPayload } from '../../../src/tracker/payload';
import { openedReview, reviewModel } from '../../../src/tracker/review';
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
  active: true,
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
    offsets: {},
  };
}

/** Main after #2 merges, so #3 clashes with it on the PG-203 name. */
function afterTwoMerges() {
  const { cr1, cr2, cr3, cr4, commits } = seed();
  const c2 = commitOf(cr2, 2, described(commits, liveOps(cr2.ops, commits), 1));
  const merged2: Cr = { ...cr2, status: 'merged', mergedRev: 2, mergedBy: LARKSPUR_OWNER };
  return { crs: [cr1, merged2, cr3, cr4], commits: [...commits, c2], cr3 };
}

/** #5 made its changes at rev 1; then #6 took the queue card qe1 and hid p31 in Main. */
function mainTookTheSpots() {
  const { cr1, commits } = seed();
  const cr5 = makeCr(5, {
    author: 'lan',
    ops: described(commits, [
      makeOp('attach', { eventId: 'qe1', workItemId: 'incident' }, 1, 'lan'),
      makeOp('kind', { eventId: 'p31', kind: 'issue' }, 1, 'lan'),
      makeOp('rename', { workItemId: 'secret', title: 'Secret renewed' }, 1, 'lan'),
    ]),
  });
  const mainOps = described(commits, [
    makeOp('attach', { eventId: 'qe1', workItemId: 'secret' }, 1, 'quang'),
    makeOp('hide', { eventId: 'p31' }, 1, 'quang'),
  ]);
  const cr6 = makeCr(6, {
    author: 'quang',
    status: 'merged',
    ops: mainOps,
    mergedRev: 2,
    mergedBy: LARKSPUR_OWNER,
  });
  return { crs: [cr1, cr5, cr6], commits: [...commits, commitOf(cr6, 2, mainOps)] };
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
    expect(keepCr?.clashes.map((k) => k.crApplies)).toEqual([true]);
  });

  it('marks a clash whose CR version cannot apply on top of Main and never merges that pick', () => {
    const { crs, commits } = mainTookTheSpots();
    const p = payload(crs, commits);
    const model = reviewModel(p, 5, {});
    expect(model?.clashes.map((k) => [k.key, k.index, k.crApplies])).toEqual([
      ['event:qe1', 0, false],
      ['act:p31', 1, false],
    ]);
    const keepCr = reviewModel(p, 5, { 'event:qe1': 'cr', 'act:p31': 'main' });
    expect(keepCr?.picks).toEqual({ 'event:qe1': 'cr', 'act:p31': 'main' });
    expect(keepCr?.canMerge).toBe(false);
    const keepMain = reviewModel(p, 5, { 'event:qe1': 'main', 'act:p31': 'main' });
    expect(keepMain?.canMerge).toBe(true);
    expect(keepMain?.after.events.find((e) => e.id === 'qe1')?.workItemId).toBe('secret');
    expect(titleOf(keepMain!.after, 'secret')).toBe('Secret renewed');
  });

  it('reports the clash of a draft but never lets the owner merge it', () => {
    const { crs, commits, cr3 } = afterTwoMerges();
    const draft: Cr = { ...cr3, status: 'draft' };
    const p = payload([...crs.filter((c) => c.num !== 3), draft], commits);
    const model = reviewModel(p, 3, { 'loop:pg203:title': 'cr' });
    if (!model) throw new Error('no model');
    expect(model.owner).toBe(true);
    expect(model.clashes.map((k) => [k.key, k.index, k.fromAuthor])).toEqual([
      ['loop:pg203:title', 1, 'lan'],
    ]);
    expect(model.changes.map((c) => c.clash?.key ?? null)).toEqual([null, 'loop:pg203:title']);
    expect(model.picks).toEqual({ 'loop:pg203:title': 'cr' });
    expect(titleOf(model.after, 'pg203')).toBe('PG-203 Country list field type, on staging');
    expect(model.canMerge).toBe(false);
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

  it('marks a change whose queue card was removed as skipped, and never merges only that', () => {
    const { cr1, commits } = seed();
    const gone = makeOp('attach', { eventId: 'nope', workItemId: 'pg203' }, 1, 'lan');
    const cr = makeCr(5, { author: 'lan', ops: [gone] });
    const model = reviewModel(payload([cr1, cr], commits), 5, {});
    expect(model?.changes[0]).toMatchObject({ skipped: true, skipReason: 'queue', opIndex: 0 });
    expect(model?.changes[0].d.change).toBe('no longer applies');
    expect(model?.canMerge).toBe(false);
  });

  it('says why each change no longer applies', () => {
    const { crs, commits } = mainTookTheSpots();
    const fromEvent = makeOp(
      'fromEvent',
      {
        id: 'scopecall',
        eventId: 'qe1',
        teamId: 'engineering',
        title: 'Scope call',
        doneBy: 'quang',
        requestedBy: 'lan',
        after: null,
        plannedFinish: '2026-10-20',
      },
      1,
      'lan',
    );
    const rename = makeOp('rename', { workItemId: 'scopecall', title: 'Scope call, Sarah' }, 1);
    const orphan = makeOp('rename', { workItemId: 'nowhere', title: 'X' }, 1, 'lan');
    const ops = [...described(commits.slice(0, 1), [fromEvent, rename]), orphan];
    const cr7 = makeCr(7, { author: 'lan', ops });
    const p = payload([...crs, cr7], commits);
    expect(reviewModel(p, 5, {})?.changes.map((c) => [c.opIndex, c.skipped, c.skipReason])).toEqual(
      [
        [0, true, 'main'],
        [1, true, 'main'],
        [2, false, null],
      ],
    );
    expect(reviewModel(p, 7, {})?.changes.map((c) => [c.opIndex, c.skipReason])).toEqual([
      [0, 'main'],
      [1, 'skipped'],
      [2, 'removed'],
    ]);
    expect(reviewModel(p, 7, { 'event:qe1': 'main' })?.canMerge).toBe(false);
  });

  it('blames Main, not the queue, for a closed change whose card or spot Main used before the close', () => {
    const { crs, commits } = mainTookTheSpots();
    const [, cr5] = crs;
    const closed: Cr = { ...cr5, status: 'closed', closedRev: 2, closedBy: LARKSPUR_OWNER };
    const sameAsMain = makeCr(8, {
      author: 'lan',
      status: 'closed',
      closedRev: 2,
      closedBy: LARKSPUR_OWNER,
      ops: described(commits.slice(0, 1), [
        makeOp('attach', { eventId: 'qe1', workItemId: 'secret' }, 1, 'quang'),
      ]),
    });
    const p = payload([...crs.filter((c) => c.num !== 5), closed, sameAsMain], commits);
    expect(reviewModel(p, 5, {})?.changes.map((c) => [c.opIndex, c.skipReason])).toEqual([
      [0, 'main'],
      [1, 'main'],
      [2, null],
    ]);
    expect(reviewModel(p, 8, {})?.changes.map((c) => c.skipReason)).toEqual(['main']);
  });

  it('keeps the queue reason for a closed change whose card Main did not use', () => {
    const { crs, commits } = mainTookTheSpots();
    const gone = makeOp('attach', { eventId: 'nope', workItemId: 'pg203' }, 1, 'lan');
    const closed = makeCr(9, { author: 'lan', status: 'closed', closedRev: 2, ops: [gone] });
    const model = reviewModel(payload([...crs, closed], commits), 9, {});
    expect(model?.changes.map((c) => c.skipReason)).toEqual(['queue']);
  });
});

describe('openedReview', () => {
  it('shows the live payload while the change request keeps the revision the owner opened', () => {
    const { cr1, cr2, commits } = seed();
    const live = payload([cr1, cr2], commits);
    expect(openedReview(live, cr2)).toEqual({ payload: live, changed: false });
    expect(openedReview(live, null)).toEqual({ payload: live, changed: false });
  });

  it('shows the live payload to a viewer who is not the owner, even after an edit', () => {
    const { cr1, cr2, commits } = seed();
    const rename = makeOp('rename', { workItemId: 'secret', title: 'Secret renewed' }, 1, 'lan');
    const edited: Cr = { ...cr2, status: 'draft', revision: 3, ops: [...cr2.ops, rename] };
    for (const me of ['lan', 'nobody']) {
      const live = payload([cr1, edited], commits, me);
      expect(openedReview(live, cr2)).toEqual({ payload: live, changed: false });
    }
  });

  it('keeps the opened changes and status after an edit, with the live conversation', () => {
    const { cr1, cr2, commits } = seed();
    const rename = makeOp('rename', { workItemId: 'secret', title: 'Secret renewed' }, 1, 'lan');
    const comment = {
      id: 'm1',
      memberId: 'quang',
      kind: 'comment' as const,
      body: 'Looks fine.',
      opIndex: null,
      createdAt: at('2026-10-09T17:10'),
    };
    const edited: Cr = {
      ...cr2,
      status: 'draft',
      revision: 3,
      ops: [...cr2.ops, rename],
      comments: [comment],
      asks: [{ memberId: 'khoa', createdAt: at('2026-10-09T17:12') }],
    };
    const { payload: shown, changed } = openedReview(payload([cr1, edited], commits), cr2);
    expect(changed).toBe(true);
    const cr = shown.crs.find((c) => c.num === 2);
    expect(cr).toMatchObject({ status: 'ready', revision: 1, ops: cr2.ops });
    expect(cr?.comments).toEqual([comment]);
    expect(cr?.asks).toEqual(edited.asks);
    expect(shown.crs.find((c) => c.num === 1)).toBe(cr1);
    expect(reviewModel(shown, 2, {})?.changes).toHaveLength(2);
  });
});
