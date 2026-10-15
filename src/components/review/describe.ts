import type {
  Act,
  Annotation,
  Department,
  EntityChange,
  EntityCollection,
  GraphSnapshot,
  Loop,
  Milestone,
  Party,
  Person,
  RecordDecision,
} from '../../contracts';
import { ACT_LABEL, dueLabel, shortDate } from '../graph/labels';

/** Display names gathered on the server from every snapshot a screen compares, so a removed entity still has a name. */
export type Names = {
  people: Record<string, string>;
  loops: Record<string, string>;
  milestones: Record<string, string>;
  departments: Record<string, string>;
  records: Record<string, string>;
};
type Image = EntityChange['before'];
export type ChangeKind = EntityChange['kind'];

export function namesFrom(
  snapshots: readonly GraphSnapshot[],
  records: Record<string, string> = {},
): Names {
  const names: Names = { people: {}, loops: {}, milestones: {}, departments: {}, records };
  for (const snapshot of snapshots) {
    for (const person of snapshot.context.people) names.people[person.id] ??= person.name;
    for (const loop of snapshot.loops) names.loops[loop.id] ??= loop.title;
    for (const milestone of snapshot.context.milestones)
      names.milestones[milestone.id] ??= milestone.name;
    for (const department of snapshot.context.departments)
      names.departments[department.id] ??= department.name;
  }
  return names;
}

export function partyLabel(party: Party, names: Names): string {
  if (party.kind === 'side') return party.side === 'client' ? 'Client side' : 'Vendor side';
  return names.people[party.personId] ?? 'Unknown person';
}
const loopName = (id: string | null, names: Names) =>
  id === null ? 'no loop' : (names.loops[id] ?? 'Unknown loop');
const milestoneName = (id: string | null, names: Names) =>
  id === null ? 'none' : (names.milestones[id] ?? 'Unknown milestone');
const recordName = (id: string, names: Names) => names.records[id] ?? 'Unknown record';
const clip = (text: string, length = 70) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

const KIND: Record<EntityCollection, string> = {
  acts: 'Step',
  loops: 'Loop',
  annotations: 'Note',
  recordDecisions: 'Record decision',
  people: 'Person',
  departments: 'Department',
  milestones: 'Milestone',
  context: 'Project settings',
};

/** One image is enough to name an entity; callers pass the newest non-null one. */
export function describeEntity(
  collection: EntityCollection,
  id: string,
  image: Image,
  names: Names,
): { kind: string; name: string } {
  const kind = KIND[collection];
  if (image === null || typeof image !== 'object' || Array.isArray(image)) {
    if (collection === 'context') return { kind, name: id };
    if (collection === 'recordDecisions') return { kind, name: recordName(id, names) };
    if (collection === 'loops') return { kind, name: names.loops[id] ?? 'Unknown loop' };
    return { kind, name: `Unknown ${kind.toLowerCase()}` };
  }
  switch (collection) {
    case 'acts': {
      const act = image as Act;
      return { kind, name: `${ACT_LABEL[act.type]} by ${partyLabel(act.actor, names)}` };
    }
    case 'loops':
      return { kind, name: (image as Loop).title };
    case 'annotations':
      return { kind, name: clip((image as Annotation).text) };
    case 'recordDecisions':
      return { kind, name: recordName((image as RecordDecision).recordVersionId, names) };
    case 'people':
      return { kind, name: (image as Person).name };
    case 'departments':
      return { kind, name: (image as Department).name };
    case 'milestones':
      return { kind, name: (image as Milestone).name };
    default:
      return { kind, name: id };
  }
}
export const entityTitle = (
  collection: EntityCollection,
  id: string,
  image: Image,
  names: Names,
) => {
  const { kind, name } = describeEntity(collection, id, image, names);
  return `${kind}: ${name}`;
};
export const newestImage = (...images: Image[]): Image =>
  images.find((image) => image !== null && image !== undefined) ?? null;

function fieldValue(
  collection: EntityCollection,
  field: string,
  value: unknown,
  names: Names,
): string {
  if (value === null || value === undefined) return 'none';
  if (field === 'loopId' || field === 'parentLoopId') return loopName(value as string, names);
  if (field === 'afterLoopIds')
    return (value as string[]).map((id) => loopName(id, names)).join(', ');
  if (field === 'milestoneId') return milestoneName(value as string, names);
  if (field === 'performerDepartmentId' || field === 'departmentId')
    return names.departments[value as string] ?? 'Unknown department';
  if (field === 'actor' || field === 'customer' || field === 'performer')
    return partyLabel(value as Party, names);
  if (field === 'type' && collection === 'acts')
    return ACT_LABEL[value as Act['type']] ?? String(value);
  if (field === 'due') return dueLabel(value as Act['due']);
  if (field === 'citation') {
    const citation = value as Act['citation'];
    return `${recordName(citation.recordVersionId, names)}, offsets ${citation.start}–${citation.end}`;
  }
  if (field === 'plannedDate' || field === 'currentDate') return shortDate(value as string);
  if (field === 'actIds') return `${(value as string[]).length} cited acts`;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return clip(value, 120);
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  return JSON.stringify(value);
}

const FIELD_LABEL: Record<string, string> = {
  loopId: 'loop',
  parentLoopId: 'part of',
  afterLoopIds: 'after',
  milestoneId: 'milestone',
  customer: 'requested by',
  performer: 'done by',
  performerDepartmentId: 'department',
  departmentId: 'department',
  recordVersionId: 'record',
  actIds: 'cited acts',
  plannedDate: 'planned',
  currentDate: 'current date',
  reachedAt: 'reached',
};
export type FieldLine = { field: string; label: string; value: string };

export function fieldLines(
  collection: EntityCollection,
  images: Image[],
  names: Names,
): FieldLine[][] {
  const objects = images.map((image) =>
    image !== null && typeof image === 'object' && !Array.isArray(image)
      ? (image as unknown as Record<string, unknown>)
      : null,
  );
  if (objects.every((object) => object === null))
    return images.map((image) => [
      {
        field: 'value',
        label: collection === 'context' ? 'value' : '',
        value: image === null ? 'none' : fieldValue(collection, 'value', image, names),
      },
    ]);
  const keys = [
    ...new Set(objects.flatMap((object) => (object ? Object.keys(object) : []))),
  ].filter(
    (key) =>
      key !== 'id' &&
      new Set(objects.map((object) => JSON.stringify(object?.[key] ?? null))).size > 1,
  );
  return objects.map((object) =>
    object === null
      ? [{ field: 'value', label: '', value: 'none' }]
      : keys.map((key) => ({
          field: key,
          label: FIELD_LABEL[key] ?? key,
          value: fieldValue(collection, key, object[key], names),
        })),
  );
}

export function changeSymbol(kind: ChangeKind): string {
  return kind === 'added' ? '+ added' : kind === 'removed' ? '− removed' : '~ changed';
}
export const changeClass = (kind: ChangeKind) =>
  kind === 'added' ? 'diff-add' : kind === 'removed' ? 'diff-rem' : 'diff-chg';

export function summarizeEntity(collection: EntityCollection, image: Image, names: Names): string {
  if (image === null) return 'none';
  if (typeof image !== 'object' || Array.isArray(image))
    return fieldValue(collection, 'value', image, names);
  switch (collection) {
    case 'acts': {
      const act = image as Act;
      return [
        `${act.action}`,
        `loop ${loopName(act.loopId, names)}`,
        act.due ? `due ${dueLabel(act.due)}` : null,
        act.hedged ? 'hedged' : null,
        act.hidden ? 'hidden' : null,
      ]
        .filter(Boolean)
        .join(', ');
    }
    case 'loops': {
      const loop = image as Loop;
      return `${partyLabel(loop.customer, names)} asks ${partyLabel(loop.performer, names)}, milestone ${milestoneName(loop.milestoneId, names)}`;
    }
    case 'annotations':
      return clip((image as Annotation).text, 160);
    case 'recordDecisions': {
      const decision = image as RecordDecision;
      return decision.disposition === 'included' ? 'included' : `ignored: ${decision.reason}`;
    }
    case 'people': {
      const person = image as Person;
      return `${person.side}, ${person.role || 'no role'}`;
    }
    case 'milestones': {
      const milestone = image as Milestone;
      return `planned ${shortDate(milestone.plannedDate)}, current ${shortDate(milestone.currentDate)}`;
    }
    case 'departments': {
      const department = image as Department;
      return `${department.side} side, order ${department.order}`;
    }
    default:
      return JSON.stringify(image);
  }
}

/** The proposal editor lists the draft's changes against its base; the draft stores a snapshot, not an operation log. */
export function changeItems(
  changes: readonly EntityChange[],
  names: Names,
): {
  key: string;
  collection: EntityCollection;
  id: string;
  kind: ChangeKind;
  title: string;
  detail: string;
}[] {
  return changes.map((change) => {
    const image = newestImage(change.after, change.before),
      key = `${change.collection}/${change.id}`;
    const base = { key, collection: change.collection, id: change.id, kind: change.kind };
    if (change.collection === 'acts') {
      const act = image as Act;
      return {
        ...base,
        title: describeEntity('acts', change.id, image, names).name,
        detail: `act, ${change.kind}, loop ${loopName(act.loopId, names)}`,
      };
    }
    if (change.collection === 'recordDecisions') {
      const decision = change.after as RecordDecision | null,
        record = recordName(change.id, names);
      return {
        ...base,
        title:
          decision === null
            ? `Back to pending: ${record}`
            : decision.disposition === 'included'
              ? `Include record ${record}`
              : `Ignore record ${record}`,
        detail: `record decision, ${change.kind}`,
      };
    }
    const fields =
      change.kind === 'changed'
        ? fieldLines(change.collection, [change.before, change.after], names)
        : null;
    const delta = fields
      ? fields[0]
          .map(
            (line, index) =>
              `${line.label ? `${line.label} ` : ''}${line.value} → ${fields[1][index]?.value ?? 'none'}`,
          )
          .join('; ')
      : null;
    return {
      ...base,
      title: entityTitle(change.collection, change.id, image, names),
      detail: `${KIND[change.collection].toLowerCase()}, ${change.kind}${delta ? `, ${clip(delta, 90)}` : ''}`,
    };
  });
}

/** An act moved between loops changes both of them, so both loops get the halo. */
export function proposalHighlights(changes: readonly EntityChange[]): {
  loopIds: string[];
  actIds: string[];
} {
  const loopIds = new Set<string>(),
    actIds = new Set<string>();
  for (const change of changes) {
    if (change.collection === 'loops') loopIds.add(change.id);
    if (change.collection !== 'acts') continue;
    for (const image of [change.before, change.after] as (Act | null)[])
      if (image?.loopId) loopIds.add(image.loopId);
    if (change.kind !== 'removed') actIds.add(change.id);
  }
  return { loopIds: [...loopIds].sort(), actIds: [...actIds].sort() };
}

export const MAX_NAMED_RECORDS = 1000;
/** The cited-record read takes at most 1,000 IDs; callers list the IDs they need most first and show how many were left out. */
export function capRecordIds(ids: Iterable<string>): { ids: string[]; omitted: number } {
  const unique = [...new Set(ids)];
  return {
    ids: unique.slice(0, MAX_NAMED_RECORDS),
    omitted: Math.max(0, unique.length - MAX_NAMED_RECORDS),
  };
}
