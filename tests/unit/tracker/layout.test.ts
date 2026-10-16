import { describe, expect, it } from 'vitest';
import {
  GEOMETRY,
  STATUS_TONE,
  layoutTracker,
  type LayoutSegment,
  type TrackerLayout,
  type View,
} from '../../../src/tracker/layout';
import type { TrackerState } from '../../../src/tracker/model';
import { replayOps, type Marks } from '../../../src/tracker/ops';
import { itemStatus } from '../../../src/tracker/status';
import {
  AS_OF,
  TIME_ZONE,
  at,
  buildState,
  event,
  larkspurState,
  makeOp,
  workItem,
} from '../../support/tracker-fixture';

const { X0, X1, TRUNK_Y, MS_Y, AXIS_Y, FOLD } = GEOMETRY;

const view = (over: Partial<View> = {}): View => ({
  hiddenRows: new Set(),
  hiddenTeams: new Set(),
  asOf: AS_OF,
  timeZone: TIME_ZONE,
  windowStart: '2026-09-10',
  windowEnd: '2026-10-17',
  ...over,
});

const ms = (local: string) => Date.parse(at(local));
const midnight = (date: string) => Date.parse(`${date}T00:00:00+07:00`);
const noon = (date: string) => Date.parse(`${date}T12:00:00+07:00`);

const lines = (L: TrackerLayout, id: string) =>
  L.segments.filter(
    (s): s is Extract<LayoutSegment, { kind: 'line' }> => s.workItemId === id && s.kind === 'line',
  );

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const noMarks = (): Marks => ({
  workItems: new Set(),
  events: new Set(),
  milestones: new Set(),
  dates: new Set(),
});

describe('layoutTracker: scale and window', () => {
  const L = layoutTracker(larkspurState(), view());

  it('maps the window onto the label column and the right edge', () => {
    expect(L.width).toBe(1060);
    expect(L.x(midnight('2026-09-10'))).toBeCloseTo(X0, 9);
    expect(L.x(midnight('2026-10-17'))).toBeCloseTo(X1, 9);
    expect(L.window).toMatchObject({
      start: '2026-09-10',
      end: '2026-10-17',
      startMs: midnight('2026-09-10'),
      endMs: midnight('2026-10-17'),
      label: 'Work items from 10 Sept to 16 Oct',
    });
  });

  it('keeps x(t) and t(x) inverse within 1 ms', () => {
    for (const t of [midnight('2026-09-10'), Date.parse(AS_OF), ms('2026-09-24T09:20')]) {
      expect(Math.abs(L.t(L.x(t)) - t)).toBeLessThan(1);
    }
    for (const x of [X0, 400.5, 777.25, X1]) expect(L.x(L.t(x))).toBeCloseTo(x, 6);
  });

  it('draws a grid tick every 7 days from the first Monday and hides labels near the T line', () => {
    expect(L.ticks.map((t) => t.date)).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ]);
    expect(L.ticks.map((t) => t.labelled)).toEqual([true, true, true, true, false]);
    expect(L.ticks[0]).toMatchObject({ label: '14 Sept', x: L.x(midnight('2026-09-14')) });
  });

  it('puts the T line at asOf', () => {
    expect(L.tLine).toEqual({
      x: L.x(Date.parse(AS_OF)),
      y1: AXIS_Y + 5,
      y2: L.height,
      label: 'T 9 Oct 18:00',
    });
  });

  it('defaults the window to 3 days before the earliest relevant start and past the plans', () => {
    const D = layoutTracker(
      larkspurState(),
      view({ windowStart: undefined, windowEnd: undefined }),
    );
    expect(D.window.start).toBe('2026-06-29');
    expect(D.window.end).toBe('2026-10-19');
  });

  it('ignores items finished more than 60 days ago for the default start', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'old', teamId: 't', plannedFinish: '2026-07-01' }),
        workItem({ id: 'recent', teamId: 't', plannedFinish: '2026-09-01' }),
        workItem({ id: 'open', teamId: 't', plannedFinish: '2026-10-10' }),
      ],
      events: [
        event({ id: 'o1', workItemId: 'old', at: at('2026-06-20T09:00') }),
        event({ id: 'o2', workItemId: 'old', kind: 'done', at: at('2026-07-01T09:00') }),
        event({ id: 'r1', workItemId: 'recent', at: at('2026-08-25T09:00') }),
        event({ id: 'r2', workItemId: 'recent', kind: 'done', at: at('2026-09-01T09:00') }),
        event({ id: 'n1', workItemId: 'open', at: at('2026-09-20T09:00') }),
      ],
    });
    const D = layoutTracker(s, view({ windowStart: undefined, windowEnd: undefined }));
    expect(D.window.start).toBe('2026-08-22');
    expect(D.window.end).toBe('2026-10-16');
    expect(D.rows.map((r) => r.id)).toEqual(['recent', 'open']);
  });

  it('starts an empty project 3 days before asOf', () => {
    const D = layoutTracker(buildState(), view({ windowStart: undefined, windowEnd: undefined }));
    expect(D.window.start).toBe('2026-10-06');
    expect(D.window.end).toBe('2026-10-16');
  });
});

describe('layoutTracker: lanes and rows', () => {
  it('lists 7 lanes in team order', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.lanes.map((l) => l.name)).toEqual([
      'Implementation',
      'Digitization',
      'Solutions Engineering',
      'Engineering',
      'Digitization QA',
      'Customer Success',
      'IT',
    ]);
    expect(L.lanes.map((l) => l.alt)).toEqual([false, true, false, true, false, true, false]);
    expect(L.lanes[0]).toMatchObject({
      teamId: 'implementation',
      top: TRUNK_Y + 16,
      bottom: 188,
      hidden: false,
      count: 3,
      hiddenCount: 0,
      guide: { y1: TRUNK_Y + 36, y2: 166 },
      eyeLabel: 'Hide Implementation',
    });
  });

  it('gives one row per visible work item and drops items finished before the window', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.rows.map((r) => [r.id, r.y])).toEqual([
      ['golive', 102],
      ['crs', 134],
      ['rehearsal', 166],
      ['analyse', 226],
      ['pg201', 286],
      ['pg202', 318],
      ['dynamics', 378],
      ['syncmon', 410],
      ['crmlive', 442],
      ['pg203', 474],
      ['test', 534],
      ['incident', 594],
      ['secret', 654],
    ]);
    expect(L.rows.every((r) => r.fold === null && !r.draft)).toBe(true);
    expect(L.rows.find((r) => r.id === 'crs')).toMatchObject({
      title: 'CRS tax residency section with DealCloud sync',
      label: 'CRS tax residency section…',
      teamId: 'implementation',
      done: false,
      status: 'planned',
      milestoneId: 'golive',
      eyeLabel: 'Hide CRS tax residency section with DealCloud sync',
    });
    expect(L.height).toBe(732);
  });

  it('folds a hidden team into one strip with the hidden count', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['engineering']) }));
    const lane = L.lanes.find((l) => l.teamId === 'engineering');
    expect(lane).toMatchObject({ hidden: true, count: 4, hiddenCount: 4, guide: null });
    expect(lane?.eyeLabel).toBe('Show Engineering');
    const folds = L.folds.filter((f) => f.kind === 'team');
    expect(folds).toEqual([
      {
        kind: 'team',
        teamId: 'engineering',
        count: 4,
        x: 22,
        y: 362,
        width: X1 - 22,
        height: FOLD,
        textX: 30,
        textY: 362 + FOLD / 2 + 3.5,
        text: '4 hidden items in Engineering. Click to show.',
        ariaLabel: 'Show Engineering',
      },
    ]);
    const engineering = ['dynamics', 'syncmon', 'crmlive', 'pg203'];
    for (const id of engineering) {
      expect(L.rows.find((r) => r.id === id)).toMatchObject({ fold: 'team', y: 362 + FOLD / 2 });
    }
    expect(L.segments.some((s) => engineering.includes(s.workItemId))).toBe(false);
    expect(L.eventGroups.some((g) => engineering.includes(g.workItemId))).toBe(false);
    expect(L.flags.some((f) => engineering.includes(f.workItemId))).toBe(false);
    expect(L.laneDrops.map((d) => d.teamId)).not.toContain('engineering');
    expect(L.height).toBe(619);
  });

  it('writes 1 hidden item in the singular', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenTeams: new Set(['it']) }));
    expect(L.folds.find((f) => f.kind === 'team')?.text).toBe(
      '1 hidden item in IT. Click to show.',
    );
  });

  it('folds a hidden row into a strip with its title', () => {
    const L = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['pg203']) }));
    expect(L.folds).toEqual([
      {
        kind: 'row',
        workItemId: 'pg203',
        x: 30,
        y: 458 + 1,
        width: X1 - 30,
        height: FOLD - 2,
        iconX: 38,
        textX: 48,
        textY: 458 + FOLD / 2 + 3.5,
        text: 'PG-203 Country list field type (hidden)',
        ariaLabel: 'Show PG-203 Country list field type',
      },
    ]);
    expect(L.rows.find((r) => r.id === 'pg203')).toMatchObject({ fold: 'row', y: 458 + FOLD / 2 });
    expect(L.lanes.find((l) => l.teamId === 'engineering')).toMatchObject({
      hidden: false,
      hiddenCount: 1,
    });
    expect(L.height).toBe(713);
  });

  it('offers a drop target on each visible lane', () => {
    const L = layoutTracker(larkspurState(), view());
    expect(L.laneDrops).toHaveLength(7);
    expect(L.laneDrops[0]).toEqual({
      teamId: 'implementation',
      x: X0,
      y: TRUNK_Y + 18,
      width: X1 - X0,
      height: 18,
      text: 'Drop here: Implementation',
      textX: X0 + 10,
      textY: TRUNK_Y + 31,
    });
  });

  it('gives an empty lane room for drops', () => {
    const s = buildState({ teams: [{ id: 't', name: 'Team', leadId: null }] });
    const L = layoutTracker(s, view());
    expect(L.lanes[0]).toMatchObject({ top: 64, bottom: 64 + 22 + 18 + 6, count: 0, guide: null });
  });
});

describe('layoutTracker: segments, waits and stems', () => {
  const L = layoutTracker(larkspurState(), view());

  it('turns PG-203 danger after 7 Oct (planned 6 Oct, still open)', () => {
    const segs = lines(L, 'pg203');
    expect(segs.map((s) => s.tone)).toEqual(['route', 'danger']);
    expect(segs[0].x1).toBeCloseTo(L.x(ms('2026-09-24T09:20')), 9);
    expect(segs[0].x2).toBeCloseTo(L.x(midnight('2026-10-07')), 9);
    expect(segs[1].x1).toBeCloseTo(L.x(midnight('2026-10-07')), 9);
    expect(segs[1].x2).toBeCloseTo(L.x(Date.parse(AS_OF)), 9);
    expect(segs[1].y).toBe(474);
  });

  it('shows PG-202 caution after its planned day (finished late)', () => {
    const segs = lines(L, 'pg202');
    expect(segs.map((s) => s.tone)).toEqual(['proceed', 'caution']);
    expect(segs[1].x1).toBeCloseTo(L.x(midnight('2026-10-02')), 9);
    expect(segs[1].x2).toBeCloseTo(L.x(ms('2026-10-02T16:40')), 9);
  });

  it('draws one blue or green line for items inside their plan', () => {
    expect(lines(L, 'crs').map((s) => s.tone)).toEqual(['route']);
    expect(lines(L, 'pg201').map((s) => s.tone)).toEqual(['proceed']);
  });

  it('starts a line that began before the window at the label column', () => {
    const [seg] = lines(L, 'dynamics');
    expect(seg.x1).toBe(X0);
    expect(L.stems.some((s) => s.workItemId === 'dynamics')).toBe(false);
  });

  it('draws a waiting line with the open items it waits for', () => {
    const wait = L.segments.find((s) => s.workItemId === 'test');
    const sx = L.x(ms('2026-10-02T16:40'));
    expect(wait).toEqual({
      kind: 'wait',
      workItemId: 'test',
      x1: sx,
      x2: L.x(Date.parse(AS_OF)),
      y: 534,
      tone: 'ink-3',
      text: 'Waiting for PG-203',
      textX: sx + 8,
      textY: 534 - 7,
    });
  });

  it('writes No events yet when nothing blocks an empty item', () => {
    const s = larkspurState();
    s.workItems.find((w) => w.id === 'test')!.after = [];
    const wait = layoutTracker(s, view()).segments.find((x) => x.workItemId === 'test');
    expect(wait).toMatchObject({ kind: 'wait', text: 'No events yet' });
  });

  it('starts an empty item placed after asOf at the T line', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'src', teamId: 't' }),
        workItem({ id: 'placed', teamId: 't', since: at('2026-10-12T09:00') }),
        workItem({ id: 'led', teamId: 't', after: ['src'], since: at('2026-10-12T09:00') }),
      ],
      events: [
        event({ id: 's1', workItemId: 'src', at: at('2026-09-20T09:00') }),
        event({ id: 's2', workItemId: 'src', kind: 'done', at: at('2026-10-02T16:40') }),
      ],
    });
    const L = layoutTracker(s, view());
    const xt = L.x(Date.parse(AS_OF));
    expect(L.segments.find((x) => x.workItemId === 'placed')).toMatchObject({ x1: xt });
    expect(L.stems.find((x) => x.workItemId === 'placed')?.x).toBe(xt);
    expect(L.segments.find((x) => x.workItemId === 'led')).toMatchObject({ x1: xt });
  });

  it('starts an empty item placed before asOf at the later of since and its finished source', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'src', teamId: 't' }),
        workItem({ id: 'led', teamId: 't', after: ['src'], since: at('2026-09-25T09:00') }),
      ],
      events: [
        event({ id: 's1', workItemId: 'src', at: at('2026-09-20T09:00') }),
        event({ id: 's2', workItemId: 'src', kind: 'done', at: at('2026-10-02T16:40') }),
      ],
    });
    const L = layoutTracker(s, view());
    expect(L.segments.find((x) => x.workItemId === 'led')).toMatchObject({
      x1: L.x(ms('2026-10-02T16:40')),
    });
  });

  it('drops a stem from the parent row, or from the trunk without a parent', () => {
    expect(L.stems.find((s) => s.workItemId === 'pg203')).toEqual({
      workItemId: 'pg203',
      parentId: 'crs',
      x: L.x(ms('2026-09-24T09:20')),
      y1: 134,
      y2: 474,
      tone: 'route',
      ghost: false,
    });
    expect(L.stems.find((s) => s.workItemId === 'rehearsal')).toMatchObject({
      parentId: null,
      y1: TRUNK_Y,
      y2: 166,
      tone: 'proceed',
    });
    expect(L.stems.find((s) => s.workItemId === 'test')).toMatchObject({ tone: 'ink-3' });
  });

  it('ghosts a stem whose parent row is folded', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['crs']) }));
    const crsY = H.rows.find((r) => r.id === 'crs')!.y;
    expect(H.stems.find((s) => s.workItemId === 'pg201')).toMatchObject({
      y1: crsY,
      ghost: true,
      tone: 'ink-3',
    });
  });
});

describe('layoutTracker: events, flags and slips', () => {
  const state = larkspurState();
  const L = layoutTracker(state, view());

  it('groups events closer than 16 units and lists every id, top event last', () => {
    const rehearsal = L.eventGroups.filter((g) => g.workItemId === 'rehearsal');
    expect(rehearsal).toHaveLength(1);
    expect(rehearsal[0]).toMatchObject({
      eventIds: ['r1', 'r2', 'r3'],
      topId: 'r3',
      kind: 'done',
      x: L.x(ms('2026-09-24T16:40')),
      y: 166,
      tone: 'proceed',
      draft: false,
      ariaLabel: 'Done by Sarah Kim, 24 Sept 16:40',
      tooltip:
        'Done · Sarah Kim · 24 Sept 16:40\nSarah accepts the rehearsal.\n3 events on this day',
    });
    expect(L.eventGroups.filter((g) => g.workItemId === 'analyse').map((g) => g.eventIds)).toEqual([
      ['a1'],
      ['a2'],
      ['a3', 'a4'],
    ]);
  });

  it('skips events before the window', () => {
    expect(L.eventGroups.filter((g) => g.workItemId === 'golive').map((g) => g.eventIds)).toEqual([
      ['g3'],
      ['g4'],
    ]);
    expect(L.eventGroups.some((g) => g.workItemId === 'dynamics')).toBe(false);
  });

  it('colours an event after the planned finish red while open', () => {
    const pg203 = L.eventGroups.filter((g) => g.workItemId === 'pg203');
    expect(pg203.map((g) => [g.topId, g.tone])).toEqual([
      ['p31', 'route'],
      ['p32', 'danger'],
    ]);
    const pg202 = L.eventGroups.filter((g) => g.workItemId === 'pg202');
    expect(pg202.map((g) => g.tone)).toEqual(['proceed', 'caution']);
  });

  it('colours each date flag by the item status', () => {
    expect(L.flags).toHaveLength(13);
    for (const flag of L.flags) {
      const item = state.workItems.find((w) => w.id === flag.workItemId)!;
      const status = itemStatus(item, state.events, AS_OF, TIME_ZONE);
      expect(flag.status).toBe(status);
      expect(flag.tone).toBe(STATUS_TONE[status]);
    }
    const tone = (id: string) => L.flags.find((f) => f.workItemId === id)?.tone;
    expect([tone('pg203'), tone('pg202'), tone('pg201'), tone('rehearsal'), tone('crs')]).toEqual([
      'danger',
      'caution',
      'proceed',
      'teal',
      'ink-3',
    ]);
  });

  it('puts the flag at noon of the planned day with its labels', () => {
    expect(L.flags.find((f) => f.workItemId === 'golive')).toEqual({
      workItemId: 'golive',
      date: '2026-10-15',
      x: L.x(noon('2026-10-15')),
      y: 102,
      status: 'planned',
      tone: 'ink-3',
      draft: false,
      moves: 1,
      ariaLabel: 'Planned finish 15 Oct, Planned',
      tooltip: 'Planned finish 15 Oct · Planned · moved 1×',
    });
  });

  it('keeps a flag inside the right edge', () => {
    const s = larkspurState();
    s.workItems.find((w) => w.id === 'test')!.plannedFinish = '2026-12-01';
    const flag = layoutTracker(s, view()).flags.find((f) => f.workItemId === 'test');
    expect(flag?.x).toBe(X1 - 4);
  });

  it('draws a slip line from the first planned date to the current one', () => {
    expect(L.slips).toEqual([
      {
        workItemId: 'golive',
        from: '2026-09-30',
        to: '2026-10-15',
        x1: L.x(noon('2026-09-30')),
        x2: L.x(noon('2026-10-15')),
        y: 102 - 12,
      },
      {
        workItemId: 'pg201',
        from: '2026-09-26',
        to: '2026-09-30',
        x1: L.x(noon('2026-09-26')),
        x2: L.x(noon('2026-09-30')),
        y: 286 - 12,
      },
    ]);
  });
});

describe('layoutTracker: links', () => {
  const L = layoutTracker(larkspurState(), view());

  it('curves a leads-from link from the finish of the source to the start of the target', () => {
    const link = L.links.find((l) => l.fromId === 'analyse' && l.toId === 'pg201')!;
    const x1 = L.x(ms('2026-09-22T16:40'));
    const x2 = L.x(ms('2026-09-23T09:20'));
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    expect(link).toEqual({
      fromId: 'analyse',
      toId: 'pg201',
      tone: 'proceed',
      ghost: false,
      wait: false,
      from: { x: x1, y: 226 },
      c1: { x: x1 + dx, y: 226 },
      c2: { x: x2 - dx, y: 286 },
      to: { x: x2, y: 286 },
    });
  });

  it('draws a red waiting link at the T line from an open source', () => {
    const link = L.links.find((l) => l.fromId === 'pg203' && l.toId === 'test')!;
    const xt = L.x(Date.parse(AS_OF));
    expect(link).toMatchObject({ wait: true, tone: 'danger', ghost: false });
    expect([link.from, link.to]).toEqual([
      { x: xt, y: 474 },
      { x: xt, y: 534 },
    ]);
  });

  it('ghosts a link whose source row is folded', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['analyse']) }));
    const link = H.links.find((l) => l.fromId === 'analyse' && l.toId === 'pg201')!;
    expect(link.ghost).toBe(true);
    expect(link.from.y).toBe(H.rows.find((r) => r.id === 'analyse')!.y);
  });

  it('draws no link into a folded row', () => {
    const H = layoutTracker(larkspurState(), view({ hiddenRows: new Set(['test']) }));
    expect(H.links.some((l) => l.toId === 'test')).toBe(false);
  });

  it('shows a chip for a source or parent that finished before the window', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [
        workItem({ id: 'p', title: 'Analyse the CRS and FATCA rules', teamId: 't' }),
        workItem({ id: 'c', teamId: 't', parentId: 'p', after: ['p'] }),
      ],
      events: [
        event({ id: 'p1', workItemId: 'p', kind: 'done', at: at('2026-09-01T09:00') }),
        event({ id: 'c1', workItemId: 'c', at: at('2026-09-20T09:00') }),
      ],
    });
    const C = layoutTracker(s, view());
    expect(C.rows.map((r) => r.id)).toEqual(['c']);
    const y = C.rows[0].y;
    const sx = C.x(ms('2026-09-20T09:00'));
    const text = 'from Analyse the CRS and FAT… (hidden)';
    const width = text.length * 5.6 + 22;
    expect(C.chips).toEqual([
      {
        workItemId: 'c',
        sources: ['p'],
        label: `↖ ${text}`,
        ariaLabel: 'Show Analyse the CRS and FATCA rules',
        x: sx + 6,
        y: y - 26,
        width,
        height: 15,
      },
    ]);
    expect(C.stems).toEqual([
      { workItemId: 'c', parentId: 'p', x: sx, y1: TRUNK_Y, y2: y, tone: 'ink-3', ghost: true },
    ]);
    expect(C.links).toEqual([]);
  });

  it('colours milestone links by spec 2.8', () => {
    const tone = (id: string) => L.msLinks.find((m) => m.workItemId === id)?.tone;
    expect(tone('golive')).toBe('danger');
    expect(tone('incident')).toBe('danger');
    expect(tone('rehearsal')).toBe('ink-2');
    expect(tone('secret')).toBe('ink-2');
    expect(tone('crmlive')).toBe('ink-2');
    expect(tone('dynamics')).toBe('ink-2');
    expect(L.msLinks.some((m) => m.workItemId === 'legal')).toBe(false);
  });

  it('colours a milestone link amber when the item finished after the milestone date', () => {
    const s = larkspurState();
    s.events.push(
      event({ id: 'late', workItemId: 'incident', kind: 'done', at: at('2026-10-05T10:00') }),
    );
    const link = layoutTracker(s, view()).msLinks.find((m) => m.workItemId === 'incident');
    expect(link?.tone).toBe('caution');
  });

  it('runs a milestone link from the end of the line to under the diamond', () => {
    const link = L.msLinks.find((m) => m.workItemId === 'rehearsal')!;
    const mx = L.milestones.find((m) => m.id === 'golive')!.x;
    const ex = L.x(ms('2026-09-24T16:40'));
    expect(link).toEqual({
      workItemId: 'rehearsal',
      milestoneId: 'golive',
      tone: 'ink-2',
      from: { x: ex, y: 166 },
      c1: { x: ex, y: 166 - 30 },
      c2: { x: mx, y: TRUNK_Y + 34 },
      to: { x: mx, y: TRUNK_Y + 8 },
    });
  });
});

describe('layoutTracker: milestones and trunk', () => {
  const L = layoutTracker(larkspurState(), view());

  it('marks CRM integration live late', () => {
    const crm = L.milestones.find((m) => m.name === 'CRM integration live')!;
    expect(crm).toMatchObject({
      id: 'crm',
      x: L.x(noon('2026-09-18')),
      y: TRUNK_Y,
      status: 'late',
      tone: 'danger',
      stroke: 'danger',
      labelTone: 'danger',
      filled: true,
      draft: false,
      label: 'CRM integration live · 18 Sept · Late',
      ariaLabel: 'CRM integration live · 18 Sept · Late',
      anchor: 'start',
      level: 0,
      labelY: MS_Y,
    });
    expect(crm.labelX).toBe(crm.x + 13);
  });

  it('draws the trunk and a red segment from each late milestone to the T line', () => {
    const xt = L.x(Date.parse(AS_OF));
    expect(L.trunk).toEqual({ x1: X0, x2: X1, y: TRUNK_Y });
    expect(L.trunkSegments).toEqual([
      { milestoneId: 'crm', x1: L.x(noon('2026-09-18')), x2: xt, y: TRUNK_Y, tone: 'danger' },
      { milestoneId: 'golive', x1: L.x(noon('2026-09-30')), x2: xt, y: TRUNK_Y, tone: 'danger' },
    ]);
  });

  it('draws amber from the date to the finish when a milestone finished late', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-09-20', firstPlanned: '2026-09-20', moves: [] },
      ],
      workItems: [workItem({ id: 'w', teamId: 't', milestoneId: 'm' })],
      events: [event({ id: 'd', workItemId: 'w', kind: 'done', at: at('2026-09-25T10:00') })],
    });
    const M = layoutTracker(s, view());
    expect(M.trunkSegments).toEqual([
      {
        milestoneId: 'm',
        x1: M.x(noon('2026-09-20')),
        x2: M.x(ms('2026-09-25T10:00')),
        y: TRUNK_Y,
        tone: 'caution',
      },
    ]);
  });

  it('draws teal from the finish to the date when a milestone finished early', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      milestones: [
        { id: 'm', name: 'M', planned: '2026-09-30', firstPlanned: '2026-09-30', moves: [] },
      ],
      workItems: [workItem({ id: 'w', teamId: 't', milestoneId: 'm' })],
      events: [event({ id: 'd', workItemId: 'w', kind: 'done', at: at('2026-09-25T10:00') })],
    });
    const M = layoutTracker(s, view());
    expect(M.milestones[0]).toMatchObject({ status: 'early', tone: 'teal', filled: true });
    expect(M.trunkSegments[0]).toMatchObject({
      x1: M.x(ms('2026-09-25T10:00')),
      x2: M.x(noon('2026-09-30')),
      tone: 'teal',
    });
  });

  it('draws a planned milestone hollow and grey without a trunk segment', () => {
    const s = buildState({
      milestones: [
        { id: 'm', name: 'M', planned: '2026-10-14', firstPlanned: '2026-10-14', moves: [] },
      ],
    });
    const M = layoutTracker(s, view());
    expect(M.milestones[0]).toMatchObject({ status: 'planned', tone: 'ink-3', filled: false });
    expect(M.trunkSegments).toEqual([]);
  });

  it('right-aligns a label near the right edge', () => {
    const s = buildState({
      milestones: [
        { id: 'm', name: 'Late', planned: '2026-10-15', firstPlanned: '2026-10-15', moves: [] },
      ],
    });
    const m = layoutTracker(s, view()).milestones[0];
    expect(m.anchor).toBe('end');
    expect(m.labelX).toBe(m.x - 13);
    expect(m.labelBox.x1).toBe(m.x - 13);
  });

  it('never overlaps two labels on the same level', () => {
    const s = larkspurState();
    s.milestones.push(
      { id: 'm1', name: 'Close one', planned: '2026-09-19', firstPlanned: '2026-09-19', moves: [] },
      { id: 'm2', name: 'Far one', planned: '2026-10-05', firstPlanned: '2026-10-05', moves: [] },
    );
    for (const state of [larkspurState(), s]) {
      const ms = layoutTracker(state, view()).milestones;
      for (const a of ms)
        for (const b of ms) {
          if (a === b || a.level !== b.level) continue;
          const apart = a.labelBox.x0 >= b.labelBox.x1 + 8 || a.labelBox.x1 <= b.labelBox.x0 - 8;
          expect(apart, `${a.id} and ${b.id}`).toBe(true);
        }
    }
    const levels = layoutTracker(s, view()).milestones.map((m) => [m.id, m.level, m.labelY]);
    expect(levels).toEqual([
      ['crm', 0, MS_Y],
      ['m1', 1, TRUNK_Y + 17],
      ['golive', 0, MS_Y],
      ['m2', 1, TRUNK_Y + 17],
    ]);
  });
});

describe('layoutTracker: draft marks', () => {
  it('flags changed rows, events, milestones and dates as draft', () => {
    const marks: Marks = {
      workItems: new Set(['pg203']),
      events: new Set(['p32']),
      milestones: new Set(['crm']),
      dates: new Set(['golive']),
    };
    const L = layoutTracker(larkspurState(), view(), marks);
    expect(L.rows.filter((r) => r.draft).map((r) => r.id)).toEqual(['pg203']);
    expect(L.eventGroups.filter((g) => g.draft).map((g) => g.eventIds)).toEqual([['p32']]);
    expect(L.flags.filter((f) => f.draft).map((f) => f.workItemId)).toEqual(['golive']);
    const crm = L.milestones.find((m) => m.id === 'crm')!;
    expect(crm).toMatchObject({ draft: true, stroke: 'draft', labelTone: 'draft', tone: 'danger' });
    expect(L.milestones.find((m) => m.id === 'golive')?.draft).toBe(false);
  });

  it('shows the earlier date of a moved milestone in a change request only', () => {
    const move = (date: string, why: string) =>
      makeOp('msDate', { milestoneId: 'crm', date, why, by: 'minh', at: at('2026-10-08T16:55') });
    const replay = replayOps(larkspurState(), [
      move('2026-09-22', 'The sandbox is late.'),
      move('2026-09-25', 'The vendor needs more time.'),
    ]);
    const crm = (L: TrackerLayout) => L.milestones.find((m) => m.id === 'crm')!;
    const draft = crm(layoutTracker(replay.state, view(), replay.marks));
    expect(draft.label).toBe('CRM integration live · 25 Sept · Late (was 22 Sept)');
    expect(draft.ariaLabel).toBe(draft.label);
    expect(crm(layoutTracker(replay.state, view())).label).toBe(
      'CRM integration live · 25 Sept · Late',
    );
    const renamed = replayOps(larkspurState(), [
      makeOp('msName', { milestoneId: 'crm', name: 'CRM sync live' }),
    ]);
    expect(crm(layoutTracker(renamed.state, view(), renamed.marks)).label).toBe(
      'CRM sync live · 18 Sept · Late',
    );
    const renamedAfterMove = replayOps(replay.state, [
      makeOp('msName', { milestoneId: 'crm', name: 'CRM sync live' }),
    ]);
    expect(crm(layoutTracker(renamedAfterMove.state, view(), renamedAfterMove.marks)).label).toBe(
      'CRM sync live · 25 Sept · Late',
    );
    const itemMoved = replayOps(larkspurState(), [
      makeOp('due', {
        workItemId: 'golive',
        date: '2026-10-16',
        why: 'Later.',
        by: 'minh',
        at: at('2026-10-08T16:55'),
      }),
    ]);
    const golive = layoutTracker(itemMoved.state, view(), itemMoved.marks).milestones.find(
      (m) => m.id === 'golive',
    )!;
    expect(golive.label).not.toContain('(was');
  });

  it('reads the marks of a replay', () => {
    const replay = replayOps(larkspurState(), [
      makeOp('rename', { workItemId: 'pg203', title: 'PG-203 Country list field (multi-select)' }),
    ]);
    const L = layoutTracker(replay.state, view(), replay.marks);
    expect(L.rows.find((r) => r.id === 'pg203')).toMatchObject({
      draft: true,
      title: 'PG-203 Country list field (multi-select)',
    });
  });

  it('flags nothing without marks', () => {
    const L = layoutTracker(larkspurState(), view(), noMarks());
    expect(L.rows.some((r) => r.draft) || L.eventGroups.some((g) => g.draft)).toBe(false);
  });
});

describe('layoutTracker: purity', () => {
  it('leaves a frozen state unchanged and gives the same layout twice', () => {
    const state: TrackerState = deepFreeze(larkspurState());
    const a = layoutTracker(state, view({ hiddenRows: new Set(['pg203']) }));
    const b = layoutTracker(state, view({ hiddenRows: new Set(['pg203']) }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
