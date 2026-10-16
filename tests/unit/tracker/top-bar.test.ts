import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDirectory } from '../../../src/components/tracker/avatar';
import type { Session } from '../../../src/components/tracker/ContextBar';
import { TopBar } from '../../../src/components/tracker/TopBar';
import { NO_ACTIONS } from '../../../src/components/tracker/TrackerScreen';
import type { Member, TrackerPayload } from '../../../src/tracker/payload';
import { buildState } from '../../support/tracker-fixture';

const members: Member[] = [
  { id: 'minh', name: 'Minh Trần', roleLabel: 'Owner', color: '#111', userId: 'u1' },
  { id: 'lan', name: 'Lan Phạm', roleLabel: 'Lead', color: '#222', userId: null },
];

function render(me: Member | null) {
  const { queue, ...base } = buildState();
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
      hiddenCount: 0,
      drawer: null,
      actions: NO_ACTIONS,
      onView: () => {},
      onDrawer: () => {},
      onShowAll: () => {},
      onActAs: () => {},
      onPick: () => {},
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
});
