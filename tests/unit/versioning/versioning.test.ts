import { describe, expect, it } from 'vitest';
import { GraphSnapshotSchema, InverseResultSchema, RebaseResultSchema, SnapshotDiffSchema } from '../../../src/contracts/graph';
import { diffSnapshots } from '../../../src/server/graph/diff';
import { threeWayRebase } from '../../../src/server/graph/rebase';
import { inverseCommit } from '../../../src/server/graph/revert';
import { restoreSnapshot } from '../../../src/server/graph/restore';
import { anotherAct, ids, snapshot } from '../../support/builders';

describe('diffSnapshots', () => {
  it('reports complete added, removed, and edited entity images', () => {
    const base = snapshot(), candidate = snapshot();
    candidate.acts.push(anotherAct());
    candidate.annotations = [];
    candidate.loops[0].title = 'Deliver the final draft';
    const diff = diffSnapshots(base, candidate);
    expect(diff.changes).toHaveLength(3);
    expect(diff.changes).toContainEqual({ collection: 'acts', id: ids.other, kind: 'added', before: null, after: anotherAct() });
    expect(diff.changes).toContainEqual({ collection: 'annotations', id: ids.annotation, kind: 'removed', before: base.annotations[0], after: null });
    expect(diff.changes).toContainEqual({ collection: 'loops', id: ids.loop, kind: 'changed', before: base.loops[0], after: candidate.loops[0] });
    expect(SnapshotDiffSchema.safeParse(diff).success).toBe(true);
  });

  it('keys context arrays by entity ID and decisions by immutable record version ID', () => {
    const base = snapshot(), candidate = snapshot();
    candidate.context.people[0].role = 'Lead';
    candidate.context.departments[0].name = 'Design';
    candidate.context.milestones[0].currentDate = '2026-10-21';
    candidate.recordDecisions[0].reason = 'Reviewed';
    expect(diffSnapshots(base, candidate).changes.map(({ collection, id }) => ({ collection, id }))).toEqual([
      { collection: 'recordDecisions', id: ids.record },
      { collection: 'people', id: ids.person },
      { collection: 'departments', id: ids.department },
      { collection: 'milestones', id: ids.milestone },
    ]);
  });

  it('compares each scalar context key separately, including nullable values and holidays', () => {
    const base = snapshot(), candidate = snapshot();
    candidate.context.asOfOverride = '2026-10-12T10:00:00Z';
    candidate.context.holidays = ['2026-10-15'];
    candidate.context.replyWindowDays = 7;
    expect(diffSnapshots(base, candidate).changes).toEqual([
      { collection: 'context', id: 'asOfOverride', kind: 'changed', before: null, after: '2026-10-12T10:00:00Z' },
      { collection: 'context', id: 'holidays', kind: 'changed', before: [], after: ['2026-10-15'] },
      { collection: 'context', id: 'replyWindowDays', kind: 'changed', before: 2, after: 7 },
    ]);
  });

  it('ignores entity array order and object key order while retaining ordered fields', () => {
    const base = snapshot(), candidate = snapshot();
    base.acts.push(anotherAct());
    candidate.acts = [anotherAct(), { ...candidate.acts[0], due: { precision: 'day', date: '2026-10-20' } }];
    expect(diffSnapshots(base, candidate).changes).toEqual([]);
    candidate.annotations[0].actIds = [ids.other, ids.act];
    base.annotations[0].actIds = [ids.act, ids.other];
    expect(diffSnapshots(base, candidate).changes).toHaveLength(1);
  });

  it('returns detached images that cannot modify either input', () => {
    const base = snapshot(), candidate = snapshot();
    candidate.context.holidays = ['2026-10-15'];
    const diff = diffSnapshots(base, candidate);
    expect(diff.changes[0].after).not.toBe(candidate.context.holidays);
    (diff.changes[0].after as string[]).push('2026-10-16');
    expect(candidate.context.holidays).toEqual(['2026-10-15']);
    expect(base.context.holidays).toEqual([]);
  });
});

describe('threeWayRebase', () => {
  it('preserves disjoint loop, act, context scalar, and context entity changes', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.loops[0].title = 'Revised proposal';
    candidate.context.replyWindowDays = 8;
    candidate.context.people.push({ ...candidate.context.people[0], id: ids.other, name: 'Binh' });
    main.acts[0].due = { date: '2026-10-22', precision: 'day' };
    main.context.acceptWindowDays = 9;
    main.context.people[0].role = 'Lead';
    const result = threeWayRebase(base, candidate, main);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot?.loops[0].title).toBe('Revised proposal');
    expect(result.snapshot?.acts[0].due?.date).toBe('2026-10-22');
    expect(result.snapshot?.context).toMatchObject({ replyWindowDays: 8, acceptWindowDays: 9 });
    expect(result.snapshot?.context.people).toEqual([{ ...main.context.people[0] }, { ...candidate.context.people[1] }]);
    expect(RebaseResultSchema.safeParse(result).success).toBe(true);
  });

  it('accepts identical edits, additions, and removals', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    for (const branch of [candidate, main]) {
      branch.loops[0].title = 'Shared edit';
      branch.acts.push(anotherAct());
      branch.annotations = [];
      branch.context.asOfOverride = '2026-10-12T10:00:00Z';
    }
    expect(threeWayRebase(base, candidate, main)).toEqual({ snapshot: candidate, conflicts: [] });
  });

  it('conflicts on divergent edits to the same complete entity even across different fields', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.loops[0].title = 'Proposal edit';
    main.loops[0].milestoneId = null;
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ collection: 'loops', id: ids.loop, base: base.loops[0], main: main.loops[0], proposed: candidate.loops[0] });
    expect(result.conflicts[0].reason).toMatch(/edit|chang/i);
  });

  it.each(['candidate', 'main'] as const)('conflicts when %s deletes an entity the other side edits', side => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    const deleted = side === 'candidate' ? candidate : main;
    const edited = side === 'candidate' ? main : candidate;
    deleted.loops = [];
    edited.loops[0].title = 'Edited';
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ collection: 'loops', id: ids.loop });
    expect(result.conflicts[0].reason).toMatch(/delet|remov/i);
  });

  it('conflicts on incompatible additions sharing an ID', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.acts.push(anotherAct());
    main.acts.push({ ...anotherAct(), action: 'Different promise' });
    expect(threeWayRebase(base, candidate, main).conflicts).toEqual([
      expect.objectContaining({ collection: 'acts', id: ids.other, base: null, main: main.acts[1], proposed: candidate.acts[1], reason: expect.stringMatching(/add/i) }),
    ]);
  });

  it('conflicts on divergent scalar and stable-ID context edits', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.context.asOfOverride = '2026-10-12T10:00:00Z';
    main.context.asOfOverride = '2026-10-13T10:00:00Z';
    candidate.context.people[0].name = 'Proposal';
    main.context.people[0].role = 'Main';
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts.map(({ collection, id }) => ({ collection, id }))).toEqual([
      { collection: 'people', id: ids.person }, { collection: 'context', id: 'asOfOverride' },
    ]);
  });

  it('reports dangling references caused by combining individually valid disjoint changes', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    // Both branches are reference-valid alone: proposal removes a person and their existing uses;
    // main adds a separate act that still uses that person.
    candidate.context.people = [];
    candidate.acts[0].actor = { kind: 'side', side: 'vendor' };
    candidate.acts[0].performer = { kind: 'side', side: 'vendor' };
    candidate.loops[0].performer = { kind: 'side', side: 'vendor' };
    main.acts.push(anotherAct());
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toContainEqual(expect.objectContaining({ collection: 'acts', id: ids.other, reason: expect.stringContaining(ids.person) }));
    expect(main.acts[1].actor).toEqual({ kind: 'person', personId: ids.person });
    expect(candidate.acts).toHaveLength(1);
  });

  it('reports dangling department, milestone, anchor-loop, loop, and annotation references', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.context.departments = [];
    candidate.context.milestones = [];
    candidate.loops = [];
    candidate.acts = [];
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: 'people', id: ids.person, reason: expect.stringContaining(ids.department) }),
      expect.objectContaining({ collection: 'annotations', id: ids.annotation, reason: expect.stringContaining(ids.act) }),
    ]));
    const broken = snapshot();
    broken.context.milestones[0].anchorLoopId = ids.other;
    broken.loops[0].milestoneId = ids.other;
    broken.acts[0].loopId = ids.other;
    expect(threeWayRebase(base, broken, main).conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: 'milestones', id: ids.milestone, reason: expect.stringContaining(ids.other) }),
      expect.objectContaining({ collection: 'loops', id: ids.loop, reason: expect.stringContaining(ids.other) }),
      expect.objectContaining({ collection: 'acts', id: ids.act, reason: expect.stringContaining(ids.other) }),
    ]));
  });

  it('rejects schema-invalid composition of individually valid context windows', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.context.windowStart = '2026-10-25';
    main.context.windowEnd = '2026-10-20';
    expect(GraphSnapshotSchema.safeParse(candidate).success).toBe(true);
    expect(GraphSnapshotSchema.safeParse(main).success).toBe(true);
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].reason).toMatch(/window|end|start/i);
    expect(RebaseResultSchema.safeParse(result).success).toBe(true);
  });

  it('conflicts when individually valid branches exceed the loop cap together', () => {
    const base = snapshot();
    const loop = base.loops[0];
    for (let index = 10; index < 308; index++) base.loops.push({
      ...loop, id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    });
    const candidate = structuredClone(base), main = structuredClone(base);
    candidate.loops.push({ ...loop, id: '20000000-0000-4000-8000-000000000001' });
    main.loops.push({ ...loop, id: '20000000-0000-4000-8000-000000000002' });
    expect(GraphSnapshotSchema.safeParse(candidate).success).toBe(true);
    expect(GraphSnapshotSchema.safeParse(main).success).toBe(true);
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toContainEqual(expect.objectContaining({ collection: 'loops', reason: expect.stringMatching(/300|too big/i) }));
    expect(RebaseResultSchema.safeParse(result).success).toBe(true);
    expect(candidate.loops).toHaveLength(300);
    expect(main.loops).toHaveLength(300);
  });

  it('conflicts when disjoint annotation additions together exceed the snapshot byte cap', () => {
    const base = snapshot();
    const annotations = (start: number) => Array.from({ length: 300 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(start + index).padStart(12, '0')}`,
      text: 'x'.repeat(10000), actIds: [],
    }));
    const candidate = snapshot(), main = snapshot();
    candidate.annotations.push(...annotations(1));
    main.annotations.push(...annotations(301));
    expect(GraphSnapshotSchema.safeParse(candidate).success).toBe(true);
    expect(GraphSnapshotSchema.safeParse(main).success).toBe(true);
    const result = threeWayRebase(base, candidate, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toContainEqual(expect.objectContaining({ collection: 'annotations', reason: expect.stringMatching(/UTF-8 bytes/) }));
    expect(RebaseResultSchema.safeParse(result).success).toBe(true);
  });

  it('preserves disjoint record decisions and conflicts on divergent edits to one decision', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.recordDecisions.push({ recordVersionId: ids.other, disposition: 'ignored', reason: 'Unrelated evidence' });
    main.recordDecisions[0].reason = 'Reviewed';
    const result = threeWayRebase(base, candidate, main);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot?.recordDecisions).toEqual([
      { recordVersionId: ids.record, disposition: 'included', reason: 'Reviewed' },
      { recordVersionId: ids.other, disposition: 'ignored', reason: 'Unrelated evidence' },
    ]);
    candidate.recordDecisions[0].reason = 'Proposal review';
    expect(threeWayRebase(base, candidate, main)).toMatchObject({ snapshot: null, conflicts: [
      { collection: 'recordDecisions', id: ids.record, base: base.recordDecisions[0], main: main.recordDecisions[0], proposed: candidate.recordDecisions[0] },
    ] });
  });

  it('does not mutate inputs and detaches the merged output and conflict images', () => {
    const base = snapshot(), candidate = snapshot(), main = snapshot();
    candidate.loops[0].title = 'Proposal';
    const before = structuredClone([base, candidate, main]);
    const result = threeWayRebase(base, candidate, main);
    expect([base, candidate, main]).toEqual(before);
    result.snapshot!.acts[0].action = 'Changed output';
    expect(main.acts[0].action).toBe('Deliver the draft');
    main.loops[0].title = 'Main';
    const conflict = threeWayRebase(base, candidate, main).conflicts[0];
    expect(conflict.proposed).not.toBe(candidate.loops[0]);
  });
});

describe('inverseCommit', () => {
  it('inverts only the target delta while preserving unrelated later work', () => {
    const parent = snapshot(), target = snapshot();
    target.loops[0].title = 'Committed edit';
    target.context.replyWindowDays = 8;
    target.acts.push(anotherAct());
    target.annotations = [];
    const main = structuredClone(target);
    main.context.people[0].role = 'Later promotion';
    main.context.acceptWindowDays = 10;
    const result = inverseCommit(parent, target, main);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot?.loops[0].title).toBe('Deliver the draft');
    expect(result.snapshot?.context.replyWindowDays).toBe(2);
    expect(result.snapshot?.acts).toHaveLength(1);
    expect(result.snapshot?.annotations).toEqual(parent.annotations);
    expect(result.snapshot?.context.people[0].role).toBe('Later promotion');
    expect(result.snapshot?.context.acceptWindowDays).toBe(10);
    expect(InverseResultSchema.safeParse(result).success).toBe(true);
  });

  it('conflicts when current main no longer equals the target postimage', () => {
    const parent = snapshot(), target = snapshot(), main = snapshot();
    target.loops[0].title = 'Committed edit';
    main.loops[0].title = 'Later edit';
    const result = inverseCommit(parent, target, main);
    expect(result.snapshot).not.toBeNull();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ collection: 'loops', id: ids.loop, base: target.loops[0], main: main.loops[0], proposed: parent.loops[0], reason: expect.stringMatching(/post.?image|target/i) }),
    ]);
  });

  it('conflicts even if an entity was independently returned to its original image', () => {
    const parent = snapshot(), target = snapshot(), main = snapshot();
    target.context.replyWindowDays = 8;
    expect(inverseCommit(parent, target, main)).toMatchObject({ conflicts: [{ collection: 'context', id: 'replyWindowDays', base: 8, main: 2, proposed: 2 }] });
  });

  it('conflicts on recreated removals and later deletions of target additions', () => {
    const parent = snapshot(), target = snapshot();
    target.annotations = [];
    target.acts.push(anotherAct());
    const main = structuredClone(target);
    main.annotations = [{ ...parent.annotations[0], text: 'Later recreated' }];
    main.acts.pop();
    const result = inverseCommit(parent, target, main);
    expect(result.snapshot).not.toBeNull();
    expect(result.conflicts.map(({ collection, id }) => ({ collection, id }))).toEqual([
      { collection: 'acts', id: ids.other }, { collection: 'annotations', id: ids.annotation },
    ]);
  });

  it('reverts a revert with the same entity delta rule', () => {
    const parent = snapshot(), target = snapshot();
    target.loops[0].title = 'Committed edit';
    target.context.asOfOverride = '2026-10-12T10:00:00Z';
    const reverted = inverseCommit(parent, target, target).snapshot!;
    const laterMain = structuredClone(reverted);
    laterMain.context.acceptWindowDays = 9;
    const result = inverseCommit(target, reverted, laterMain);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot?.loops[0].title).toBe('Committed edit');
    expect(result.snapshot?.context.asOfOverride).toBe('2026-10-12T10:00:00Z');
    expect(result.snapshot?.context.acceptWindowDays).toBe(9);
  });

  it('conflicts instead of silently removing later references to a target addition', () => {
    const parent = snapshot(), target = snapshot();
    target.context.people.push({ ...target.context.people[0], id: ids.other, name: 'Binh' });
    const main = structuredClone(target);
    main.acts[0].actor = { kind: 'person', personId: ids.other };
    const result = inverseCommit(parent, target, main);
    expect(result.snapshot).toBeNull();
    expect(result.conflicts).toContainEqual(expect.objectContaining({ collection: 'acts', id: ids.act, reason: expect.stringContaining(ids.other) }));
    expect(main.acts[0].actor).toEqual({ kind: 'person', personId: ids.other });
  });

  it('returns a detached copy for an empty delta', () => {
    const parent = snapshot(), main = snapshot();
    main.loops[0].title = 'Unrelated';
    const result = inverseCommit(parent, parent, main);
    expect(result.snapshot).toEqual(main);
    expect(result.snapshot?.loops).not.toBe(main.loops);
  });

  it('inverts stable-ID context and decision edits while preserving later entities in those collections', () => {
    const parent = snapshot(), target = snapshot();
    target.context.people[0].role = 'Lead';
    target.context.departments[0].name = 'Delivery';
    target.context.milestones[0].currentDate = '2026-10-22';
    target.recordDecisions[0].reason = 'Reviewed in commit';
    const main = structuredClone(target);
    main.context.people.push({ ...main.context.people[0], id: ids.other, name: 'Binh' });
    main.context.departments.push({ ...main.context.departments[0], id: ids.other, name: 'Support' });
    main.context.milestones.push({ ...main.context.milestones[0], id: ids.other, name: 'Follow-up' });
    main.recordDecisions.push({ recordVersionId: ids.other, disposition: 'ignored', reason: 'Unrelated' });
    const result = inverseCommit(parent, target, main);
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot?.context.people).toEqual([parent.context.people[0], main.context.people[1]]);
    expect(result.snapshot?.context.departments).toEqual([parent.context.departments[0], main.context.departments[1]]);
    expect(result.snapshot?.context.milestones).toEqual([parent.context.milestones[0], main.context.milestones[1]]);
    expect(result.snapshot?.recordDecisions).toEqual(expect.arrayContaining([parent.recordDecisions[0], main.recordDecisions[1]]));
  });
});

describe('restoreSnapshot', () => {
  it('copies the complete interpretation including context and record decisions without sharing nested values', () => {
    const target = snapshot(), restored = restoreSnapshot(target);
    expect(restored).toEqual(target);
    restored.context.people[0].name = 'Changed copy';
    restored.acts[0].citation.start = 2;
    restored.annotations[0].actIds.push(ids.other);
    restored.recordDecisions[0].reason = 'Changed copy';
    expect(target.context.people[0].name).toBe('An');
    expect(target.acts[0].citation.start).toBe(0);
    expect(target.annotations[0].actIds).toEqual([ids.act]);
    expect(target.recordDecisions[0].reason).toBe('');
  });
});
