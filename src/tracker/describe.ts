import type { Clash } from './clash';
import type { TrackerState } from './model';
import { applyOp, type Op, type OpDescription, type OpName } from './ops';
import { DEFAULT_TIME_ZONE } from './time';

export const FIELD: Record<OpName, string> = {
  attach: 'Event',
  addEvent: 'Event',
  place: 'Team',
  qms: 'Milestone',
  fromEvent: 'New work item',
  move: 'Work item',
  kind: 'Kind',
  hide: 'Shown',
  msDate: 'Planned date',
  due: 'Planned finish',
  msName: 'Name',
  msRemove: 'Milestone',
  msAdd: 'Milestone',
  newMs: 'New milestone',
  rename: 'Name',
  addTeam: 'New team',
  doneBy: 'Done by',
  requestedBy: 'Requested by',
  team: 'Team',
  parent: 'Parent',
  after: 'Leads from',
};

export function describeOp(
  op: Op,
  stateBefore: TrackerState,
  timeZone: string = DEFAULT_TIME_ZONE,
): OpDescription {
  return applyOp(stateBefore, op, timeZone).entry;
}

const PREFIX: Partial<Record<OpName, string>> = {
  msDate: 'planned ',
  newMs: 'planned ',
  hide: 'on ',
};

function clean(name: OpName, value: string): string {
  const prefix = PREFIX[name];
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function diffLines(op: Pick<Op, 'op' | 'd'>): Array<['del' | 'add', string]> {
  const d = op.d;
  if (!d) return [];
  if (d.before === 'Queue') {
    return [
      ['del', 'In the queue'],
      ['add', `${op.op === 'place' ? 'Team' : 'On'}: ${clean(op.op, d.after)}`],
    ];
  }
  const field = FIELD[op.op] ?? 'Change';
  const lines: Array<['del' | 'add', string]> = [];
  if (d.before) lines.push(['del', `${field}: ${clean(op.op, d.before)}`]);
  lines.push(['add', `${field}: ${clean(op.op, d.after || d.change)}`]);
  return lines;
}

const LOOP_FIELD: Record<string, string> = {
  title: 'name',
  due: 'planned finish',
  ms: 'milestone',
  doneBy: 'done by',
  requestedBy: 'requested by',
  team: 'team',
  parent: 'parent',
  after: 'leads from',
};

export function clashLabel(clash: Pick<Clash, 'key' | 'x'>, state: TrackerState): string {
  const [kind, id, field] = clash.key.split(':');
  if (kind === 'loop') {
    const item = state.workItems.find((w) => w.id === id);
    return `${item ? item.title : 'Work item'} · ${LOOP_FIELD[field] ?? field}`;
  }
  if (kind === 'ms') {
    const m = state.milestones.find((x) => x.id === id);
    return `${m ? m.name : 'Milestone'} · ${field === 'date' ? 'planned date' : 'name'}`;
  }
  const item = clash.x.d?.item ?? clash.x.op;
  return kind === 'event' ? `${item} · which work item` : item;
}

export function onlyMainNote(key: string): string {
  const kind = key.split(':')[0];
  if (kind === 'event' || kind === 'item')
    return "Main already used this card, so only Main's version can be kept.";
  if (kind === 'act') return "Main hid this event, so only Main's version can be kept.";
  return "This change no longer fits Main, so only Main's version can be kept.";
}
