import { describe, expect, it } from 'vitest';
import {
  descendantsOf,
  focusTree,
  teamDescendants,
  teamFocusTree,
  type FocusNode,
} from '../../../src/tracker/focus';
import { buildState, larkspurState, workItem } from '../../support/tracker-fixture';

const ids = (node: FocusNode): unknown => [node.id, node.children.map(ids)];

describe('descendantsOf', () => {
  it('follows children by parent and by "leads from", transitively, and keeps the item itself', () => {
    expect([...descendantsOf(larkspurState(), 'analyse')].sort()).toEqual(
      ['analyse', 'pg201', 'pg202', 'pg203', 'test'].sort(),
    );
    expect([...descendantsOf(larkspurState(), 'crs')].sort()).toEqual(
      ['crs', 'analyse', 'pg201', 'pg202', 'pg203', 'test'].sort(),
    );
  });

  it('gives a leaf only itself and an unknown id nothing', () => {
    expect([...descendantsOf(larkspurState(), 'secret')]).toEqual(['secret']);
    expect(descendantsOf(larkspurState(), 'nope').size).toBe(0);
  });

  it('stops on a cycle', () => {
    const s = buildState({
      workItems: [workItem({ id: 'a', after: ['b'] }), workItem({ id: 'b', after: ['a'] })],
    });
    expect([...descendantsOf(s, 'a')].sort()).toEqual(['a', 'b']);
  });
});

describe('focusTree', () => {
  it('lists the parent, the focused item and each descendant once, under its nearest parent', () => {
    const tree = focusTree(larkspurState(), 'analyse')!;
    expect(tree.parent?.id).toBe('crs');
    expect(ids(tree.root)).toEqual([
      'analyse',
      [
        ['pg201', [['test', []]]],
        ['pg202', []],
        ['pg203', []],
      ],
    ]);
    expect(tree.root).toMatchObject({
      title: 'Analyse the CRS and FATCA rules',
      teamId: 'digitization',
    });
  });

  it('puts direct children by parent and by "leads from" on the first level', () => {
    const tree = focusTree(larkspurState(), 'crs')!;
    expect(tree.parent).toBeNull();
    expect(tree.root.children.map((c) => c.id)).toEqual([
      'analyse',
      'pg201',
      'pg202',
      'pg203',
      'test',
    ]);
    expect(tree.root.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it('orders children by team, then by their order in the project', () => {
    const s = buildState({
      teams: [
        { id: 't1', name: 'One', leadId: null },
        { id: 't2', name: 'Two', leadId: null },
      ],
      workItems: [
        workItem({ id: 'p', teamId: 't1' }),
        workItem({ id: 'late', teamId: 't2', parentId: 'p' }),
        workItem({ id: 'early', teamId: 't1', after: ['p'] }),
      ],
    });
    expect(focusTree(s, 'p')!.root.children.map((c) => c.id)).toEqual(['early', 'late']);
  });

  it('gives null for an unknown id', () => {
    expect(focusTree(larkspurState(), 'nope')).toBeNull();
  });
});

describe('teamFocusTree and teamDescendants', () => {
  it('lists the rows of a team with the work that comes from them, each once', () => {
    const tree = teamFocusTree(larkspurState(), 'digitization')!;
    expect(tree.team.name).toBe('Digitization');
    expect(tree.roots.map(ids)).toEqual([
      [
        'analyse',
        [
          ['pg201', [['test', []]]],
          ['pg202', []],
          ['pg203', []],
        ],
      ],
      ['legal', []],
    ]);
    expect([...teamDescendants(larkspurState(), 'digitization')].sort()).toEqual(
      ['analyse', 'legal', 'pg201', 'pg202', 'pg203', 'test'].sort(),
    );
  });

  it('puts a team row that comes from another row of the team under that row', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'T', leadId: null }],
      workItems: [
        workItem({ id: 'b', teamId: 't', after: ['x'] }),
        workItem({ id: 'x', teamId: 'other', after: ['a'] }),
        workItem({ id: 'a', teamId: 't' }),
      ],
    });
    expect(teamFocusTree(s, 't')!.roots.map(ids)).toEqual([['a', [['x', [['b', []]]]]]]);
  });

  it('keeps the rows of a loop inside the team, and gives an unknown team nothing', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'T', leadId: null }],
      workItems: [
        workItem({ id: 'a', teamId: 't', after: ['b'] }),
        workItem({ id: 'b', teamId: 't', after: ['a'] }),
      ],
    });
    expect(teamFocusTree(s, 't')!.roots.map(ids)).toEqual([['a', [['b', []]]]]);
    expect(teamFocusTree(s, 'nope')).toBeNull();
    expect(teamDescendants(s, 'nope').size).toBe(0);
  });
});
