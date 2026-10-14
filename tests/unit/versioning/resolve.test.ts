import { describe, expect, it } from 'vitest';
import { threeWayRebase } from '../../../src/server/graph/rebase';
import { resolveRebase } from '../../../src/server/graph/resolve';
import { inverseCommit } from '../../../src/server/graph/revert';
import { anotherAct, ids, snapshot } from '../../support/builders';

describe('resolveRebase', () => {
  const divergent = () => {
    const base = snapshot(),
      candidate = snapshot(),
      main = snapshot();
    candidate.loops[0].title = 'Proposal title';
    main.loops[0].title = 'Main title';
    candidate.acts.push(anotherAct());
    return { base, candidate, main };
  };
  it('keeps main for a conflict when chosen and still applies one-sided changes', () => {
    const { base, candidate, main } = divergent();
    expect(threeWayRebase(base, candidate, main).conflicts).toHaveLength(1);
    const result = resolveRebase(base, candidate, main, [
      { collection: 'loops', id: ids.loop, choice: 'main' },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.loops[0].title).toBe('Main title');
    expect(result.snapshot!.acts.map((act) => act.id)).toContain(ids.other);
  });
  it('applies the proposal choice and a validated replacement', () => {
    const { base, candidate, main } = divergent();
    expect(
      resolveRebase(base, candidate, main, [
        { collection: 'loops', id: ids.loop, choice: 'proposal' },
      ]).snapshot!.loops[0].title,
    ).toBe('Proposal title');
    const replacement = { ...main.loops[0], title: 'Agreed title' };
    expect(
      resolveRebase(base, candidate, main, [
        { collection: 'loops', id: ids.loop, choice: 'replacement', value: replacement },
      ]).snapshot!.loops[0].title,
    ).toBe('Agreed title');
  });
  it('reports a missing resolution and an unknown resolution as conflicts', () => {
    const { base, candidate, main } = divergent();
    expect(resolveRebase(base, candidate, main, []).conflicts[0].reason).toMatch(
      /Resolution missing/,
    );
    expect(
      resolveRebase(base, candidate, main, [
        { collection: 'loops', id: ids.loop, choice: 'main' },
        { collection: 'acts', id: ids.act, choice: 'main' },
      ]).conflicts[0].reason,
    ).toMatch(/No such conflict/);
  });
  it('turns a resolution that orphans a reference into a conflict instead of deleting the act', () => {
    const base = snapshot(),
      candidate = snapshot(),
      main = snapshot();
    candidate.loops = [];
    candidate.acts[0].loopId = null;
    main.acts[0].action = 'edited on main';
    const result = resolveRebase(base, candidate, main, [
      { collection: 'acts', id: ids.act, choice: 'main' },
    ]);
    expect(result.snapshot).toBeNull();
    expect(
      result.conflicts.some((conflict) => /references missing loops/.test(conflict.reason)),
    ).toBe(true);
  });
});

describe('inverseCommit proposed inverse', () => {
  it('returns a proposed inverse with conflicts when a later commit touched the same entity', () => {
    const parent = snapshot(),
      target = snapshot(),
      main = snapshot();
    target.loops[0].title = 'Target';
    target.acts[0].action = 'target action';
    main.loops[0].title = 'Later';
    main.acts[0].action = 'target action';
    const result = inverseCommit(parent, target, main);
    expect(result.conflicts.map((conflict) => conflict.id)).toEqual([ids.loop]);
    expect(result.snapshot!.acts[0].action).toBe(parent.acts[0].action);
    expect(result.snapshot!.loops[0].title).toBe('Later');
  });
});

describe('resolveRebase composition conflicts and replacement rules', () => {
  const deletedAct = () => {
    const base = snapshot(),
      candidate = snapshot(),
      main = snapshot();
    candidate.acts = [];
    candidate.annotations = [];
    main.annotations.push({ id: ids.other, text: 'Main note', actIds: [ids.act] });
    return { base, candidate, main };
  };
  const key = { collection: 'annotations' as const, id: ids.other };
  it('lists a composition conflict on an entity only main touched and resolves it by replacement', () => {
    const { base, candidate, main } = deletedAct();
    const preview = threeWayRebase(base, candidate, main);
    expect(preview.snapshot).toBeNull();
    expect(
      preview.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
    ).toEqual([key]);
    const result = resolveRebase(base, candidate, main, [
      { ...key, choice: 'replacement', value: { id: ids.other, text: 'Main note', actIds: [] } },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.annotations).toEqual([
      { id: ids.other, text: 'Main note', actIds: [] },
    ]);
    expect(result.snapshot!.acts).toEqual([]);
  });
  it('resolves a composition conflict and a divergence conflict in one call', () => {
    const { base, candidate, main } = deletedAct();
    candidate.loops[0].title = 'Proposal title';
    main.loops[0].title = 'Main title';
    const preview = threeWayRebase(base, candidate, main);
    expect(preview.conflicts.map((conflict) => conflict.collection).sort()).toEqual([
      'annotations',
      'loops',
    ]);
    const result = resolveRebase(base, candidate, main, [
      { collection: 'loops', id: ids.loop, choice: 'proposal' },
      { ...key, choice: 'replacement', value: null },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.loops[0].title).toBe('Proposal title');
    expect(result.snapshot!.annotations).toEqual([]);
  });
  it('keeps a conflict that names the missing entity when a proposal choice recreates an orphan', () => {
    const base = snapshot(),
      candidate = snapshot(),
      main = snapshot();
    candidate.annotations[0].text = 'Proposal note';
    main.annotations = [];
    main.acts = [];
    const result = resolveRebase(base, candidate, main, [
      { collection: 'annotations', id: ids.annotation, choice: 'proposal' },
    ]);
    expect(result.snapshot).toBeNull();
    expect(
      result.conflicts.some(
        (conflict) =>
          conflict.reason.includes(ids.act) && /references missing acts/.test(conflict.reason),
      ),
    ).toBe(true);
  });
  it('rejects a replacement that changes the entity identity', () => {
    const { base, candidate, main } = divergentPair();
    const result = resolveRebase(base, candidate, main, [
      {
        collection: 'loops',
        id: ids.loop,
        choice: 'replacement',
        value: { ...main.loops[0], id: ids.other },
      },
    ]);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts[0].reason).toBe(
      "Replacement value must keep the conflict's entity identity.",
    );
  });
  it('rejects a duplicate resolution for the same conflict', () => {
    const { base, candidate, main } = divergentPair();
    const result = resolveRebase(base, candidate, main, [
      { collection: 'loops', id: ids.loop, choice: 'main' },
      { collection: 'loops', id: ids.loop, choice: 'proposal' },
    ]);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts[0].reason).toBe('Duplicate resolution for this conflict.');
  });
  it('returns a conflict for a schema-invalid replacement', () => {
    const { base, candidate, main } = divergentPair();
    const result = resolveRebase(base, candidate, main, [
      {
        collection: 'loops',
        id: ids.loop,
        choice: 'replacement',
        value: { ...main.loops[0], title: '' },
      },
    ]);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
  it('accepts a null replacement that deletes an unreferenced entity', () => {
    const base = snapshot(),
      candidate = snapshot(),
      main = snapshot();
    candidate.annotations[0].text = 'Proposal note';
    main.annotations[0].text = 'Main note';
    const result = resolveRebase(base, candidate, main, [
      { collection: 'annotations', id: ids.annotation, choice: 'replacement', value: null },
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.annotations).toEqual([]);
  });
});

function divergentPair() {
  const base = snapshot(),
    candidate = snapshot(),
    main = snapshot();
  candidate.loops[0].title = 'Proposal title';
  main.loops[0].title = 'Main title';
  return { base, candidate, main };
}

describe('resolveRebase late conflicts on proposal-touched entities', () => {
  const lateScenario = () => {
    const base = snapshot(),
      candidate = snapshot(),
      main = snapshot();
    base.annotations = [];
    candidate.annotations = [];
    main.annotations = [];
    candidate.acts[0].action = 'Proposal action';
    candidate.annotations.push({ id: ids.other, text: 'Proposal note', actIds: [ids.act] });
    main.acts[0].action = 'Main action';
    return { base, candidate, main };
  };
  const actRemoval = {
    collection: 'acts' as const,
    id: ids.act,
    choice: 'replacement' as const,
    value: null,
  };
  const noteKey = { collection: 'annotations' as const, id: ids.other };
  it('resolves a late conflict on a proposal-added entity in a second call', () => {
    const { base, candidate, main } = lateScenario();
    expect(
      threeWayRebase(base, candidate, main).conflicts.map((conflict) => conflict.collection),
    ).toEqual(['acts']);
    const first = resolveRebase(base, candidate, main, [actRemoval]);
    expect(first.snapshot).toBeNull();
    expect(
      first.conflicts.map((conflict) => ({ collection: conflict.collection, id: conflict.id })),
    ).toEqual([noteKey]);
    const second = resolveRebase(base, candidate, main, [
      actRemoval,
      {
        ...noteKey,
        choice: 'replacement',
        value: { id: ids.other, text: 'Proposal note', actIds: [] },
      },
    ]);
    expect(second.conflicts).toEqual([]);
    expect(second.snapshot!.acts).toEqual([]);
    expect(second.snapshot!.annotations).toEqual([
      { id: ids.other, text: 'Proposal note', actIds: [] },
    ]);
  });
  it('returns unused resolutions together with the current composition conflicts', () => {
    const { base, candidate, main } = lateScenario();
    const result = resolveRebase(base, candidate, main, [
      actRemoval,
      { collection: 'loops', id: ids.loop, choice: 'main' },
    ]);
    expect(result.snapshot).toBeNull();
    const reasons = Object.fromEntries(
      result.conflicts.map((conflict) => [
        `${conflict.collection}/${conflict.id}`,
        conflict.reason,
      ]),
    );
    expect(reasons[`loops/${ids.loop}`]).toMatch(/No such conflict/);
    expect(reasons[`annotations/${ids.other}`]).toMatch(/references missing acts/);
    expect(result.conflicts).toHaveLength(2);
  });
});
