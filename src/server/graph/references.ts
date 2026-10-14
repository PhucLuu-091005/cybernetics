import type { EntityCollection, GraphSnapshot, Party } from '../../contracts/graph';

export type ReferenceError = { collection: EntityCollection; id: string; message: string };

export function referenceErrors(snapshot: GraphSnapshot): ReferenceError[] {
  const errors: ReferenceError[] = [];
  const people = new Set(snapshot.context.people.map((entity) => entity.id));
  const departments = new Set(snapshot.context.departments.map((entity) => entity.id));
  const milestones = new Set(snapshot.context.milestones.map((entity) => entity.id));
  const loops = new Set(snapshot.loops.map((entity) => entity.id));
  const acts = new Set(snapshot.acts.map((entity) => entity.id));
  const reference = (
    collection: EntityCollection,
    id: string,
    field: string,
    target: string | null,
    targets: Set<string>,
    targetCollection: string,
  ) => {
    if (target !== null && !targets.has(target))
      errors.push({
        collection,
        id,
        message: `${field} references missing ${targetCollection} entity ${target}; restore it or explicitly replace the reference.`,
      });
  };
  const party = (collection: EntityCollection, id: string, field: string, value: Party) => {
    if (value.kind === 'person') reference(collection, id, field, value.personId, people, 'people');
  };
  for (const person of snapshot.context.people)
    reference('people', person.id, 'departmentId', person.departmentId, departments, 'departments');
  for (const milestone of snapshot.context.milestones)
    reference('milestones', milestone.id, 'anchorLoopId', milestone.anchorLoopId, loops, 'loops');
  for (const loop of snapshot.loops) {
    party('loops', loop.id, 'customer', loop.customer);
    party('loops', loop.id, 'performer', loop.performer);
    reference(
      'loops',
      loop.id,
      'performerDepartmentId',
      loop.performerDepartmentId,
      departments,
      'departments',
    );
    reference('loops', loop.id, 'milestoneId', loop.milestoneId, milestones, 'milestones');
  }
  taskErrors(snapshot, errors);
  for (const act of snapshot.acts) {
    party('acts', act.id, 'actor', act.actor);
    party('acts', act.id, 'customer', act.customer);
    party('acts', act.id, 'performer', act.performer);
    reference('acts', act.id, 'loopId', act.loopId, loops, 'loops');
  }
  for (const annotation of snapshot.annotations) {
    for (const actId of annotation.actIds)
      reference('annotations', annotation.id, 'actIds', actId, acts, 'acts');
  }
  return errors;
}

function taskErrors(snapshot: GraphSnapshot, errors: ReferenceError[]) {
  const loops = new Map(snapshot.loops.map((loop) => [loop.id, loop]));
  const fail = (id: string, message: string) => errors.push({ collection: 'loops', id, message });
  for (const loop of snapshot.loops) {
    if (loop.parentLoopId !== undefined) {
      const parent = loops.get(loop.parentLoopId);
      if (!parent)
        fail(
          loop.id,
          `parentLoopId references missing loops entity ${loop.parentLoopId}; restore it or explicitly replace the reference.`,
        );
      else if (parent.id === loop.id || parent.parentLoopId !== undefined)
        fail(loop.id, 'parentLoopId must name a top-level loop; tasks are one level deep.');
      if (loop.milestoneId !== null)
        fail(loop.id, 'a task takes its milestone from its parent; set milestoneId to null.');
    }
    if (loop.afterLoopIds === undefined) continue;
    if (loop.parentLoopId === undefined) {
      fail(
        loop.id,
        'afterLoopIds needs parentLoopId; only tasks of one loop hand off to each other.',
      );
      continue;
    }
    const seen = new Set<string>();
    for (const id of loop.afterLoopIds) {
      if (id === loop.id) fail(loop.id, 'afterLoopIds cannot name the loop itself.');
      else if (seen.has(id)) fail(loop.id, `afterLoopIds names ${id} twice.`);
      else if (loops.get(id)?.parentLoopId !== loop.parentLoopId)
        fail(loop.id, `afterLoopIds entry ${id} must be a task of the same parent.`);
      seen.add(id);
    }
  }
  for (const id of cyclicTasks(snapshot.loops))
    fail(id, 'afterLoopIds makes a cycle; a task cannot wait for itself.');
}

/** Tasks on a cycle of after links; self links are reported on their own and skipped here. */
function cyclicTasks(loops: GraphSnapshot['loops']): string[] {
  const after = new Map(
    loops.map((loop) => [loop.id, (loop.afterLoopIds ?? []).filter((id) => id !== loop.id)]),
  );
  const state = new Map<string, 'open' | 'done'>(),
    cyclic = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      for (const member of path.slice(path.indexOf(id))) cyclic.add(member);
      return;
    }
    state.set(id, 'open');
    for (const next of after.get(id) ?? []) if (after.has(next)) visit(next, [...path, id]);
    state.set(id, 'done');
  };
  for (const loop of loops) visit(loop.id, []);
  return [...cyclic].sort();
}
