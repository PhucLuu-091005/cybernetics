import { ALL_GRANTS, DEFAULT_GRANTS } from '../../../tracker/permissions';
import { addDays } from '../../../tracker/time';
import type {
  CrCommentKind,
  CrPermission,
  DateMove,
  EventKind,
  Op,
  QueueEvent,
  QueueItem,
  QueueRow,
  TrackerBase,
  TrackerState,
  WorkItem,
} from '../../../tracker';

export const LARKSPUR_PROJECT = {
  title: 'Larkspur Capital, Fund III onboarding',
  clientName: 'Larkspur Capital',
};
export const LARKSPUR_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** The moment the story is written for: its last change request comment is at 16:50 that day. */
export const LARKSPUR_STORY_NOW = '2026-10-09T18:00:00+07:00';
export const LARKSPUR_WINDOW_START = '2026-09-13';

export const at = (local: string) => `${local}:00+07:00`;

const DAY = 86_400_000;

/**
 * The whole days a copy made at `now` moves the story, so the story's now lands in the 24 hours
 * before `now`: every seeded moment is past and the statuses match the story. The seed writes
 * +07:00, and Asia/Ho_Chi_Minh has no daylight saving, so a day is always 24 hours.
 */
export function larkspurShift(now: Date): number {
  return Math.floor((now.getTime() - Date.parse(LARKSPUR_STORY_NOW)) / DAY);
}

const longDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** Moves every date and instant by `days`, and writes each `{YYYY-MM-DD}` in a text as "30 September". */
function shiftStory<T>(value: T, days: number): T {
  if (typeof value === 'string') {
    const date = /^(\d{4}-\d{2}-\d{2})(T.*)?$/.exec(value);
    if (date) return `${addDays(date[1], days)}${date[2] ?? ''}` as T;
    return value.replace(/\{(\d{4}-\d{2}-\d{2})\}/g, (_, day: string) =>
      longDay.format(new Date(`${addDays(day, days)}T00:00:00Z`)),
    ) as T;
  }
  if (Array.isArray(value)) return value.map((item) => shiftStory(item, days)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shiftStory(item, days)]),
    ) as T;
  return value;
}

/**
 * Maps a story key to the id it is stored under. The database seed maps member keys and queue
 * keys to fresh UUIDs, because those rows have global primary keys; tests keep the keys.
 */
export type LarkspurIds = (key: string) => string;
const keep: LarkspurIds = (key) => key;

const PEOPLE: Record<string, string> = {
  sarah: 'Sarah Kim',
  minh: 'Minh Trần',
  quang: 'Quang Nguyễn',
  daniel: 'Daniel Reyes',
  tom: 'Tom Becker',
  lan: 'Lan Phạm',
  khoa: 'Khoa Lê',
  ha: 'Hà Đỗ',
  priya: 'Priya Shah',
};

const TEAMS: Array<[string, string, string]> = [
  ['implementation', 'Implementation', 'minh'],
  ['digitization', 'Digitization', 'lan'],
  ['solutions-engineering', 'Solutions Engineering', 'khoa'],
  ['engineering', 'Engineering', 'quang'],
  ['digitization-qa', 'Digitization QA', 'ha'],
  ['customer-success', 'Customer Success', 'daniel'],
  ['it', 'IT', 'tom'],
];

type Ev = [id: string, local: string, kind: EventKind, by: string, text: string];
type Loop = {
  id: string;
  title: string;
  team: string;
  requestedBy: string;
  doneBy: string;
  milestoneId: string | null;
  parentId: string | null;
  after: string[];
  plannedFinish: string;
  events: Ev[];
};

const LOOPS: Loop[] = [
  {
    id: 'golive',
    title: 'Go-live date',
    team: 'implementation',
    requestedBy: 'sarah',
    doneBy: 'minh',
    milestoneId: 'golive',
    parentId: null,
    after: [],
    plannedFinish: '2026-10-15',
    events: [
      ['g1', '2026-09-14T09:20', 'message', 'sarah', 'Can Fund III go live by {2026-09-30}?'],
      ['g2', '2026-09-15T10:45', 'decision', 'minh', 'Go-live is set for {2026-09-30}.'],
      [
        'g3',
        '2026-09-25T10:40',
        'issue',
        'minh',
        'Go-live moves to {2026-10-15}. The CRS section is not ready.',
      ],
      ['g4', '2026-09-26T09:15', 'decision', 'sarah', 'Sarah agrees to go live on {2026-10-15}.'],
    ],
  },
  {
    id: 'crs',
    title: 'CRS tax residency section with DealCloud sync',
    team: 'implementation',
    requestedBy: 'sarah',
    doneBy: 'minh',
    milestoneId: 'golive',
    parentId: null,
    after: [],
    plannedFinish: '2026-10-16',
    events: [
      [
        'c1',
        '2026-09-14T09:20',
        'message',
        'sarah',
        'Add a CRS tax residency section to the Fund III form and sync the answers to DealCloud.',
      ],
      [
        'c2',
        '2026-09-15T10:45',
        'task',
        'minh',
        'Minh plans five parts: rules analysis, form logic, DealCloud mapping, country field and an end-to-end test. Target: {2026-10-16}.',
      ],
      [
        'c3',
        '2026-09-15T11:30',
        'handoff',
        'minh',
        'Minh hands the rules analysis to Digitization.',
      ],
    ],
  },
  {
    id: 'rehearsal',
    title: 'First-close rehearsal',
    team: 'implementation',
    requestedBy: 'sarah',
    doneBy: 'minh',
    milestoneId: 'golive',
    parentId: null,
    after: [],
    plannedFinish: '2026-09-26',
    events: [
      ['r1', '2026-09-24T09:20', 'meeting', 'minh', 'Rehearsal call with Fund Operations.'],
      ['r2', '2026-09-24T15:10', 'delivery', 'minh', 'Minh sends the rehearsal report.'],
      ['r3', '2026-09-24T16:40', 'done', 'sarah', 'Sarah accepts the rehearsal.'],
    ],
  },
  {
    id: 'analyse',
    title: 'Analyse the CRS and FATCA rules',
    team: 'digitization',
    requestedBy: 'minh',
    doneBy: 'lan',
    milestoneId: null,
    parentId: 'crs',
    after: [],
    plannedFinish: '2026-09-22',
    events: [
      [
        'a1',
        '2026-09-15T13:00',
        'task',
        'lan',
        'Lan starts the rules analysis. Target: {2026-09-22}.',
      ],
      [
        'a2',
        '2026-09-20T15:10',
        'delivery',
        'lan',
        'The field list and the show and hide rules are in the ticket.',
      ],
      [
        'a3',
        '2026-09-21T16:00',
        'handoff',
        'lan',
        'Lan hands three tasks to Solutions Engineering and Engineering.',
      ],
      ['a4', '2026-09-22T16:40', 'done', 'minh', 'Minh accepts the analysis.'],
    ],
  },
  {
    id: 'legal',
    title: 'Legal review routing',
    team: 'digitization',
    requestedBy: 'priya',
    doneBy: 'lan',
    milestoneId: 'crm',
    parentId: null,
    after: [],
    plannedFinish: '2026-09-09',
    events: [
      ['l1', '2026-09-09T09:20', 'task', 'priya', 'Configure legal review routing.'],
      ['l2', '2026-09-09T15:10', 'delivery', 'lan', 'Legal review routing is live.'],
      ['l3', '2026-09-09T16:40', 'done', 'priya', 'Priya accepts the routing.'],
    ],
  },
  {
    id: 'pg201',
    title: 'PG-201 CRS form logic',
    team: 'solutions-engineering',
    requestedBy: 'lan',
    doneBy: 'khoa',
    milestoneId: null,
    parentId: 'crs',
    after: ['analyse'],
    plannedFinish: '2026-09-30',
    events: [
      [
        'p11',
        '2026-09-23T09:20',
        'task',
        'lan',
        'Build the show and hide logic from the analysis. Target: {2026-09-30}.',
      ],
      ['p12', '2026-09-29T15:10', 'delivery', 'khoa', 'The logic is live on staging.'],
      ['p13', '2026-09-30T16:40', 'done', 'lan', 'Lan checks staging. It matches the analysis.'],
    ],
  },
  {
    id: 'pg202',
    title: 'PG-202 DealCloud mapping for CRS fields',
    team: 'solutions-engineering',
    requestedBy: 'lan',
    doneBy: 'khoa',
    milestoneId: null,
    parentId: 'crs',
    after: ['analyse'],
    plannedFinish: '2026-10-01',
    events: [
      [
        'p21',
        '2026-09-28T09:20',
        'task',
        'lan',
        'Map the CRS fields to DealCloud. Target: {2026-10-01}.',
      ],
      ['p22', '2026-10-01T15:10', 'delivery', 'khoa', 'The CRS fields sync to DealCloud.'],
      ['p23', '2026-10-02T16:40', 'done', 'lan', 'The values match in DealCloud.'],
    ],
  },
  {
    id: 'dynamics',
    title: 'Dynamics CRM sync scope',
    team: 'engineering',
    requestedBy: 'sarah',
    doneBy: 'quang',
    milestoneId: 'crm',
    parentId: null,
    after: [],
    plannedFinish: '2026-09-18',
    events: [
      [
        'd1',
        '2026-09-14T09:20',
        'message',
        'sarah',
        'Can we have the Dynamics CRM sync in phase 1?',
      ],
      ['d2', '2026-09-15T10:45', 'message', 'quang', "We'll look into it; phase 1 should be fine."],
    ],
  },
  {
    id: 'syncmon',
    title: 'Sync monitoring',
    team: 'engineering',
    requestedBy: 'tom',
    doneBy: 'quang',
    milestoneId: 'crm',
    parentId: null,
    after: [],
    plannedFinish: '2026-09-16',
    events: [
      ['s1', '2026-09-14T09:20', 'task', 'tom', 'Enable sync monitoring.'],
      ['s2', '2026-09-15T15:10', 'delivery', 'quang', 'Sync monitoring is on.'],
      ['s3', '2026-09-16T16:40', 'done', 'tom', 'Tom accepts sync monitoring.'],
    ],
  },
  {
    id: 'crmlive',
    title: 'CRM integration live',
    team: 'engineering',
    requestedBy: 'tom',
    doneBy: 'quang',
    milestoneId: 'crm',
    parentId: null,
    after: [],
    plannedFinish: '2026-09-18',
    events: [
      ['m1', '2026-09-16T09:20', 'task', 'tom', 'Enable the CRM integration.'],
      ['m2', '2026-09-17T15:10', 'delivery', 'quang', 'The CRM integration is live.'],
      ['m3', '2026-09-18T16:40', 'done', 'tom', 'Tom accepts the CRM integration.'],
    ],
  },
  {
    id: 'pg203',
    title: 'PG-203 Country list field type',
    team: 'engineering',
    requestedBy: 'lan',
    doneBy: 'quang',
    milestoneId: null,
    parentId: 'crs',
    after: ['analyse'],
    plannedFinish: '2026-10-06',
    events: [
      [
        'p31',
        '2026-09-24T09:20',
        'task',
        'lan',
        'Add a multi-select country list field. Target: {2026-10-06}.',
      ],
      [
        'p32',
        '2026-10-07T10:00',
        'message',
        'lan',
        'Lan asks Quang for news on the country list field.',
      ],
    ],
  },
  {
    id: 'test',
    title: 'Test the CRS section end to end',
    team: 'digitization-qa',
    requestedBy: 'minh',
    doneBy: 'ha',
    milestoneId: null,
    parentId: 'crs',
    after: ['pg201', 'pg202', 'pg203'],
    plannedFinish: '2026-10-14',
    events: [],
  },
  {
    id: 'incident',
    title: 'Sync incident report',
    team: 'customer-success',
    requestedBy: 'sarah',
    doneBy: 'daniel',
    milestoneId: 'golive',
    parentId: null,
    after: [],
    plannedFinish: '2026-10-03',
    events: [
      [
        'i1',
        '2026-10-01T10:45',
        'task',
        'daniel',
        'Daniel will send the sync root cause report by {2026-10-03}.',
      ],
    ],
  },
  {
    id: 'secret',
    title: 'Client secret renewal',
    team: 'it',
    requestedBy: 'quang',
    doneBy: 'tom',
    milestoneId: 'golive',
    parentId: null,
    after: [],
    plannedFinish: '2026-09-24',
    events: [
      [
        'x1',
        '2026-09-22T09:20',
        'task',
        'quang',
        'Renew the expired Azure client secret. The sync dropped 40 investors.',
      ],
      ['x2', '2026-09-25T09:30', 'message', 'quang', 'Quang asks Tom for an update on the secret.'],
    ],
  },
  {
    id: 'sso',
    title: 'Investor portal single sign-on',
    team: 'it',
    requestedBy: 'sarah',
    doneBy: 'tom',
    milestoneId: null,
    parentId: null,
    after: [],
    plannedFinish: '2026-10-02',
    events: [
      [
        'v1',
        '2026-09-21T10:00',
        'idea',
        'tom',
        'Tom suggests single sign-on for the investor portal.',
      ],
      [
        'v2',
        '2026-09-29T11:00',
        'cancelled',
        'sarah',
        'Sarah keeps single sign-on out of phase 1.',
      ],
    ],
  },
];

const RECORDED_MOVES: Record<string, { firstPlannedFinish: string; moves: DateMove[] }> = {
  golive: {
    firstPlannedFinish: '2026-09-30',
    moves: [
      {
        from: '2026-09-30',
        to: '2026-10-15',
        why: 'The CRS section is not ready. Sarah agreed to {2026-10-15} on {2026-09-26}.',
        by: 'minh',
        at: at('2026-09-26T09:30'),
      },
    ],
  },
  pg201: {
    firstPlannedFinish: '2026-09-26',
    moves: [
      {
        from: '2026-09-26',
        to: '2026-09-30',
        why: 'The analysis finished on {2026-09-22}, not {2026-09-19}.',
        by: 'lan',
        at: at('2026-09-22T17:00'),
      },
    ],
  },
};

const QUEUE_EVENTS: QueueEvent[] = [
  {
    id: 'qe1',
    kind: 'message',
    at: at('2026-10-09T14:20'),
    by: 'sarah',
    text: 'Where is the root cause report you promised?',
    addedBy: 'minh',
    agent: true,
    createdAt: at('2026-10-09T14:20'),
  },
  {
    id: 'qe2',
    kind: 'meeting',
    at: at('2026-10-08T09:10'),
    by: 'sarah',
    text: 'Scope call: Sarah says the Dynamics sync was always in phase 1.',
    addedBy: 'quang',
    agent: false,
    createdAt: at('2026-10-08T09:10'),
  },
  {
    id: 'qe3',
    kind: 'message',
    at: at('2026-10-07T08:30'),
    by: 'sarah',
    text: 'Sarah needs an explanation for the go-live slip before the LP call.',
    addedBy: 'minh',
    agent: true,
    createdAt: at('2026-10-07T08:30'),
  },
  {
    id: 'qe4',
    kind: 'issue',
    at: at('2026-10-09T11:00'),
    by: 'ha',
    text: 'The test environment has no country list field yet.',
    addedBy: 'ha',
    agent: false,
    createdAt: at('2026-10-09T11:00'),
  },
];

const QUEUE_ITEMS: QueueItem[] = [
  {
    id: 'q1',
    title: 'PG-204 Tax ID format check',
    note: 'Check the format of each tax ID against the country rules.',
    doneBy: 'quang',
    requestedBy: 'lan',
    milestoneId: null,
    after: 'analyse',
    plannedFinish: '2026-10-14',
    addedBy: 'lan',
    agent: true,
    createdAt: at('2026-10-09T16:00'),
  },
  {
    id: 'q2',
    title: 'Investor statement template',
    note: 'Sarah needs a statement template before the first close.',
    doneBy: 'minh',
    requestedBy: 'sarah',
    milestoneId: null,
    after: null,
    plannedFinish: '2026-10-20',
    addedBy: 'minh',
    agent: false,
    createdAt: at('2026-10-09T15:00'),
  },
];

const orNull = (id: LarkspurIds, key: string | null) => (key === null ? null : id(key));

/** `days` moves a copy of the story in time (`larkspurShift`); 0 is the story as written. */
export function larkspurBase(id: LarkspurIds = keep, days = 0): TrackerBase {
  return shiftStory(storyBase(id), days);
}

function storyBase(id: LarkspurIds): TrackerBase {
  return {
    people: Object.entries(PEOPLE).map(([key, name]) => ({ id: id(key), name })),
    teams: TEAMS.map(([teamId, name, leadId]) => ({ id: teamId, name, leadId: id(leadId) })),
    milestones: [
      {
        id: 'crm',
        name: 'CRM integration live',
        planned: '2026-09-18',
        firstPlanned: '2026-09-18',
        moves: [],
      },
      {
        id: 'golive',
        name: 'Go-live and first close',
        planned: '2026-09-30',
        firstPlanned: '2026-09-30',
        moves: [],
      },
    ],
    workItems: LOOPS.map((loop): WorkItem => {
      const recorded = RECORDED_MOVES[loop.id];
      return {
        id: loop.id,
        title: loop.title,
        teamId: loop.team,
        doneBy: id(loop.doneBy),
        requestedBy: id(loop.requestedBy),
        milestoneId: loop.milestoneId,
        parentId: loop.parentId,
        after: [...loop.after],
        plannedFinish: loop.plannedFinish,
        firstPlannedFinish: recorded?.firstPlannedFinish ?? loop.plannedFinish,
        moves: (recorded?.moves ?? []).map((move) => ({ ...move, by: id(move.by) })),
        since: null,
      };
    }),
    events: LOOPS.flatMap((loop) =>
      loop.events.map(([eventId, local, kind, by, text]) => ({
        id: eventId,
        workItemId: loop.id,
        kind,
        at: at(local),
        by: id(by),
        text,
        addedBy: null,
        hidden: false,
      })),
    ),
  };
}

export function larkspurState(id: LarkspurIds = keep, days = 0): TrackerState {
  return shiftStory(
    {
      ...storyBase(id),
      queue: {
        events: QUEUE_EVENTS.map((q) => ({
          ...q,
          id: id(q.id),
          by: id(q.by),
          addedBy: orNull(id, q.addedBy),
        })),
        items: QUEUE_ITEMS.map((q) => ({
          ...q,
          id: id(q.id),
          doneBy: id(q.doneBy),
          requestedBy: id(q.requestedBy),
          addedBy: orNull(id, q.addedBy),
        })),
      },
    },
    days,
  );
}

export function larkspurQueueRows(id: LarkspurIds = keep, days = 0): QueueRow[] {
  const { events, items } = larkspurState(id, days).queue;
  return [
    ...events.map(({ id: rowId, addedBy, agent, createdAt, ...payload }): QueueRow => ({
      id: rowId,
      kind: 'event',
      payload,
      addedByMember: addedBy,
      addedByAgent: agent,
      createdAt,
    })),
    ...items.map(({ id: rowId, addedBy, agent, createdAt, ...payload }): QueueRow => ({
      id: rowId,
      kind: 'item',
      payload,
      addedByMember: addedBy,
      addedByAgent: agent,
      createdAt,
    })),
  ];
}

/** The people who use the demo; colours and role labels come from the prototype. Quang may also merge. */
export const LARKSPUR_MEMBERS = [
  { key: 'minh', roleLabel: 'Project lead', color: '#0f766e', grants: ALL_GRANTS },
  { key: 'lan', roleLabel: 'Digitization lead', color: '#7c3aed', grants: DEFAULT_GRANTS },
  {
    key: 'quang',
    roleLabel: 'Engineering lead',
    color: '#2563eb',
    grants: { ...DEFAULT_GRANTS, mergeCrs: true },
  },
  { key: 'ha', roleLabel: 'QA analyst', color: '#db2777', grants: DEFAULT_GRANTS },
  { key: 'khoa', roleLabel: 'Solutions engineer', color: '#d97706', grants: DEFAULT_GRANTS },
].map((member) => ({ ...member, name: PEOPLE[member.key] }));
export const LARKSPUR_OWNER = 'minh';

/** Team leads follow the role labels; each member sits in the team of their own work. */
export const LARKSPUR_TEAM_PEOPLE: Record<string, { lead: string | null; members: string[] }> = {
  implementation: { lead: 'minh', members: ['minh'] },
  digitization: { lead: 'lan', members: ['lan'] },
  'solutions-engineering': { lead: null, members: ['khoa'] },
  engineering: { lead: 'quang', members: ['quang'] },
  'digitization-qa': { lead: null, members: ['ha'] },
};

export type LarkspurCr = {
  title: string;
  author: string;
  status: 'draft' | 'ready' | 'merged';
  ops: Op[];
  shares: Array<{ memberId: string; permission: CrPermission }>;
  comments: Array<{ by: string; kind: CrCommentKind; at: string; body: string | null }>;
  createdAt: string;
  mergedAt: string | null;
};

/** The change requests of the prototype seed(); #1 is merged as Main revision 1. */
export function larkspurCrs(id: LarkspurIds = keep, days = 0): LarkspurCr[] {
  return shiftStory(storyCrs(id), days);
}

function storyCrs(id: LarkspurIds): LarkspurCr[] {
  const minh = id('minh'),
    lan = id('lan'),
    quang = id('quang'),
    ha = id('ha');
  const note = (by: string, kind: CrCommentKind, local: string, body: string | null = null) => ({
    by,
    kind,
    at: at(local),
    body,
  });
  return [
    {
      title: 'Explain the go-live slip',
      author: minh,
      status: 'merged',
      ops: [
        { op: 'attach', a: { eventId: id('qe3'), workItemId: 'golive' }, rev: 0, by: minh },
        {
          op: 'msDate',
          a: {
            milestoneId: 'golive',
            date: '2026-10-15',
            why: 'The CRS section is not ready. Sarah agreed on {2026-09-26}.',
            by: minh,
            at: at('2026-10-08T16:55'),
          },
          rev: 0,
          by: minh,
        },
      ],
      shares: [],
      comments: [
        note(minh, 'created', '2026-10-08T16:50'),
        note(minh, 'ready', '2026-10-08T17:05'),
        note(minh, 'merged', '2026-10-08T17:30'),
      ],
      createdAt: at('2026-10-08T16:50'),
      mergedAt: at('2026-10-08T17:30'),
    },
    {
      title: 'Place PG-204 in Engineering',
      author: lan,
      status: 'ready',
      ops: [
        { op: 'place', a: { itemId: id('q1'), teamId: 'engineering' }, rev: 1, by: lan },
        {
          op: 'rename',
          a: { workItemId: 'pg203', title: 'PG-203 Country list field (multi-select)' },
          rev: 1,
          by: lan,
        },
      ],
      shares: [],
      comments: [note(lan, 'created', '2026-10-09T15:20'), note(lan, 'ready', '2026-10-09T15:40')],
      createdAt: at('2026-10-09T15:20'),
      mergedAt: null,
    },
    {
      title: 'PG-203 is on staging',
      author: quang,
      status: 'ready',
      ops: [
        {
          op: 'addEvent',
          a: {
            workItemId: 'pg203',
            ev: {
              id: 'qd1',
              kind: 'delivery',
              at: at('2026-10-09T12:00'),
              by: quang,
              text: 'The country list field is on staging.',
            },
          },
          rev: 1,
          by: quang,
        },
        {
          op: 'rename',
          a: { workItemId: 'pg203', title: 'PG-203 Country list field type, on staging' },
          rev: 1,
          by: quang,
        },
      ],
      shares: [],
      comments: [
        note(quang, 'created', '2026-10-09T16:10'),
        note(quang, 'ready', '2026-10-09T16:30'),
      ],
      createdAt: at('2026-10-09T16:10'),
      mergedAt: null,
    },
    {
      title: 'Test plan for the CRS section',
      author: ha,
      status: 'draft',
      ops: [{ op: 'attach', a: { eventId: id('qe4'), workItemId: 'test' }, rev: 1, by: ha }],
      shares: [{ memberId: id('khoa'), permission: 'edit' }],
      comments: [
        note(ha, 'created', '2026-10-09T16:45'),
        note(ha, 'shared', '2026-10-09T16:50', 'Khoa Lê can edit.'),
      ],
      createdAt: at('2026-10-09T16:45'),
      mergedAt: null,
    },
  ];
}
