import { describe, expect, it } from 'vitest';
import {
  EVENT_KINDS,
  KIND_GROUPS,
  KIND_LABEL,
  kindText,
  kindWithArticle,
  STATUS_LABEL,
  type Milestone,
  type TrackerEvent,
} from '../../../src/tracker/model';
import {
  finishesItem,
  timeSpent,
  itemInfo,
  itemStatus,
  milestoneStatus,
  startHint,
} from '../../../src/tracker/status';
import {
  AddEventArgsSchema,
  EventKindSchema,
  KindArgsSchema,
  NewEventSchema,
  OpSchema,
  QueueEventInputSchema,
  QueueEventSchema,
  TrackerEventSchema,
} from '../../../src/tracker/schemas';
import { applyOp, replayOps, sameOp, type Op } from '../../../src/tracker/ops';
import { clashesOf } from '../../../src/tracker/clash';
import { layoutTracker, STATUS_TONE, type View } from '../../../src/tracker/layout';
import { matchRows, NO_FILTER } from '../../../src/tracker/filter';
import {
  TIME_ZONE,
  at,
  buildState,
  event,
  larkspurState,
  makeOp,
  workItem,
} from '../../support/tracker-fixture';

const item = workItem({ id: 'w', plannedFinish: '2026-10-06' });
const started = event({ id: 'e0', workItemId: 'w', kind: 'task', at: at('2026-10-01T09:00') });
const ev = (
  id: string,
  kind: TrackerEvent['kind'],
  local: string,
  over: Partial<TrackerEvent> = {},
) => event({ id, workItemId: 'w', kind, at: at(local), ...over });
const status = (events: TrackerEvent[], asOf = at('2026-10-09T18:00')) =>
  itemStatus(item, events, asOf, TIME_ZONE);

describe('event kinds', () => {
  it('adds Idea and Cancelled to the 8 kinds', () => {
    expect(EVENT_KINDS).toHaveLength(10);
    expect(KIND_LABEL.idea).toBe('Idea');
    expect(KIND_LABEL.cancelled).toBe('Cancelled');
  });

  it('groups every kind once into Start, Progress and Finish', () => {
    expect(KIND_GROUPS.map((g) => [g.label, g.kinds])).toEqual([
      ['Start', ['idea', 'message', 'issue']],
      ['Progress', ['task', 'meeting', 'decision', 'delivery']],
      ['Finish', ['handoff', 'done', 'cancelled']],
    ]);
    expect(KIND_GROUPS.flatMap((g) => g.kinds).sort()).toEqual([...EVENT_KINDS].sort());
  });

  it('puts the right article before each kind', () => {
    expect(kindWithArticle('issue')).toBe('an Issue');
    expect(kindWithArticle('idea')).toBe('an Idea');
    expect(kindWithArticle('meeting')).toBe('a Meeting');
    expect(kindWithArticle('handoff')).toBe('a Handoff');
    expect(kindWithArticle('done')).toBe('a Done');
  });

  it('has a Cancelled status with a neutral tone', () => {
    expect(STATUS_LABEL.cancelled).toBe('Cancelled');
    expect(STATUS_TONE.cancelled).toBe('isolated');
  });
});

describe('finishing events', () => {
  it('finishes on Done, Cancelled and a Handoff marked as finishing', () => {
    expect(finishesItem({ kind: 'done' })).toBe(true);
    expect(finishesItem({ kind: 'cancelled' })).toBe(true);
    expect(finishesItem({ kind: 'handoff', finishes: true })).toBe(true);
    expect(finishesItem({ kind: 'handoff' })).toBe(false);
    expect(finishesItem({ kind: 'handoff', finishes: false })).toBe(false);
    expect(finishesItem({ kind: 'delivery', finishes: true })).toBe(false);
  });

  it('makes a finishing Handoff finish the item at its time, with the Done statuses', () => {
    const handoff = (local: string) => ev('h', 'handoff', local, { finishes: true });
    expect(itemInfo(item, [started, handoff('2026-10-05T16:00')])).toMatchObject({
      done: true,
      cancelled: false,
      finishedAt: at('2026-10-05T16:00'),
    });
    expect(status([started, handoff('2026-10-05T16:00')])).toBe('early');
    expect(status([started, handoff('2026-10-06T16:00')])).toBe('ontime');
    expect(status([started, handoff('2026-10-07T16:00')])).toBe('flate');
  });

  it('keeps an item open after a Handoff that does not finish it', () => {
    const plain = ev('h', 'handoff', '2026-10-05T16:00');
    expect(itemInfo(item, [started, plain]).done).toBe(false);
    expect(status([started, plain])).toBe('late');
  });

  it('cancels an item at its Cancelled event, and a cancelled item is never late', () => {
    const cancel = ev('c', 'cancelled', '2026-10-08T10:00', { text: 'The client dropped it.' });
    expect(itemInfo(item, [started, cancel])).toMatchObject({
      done: true,
      cancelled: true,
      finishedAt: at('2026-10-08T10:00'),
      end: at('2026-10-08T10:00'),
    });
    expect(status([started, cancel])).toBe('cancelled');
    expect(status([started, { ...cancel, at: at('2026-10-02T10:00') }])).toBe('cancelled');
  });

  it('finishes at the last visible finishing event, whatever follows it', () => {
    const done = ev('d', 'done', '2026-10-05T10:00');
    const cancel = ev('c', 'cancelled', '2026-10-07T10:00');
    const note = ev('n', 'message', '2026-10-08T10:00');
    expect(status([started, done, cancel])).toBe('cancelled');
    expect(status([started, { ...cancel, at: at('2026-10-04T10:00') }, done])).toBe('early');
    expect(itemInfo(item, [started, done, note]).finishedAt).toBe(at('2026-10-05T10:00'));
    expect(status([started, done, { ...cancel, hidden: true }])).toBe('early');
  });
});

describe('milestones with cancelled work items', () => {
  const m: Milestone = {
    id: 'm',
    name: 'M',
    planned: '2026-10-06',
    firstPlanned: '2026-10-06',
    moves: [],
  };
  const a = workItem({ id: 'a', milestoneId: 'm' });
  const b = workItem({ id: 'b', milestoneId: 'm' });
  const on = (workItemId: string, kind: TrackerEvent['kind'], local: string) =>
    event({ id: `${workItemId}-${kind}-${local}`, workItemId, kind, at: at(local) });
  const msStatus = (events: TrackerEvent[]) =>
    milestoneStatus(m, [a, b], events, at('2026-10-09T18:00'), TIME_ZONE);

  it('is done when every member that is not cancelled is done', () => {
    const r = msStatus([
      on('a', 'done', '2026-10-05T10:00'),
      on('b', 'cancelled', '2026-10-08T10:00'),
    ]);
    expect(r).toMatchObject({ status: 'early', finishedAt: at('2026-10-05T10:00') });
  });

  it('stays open while a member that is not cancelled is open', () => {
    expect(msStatus([on('b', 'cancelled', '2026-10-02T10:00')]).status).toBe('late');
  });

  it('takes the latest cancel as the finish when every member is cancelled', () => {
    const r = msStatus([
      on('a', 'cancelled', '2026-10-03T10:00'),
      on('b', 'cancelled', '2026-10-05T10:00'),
    ]);
    expect(r).toMatchObject({ status: 'early', finishedAt: at('2026-10-05T10:00') });
  });
});

describe('startHint', () => {
  it('names the kind when the first visible event is a Delivery, a Handoff or a Done', () => {
    expect(startHint(item, [ev('d', 'delivery', '2026-10-01T09:00')])).toBe('delivery');
    expect(startHint(item, [ev('h', 'handoff', '2026-10-01T09:00')])).toBe('handoff');
    expect(startHint(item, [ev('x', 'done', '2026-10-01T09:00')])).toBe('done');
  });

  it('is null for any other first event, an empty item, or a hidden first event', () => {
    const delivery = ev('d', 'delivery', '2026-10-02T09:00');
    expect(startHint(item, [started, delivery])).toBeNull();
    expect(startHint(item, [ev('i', 'idea', '2026-10-01T09:00')])).toBeNull();
    expect(startHint(item, [])).toBeNull();
    expect(startHint(item, [{ ...started, hidden: true }, delivery])).toBe('delivery');
    expect(startHint(item, [delivery, started])).toBeNull();
  });
});

describe('schemas', () => {
  const base = {
    id: 'e',
    workItemId: 'w',
    at: at('2026-10-01T09:00'),
    by: 'p',
    addedBy: null,
    hidden: false,
  };

  it('accepts the new kinds and the finishes flag', () => {
    expect(EventKindSchema.parse('idea')).toBe('idea');
    expect(EventKindSchema.parse('cancelled')).toBe('cancelled');
    expect(
      TrackerEventSchema.safeParse({ ...base, kind: 'handoff', text: 'Sent.', finishes: true })
        .success,
    ).toBe(true);
    expect(
      QueueEventInputSchema.parse({
        kind: 'handoff',
        at: base.at,
        by: 'p',
        text: 'x',
        finishes: true,
      }),
    ).toMatchObject({ finishes: true });
    expect(
      KindArgsSchema.safeParse({ eventId: 'e', kind: 'handoff', finishes: false }).success,
    ).toBe(true);
  });

  it('refuses an unknown kind, a finishes flag that is not a boolean, and a blank reason', () => {
    expect(EventKindSchema.safeParse('cancel').success).toBe(false);
    expect(
      TrackerEventSchema.safeParse({ ...base, kind: 'handoff', text: 'x', finishes: 'yes' })
        .success,
    ).toBe(false);
    expect(
      AddEventArgsSchema.safeParse({
        workItemId: 'w',
        ev: { id: 'c', kind: 'cancelled', at: base.at, by: 'p', text: '   ' },
      }).success,
    ).toBe(false);
  });
});

describe('ops with finishing events', () => {
  const s = () =>
    buildState({
      people: [{ id: 'p', name: 'Lan' }],
      workItems: [item],
      events: [started],
      queue: {
        events: [
          {
            id: 'q',
            kind: 'handoff',
            at: at('2026-10-05T16:00'),
            by: 'p',
            text: 'Handed over.',
            finishes: true,
            addedBy: null,
            agent: false,
            createdAt: at('2026-10-05T16:00'),
          },
        ],
        items: [],
      },
    });

  it('keeps finishes on an added or attached Handoff only', () => {
    const add = (kind: TrackerEvent['kind']) =>
      applyOp(
        s(),
        makeOp('addEvent', {
          workItemId: 'w',
          ev: { id: 'n', kind, at: at('2026-10-05T16:00'), by: 'p', text: 'x', finishes: true },
        }),
      ).state.events.find((e) => e.id === 'n')!;
    expect(add('handoff').finishes).toBe(true);
    expect(add('delivery')).not.toHaveProperty('finishes');
    const attached = applyOp(s(), makeOp('attach', { eventId: 'q', workItemId: 'w' })).state;
    expect(attached.events.find((e) => e.id === 'q')!.finishes).toBe(true);
    expect(itemInfo(item, attached.events).done).toBe(true);
  });

  it('sets and clears finishes with the kind change, and says so in the change', () => {
    const handoff = { ...started, kind: 'handoff' as const };
    const state = buildState({
      people: [{ id: 'p', name: 'Lan' }],
      workItems: [item],
      events: [handoff],
    });
    const on = applyOp(state, makeOp('kind', { eventId: 'e0', kind: 'handoff', finishes: true }));
    expect(on.state.events[0].finishes).toBe(true);
    expect(on.entry).toMatchObject({ before: 'Handoff', after: 'Handoff, finishes the work item' });
    const off = applyOp(on.state, makeOp('kind', { eventId: 'e0', kind: 'task' }));
    expect(off.state.events[0]).not.toHaveProperty('finishes');
  });

  it('replays a cancel into a cancelled status', () => {
    const { state } = replayOps(s(), [
      makeOp('addEvent', {
        workItemId: 'w',
        ev: { id: 'c', kind: 'cancelled', at: at('2026-10-08T10:00'), by: 'p', text: 'Dropped.' },
      }),
    ]);
    expect(itemStatus(item, state.events, at('2026-10-09T18:00'), TIME_ZONE)).toBe('cancelled');
  });
});

describe('layout and filters for a cancelled work item', () => {
  const view: View = {
    hiddenRows: new Set(),
    hiddenTeams: new Set(),
    asOf: at('2026-10-09T18:00'),
    timeZone: TIME_ZONE,
    windowStart: '2026-09-28',
    windowEnd: '2026-10-17',
  };
  const team = { id: 'team', name: 'Team', leadId: null };
  const cancelled = buildState({
    teams: [team],
    workItems: [item, workItem({ id: 'open', plannedFinish: '2026-10-06' })],
    events: [
      started,
      ev('c', 'cancelled', '2026-10-08T10:00'),
      event({ id: 'o', workItemId: 'open', at: at('2026-10-01T09:00') }),
    ],
  });

  it('draws a neutral line up to the cancel and nothing after it, never late', () => {
    const L = layoutTracker(cancelled, view);
    const segs = L.segments.filter((x) => x.workItemId === 'w');
    expect(segs.map((x) => x.tone)).toEqual(['isolated']);
    expect(segs[0].x2).toBeCloseTo(L.x(Date.parse(at('2026-10-08T10:00'))), 9);
    expect(L.rows.find((r) => r.id === 'w')).toMatchObject({ status: 'cancelled', done: true });
  });

  it('counts cancelled work items apart in the team summary', () => {
    const L = layoutTracker(cancelled, view);
    expect(L.lanes[0].summary).toMatchObject({
      count: 2,
      late: 1,
      notYet: 0,
      done: 0,
      cancelled: 1,
      ariaLabel: 'Team, 2 work items: 1 late, 1 cancelled',
    });
  });

  it('filters by the Cancelled status', () => {
    const match = matchRows(
      cancelled,
      { ...NO_FILTER, statuses: ['cancelled'] },
      view.asOf,
      TIME_ZONE,
    );
    expect([...match!.match]).toEqual(['w']);
  });

  it('keeps the Larkspur demo free of cancelled work items', () => {
    const L = layoutTracker(larkspurState(), { ...view, windowStart: '2026-09-10' });
    expect(L.lanes.every((l) => l.summary.cancelled === 0)).toBe(true);
  });
});

describe('fix round: finishing order and milestones', () => {
  it('finishes at a later Done after a finishing Handoff', () => {
    const handoff = ev('h', 'handoff', '2026-10-05T16:00', { finishes: true });
    const done = ev('d', 'done', '2026-10-07T10:00');
    expect(itemInfo(item, [started, handoff, done]).finishedAt).toBe(at('2026-10-07T10:00'));
    expect(status([started, handoff, done])).toBe('flate');
  });

  it('keeps a milestone open by its live member when the other member is cancelled', () => {
    const m: Milestone = {
      id: 'm',
      name: 'M',
      planned: '2026-10-12',
      firstPlanned: '2026-10-12',
      moves: [],
    };
    const live = workItem({ id: 'live', milestoneId: 'm' });
    const gone = workItem({ id: 'gone', milestoneId: 'm' });
    const events = [
      event({ id: 'l1', workItemId: 'live', at: at('2026-10-02T09:00') }),
      event({ id: 'g1', workItemId: 'gone', kind: 'cancelled', at: at('2026-10-03T09:00') }),
    ];
    const r = (asOf: string) => milestoneStatus(m, [live, gone], events, asOf, TIME_ZONE);
    expect(r(at('2026-10-09T18:00'))).toMatchObject({ status: 'planned', finishedAt: null });
    expect(r(at('2026-10-13T09:00'))).toMatchObject({ status: 'late', finishedAt: null });
  });
});

describe('fix round: the finishes flag is normalised at parse', () => {
  const fields = { at: at('2026-10-01T09:00'), by: 'p', text: 'x' };

  it('keeps the flag only on a finishing Handoff', () => {
    expect(
      QueueEventInputSchema.parse({ ...fields, kind: 'handoff', finishes: true }),
    ).toHaveProperty('finishes', true);
    for (const raw of [
      { ...fields, kind: 'handoff', finishes: false },
      { ...fields, kind: 'task', finishes: true },
    ]) {
      expect(QueueEventInputSchema.parse(raw)).not.toHaveProperty('finishes');
      expect(NewEventSchema.parse({ id: 'n', ...raw })).not.toHaveProperty('finishes');
      expect(
        QueueEventSchema.parse({
          id: 'q',
          ...raw,
          addedBy: null,
          agent: true,
          createdAt: fields.at,
        }),
      ).not.toHaveProperty('finishes');
      expect(
        TrackerEventSchema.parse({
          id: 'e',
          workItemId: 'w',
          ...raw,
          addedBy: null,
          hidden: false,
        }),
      ).not.toHaveProperty('finishes');
    }
    expect(KindArgsSchema.parse({ eventId: 'e', kind: 'handoff', finishes: false })).toEqual({
      eventId: 'e',
      kind: 'handoff',
    });
    expect(KindArgsSchema.parse({ eventId: 'e', kind: 'done', finishes: true })).toEqual({
      eventId: 'e',
      kind: 'done',
    });
  });

  it('makes a kind op with finishes false the same change as one without, so it never clashes', () => {
    const parse = (a: object): Op => OpSchema.parse({ op: 'kind', a, rev: 0, by: 'minh' });
    const off = parse({ eventId: 'p31', kind: 'handoff', finishes: false });
    const plain = parse({ eventId: 'p31', kind: 'handoff' });
    expect(sameOp(off, plain)).toBe(true);
    const main = {
      rev: 1,
      crId: 'c',
      crNum: 1,
      mergedBy: 'minh',
      mergedAt: at('2026-10-09T10:00'),
      ops: [plain],
      resolutions: [],
    };
    expect(clashesOf([off], [main])).toEqual([]);
  });
});

describe('fix round: labels carry the finishing flag', () => {
  const state = () =>
    buildState({
      people: [{ id: 'p', name: 'Lan' }],
      workItems: [item],
      queue: {
        events: [
          {
            id: 'q',
            kind: 'handoff',
            at: at('2026-10-05T16:00'),
            by: 'p',
            text: 'Handed over.',
            finishes: true,
            addedBy: null,
            agent: false,
            createdAt: at('2026-10-05T16:00'),
          },
        ],
        items: [],
      },
    });

  it('names the kind with the note only for a finishing Handoff', () => {
    expect(kindText({ kind: 'handoff', finishes: true })).toBe('Handoff, finishes the work item');
    expect(kindText({ kind: 'handoff' })).toBe('Handoff');
    expect(kindText({ kind: 'done', finishes: true })).toBe('Done');
  });

  it('names a finishing Handoff in attach and addEvent changes', () => {
    const label = 'Handoff by Lan, finishes the work item';
    expect(applyOp(state(), makeOp('attach', { eventId: 'q', workItemId: 'w' })).entry.item).toBe(
      label,
    );
    const added = applyOp(
      state(),
      makeOp('addEvent', {
        workItemId: 'w',
        ev: {
          id: 'n',
          kind: 'handoff',
          at: at('2026-10-05T16:00'),
          by: 'p',
          text: 'x',
          finishes: true,
        },
      }),
    );
    expect(added.entry.item).toBe(label);
  });
});

describe('fix round: time spent', () => {
  it('shows hours only under a day, and hours with days from a day on', () => {
    const from = at('2026-10-01T09:00');
    const after = (minutes: number) => new Date(Date.parse(from) + minutes * 60_000).toISOString();
    expect(timeSpent(from, from)).toBe('0 h');
    expect(timeSpent(from, after(60))).toBe('1 h');
    expect(timeSpent(from, after(23 * 60 + 20))).toBe('23 h');
    expect(timeSpent(from, after(23 * 60 + 54))).toBe('24 h (1.0 days)');
    expect(timeSpent(from, after(36 * 60))).toBe('36 h (1.5 days)');
  });
});

describe('fix round: a cancelled source hands nothing over', () => {
  const view: View = {
    hiddenRows: new Set(),
    hiddenTeams: new Set(),
    asOf: at('2026-10-09T18:00'),
    timeZone: TIME_ZONE,
    windowStart: '2026-09-10',
    windowEnd: '2026-10-17',
  };
  const cancelled = () => {
    const s = larkspurState();
    s.events.push(
      event({
        id: 'cancel203',
        workItemId: 'pg203',
        kind: 'cancelled',
        at: at('2026-10-08T10:00'),
        text: 'The field stays free text.',
      }),
    );
    return s;
  };

  it('marks a cancelled source as cancelled, in the neutral tone, with no handoff', () => {
    const before = layoutTracker(larkspurState(), view).handoffs.find((h) => h.fromId === 'pg203')!;
    expect(before).toMatchObject({ cancelled: false, wait: true });
    const L = layoutTracker(cancelled(), view);
    const h = L.handoffs.find((x) => x.fromId === 'pg203')!;
    expect(h).toMatchObject({
      cancelled: true,
      wait: false,
      tone: 'isolated',
      eventId: null,
      tooltip: 'Cancelled · Test the CRS section end to end no longer gets it from here',
    });
    expect(h.x).toBeGreaterThan(L.x(Date.parse(at('2026-10-08T10:00'))));
  });

  it('tells the receiver that its source was cancelled', () => {
    const wait = (s: ReturnType<typeof larkspurState>) =>
      layoutTracker(s, view).segments.find((x) => x.workItemId === 'test' && x.kind === 'wait');
    expect(wait(larkspurState())).toMatchObject({ text: 'Waiting for PG-203' });
    expect(wait(cancelled())).toMatchObject({ text: 'PG-203 was cancelled' });
  });

  it('does not start the empty receiver at the cancel', () => {
    const L = layoutTracker(cancelled(), view);
    const seg = L.segments.find((x) => x.workItemId === 'test')!;
    const pg202 = itemInfo(
      larkspurState().workItems.find((w) => w.id === 'pg202')!,
      larkspurState().events,
    ).finishedAt!;
    expect(seg.x1).toBeCloseTo(L.x(Date.parse(pg202)), 6);
  });
});
