import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDirectory } from '../../../src/components/tracker/avatar';
import type { Session } from '../../../src/components/tracker/ContextBar';
import { TopBar } from '../../../src/components/tracker/TopBar';
import { NO_ACTIONS } from '../../../src/components/tracker/TrackerScreen';
import type { HiddenList } from '../../../src/components/tracker/view-state';
import { NO_FILTER, type RowFilter } from '../../../src/tracker/filter';
import type { Member, TrackerPayload } from '../../../src/tracker/payload';
import { buildState } from '../../support/tracker-fixture';

const members: Member[] = [
  { id: 'minh', name: 'Minh Trần', roleLabel: 'Owner', color: '#111', userId: 'u1' },
  { id: 'lan', name: 'Lan Phạm', roleLabel: 'Lead', color: '#222', userId: null },
];

const NONE: HiddenList = { teams: [], items: [], count: 0 };

function render(me: Member | null, hidden: HiddenList = NONE, filter: RowFilter = NO_FILTER) {
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
      ownerMemberId: 'minh',
    },
    members,
    me,
    base,
    queue,
    commits: [],
    crs: [],
    offsets: {},
  };
  const session: Session = {
    projectId: 'p1',
    payload,
    me: me?.id ?? null,
    isOwner: me?.id === 'minh',
    dir: makeDirectory(members, []),
    tz: 'Asia/Ho_Chi_Minh',
  };
  return renderToStaticMarkup(
    createElement(TopBar, {
      session,
      view: 'main',
      cr: null,
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
});
