import { describe, expect, it } from 'vitest';
import main from '../../../fixtures/main-snapshot.json';
import { GraphSnapshotSchema, type GraphSnapshot, type Loop } from '../../../src/contracts/graph';
import { canonicalJson } from '../../../src/lib/canonical-json';
import { referenceErrors } from '../../../src/server/graph/references';

const base = main as GraphSnapshot;
const [parent, a, b, c] = base.loops.filter((loop) => !loop.parentLoopId);
const withLoops = (patch: (loop: Loop) => Loop): GraphSnapshot => ({
  ...base,
  loops: base.loops.map(patch),
});
const task = (loop: Loop, extra: Partial<Loop> = {}): Loop => ({
  ...loop,
  milestoneId: null,
  parentLoopId: parent.id,
  ...extra,
});
const messages = (snapshot: GraphSnapshot) =>
  referenceErrors(snapshot).map((error) => `${error.id}: ${error.message}`);

describe('task and handoff references', () => {
  it('accepts tasks under a top-level loop with after links to their siblings', () => {
    const snapshot = withLoops((loop) =>
      loop.id === a.id
        ? task(loop)
        : loop.id === b.id
          ? task(loop, { afterLoopIds: [a.id] })
          : loop.id === c.id
            ? task(loop, { afterLoopIds: [a.id, b.id] })
            : loop,
    );
    expect(GraphSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(referenceErrors(snapshot)).toEqual([]);
  });
  it('keeps the new fields absent on top-level loops, so canonical JSON never meets undefined', () => {
    for (const loop of base.loops.filter((item) => item.parentLoopId === undefined))
      expect('afterLoopIds' in loop).toBe(false);
    expect(base.loops.filter((item) => item.parentLoopId !== undefined)).toHaveLength(5);
    expect(() => canonicalJson(GraphSnapshotSchema.parse(base))).not.toThrow();
  });
  it('rejects a missing parent, a nested task, a self parent and a task with a milestone', () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(
      messages(
        withLoops((loop) => (loop.id === a.id ? task(loop, { parentLoopId: missing }) : loop)),
      ),
    ).toEqual([
      `${a.id}: parentLoopId references missing loops entity ${missing}; restore it or explicitly replace the reference.`,
    ]);
    expect(
      messages(
        withLoops((loop) =>
          loop.id === a.id
            ? task(loop)
            : loop.id === b.id
              ? task(loop, { parentLoopId: a.id })
              : loop,
        ),
      ),
    ).toEqual([`${b.id}: parentLoopId must name a top-level loop; tasks are one level deep.`]);
    expect(
      messages(withLoops((loop) => (loop.id === a.id ? task(loop, { parentLoopId: a.id }) : loop))),
    ).toEqual([`${a.id}: parentLoopId must name a top-level loop; tasks are one level deep.`]);
    const milestoneId = base.context.milestones[0].id;
    expect(
      messages(withLoops((loop) => (loop.id === a.id ? task(loop, { milestoneId }) : loop))),
    ).toEqual([`${a.id}: a task takes its milestone from its parent; set milestoneId to null.`]);
  });
  it('rejects after links on a top-level loop, to a non-sibling, to itself, twice, or in a cycle', () => {
    expect(
      messages(withLoops((loop) => (loop.id === a.id ? { ...loop, afterLoopIds: [b.id] } : loop))),
    ).toEqual([
      `${a.id}: afterLoopIds needs parentLoopId; only tasks of one loop hand off to each other.`,
    ]);
    expect(
      messages(
        withLoops((loop) => (loop.id === a.id ? task(loop, { afterLoopIds: [b.id] }) : loop)),
      ),
    ).toEqual([`${a.id}: afterLoopIds entry ${b.id} must be a task of the same parent.`]);
    expect(
      messages(
        withLoops((loop) => (loop.id === a.id ? task(loop, { afterLoopIds: [a.id] }) : loop)),
      ),
    ).toEqual([`${a.id}: afterLoopIds cannot name the loop itself.`]);
    expect(
      messages(
        withLoops((loop) =>
          loop.id === a.id
            ? task(loop)
            : loop.id === b.id
              ? task(loop, { afterLoopIds: [a.id, a.id] })
              : loop,
        ),
      ),
    ).toEqual([`${b.id}: afterLoopIds names ${a.id} twice.`]);
    expect(
      messages(
        withLoops((loop) =>
          loop.id === a.id
            ? task(loop, { afterLoopIds: [b.id] })
            : loop.id === b.id
              ? task(loop, { afterLoopIds: [a.id] })
              : loop,
        ),
      ).sort(),
    ).toEqual(
      [
        `${a.id}: afterLoopIds makes a cycle; a task cannot wait for itself.`,
        `${b.id}: afterLoopIds makes a cycle; a task cannot wait for itself.`,
      ].sort(),
    );
  });
});
