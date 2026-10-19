import { describe, expect, it } from 'vitest';
import {
  applyOp,
  initialState,
  keysOf,
  OpError,
  replayOps,
  sameOp,
  type Op,
  type OpDescription,
  secondMilestone,
} from '../../../src/tracker/ops';
import { mainState, type Commit } from '../../../src/tracker/clash';
import { OpSchema, QueueEventInputSchema, TrackerStateSchema } from '../../../src/tracker/schemas';
import {
  at,
  larkspurBase,
  larkspurQueueRows,
  larkspurState,
  makeOp,
} from '../../support/tracker-fixture';

const WHY = 'The country list needs a new field type.';
const MS_WHY = 'The CRS section is not ready. Sarah agreed on 13 September.';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const CASES: Array<[string, Op, OpDescription]> = [
  [
    'attach',
    makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }),
    {
      item: 'Message by Sarah Kim',
      change: 'added',
      before: 'Queue',
      after: 'Go-live date, 7 Oct 08:30',
      icon: 'message',
    },
  ],
  [
    'place',
    makeOp('place', { itemId: 'q1', teamId: 'engineering' }),
    {
      item: 'PG-204 Tax ID format check',
      change: 'placed',
      before: 'Queue',
      after: 'Engineering, after Analyse the CRS and FATCA rules',
    },
  ],
  [
    'qms',
    makeOp('qms', { itemId: 'q2', milestoneId: 'crm' }),
    {
      item: 'Investor statement template',
      change: 'milestone set',
      before: 'No milestone',
      after: 'CRM integration live',
    },
  ],
  [
    'fromEvent',
    makeOp('fromEvent', {
      id: 'w1',
      eventId: 'qe1',
      teamId: 'customer-success',
      title: 'Root cause report for the sync incident',
      doneBy: 'daniel',
      requestedBy: 'sarah',
      after: 'incident',
      plannedFinish: '2026-10-12',
    }),
    {
      item: 'Root cause report for the sync incident',
      change: 'added',
      before: 'Queue',
      after: 'Customer Success, done by Daniel Reyes',
      icon: 'message',
    },
  ],
  [
    'addEvent',
    makeOp(
      'addEvent',
      {
        workItemId: 'pg203',
        ev: {
          id: 'qd1',
          kind: 'delivery',
          at: at('2026-10-09T12:00'),
          by: 'quang',
          text: 'The country list field is on staging.',
        },
      },
      0,
      'quang',
    ),
    {
      item: 'Delivery by Quang Nguyễn',
      change: 'added',
      before: '',
      after: 'PG-203 Country list field type, 9 Oct 12:00',
      icon: 'delivery',
    },
  ],
  [
    'move',
    makeOp('move', { eventId: 'p32', to: 'test' }),
    {
      item: 'Message by Lan Phạm, 7 Oct 10:00',
      change: 'moved',
      before: 'PG-203 Country list field type',
      after: 'Test the CRS section end to end',
      icon: 'message',
    },
  ],
  [
    'kind',
    makeOp('kind', { eventId: 'p32', kind: 'issue' }),
    {
      item: 'Event by Lan Phạm, 7 Oct 10:00',
      change: 'changed',
      before: 'Message',
      after: 'Issue',
      icon: 'issue',
    },
  ],
  [
    'hide',
    makeOp('hide', { eventId: 'x2' }),
    {
      item: 'Message by Quang Nguyễn, 25 Sept 09:30',
      change: 'hidden',
      before: 'on Client secret renewal',
      after: 'Hidden',
      icon: 'message',
    },
  ],
  [
    'msDate',
    makeOp('msDate', {
      milestoneId: 'golive',
      date: '2026-10-15',
      why: MS_WHY,
      by: 'minh',
      at: at('2026-10-08T16:55'),
    }),
    {
      item: 'Go-live and first close',
      change: 'planned date moved',
      before: 'planned 30 Sept',
      after: 'planned 15 Oct',
      why: MS_WHY,
    },
  ],
  [
    'msName',
    makeOp('msName', { milestoneId: 'crm', name: 'CRM sync live' }),
    {
      item: 'CRM sync live',
      change: 'renamed',
      before: 'CRM integration live',
      after: 'CRM sync live',
    },
  ],
  [
    'msRemove',
    makeOp('msRemove', { workItemId: 'legal' }),
    {
      item: 'Legal review routing',
      change: 'removed from milestone',
      before: 'CRM integration live',
      after: 'No milestone',
    },
  ],
  [
    'msAdd',
    makeOp('msAdd', { workItemId: 'pg203', milestoneId: 'golive' }),
    {
      item: 'PG-203 Country list field type',
      change: 'milestone changed',
      before: 'No milestone',
      after: 'Go-live and first close',
    },
  ],
  [
    'newMs',
    makeOp('newMs', {
      id: 'ms1',
      name: 'Investor statements',
      planned: '2026-10-20',
      members: ['pg201', 'pg202'],
    }),
    {
      item: 'Investor statements',
      change: 'added',
      before: '',
      after: 'planned 20 Oct, 2 work items',
    },
  ],
  [
    'rename',
    makeOp('rename', { workItemId: 'pg203', title: 'PG-203 Country list field (multi-select)' }),
    {
      item: 'PG-203 Country list field (multi-select)',
      change: 'renamed',
      before: 'PG-203 Country list field type',
      after: 'PG-203 Country list field (multi-select)',
    },
  ],
  [
    'due',
    makeOp('due', {
      workItemId: 'pg203',
      date: '2026-10-14',
      why: WHY,
      by: 'quang',
      at: at('2026-10-09T17:00'),
    }),
    {
      item: 'PG-203 Country list field type',
      change: 'planned finish moved',
      before: '6 Oct',
      after: '14 Oct',
      why: WHY,
    },
  ],
  [
    'addTeam',
    makeOp('addTeam', { id: 'legal-team', name: 'Legal', leadId: 'priya' }),
    { item: 'Legal', change: 'added', before: '', after: 'lead Priya Shah' },
  ],
  [
    'doneBy',
    makeOp('doneBy', { workItemId: 'pg203', personId: 'lan' }),
    {
      item: 'PG-203 Country list field type',
      change: 'done by changed',
      before: 'Quang Nguyễn',
      after: 'Lan Phạm',
    },
  ],
  [
    'requestedBy',
    makeOp('requestedBy', { workItemId: 'pg203', personId: 'sarah' }),
    {
      item: 'PG-203 Country list field type',
      change: 'requested by changed',
      before: 'Lan Phạm',
      after: 'Sarah Kim',
    },
  ],
  [
    'team',
    makeOp('team', { workItemId: 'pg203', teamId: 'it' }),
    {
      item: 'PG-203 Country list field type',
      change: 'team changed',
      before: 'Engineering',
      after: 'IT',
    },
  ],
  [
    'parent',
    makeOp('parent', { workItemId: 'pg203', parentId: null }),
    {
      item: 'PG-203 Country list field type',
      change: 'parent changed',
      before: 'CRS tax residency section with DealCloud sync',
      after: 'No parent',
    },
  ],
  [
    'after',
    makeOp('after', { workItemId: 'pg203', after: [] }),
    {
      item: 'PG-203 Country list field type',
      change: 'leads from changed',
      before: 'Analyse the CRS and FATCA rules',
      after: 'Nothing',
    },
  ],
];

describe('the Larkspur fixture', () => {
  it('matches the state schema', () => {
    expect(TrackerStateSchema.parse(larkspurState())).toEqual(larkspurState());
  });

  it('holds the prototype data', () => {
    const s = larkspurState();
    expect(s.teams.map((t) => t.id)).toEqual([
      'implementation',
      'digitization',
      'solutions-engineering',
      'engineering',
      'digitization-qa',
      'customer-success',
      'it',
    ]);
    expect(s.milestones).toHaveLength(2);
    expect(s.workItems).toHaveLength(15);
    expect(s.queue.events.map((e) => e.id)).toEqual(['qe1', 'qe2', 'qe3', 'qe4']);
    expect(s.queue.items.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(s.workItems.filter((w) => w.moves.length).map((w) => w.id)).toEqual(['golive', 'pg201']);
  });
});

describe('applyOp', () => {
  it.each(CASES)('%s returns the prototype entry', (_, op, entry) => {
    expect(applyOp(larkspurState(), op).entry).toEqual(entry);
  });

  it('every op name has a case', () => {
    expect(new Set(CASES.map(([, op]) => op.op)).size).toBe(OpSchema.options.length);
  });

  it.each(CASES)('%s does not mutate its input', (_, op) => {
    const input = deepFreeze(larkspurState());
    const { state } = applyOp(input, op);
    expect(input).toEqual(larkspurState());
    expect(state).not.toEqual(input);
  });

  it('names the person of the key, not an agent, as the adder of an event that a key queued', () => {
    const s = larkspurState();
    expect(s.queue.events.find((e) => e.id === 'qe3')).toMatchObject({ agent: true });
    const { state } = applyOp(s, CASES[0][1]);
    expect(state.events.find((e) => e.id === 'qe3')?.addedBy).toBe('minh');
  });

  it('attach moves the queue event onto the work item', () => {
    const { state } = applyOp(larkspurState(), CASES[0][1]);
    expect(state.queue.events.map((e) => e.id)).toEqual(['qe1', 'qe2', 'qe4']);
    expect(state.events.find((e) => e.id === 'qe3')).toEqual({
      id: 'qe3',
      workItemId: 'golive',
      kind: 'message',
      at: at('2026-10-07T08:30'),
      by: 'sarah',
      text: 'Sarah needs an explanation for the go-live slip before the LP call.',
      addedBy: 'minh',
      hidden: false,
    });
    const human = applyOp(
      larkspurState(),
      makeOp('attach', { eventId: 'qe2', workItemId: 'dynamics' }),
    );
    expect(human.state.events.find((e) => e.id === 'qe2')?.addedBy).toBe('quang');
  });

  it('attach of a missing queue event throws OpError', () => {
    const op = makeOp('attach', { eventId: 'nope', workItemId: 'golive' });
    expect(() => applyOp(larkspurState(), op)).toThrow(OpError);
  });

  it('attach onto an unknown work item throws OpError', () => {
    const op = makeOp('attach', { eventId: 'qe3', workItemId: 'nope' });
    expect(() => applyOp(larkspurState(), op)).toThrow(OpError);
  });

  it.each(['', '  ', '\n\t'])('due and msDate with the reason %j throw OpError', (why) => {
    const due = makeOp('due', {
      workItemId: 'pg203',
      date: '2026-10-14',
      why,
      by: 'quang',
      at: at('2026-10-09T17:00'),
    });
    const msDate = makeOp('msDate', {
      milestoneId: 'golive',
      date: '2026-10-15',
      why,
      by: 'minh',
      at: at('2026-10-08T16:55'),
    });
    expect(() => applyOp(larkspurState(), due)).toThrow(OpError);
    expect(() => applyOp(larkspurState(), msDate)).toThrow(OpError);
  });

  it('due appends a move and keeps the first planned finish', () => {
    const op = makeOp('due', {
      workItemId: 'golive',
      date: '2026-10-20',
      why: WHY,
      by: 'minh',
      at: at('2026-10-09T17:00'),
    });
    const golive = applyOp(larkspurState(), op).state.workItems.find((w) => w.id === 'golive');
    expect(golive?.plannedFinish).toBe('2026-10-20');
    expect(golive?.firstPlannedFinish).toBe('2026-09-30');
    expect(golive?.moves).toEqual([
      {
        from: '2026-09-30',
        to: '2026-10-15',
        why: 'The CRS section is not ready. Sarah agreed to 15 October on 26 September.',
        by: 'minh',
        at: at('2026-09-26T09:30'),
      },
      { from: '2026-10-15', to: '2026-10-20', why: WHY, by: 'minh', at: at('2026-10-09T17:00') },
    ]);
  });

  it('msDate records the move and keeps the first planned date', () => {
    const golive = applyOp(larkspurState(), CASES[8][1]).state.milestones.find(
      (m) => m.id === 'golive',
    );
    expect(golive).toEqual({
      id: 'golive',
      name: 'Go-live and first close',
      planned: '2026-10-15',
      firstPlanned: '2026-09-30',
      moves: [
        {
          from: '2026-09-30',
          to: '2026-10-15',
          why: MS_WHY,
          by: 'minh',
          at: at('2026-10-08T16:55'),
        },
      ],
    });
  });

  it('place uses the queue item planned finish when the op has none', () => {
    const { state } = applyOp(larkspurState(), CASES[1][1]);
    expect(state.queue.items.map((q) => q.id)).toEqual(['q2']);
    expect(state.workItems.find((w) => w.id === 'q1')).toEqual({
      id: 'q1',
      title: 'PG-204 Tax ID format check',
      teamId: 'engineering',
      doneBy: 'quang',
      requestedBy: 'lan',
      milestoneId: null,
      parentId: null,
      after: ['analyse'],
      plannedFinish: '2026-10-14',
      firstPlannedFinish: '2026-10-14',
      moves: [],
      since: at('2026-10-09T16:00'),
    });
  });

  it('place takes the planned finish of the op first', () => {
    const op = makeOp('place', {
      itemId: 'q1',
      teamId: 'engineering',
      plannedFinish: '2026-10-12',
    });
    const q1 = applyOp(larkspurState(), op).state.workItems.find((w) => w.id === 'q1');
    expect(q1?.plannedFinish).toBe('2026-10-12');
    expect(q1?.firstPlannedFinish).toBe('2026-10-12');
  });

  it('a queue item keeps the milestone that qms set when it is placed', () => {
    const { state, entries } = replayOps(larkspurState(), [
      makeOp('qms', { itemId: 'q2', milestoneId: 'crm' }),
      makeOp('place', { itemId: 'q2', teamId: 'customer-success' }),
    ]);
    expect(state.workItems.find((w) => w.id === 'q2')?.milestoneId).toBe('crm');
    expect(entries[1].after).toBe('Customer Success, milestone CRM integration live');
  });

  it('fromEvent makes a work item that holds the queue event', () => {
    const { state } = applyOp(larkspurState(), CASES[3][1]);
    expect(state.workItems.find((w) => w.id === 'w1')).toMatchObject({
      teamId: 'customer-success',
      doneBy: 'daniel',
      requestedBy: 'sarah',
      milestoneId: null,
      after: ['incident'],
      plannedFinish: '2026-10-12',
      firstPlannedFinish: '2026-10-12',
      moves: [],
    });
    expect(state.events.find((e) => e.id === 'qe1')?.workItemId).toBe('w1');
    expect(state.queue.events.map((e) => e.id)).toEqual(['qe2', 'qe3', 'qe4']);
  });

  it('addEvent records the member who added it', () => {
    const { state } = applyOp(larkspurState(), CASES[4][1]);
    expect(state.events.find((e) => e.id === 'qd1')).toEqual({
      id: 'qd1',
      workItemId: 'pg203',
      kind: 'delivery',
      at: at('2026-10-09T12:00'),
      by: 'quang',
      text: 'The country list field is on staging.',
      addedBy: 'quang',
      hidden: false,
    });
  });

  it('move, kind and hide change the event', () => {
    const s = larkspurState();
    expect(applyOp(s, CASES[5][1]).state.events.find((e) => e.id === 'p32')?.workItemId).toBe(
      'test',
    );
    expect(applyOp(s, CASES[6][1]).state.events.find((e) => e.id === 'p32')?.kind).toBe('issue');
    expect(applyOp(s, CASES[7][1]).state.events.find((e) => e.id === 'x2')?.hidden).toBe(true);
  });

  it('move, kind and hide of a hidden event throw OpError', () => {
    const hidden = applyOp(larkspurState(), makeOp('hide', { eventId: 'x2' })).state;
    for (const op of [
      makeOp('move', { eventId: 'x2', to: 'test' }),
      makeOp('kind', { eventId: 'x2', kind: 'issue' }),
      makeOp('hide', { eventId: 'x2' }),
    ]) {
      expect(() => applyOp(hidden, op)).toThrow(OpError);
    }
  });

  it('newMs adds the milestone and sets it on the known members', () => {
    const op = makeOp('newMs', {
      id: 'ms1',
      name: 'Investor statements',
      planned: '2026-10-20',
      members: ['pg201', 'gone'],
    });
    const { state } = applyOp(larkspurState(), op);
    expect(state.milestones.at(-1)).toEqual({
      id: 'ms1',
      name: 'Investor statements',
      planned: '2026-10-20',
      firstPlanned: '2026-10-20',
      moves: [],
    });
    expect(state.workItems.filter((w) => w.milestoneId === 'ms1').map((w) => w.id)).toEqual([
      'pg201',
    ]);
  });

  it('rename, msAdd, msRemove and msName change their field', () => {
    const s = larkspurState();
    const item = (st: typeof s, id: string) => st.workItems.find((w) => w.id === id);
    expect(item(applyOp(s, CASES[13][1]).state, 'pg203')?.title).toBe(
      'PG-203 Country list field (multi-select)',
    );
    expect(item(applyOp(s, CASES[11][1]).state, 'pg203')?.milestoneId).toBe('golive');
    expect(item(applyOp(s, CASES[10][1]).state, 'legal')?.milestoneId).toBeNull();
    expect(applyOp(s, CASES[9][1]).state.milestones.find((m) => m.id === 'crm')?.name).toBe(
      'CRM sync live',
    );
  });

  it('refuses a new change that puts a work item in a second milestone; a move is remove then add', () => {
    const s = larkspurState();
    const taken =
      'Dynamics CRM sync scope is in CRM integration live already. Remove it from that milestone first.';
    const add = (workItemId: string, milestoneId: string) =>
      makeOp('msAdd', { workItemId, milestoneId });
    expect(secondMilestone(s, add('dynamics', 'golive'))).toBe(taken);
    expect(
      secondMilestone(
        s,
        makeOp('newMs', { id: 'm9', name: 'X', planned: '2026-10-20', members: ['dynamics'] }),
      ),
    ).toBe(taken);
    expect(secondMilestone(s, add('pg203', 'golive'))).toBeNull();
    expect(secondMilestone(s, add('dynamics', 'crm'))).toBeNull();
    const removed = applyOp(s, makeOp('msRemove', { workItemId: 'dynamics' })).state;
    expect(secondMilestone(removed, add('dynamics', 'golive'))).toBeNull();
  });

  it('replays an old merged single msAdd as a move, so history keeps its result', () => {
    const commits: Commit[] = [
      {
        rev: 1,
        crId: 'old',
        crNum: 1,
        mergedBy: 'minh',
        mergedAt: at('2026-10-01T10:00'),
        ops: [makeOp('msAdd', { workItemId: 'dynamics', milestoneId: 'golive' })],
        resolutions: [],
      },
    ];
    const main = mainState(larkspurBase(), larkspurQueueRows(), commits);
    expect(main.workItems.find((w) => w.id === 'dynamics')?.milestoneId).toBe('golive');
  });

  it('addTeam appends the team', () => {
    const { state } = applyOp(larkspurState(), CASES[15][1]);
    expect(state.teams.at(-1)).toEqual({ id: 'legal-team', name: 'Legal', leadId: 'priya' });
  });

  it('addTeam keeps a team that the project already has, so a merged one replays', () => {
    const s = larkspurState();
    const { state } = applyOp(s, makeOp('addTeam', { id: 'it', name: 'X', leadId: null }));
    expect(state.teams).toEqual(s.teams);
  });

  it.each<[string, Op]>([
    ['msRemove without a milestone', makeOp('msRemove', { workItemId: 'pg203' })],
    ['msAdd to an unknown milestone', makeOp('msAdd', { workItemId: 'pg203', milestoneId: 'x' })],
    ['place onto an unknown team', makeOp('place', { itemId: 'q1', teamId: 'nope' })],
    ['qms of a missing queue item', makeOp('qms', { itemId: 'nope', milestoneId: 'crm' })],
    ['rename of an unknown work item', makeOp('rename', { workItemId: 'nope', title: 'X' })],
    ['move to an unknown work item', makeOp('move', { eventId: 'p32', to: 'nope' })],
    ['kind of an unknown event', makeOp('kind', { eventId: 'nope', kind: 'done' })],
    [
      'newMs with a taken id',
      makeOp('newMs', { id: 'crm', name: 'X', planned: '2026-10-20', members: [] }),
    ],
    [
      'addEvent with a taken id',
      makeOp('addEvent', {
        workItemId: 'pg203',
        ev: { id: 'p31', kind: 'task', at: at('2026-10-09T12:00'), by: 'quang', text: 'X' },
      }),
    ],
    ['an unknown op', { op: 'teleport', a: {}, rev: 0, by: 'minh' } as unknown as Op],
  ])('%s throws OpError', (_, op) => {
    expect(() => applyOp(larkspurState(), op)).toThrow(OpError);
  });
});

describe('links without loops', () => {
  const loop = /would make a loop/;

  it('refuses a parent whose own parents or sources reach the work item', () => {
    expect(() =>
      applyOp(larkspurState(), makeOp('parent', { workItemId: 'crs', parentId: 'pg203' })),
    ).toThrow(loop);
    expect(() =>
      applyOp(larkspurState(), makeOp('parent', { workItemId: 'crs', parentId: 'pg203' })),
    ).toThrow(OpError);
  });

  it('refuses a source whose own sources or parents reach the work item', () => {
    expect(() =>
      applyOp(larkspurState(), makeOp('after', { workItemId: 'analyse', after: ['pg203'] })),
    ).toThrow(loop);
    expect(() =>
      applyOp(larkspurState(), makeOp('after', { workItemId: 'crs', after: ['pg201'] })),
    ).toThrow(loop);
  });

  it('accepts links that make no loop', () => {
    const s = applyOp(
      larkspurState(),
      makeOp('after', { workItemId: 'pg203', after: ['analyse', 'pg201'] }),
    ).state;
    expect(s.workItems.find((w) => w.id === 'pg203')?.after).toEqual(['analyse', 'pg201']);
    const p = applyOp(larkspurState(), makeOp('parent', { workItemId: 'golive', parentId: 'crs' }));
    expect(p.state.workItems.find((w) => w.id === 'golive')?.parentId).toBe('crs');
  });
});

describe('replayOps', () => {
  const ops = [
    makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }),
    makeOp('attach', { eventId: 'qe3', workItemId: 'crs' }),
    makeOp('rename', { workItemId: 'pg203', title: 'PG-203 Country list field (multi-select)' }),
    makeOp('due', {
      workItemId: 'pg203',
      date: '2026-10-14',
      why: WHY,
      by: 'quang',
      at: at('2026-10-09T17:00'),
    }),
    makeOp('newMs', { id: 'ms1', name: 'Statements', planned: '2026-10-20', members: ['pg201'] }),
    makeOp('msName', { milestoneId: 'crm', name: 'CRM sync live' }),
  ];

  it('turns a failing op into a skipped entry and keeps going', () => {
    const { state, entries } = replayOps(larkspurState(), ops);
    expect(entries.map((e) => [e.i, !!e.skipped])).toEqual([
      [0, false],
      [1, true],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
    ]);
    expect(entries[1]).toMatchObject({
      i: 1,
      change: 'no longer applies',
      before: '',
      after: '',
      skipped: true,
    });
    expect(state.events.find((e) => e.id === 'qe3')?.workItemId).toBe('golive');
    expect(state.workItems.find((w) => w.id === 'pg203')?.plannedFinish).toBe('2026-10-14');
  });

  it('marks the ids that the ops changed', () => {
    const { marks } = replayOps(larkspurState(), ops);
    expect([...marks.events]).toEqual(['qe3']);
    expect([...marks.workItems].sort()).toEqual(['pg201', 'pg203']);
    expect([...marks.dates]).toEqual(['pg203']);
    expect([...marks.milestones].sort()).toEqual(['crm', 'ms1']);
  });

  it('does not mutate the base', () => {
    const base = deepFreeze(larkspurState());
    replayOps(base, ops);
    expect(base).toEqual(larkspurState());
  });

  it('throws an error that is not an OpError', () => {
    const broken = { op: 'rename', a: null, rev: 0, by: 'minh' } as unknown as Op;
    expect(() => replayOps(larkspurState(), [broken])).toThrow(TypeError);
  });
});

describe('keysOf', () => {
  it.each<[string, string[]]>([
    ['attach', ['event:qe3']],
    ['place', ['item:q1']],
    ['qms', ['item:q2']],
    ['fromEvent', ['event:qe1']],
    ['addEvent', []],
    ['move', ['act:p32']],
    ['kind', ['act:p32']],
    ['hide', ['act:x2']],
    ['msDate', ['ms:golive:date']],
    ['msName', ['ms:crm:name']],
    ['msRemove', ['loop:legal:ms']],
    ['msAdd', ['loop:pg203:ms']],
    ['newMs', []],
    ['rename', ['loop:pg203:title']],
    ['due', ['loop:pg203:due']],
    ['addTeam', []],
    ['doneBy', ['loop:pg203:doneBy']],
    ['requestedBy', ['loop:pg203:requestedBy']],
    ['team', ['loop:pg203:team']],
    ['parent', ['loop:pg203:parent']],
    ['after', ['loop:pg203:after']],
  ])('%s', (name, keys) => {
    const op = CASES.find(([n]) => n === name)?.[1] as Op;
    expect(keysOf(op)).toEqual(keys);
  });
});

describe('sameOp', () => {
  it('compares op and arguments only, in any key order', () => {
    const x = makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }, 0, 'minh');
    const y = {
      ...makeOp('attach', { workItemId: 'golive', eventId: 'qe3' }, 4, 'lan'),
      d: CASES[0][2],
    };
    expect(sameOp(x, y)).toBe(true);
    expect(sameOp(x, makeOp('attach', { eventId: 'qe3', workItemId: 'crs' }))).toBe(false);
    expect(sameOp(x, makeOp('place', { itemId: 'qe3', teamId: 'golive' }))).toBe(false);
  });

  it('treats a missing optional argument as undefined', () => {
    const x = makeOp('place', { itemId: 'q1', teamId: 'engineering' });
    const y = makeOp('place', { itemId: 'q1', teamId: 'engineering', plannedFinish: undefined });
    expect(sameOp(x, y)).toBe(true);
  });
});

describe('initialState', () => {
  it('builds the queue from the base and the queue rows', () => {
    expect(initialState(larkspurBase(), larkspurQueueRows())).toEqual(larkspurState());
  });

  it('accepts a queue that is already built', () => {
    expect(initialState(larkspurBase(), larkspurState().queue)).toEqual(larkspurState());
  });

  it('does not share objects with its inputs', () => {
    const base = larkspurBase();
    const s = initialState(base, larkspurQueueRows());
    s.workItems[0].title = 'Changed';
    expect(base.workItems[0].title).toBe('Go-live date');
  });
});

describe('OpSchema', () => {
  it('accepts every case op', () => {
    for (const [, op] of CASES) expect(OpSchema.parse(op)).toEqual(op);
  });

  it('rejects a blank reason, an unknown op and an extra argument', () => {
    expect(
      OpSchema.safeParse({ ...CASES[14][1], a: { ...CASES[14][1].a, why: '  ' } }).success,
    ).toBe(false);
    expect(OpSchema.safeParse({ op: 'teleport', a: {}, rev: 0, by: 'minh' }).success).toBe(false);
    expect(
      OpSchema.safeParse({ ...CASES[13][1], a: { ...CASES[13][1].a, extra: 1 } }).success,
    ).toBe(false);
  });
});

describe('schemas', () => {
  const event = {
    kind: 'message',
    at: '2026-10-09T18:00:00+07:00',
    by: 'sarah',
    text: 'Where is the report?',
  };

  it('accept instants with and without seconds and store them with seconds', () => {
    expect(QueueEventInputSchema.parse(event).at).toBe('2026-10-09T18:00:00+07:00');
    expect(QueueEventInputSchema.parse({ ...event, at: '2026-10-09T18:00+07:00' }).at).toBe(
      '2026-10-09T18:00:00+07:00',
    );
    expect(QueueEventInputSchema.parse({ ...event, at: '2026-10-09T11:00Z' }).at).toBe(
      '2026-10-09T11:00:00Z',
    );
    const due = OpSchema.parse({
      ...CASES[14][1],
      a: { ...CASES[14][1].a, at: '2026-10-09T17:00+07:00' },
    });
    expect(due.op === 'due' && due.a.at).toBe('2026-10-09T17:00:00+07:00');
    expect(QueueEventInputSchema.safeParse({ ...event, at: '2026-10-09T18+07:00' }).success).toBe(
      false,
    );
    expect(QueueEventInputSchema.safeParse({ ...event, at: '2026-10-09T18:00' }).success).toBe(
      false,
    );
  });

  it('accept the fixture ids and UUIDs and reject an id with a colon', () => {
    expect(TrackerStateSchema.safeParse(larkspurState()).success).toBe(true);
    const rename = (workItemId: string) =>
      OpSchema.safeParse(makeOp('rename', { workItemId, title: 'X' })).success;
    expect(rename('3f2b8c1e-9d4a-4b7e-8f60-2a1c5d9e7b34')).toBe(true);
    expect(rename('solutions-engineering')).toBe(true);
    expect(rename('pg_203')).toBe(true);
    expect(rename('pg:203')).toBe(false);
    expect(rename('pg 203')).toBe(false);
    expect(rename('')).toBe(false);
    expect(rename('a'.repeat(101))).toBe(false);
    const state = larkspurState();
    state.workItems[0].id = 'loop:golive';
    expect(TrackerStateSchema.safeParse(state).success).toBe(false);
  });
});
