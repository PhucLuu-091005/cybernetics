import { describe, expect, it } from 'vitest';
import records from '../../../fixtures/records.json';
import main from '../../../fixtures/main-snapshot.json';
import gold from '../../../fixtures/gold.json';
import type { GraphSnapshot } from '../../../src/contracts';
import { deriveProject } from '../../../src/server/loops/engine';
import { engineInputFromFixtures } from '../../../scripts/build-fixtures';
import {
  applyFilters,
  citedLoops,
  filtersToSearch,
  parseFilters,
} from '../../../src/components/graph/filters';

const snapshot = main as GraphSnapshot;
const engine = deriveProject(
  engineInputFromFixtures(
    snapshot,
    records.filter((item) => item.projectKey === 'larkspur'),
    gold.T,
  ),
);
const departments = snapshot.context.departments;
const dept = (name: string) => departments.find((item) => item.name === name)!.id;
const loopId = (title: string) => engine.loops.find((item) => item.loop.title === title)!.loop.id;
const titles = (ids: Set<string>) =>
  engine.loops
    .filter((item) => ids.has(item.loop.id))
    .map((item) => item.loop.title)
    .sort();
const visible = (query: string) =>
  applyFilters(engine, parseFilters(new URLSearchParams(query)), departments);

describe('graph filters', () => {
  it('keeps only loops in the selected departments with the selected breakdown', () => {
    const query = `dept=${dept('Customer Success')}&dept=${dept('Engineering')}&breakdown=silent_overdue`;
    const filters = parseFilters(new URLSearchParams(query));
    expect(filters.departmentIds).toEqual([dept('Customer Success'), dept('Engineering')]);
    expect(filters.breakdown).toBe('silent_overdue');
    expect(titles(visible(query))).toEqual([
      'PG-203 Country list field type',
      'Sync incident report',
    ]);
    expect(
      titles(
        visible(
          `dept=${dept('Customer Success')}&dept=${dept('Engineering')}&breakdown=ambiguous_promise`,
        ),
      ),
    ).toEqual(['Dynamics CRM sync scope']);
    expect(titles(visible(`dept=${dept('IT')}&breakdown=silent_overdue`))).toEqual([]);
  });

  it('matches q against titles and quotes, ignoring case and accents', () => {
    expect(titles(visible('q=dynamics'))).toEqual(['Dynamics CRM sync scope']);
    expect(titles(visible('q=D%C3%9DN%C3%84MICS'))).toEqual(['Dynamics CRM sync scope']);
    // "phase 1" occurs only in the request quote, never in a loop title.
    expect(titles(visible('q=PHASE%201'))).toEqual(['Dynamics CRM sync scope']);
    expect(titles(visible('q=permission'))).toEqual(['Permission matrix']);
  });

  it('keeps all 36 loops when no filter is set', () => {
    const filters = parseFilters(new URLSearchParams(''));
    expect(filters).toEqual({
      side: null,
      departmentIds: [],
      state: null,
      breakdown: null,
      problems: false,
      milestoneId: null,
      q: '',
      view: 'graph',
      loopId: null,
    });
    expect(visible('').size).toBe(36);
    expect(engine.loops).toHaveLength(36);
  });

  it('filters by side, state and milestone', () => {
    expect(titles(visible('side=client'))).toEqual(
      engine.loops
        .filter(
          (item) =>
            departments.find((d) => d.id === item.loop.performerDepartmentId)!.side === 'client',
        )
        .map((item) => item.loop.title)
        .sort(),
    );
    expect(titles(visible('side=client&state=requested'))).toEqual(['Client secret renewal']);
    const milestoneId = snapshot.context.milestones.find(
      (item) => item.name === 'CRM integration live',
    )!.id;
    expect(
      [...visible(`milestone=${milestoneId}`)].every(
        (id) => engine.loops.find((item) => item.loop.id === id)!.loop.milestoneId === milestoneId,
      ),
    ).toBe(true);
  });

  it('citedLoops returns the loops that hold the given acts and ignores unknown act IDs', () => {
    const goLive = engine.loops.find((item) => item.loop.title === 'Go-live date')!;
    const dynamics = engine.loops.find((item) => item.loop.title === 'Dynamics CRM sync scope')!;
    const cited = citedLoops(engine, [
      goLive.acts[0].id,
      goLive.acts[1].id,
      dynamics.acts[0].id,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(cited).toEqual(new Set([loopId('Go-live date'), loopId('Dynamics CRM sync scope')]));
  });

  it('drops unknown or malformed values and round-trips through the URL', () => {
    const filters = parseFilters(
      new URLSearchParams(
        'side=both&state=asleep&breakdown=nope&dept=not-a-uuid&milestone=x&view=table&loop=1&q=%20%20',
      ),
    );
    expect(filters).toEqual(parseFilters(new URLSearchParams('')));
    const full = parseFilters(
      new URLSearchParams(
        `side=vendor&dept=${dept('Engineering')}&state=promised&breakdown=ambiguous_promise&q=crm&view=list&loop=${loopId('Go-live date')}`,
      ),
    );
    expect(parseFilters(filtersToSearch(full))).toEqual(full);
    expect(filtersToSearch(parseFilters(new URLSearchParams(''))).toString()).toBe('');
  });

  it('problems=1 keeps only loops with a breakdown and round-trips through the URL', () => {
    const filters = parseFilters(new URLSearchParams('problems=1'));
    expect(filters.problems).toBe(true);
    expect(filtersToSearch(filters).get('problems')).toBe('1');
    expect(parseFilters(new URLSearchParams('problems=yes')).problems).toBe(false);
    expect(filtersToSearch(parseFilters(new URLSearchParams(''))).has('problems')).toBe(false);
    const withProblems = engine.loops
      .filter((item) => item.breakdowns.length > 0)
      .map((item) => item.loop.title)
      .sort();
    expect(withProblems.length).toBeGreaterThan(0);
    expect(titles(visible('problems=1'))).toEqual(withProblems);
  });

  it('problems=1 combines with a department filter', () => {
    const query = `problems=1&dept=${dept('Engineering')}`;
    for (const title of titles(visible(query))) {
      const derived = engine.loops.find((item) => item.loop.title === title)!;
      expect(derived.breakdowns.length).toBeGreaterThan(0);
      expect(derived.loop.performerDepartmentId).toBe(dept('Engineering'));
    }
  });
});
