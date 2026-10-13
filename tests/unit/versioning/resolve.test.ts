import { describe, expect, it } from 'vitest';
import { threeWayRebase } from '../../../src/server/graph/rebase';
import { resolveRebase } from '../../../src/server/graph/resolve';
import { inverseCommit } from '../../../src/server/graph/revert';
import { anotherAct, ids, snapshot } from '../../support/builders';

describe('resolveRebase', () => {
  const divergent = () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.loops[0].title = 'Proposal title';
    main.loops[0].title = 'Main title';
    candidate.acts.push(anotherAct());
    return { base, candidate, main };
  };
  it('keeps main for a conflict when chosen and still applies one-sided changes', () => {
    const { base, candidate, main } = divergent();
    expect(threeWayRebase(base, candidate, main).conflicts).toHaveLength(1);
    const result = resolveRebase(base, candidate, main, [{ collection: 'loops', id: ids.loop, choice: 'main' }]);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot!.loops[0].title).toBe('Main title');
    expect(result.snapshot!.acts.map(act => act.id)).toContain(ids.other);
  });
  it('applies the proposal choice and a validated replacement', () => {
    const { base, candidate, main } = divergent();
    expect(resolveRebase(base, candidate, main, [{ collection: 'loops', id: ids.loop, choice: 'proposal' }]).snapshot!.loops[0].title).toBe('Proposal title');
    const replacement = { ...main.loops[0], title: 'Agreed title' };
    expect(resolveRebase(base, candidate, main, [{ collection: 'loops', id: ids.loop, choice: 'replacement', value: replacement }]).snapshot!.loops[0].title).toBe('Agreed title');
  });
  it('reports a missing resolution and an unknown resolution as conflicts', () => {
    const { base, candidate, main } = divergent();
    expect(resolveRebase(base, candidate, main, []).conflicts[0].reason).toMatch(/Resolution missing/);
    expect(resolveRebase(base, candidate, main, [{ collection: 'loops', id: ids.loop, choice: 'main' }, { collection: 'acts', id: ids.act, choice: 'main' }]).conflicts[0].reason).toMatch(/No such conflict/);
  });
  it('turns a resolution that orphans a reference into a conflict instead of deleting the act', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.loops = []; candidate.acts[0].loopId = null;
    main.acts[0].action = 'edited on main';
    const result = resolveRebase(base, candidate, main, [{ collection: 'acts', id: ids.act, choice: 'main' }]);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts.some(conflict => /references missing loops/.test(conflict.reason))).toBe(true);
  });
});

describe('inverseCommit proposed inverse', () => {
  it('returns a proposed inverse with conflicts when a later commit touched the same entity', () => {
    const parent = snapshot(), target = snapshot(), main = snapshot();
    target.loops[0].title = 'Target'; target.acts[0].action = 'target action';
    main.loops[0].title = 'Later'; main.acts[0].action = 'target action';
    const result = inverseCommit(parent, target, main);
    expect(result.conflicts.map(conflict => conflict.id)).toEqual([ids.loop]);
    expect(result.snapshot!.acts[0].action).toBe(parent.acts[0].action);
    expect(result.snapshot!.loops[0].title).toBe('Later');
  });
});
