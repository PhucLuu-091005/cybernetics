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
    grants: DEFAULT_GRANTS,
  },
  {
    id: 'lan',
    name: 'Lan Phạm',
    roleLabel: 'Lead',
    color: '#222',
    userId: null,
    active: true,
    grants: DEFAULT_GRANTS,
  },
  {
    id: 'gone',
    name: 'Bảo Ngô',
    roleLabel: '',
    color: '#333',
    userId: null,
    active: false,
    grants: DEFAULT_GRANTS,
  },
  {
    id: 'mai',
    name: 'Mai Vũ',
    roleLabel: '',
    color: '#444',
    userId: 'u2',
    active: true,
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
    offsets: {},
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

function render(
  me: Member | null,
  hidden: HiddenList = NONE,
  filter: RowFilter = NO_FILTER,
  crs: Cr[] = [],
  cr: Cr | null = null,
) {
  const session = sessionOf(me, crs);
  const { base, queue } = session.payload;
  return renderToStaticMarkup(
    createElement(TopBar, {
      session,
      account: { name: 'Signed In', detail: 'signed@example.com' },
      userId: 'u1',
      view: cr ? cr.num : 'main',
      cr,
      state: { ...base, queue },
      asOf: '2026-10-09T18:00:00+07:00',
      hidden,
      drawer: null,
      actions: NO_ACTIONS,
      onView: () => {},
      onDrawer: () => {},
      onUnhideTeam: () => {},
      onUnhideItem: () => {},
      onUnhideAll: () => {},
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
    const html = render(members[1], NONE, { ...NO_FILTER, statuses: ['late'], teams: ['eng'] });
    expect(html).toContain('aria-label="Filters, 2 on"');
    expect(html).toMatch(/<span class="cnt">2<\/span>/);
    expect(html).toContain('Clear filters');
  });

  it('shows the typed text of the filter in the search box', () => {
    expect(render(members[1], NONE, { ...NO_FILTER, text: 'pg-203' })).toContain('value="pg-203"');
  });

  it('shows no hidden badge when nothing is hidden', () => {
    expect(render(members[1])).not.toContain('Unhide');
  });

  it('opens a list of hidden teams and work items from the hidden badge, each with Unhide', () => {
    const html = render(members[1], {
      teams: [{ id: 'it', name: 'IT', items: 1 }],
      items: [{ id: 'pg203', title: 'PG-203 Country list field type', team: 'Engineering' }],
      count: 2,
    });
    expect(html).toMatch(/<summary[^>]*>.*2 hidden.*<\/summary>/);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Unhide IT"');
    expect(html).toContain('aria-label="Unhide PG-203 Country list field type"');
    expect(html).toContain('Unhide all');
    expect(html).not.toContain('Show all');
  });

  it('shows on Main that it is read-only and who leads the project, in the view selector', () => {
    const html = render(members[1]);
    expect(html).toContain('read-only</span>');
    expect(html).toContain('Lead: Minh Trần');
    expect(html).toContain(
      'aria-label="View: Main, read-only, project lead Minh Trần. Switch view"',
    );
  });

  it('has one change requests button that reads Change requests, or the number ready to merge', () => {
    expect(render(members[0])).toMatch(/class="btn crs-btn"[^>]*>.*Change requests<\/button>/);
    const html = render(members[0], NONE, NO_FILTER, [draft(1, 'ready'), draft(2, 'ready')]);
    expect(html).toMatch(/class="btn crs-btn"[^>]*>.*2 ready to merge<\/button>/);
    expect(html.match(/crs-btn/g)).toHaveLength(1);
    expect(html).not.toContain('js-req');
  });

  it('puts New change request in the top bar on Main only; the view menu always has it', () => {
    const count = (html: string) => html.match(/New change request/g)?.length ?? 0;
    expect(count(render(members[1]))).toBe(2);
    const cr = draft(5, 'draft');
    expect(count(render(members[1], NONE, NO_FILTER, [cr], cr))).toBe(1);
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

describe('ContextBar on Main', () => {
  const bar = (me: Member, crs: Cr[]) =>
    renderToStaticMarkup(
      createElement(ContextBar, {
        session: sessionOf(me, crs),
        cr: null,
        actions: NO_ACTIONS,
        onView: () => {},
        onChanges: () => {},
      }),
    );

  it('leaves no row when nothing waits for the person', () => {
    expect(bar(members[0], [draft(1, 'ready')])).toBe('');
  });

  it('shows the row only to open a draft of your own, without the read-only sentence', () => {
    const html = bar(members[1], [draft(4, 'draft')]);
    expect(html).toContain('Open #4 (draft)');
    expect(html).not.toContain('Every change goes through a change request');
    expect(html).not.toContain('New change request');
  });
});
