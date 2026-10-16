import { describe, expect, it } from 'vitest';
import { foldText, searchWorkItems } from '../../../src/tracker/search';
import { timeSpent } from '../../../src/tracker/status';
import { at, buildState, larkspurState, workItem } from '../../support/tracker-fixture';

const titles = (query: string) => searchWorkItems(larkspurState(), query).map((w) => w.title);

describe('foldText', () => {
  it('drops case and Vietnamese marks, so a plain keyboard finds every name', () => {
    expect(foldText('Lan Phạm')).toBe('lan pham');
    expect(foldText('Hà Đỗ')).toBe('ha do');
    expect(foldText('Quang Nguyễn')).toBe('quang nguyen');
  });
});

describe('searchWorkItems', () => {
  it('finds a work item by its title, without regard to case', () => {
    expect(titles('pg-203')).toEqual(['PG-203 Country list field type']);
    expect(titles('  COUNTRY list ')).toEqual(['PG-203 Country list field type']);
  });

  it('finds the work items of a team by the team name', () => {
    expect(titles('digitization qa')).toEqual(['Test the CRS section end to end']);
  });

  it('finds the work items of a person, as Done by or Requested by, with or without marks', () => {
    const pham = titles('pham');
    expect(pham).toEqual(titles('Phạm'));
    expect(pham).toEqual(
      expect.arrayContaining([
        'Analyse the CRS and FATCA rules',
        'PG-201 CRS form logic',
        'PG-203 Country list field type',
      ]),
    );
    expect(titles('Hà Đỗ')).toEqual(['Test the CRS section end to end']);
  });

  it('needs every word of the query, in any field', () => {
    expect(titles('crs khoa')).toEqual([
      'PG-201 CRS form logic',
      'PG-202 DealCloud mapping for CRS fields',
    ]);
    expect(titles('crs nobody')).toEqual([]);
  });

  it('puts a title with a word that starts with the query first, then a title that holds it, then the rest', () => {
    const state = buildState({
      teams: [
        { id: 'a', name: 'Sync team', leadId: null },
        { id: 'b', name: 'Other', leadId: null },
      ],
      workItems: [
        workItem({ id: 'team-only', title: 'Billing', teamId: 'a' }),
        workItem({ id: 'inside', title: 'Nightly resync job', teamId: 'a' }),
        workItem({ id: 'word', title: 'Data sync checks', teamId: 'b' }),
        workItem({ id: 'start', title: 'Sync monitoring', teamId: 'b' }),
      ],
    });
    expect(searchWorkItems(state, 'sync').map((w) => w.id)).toEqual([
      'word',
      'start',
      'inside',
      'team-only',
    ]);
  });

  it('keeps the graph order of teams among equal matches', () => {
    expect(titles('crs').slice(0, 3)).toEqual([
      'CRS tax residency section with DealCloud sync',
      'Analyse the CRS and FATCA rules',
      'PG-201 CRS form logic',
    ]);
  });

  it('finds nothing for an empty query', () => {
    expect(titles('')).toEqual([]);
    expect(titles('   ')).toEqual([]);
  });
});

describe('timeSpent', () => {
  it('counts whole hours and days to one decimal from start to end', () => {
    expect(timeSpent(at('2026-10-01T09:00'), at('2026-10-06T12:00'))).toBe('123 h (5.1 days)');
    expect(timeSpent(at('2026-10-01T09:00'), at('2026-10-01T09:20'))).toBe('0 h (0.0 days)');
    expect(timeSpent(at('2026-10-01T09:00'), at('2026-10-02T09:00'))).toBe('24 h (1.0 days)');
  });

  it('has no value before the first event, and never goes below zero', () => {
    expect(timeSpent(null, at('2026-10-06T12:00'))).toBeNull();
    expect(timeSpent(at('2026-10-06T12:00'), at('2026-10-01T09:00'))).toBe('0 h (0.0 days)');
  });
});
