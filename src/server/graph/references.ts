import type { EntityCollection, GraphSnapshot, Party } from '../../contracts/graph';

export type ReferenceError = { collection: EntityCollection; id: string; message: string };

export function referenceErrors(snapshot: GraphSnapshot): ReferenceError[] {
  const errors: ReferenceError[] = [];
  const people = new Set(snapshot.context.people.map(entity => entity.id));
  const departments = new Set(snapshot.context.departments.map(entity => entity.id));
  const milestones = new Set(snapshot.context.milestones.map(entity => entity.id));
  const loops = new Set(snapshot.loops.map(entity => entity.id));
  const acts = new Set(snapshot.acts.map(entity => entity.id));
  const reference = (collection: EntityCollection, id: string, field: string, target: string | null,
    targets: Set<string>, targetCollection: string) => {
    if (target !== null && !targets.has(target)) errors.push({ collection, id,
      message: `${field} references missing ${targetCollection} entity ${target}; restore it or explicitly replace the reference.` });
  };
  const party = (collection: EntityCollection, id: string, field: string, value: Party) => {
    if (value.kind === 'person') reference(collection, id, field, value.personId, people, 'people');
  };
  for (const person of snapshot.context.people) reference('people', person.id, 'departmentId', person.departmentId, departments, 'departments');
  for (const milestone of snapshot.context.milestones) reference('milestones', milestone.id, 'anchorLoopId', milestone.anchorLoopId, loops, 'loops');
  for (const loop of snapshot.loops) {
    party('loops', loop.id, 'customer', loop.customer);
    party('loops', loop.id, 'performer', loop.performer);
    reference('loops', loop.id, 'performerDepartmentId', loop.performerDepartmentId, departments, 'departments');
    reference('loops', loop.id, 'milestoneId', loop.milestoneId, milestones, 'milestones');
  }
  for (const act of snapshot.acts) {
    party('acts', act.id, 'actor', act.actor);
    party('acts', act.id, 'customer', act.customer);
    party('acts', act.id, 'performer', act.performer);
    reference('acts', act.id, 'loopId', act.loopId, loops, 'loops');
  }
  for (const annotation of snapshot.annotations) {
    for (const actId of annotation.actIds) reference('annotations', annotation.id, 'actIds', actId, acts, 'acts');
  }
  return errors;
}
