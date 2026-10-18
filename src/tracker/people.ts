import type { Person, TrackerState } from './model';
import type { Op } from './ops';
import type { Member } from './payload';

const removedIds = (members: readonly Member[]) =>
  new Set(members.filter((member) => member.removed).map((member) => member.id));

/**
 * The people a select offers for new work. A removed member keeps the name on past work but is not
 * offered, except as the current value, so a select never changes person on its own.
 */
export function pickable(
  people: readonly Person[],
  members: readonly Member[],
  current?: string | null,
): Person[] {
  const gone = removedIds(members);
  return people.filter((person) => !gone.has(person.id) || person.id === current);
}

/** The removed members that an op gives new work to; an unchanged current value is not new. */
export function goneNamed(state: TrackerState, members: readonly Member[], op: Op): string[] {
  const gone = removedIds(members);
  const named = (() => {
    switch (op.op) {
      case 'doneBy':
      case 'requestedBy': {
        const item = state.workItems.find((w) => w.id === op.a.workItemId);
        return item?.[op.op] === op.a.personId ? [] : [op.a.personId];
      }
      case 'fromEvent':
        return [op.a.doneBy, op.a.requestedBy];
      case 'addEvent':
        return [op.a.ev.by];
      default:
        return [];
    }
  })();
  return [...new Set(named.filter((id) => gone.has(id)))];
}
