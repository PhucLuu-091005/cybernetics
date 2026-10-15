import { describe, expect, it } from 'vitest';
import { CURVE, branchPath, linkTasks } from '../../../src/lib/graph-layout';
import {
  GraphLayoutSchema,
  type BranchLayout,
  type GraphLayout,
} from '../../../src/contracts/layout';

const id = (name: string) =>
  `00000000-0000-4000-8000-${Array.from(name)
    .map((char) => char.charCodeAt(0).toString(16))
    .join('')
    .padStart(12, '0')}`;
const branch = (
  name: string,
  y: number,
  xStart: number,
  xEnd: number,
  extra: Partial<BranchLayout> = {},
): BranchLayout => ({
  id: id(name),
  loopId: id(name),
  departmentId: id('d'),
  row: 0,
  xStart,
  xEnd,
  y,
  path: `M${xStart} ${y} H${xEnd}`,
  segments: [{ startX: xStart, endX: xEnd, style: 'solid', tone: 'blue' }],
  glyphs: [],
  tone: 'blue',
  endKind: 'open',
  breakdownMarkers: [],
  title: name,
  accessibleName: `Loop: ${name}`,
  ...extra,
});
const task = (
  name: string,
  y: number,
  xStart: number,
  xEnd: number,
  after: string[],
  closed: boolean,
  wait: string | null = null,
  early = false,
): BranchLayout =>
  branch(name, y, xStart, xEnd, {
    endKind: closed ? 'merge' : 'open',
    tone: closed ? 'green' : 'blue',
    task: { parentLoopId: id('p'), afterLoopIds: after.map(id), closed, wait, early },
  });
const layoutOf = (branches: BranchLayout[]): GraphLayout => ({
  width: 600,
  height: 300,
  trunkY: 200,
  lanes: [],
  branches,
  milestones: [],
  gateways: [],
  connectors: [],
  zoomLevel: 'branches',
  navigation: { milestoneIds: [], loopIds: branches.map((item) => item.loopId) },
});

// P is the promise; A splits off, hands off to B and C, which join before D; E returns to P.
const crs = layoutOf([
  branch('p', 100, 0, 500, { endKind: 'open', tasks: { count: 5, done: 3 } }),
  task('a', 60, 20, 120, [], true),
  task('b', 40, 160, 260, ['a'], true),
  task('c', 20, 150, 300, ['a'], false),
  task('d', 80, 360, 400, ['b', 'c'], false, 'waiting for c'),
  task('e', 70, 420, 460, [], true),
]);
const linked = linkTasks(crs);
const byId = (name: string) => linked.branches.find((item) => item.loopId === id(name))!;
const gateway = (kind: string, name: string) =>
  linked.gateways.find((item) => item.kind === kind && item.loopId === id(name));

describe('linkTasks', () => {
  it('forks a task without predecessors from its parent line, at a split gateway', () => {
    expect(byId('a').path).toBe(branchPath(20, 120, 60, 100, false));
    expect(gateway('split', 'p')).toMatchObject({ x: 20 - CURVE, y: 100 });
  });
  it('ends a task with successors at a handoff gateway and starts the successor without a fork', () => {
    expect(gateway('handoff', 'a')).toMatchObject({ x: 120, y: 60, pending: false });
    expect(byId('b').path).toBe(branchPath(160, 260, 40, 40, false));
    expect(gateway('handoff', 'c')).toMatchObject({ x: 300, y: 20, pending: true });
  });
  it('puts a join gateway in front of a task that waits for two predecessors', () => {
    expect(gateway('join', 'd')).toMatchObject({ x: 300 + 2 * CURVE, y: 80 });
    const notes = linked.connectors.flatMap((item) => (item.note ? [item.note.text] : []));
    expect(notes).toContain('waiting for c');
  });
  it('returns a closed task without successors to its parent line', () => {
    expect(gateway('return', 'e')).toMatchObject({ x: 460 + CURVE, y: 100 });
    expect(byId('e').path).toBe(branchPath(420, 460, 70, 100, true, 100));
    expect(gateway('return', 'b')).toBeUndefined();
  });
  it('draws one connector per handoff edge and one from the join to its task', () => {
    const edges = linked.connectors.map((item) => item.id).sort();
    expect(edges).toEqual(
      [
        `${id('a')}>${id('b')}`,
        `${id('a')}>${id('c')}`,
        `${id('b')}>join`,
        `${id('c')}>join`,
        `join>${id('d')}`,
      ]
        .map((item) => item.replace('join', `join:${id('d')}`))
        .sort(),
    );
  });
  it('treats a task whose parent is not in the layout as a top-level loop', () => {
    const orphan = linkTasks(layoutOf([task('a', 60, 20, 120, [], true)]));
    expect(orphan.branches[0].path).toBe(branchPath(20, 120, 60, 200, true));
    expect(orphan.gateways).toEqual([]);
    expect(orphan.connectors).toEqual([]);
  });
  it('marks an early start and draws its connector dotted', () => {
    const early = linkTasks(
      layoutOf([
        branch('p', 100, 0, 500),
        task('a', 60, 20, 200, [], true),
        task('b', 40, 150, 260, ['a'], false, null, true),
      ]),
    );
    const edge = early.connectors.find((item) => item.id === `${id('a')}>${id('b')}`)!;
    expect(edge.style).toBe('dotted');
    expect(edge.note?.text).toBe('started before handoff');
  });
  it('is idempotent and satisfies the layout contract', () => {
    expect(linkTasks(linked)).toEqual(linked);
    expect(GraphLayoutSchema.safeParse(linked).error?.issues ?? []).toEqual([]);
  });
});
