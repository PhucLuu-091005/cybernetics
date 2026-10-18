import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDirectory } from '../../../src/components/tracker/avatar';
import type { Session } from '../../../src/components/tracker/ContextBar';
import { ContextBar } from '../../../src/components/tracker/ContextBar';
import { TopBar } from '../../../src/components/tracker/TopBar';
import { NO_ACTIONS } from '../../../src/components/tracker/TrackerScreen';
import type { HiddenList } from '../../../src/components/tracker/view-state';
import { NO_FILTER, type RowFilter } from '../../../src/tracker/filter';
import type { Cr, Member, TrackerPayload } from '../../../src/tracker/payload';
import { DEFAULT_GRANTS } from '../../../src/tracker/permissions';
import { buildState } from '../../support/tracker-fixture';

const members: Member[] = [
  {
    id: 'minh',
    name: 'Minh Trần',
    roleLabel: 'Owner',
    color: '#111',
    userId: 'u1',
    active: true,
    removed: false,
    grants: DEFAULT_GRANTS,
  },
  {
    id: 'lan',
    name: 'Lan Phạm',
    roleLabel: 'Lead',
    color: '#222',
    userId: null,
    active: true,
    removed: false,
    grants: DEFAULT_GRANTS,
  },
  {
    id: 'gone',
    name: 'Bảo Ngô',
    roleLabel: '',
    color: '#333',
    userId: null,
    active: false,
    removed: true,
    grants: DEFAULT_GRANTS,
  },
  {
    id: 'mai',
    name: 'Mai Vũ',
    roleLabel: '',
    color: '#444',
    userId: 'u2',
    active: true,
    removed: false,
    grants: DEFAULT_GRANTS,
  },
];
const draft = (num: number, status: Cr['status'], author = 'lan'): Cr => ({
  id: `cr${num}`,
  num,
  title: `Change ${num}`,
  author,
  editor: author,
  status,
  ops: [],
  revision: 0,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
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
});

const NONE: HiddenList = { teams: [], items: [], count: 0 };

function sessionOf(me: Member | null, crs: Cr[] = []): Session {
  const { queue, ...base } = buildState({
    teams: [{ id: 'eng', name: 'Engineering', leadId: null }],
    people: [{ id: 'sarah', name: 'Sarah Kim' }],
    milestones: [
      {
        id: 'golive',
        name: 'Go-live',
        planned: '2026-10-15',
        firstPlanned: '2026-10-15',
        moves: [],
      },
    ],
  });
  const payload: TrackerPayload = {
    project: {
      id: 'p1',
      title: 'Larkspur',
      clientName: 'Larkspur Capital',
      timeZone: 'Asia/Ho_Chi_Minh',
      windowStart: null,
      asOf: null,
      demo: true,
      leadMemberId: 'minh',
    },
    members,
    me,
    canActAs: true,
    base,
    queue,
    commits: [],
    crs,
  };
  return {
    projectId: 'p1',
    payload,
    me: me?.id ?? null,
    canMerge: me?.id === 'minh',
    canCreate: !!me,
    mergers: ['minh'],
    dir: makeDirectory(members, []),
    tz: 'Asia/Ho_Chi_Minh',
  };
}

function render(me: Member | null, filter: RowFilter = NO_FILTER, crs: Cr[] = []) {
  const session = sessionOf(me, crs);
  const { base, queue } = session.payload;
  return renderToStaticMarkup(
    createElement(TopBar, {
      session,
      account: { name: 'Signed In', detail: 'signed@example.com' },
      userId: 'u1',
      state: { ...base, queue },
      asOf: '2026-10-09T18:00:00+07:00',
      drawer: null,
      actions: NO_ACTIONS,
      onDrawer: () => {},
      onActAs: () => {},
      onPick: () => {},
      filter,
      onFilter: () => {},
    }),
  );
}

describe('TopBar', () => {
  it('shows the Demo select to an acting member of a demo project', () => {
    expect(render(members[1])).toContain('aria-label="Demo: act as"');
  });

  it('hides the Demo select from a person with no acting member', () => {
    const html = render(null);
    expect(html).not.toContain('Demo: act as');
    expect(html).not.toContain('Nobody');
  });

  it('has a work item search in place of the Work list', () => {
    const html = render(members[1]);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('placeholder="Search work items"');
    expect(html).not.toContain('Work list');
  });

  it('has a filter control in the search box with status, team, milestone and person', () => {
    const html = render(members[1]);
    expect(html).toContain('aria-label="Filters"');
    expect(html).toContain('aria-label="Filter the graph"');
    for (const legend of ['Status', 'Team', 'Milestone', 'Person (done by or requested by)'])
      expect(html).toContain(`<legend>${legend}</legend>`);
    for (const option of ['Planned', 'Finished late', 'Engineering', 'Go-live', 'No milestone'])
      expect(html).toContain(option);
    expect(html).toContain('Sarah Kim');
  });

  it('counts the active filters on the control and offers Clear filters', () => {
    const html = render(members[1], { ...NO_FILTER, statuses: ['late'], teams: ['eng'] });
    expect(html).toContain('aria-label="Filters, 2 on"');
    expect(html).toMatch(/<span class="cnt">2<\/span>/);
    expect(html).toContain('Clear filters');
  });

  it('shows the typed text of the filter in the search box', () => {
    expect(render(members[1], { ...NO_FILTER, text: 'pg-203' })).toContain('value="pg-203"');
  });

  it('leaves the hidden badge to the context bar', () => {
    expect(render(members[1])).not.toContain('hid-menu');
  });

  it('leaves the view selector to the context bar', () => {
    const html = render(members[1]);
    expect(html).not.toContain('gpick');
    expect(html).not.toContain('Switch view');
  });

  it('has one Change requests button with a badge for the ready ones, and no badge at 0', () => {
    const plain = render(members[0]);
    expect(plain).toMatch(/class="btn crs-btn"[^>]*>.*Change requests<\/button>/);
    expect(plain).not.toContain('nbadge');
    const html = render(members[0], NO_FILTER, [draft(1, 'ready'), draft(2, 'ready')]);
    expect(html).toContain('aria-label="Change requests, 2 ready to merge"');
    expect(html).toMatch(/<span class="nbadge" aria-hidden="true">2<\/span>/);
    expect(html).not.toContain('ready to merge</button>');
    expect(html.match(/crs-btn/g)).toHaveLength(1);
  });

  it('puts New change request in the top bar on Main and in a change request, for a member only', () => {
    const count = (html: string) => html.match(/New change request/g)?.length ?? 0;
    expect(count(render(members[1]))).toBe(1);
    const cr = draft(5, 'draft');
    expect(count(render(members[1], NO_FILTER, [cr]))).toBe(1);
    expect(count(render(null))).toBe(0);
  });

  it('lists only the seeded members who can act and your own member in the Demo select', () => {
    const html = render(members[1]);
    expect(html).toContain('>Lan Phạm</option>');
    expect(html).not.toContain('Bảo Ngô</option>');
    expect(html).not.toContain('Mai Vũ</option>');
    expect(html).toContain('>Minh Trần</option>');
  });

  it('opens a menu with the theme and Sign out from the acting member, or from the signed-in person', () => {
    const html = render(members[1]);
    expect(html).toMatch(
      /<details class="acct me"><summary aria-label="Lan Phạm: theme and sign out"/,
    );
    expect(html).toContain('role="radiogroup"');
    for (const theme of ['System', 'Light', 'Dark']) expect(html).toContain(`>${theme}</button>`);
    expect(html).toContain('Sign out');
    const guest = render(null);
    expect(guest).toContain('<b>Signed In</b><small>Can view</small>');
  });
});

const TWO_HIDDEN: HiddenList = {
  teams: [{ id: 'it', name: 'IT', items: 1 }],
  items: [{ id: 'pg203', title: 'PG-203 Country list field type', team: 'Engineering' }],
  count: 2,
};

const bar = (me: Member | null, crs: Cr[], cr: Cr | null = null, hidden: HiddenList = NONE) =>
  renderToStaticMarkup(
    createElement(ContextBar, {
      session: sessionOf(me, crs),
      cr,
      actions: NO_ACTIONS,
      onView: () => {},
      onDrawer: () => {},
      hidden: { hidden, onUnhideTeam: () => {}, onUnhideItem: () => {}, onUnhideAll: () => {} },
    }),
  );

/** The badge is the last control of the first line of the bar. */
const lastOfFirstLine = (html: string) => {
  const line = html.replace(/<(div class="ask-row|p class="bnote)[\s\S]*$/, '');
  const at = line.indexOf('class="hid-menu"');
  return at > 0 && !/<button|<span class="chipx/.test(line.slice(line.indexOf('</details>', at)));
};

describe('ContextBar on Main', () => {
  it('holds the view selector: Main, read-only and its project lead', () => {
    const html = bar(members[0], [draft(1, 'ready')]);
    expect(html).toContain('class="gpick"');
    expect(html).toContain(
      'aria-label="View: Main, read-only, project lead Minh Trần. Switch view"',
    );
    expect(html).toContain('read-only</span>');
    expect(html).toContain('Lead: Minh Trần');
    expect(html).not.toContain('Open #');
  });

  it('has no Open draft button; the view selector still lists your draft', () => {
    const html = bar(members[1], [draft(4, 'draft')]);
    expect(html).not.toContain('Open #');
    expect(html).toContain('#4 Change 4');
    expect(html).toContain('you are editing');
    expect(html).toContain('All change requests');
  });

  it('shows no hidden badge when nothing is hidden', () => {
    expect(bar(members[1], [draft(4, 'draft')])).not.toContain('hid-menu');
  });

  it('puts the hidden badge at the right end, with a list of each hidden row and Unhide', () => {
    const html = bar(members[1], [draft(4, 'draft')], null, TWO_HIDDEN);
    expect(html).toMatch(/<summary[^>]*>.*2 hidden.*<\/summary>/);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Unhide IT"');
    expect(html).toContain('aria-label="Unhide PG-203 Country list field type"');
    expect(html).toContain('Unhide all');
    expect(html).not.toContain('Show all');
    expect(lastOfFirstLine(html)).toBe(true);
  });
});

describe('ContextBar in a change request', () => {
  const shared = (over: Partial<Cr>): Cr => ({ ...draft(5, 'draft'), ...over });

  it('makes the title the view selector, with the status, people, editing state and count', () => {
    const cr = draft(5, 'draft');
    const html = bar(members[1], [cr], cr);
    expect(html).toContain('aria-label="View: #5 Change 5. Switch view"');
    expect(html).toMatch(/<summary[^>]*>.*#5 Change 5.*<\/summary>/);
    expect(html).toContain('Draft');
    expect(html).toContain('You are editing');
    expect(html).toContain('0 changes');
    expect(html.match(/class="bbar/g)).toHaveLength(1);
  });

  it('puts the hidden badge in the same slot, in an open and in a merged change request', () => {
    const cr = draft(5, 'draft');
    const open = bar(members[1], [cr], cr, TWO_HIDDEN);
    expect(open).toMatch(/<summary[^>]*>.*2 hidden.*<\/summary>/);
    expect(lastOfFirstLine(open)).toBe(true);
    expect(bar(members[1], [cr], cr)).not.toContain('hid-menu');
    const merged = { ...draft(6, 'merged'), mergedBy: 'minh' };
    expect(bar(members[1], [merged], merged, TWO_HIDDEN)).toContain('2 hidden');
  });

  it('adds no spacer to a merged change request when nothing is hidden', () => {
    const merged = { ...draft(6, 'merged'), mergedBy: 'minh' };
    expect(bar(members[1], [merged], merged)).not.toContain('class="sp"');
    expect(bar(members[1], [merged], merged, TWO_HIDDEN)).toContain('class="sp"');
  });

  it('gives a member without edit right a button to ask for edit access', () => {
    const cr = draft(5, 'draft');
    const html = bar(members[3], [cr], cr);
    expect(html).toContain('View only.');
    expect(html).toContain('Ask for edit access');
    expect(html).not.toContain('Ask Lan for edit access');
    expect(html).not.toContain('Cancel change request');
  });

  it('gives a member without the create right a plain view-only note and no ask', () => {
    const cr = draft(5, 'draft');
    const reader = { ...members[3], grants: { ...DEFAULT_GRANTS, createCrs: false } };
    const html = bar(reader, [cr], cr);
    expect(html).toContain('View only.');
    expect(html).not.toContain('Ask for edit access');
    expect(html).not.toContain('Ask to edit');
  });

  it('shows the asker that the ask waits, with Cancel', () => {
    const cr = shared({ asks: [{ memberId: 'mai', createdAt: '2026-10-09T10:00:00.000Z' }] });
    const html = bar(members[3], [cr], cr);
    expect(html).toContain('Waiting for Lan');
    expect(html).not.toContain('Ask for edit access');
  });

  it('shows the editor an ask for access with Grant Can edit and Not now', () => {
    const cr = shared({ asks: [{ memberId: 'mai', createdAt: '2026-10-09T10:00:00.000Z' }] });
    const html = bar(members[1], [cr], cr);
    expect(html).toContain('Mai Vũ</b> asks for edit access to #5.');
    expect(html).toContain('Grant Can edit');
    expect(html).toContain('Not now');
    expect(html).not.toContain('Hand over');
  });

  it('shows the editor an ask to edit from a member who can edit, with Hand over', () => {
    const cr = shared({
      shares: [{ memberId: 'mai', permission: 'edit' }],
      asks: [{ memberId: 'mai', createdAt: '2026-10-09T10:00:00.000Z' }],
    });
    const html = bar(members[1], [cr], cr);
    expect(html).toContain('Mai Vũ</b> asks to edit #5.');
    expect(html).toContain('Hand over');
    expect(html).not.toContain('Grant Can edit');
  });

  it('offers Cancel change request to the author and a merger, and merge to a merger', () => {
    const cr = draft(5, 'ready');
    expect(bar(members[1], [cr], cr)).toContain('Cancel change request');
    const owner = bar(members[0], [cr], cr);
    expect(owner).toContain('Cancel change request');
    expect(owner).toContain('Request changes');
    expect(owner).toContain('Merge into Main');
  });

  it('shows the reason of a cancelled change request', () => {
    const cr = shared({
      status: 'closed',
      closedBy: 'lan',
      closedAt: '2026-10-09T11:00:00.000Z',
      comments: [
        {
          id: 'c1',
          memberId: 'lan',
          kind: 'closed',
          body: 'Main has it already.',
          opIndex: null,
          agent: false,
          createdAt: '2026-10-09T11:00:00.000Z',
        },
      ],
    });
    const html = bar(members[0], [cr], cr);
    expect(html).toContain('Closed');
    expect(html).toContain('Cancelled by Lan Phạm');
    expect(html).toContain('Main has it already.');
  });
});
