import {
  KIND_LABEL,
  STATUS_LABEL,
  type EventKind,
  type Status,
  type TrackerEvent,
  type TrackerState,
  type WorkItem,
} from './model';
import type { Marks } from './ops';
import { itemInfo, itemStatus, milestoneStatus, type ItemInfo } from './status';
import { addDays, compareDay, dayOf, formatDay, formatStamp, startOfDayInstant } from './time';

/**
 * SIDE is the fixed label column and RAIL the fixed milestone chip column; at zoom 1 the label
 * column, the time line and the rail fill VW together.
 */
export const GEOMETRY = {
  VW: 1060,
  X0: 236,
  X1: 1046,
  SIDE: 228,
  RAIL: 132,
  AXIS_Y: 15,
  MS_Y: 33,
  TRUNK_Y: 48,
  ROW: 32,
  HEAD: 22,
  MAX_ZOOM: 12,
} as const;

const { VW, X0, X1, SIDE, RAIL, AXIS_Y, MS_Y, TRUNK_Y, ROW, HEAD, MAX_ZOOM } = GEOMETRY;
const RIGHT = VW - X1;
const HOUR = 3_600_000;
const GROUP_GAP = 16;
const EMPTY_LEAD = 48 * HOUR;
// A day this wide fits its own "14 Sept" label, so the axis can tick every day.
const DAY_TICK = 60;

export type Tone =
  'proceed' | 'route' | 'danger' | 'caution' | 'teal' | 'ink-2' | 'ink-3' | 'change';

export const STATUS_TONE: Record<Status, Tone> = {
  planned: 'ink-3',
  early: 'teal',
  ontime: 'proceed',
  late: 'danger',
  flate: 'caution',
};

export type View = {
  hiddenRows: Set<string>;
  hiddenTeams: Set<string>;
  asOf: string;
  timeZone: string;
  windowStart?: string;
  windowEnd?: string;
  /** 1 fits the window to the width; more widens the time line. */
  zoom?: number;
};

export type Point = { x: number; y: number };
export type Curve = { from: Point; c1: Point; c2: Point; to: Point };

export type LayoutWindow = {
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  label: string;
};
export type LayoutTick = { date: string; x: number; label: string; labelled: boolean };
export type LayoutTLine = { x: number; y1: number; y2: number; label: string };
export type LaneMore = { ids: string[]; text: string; ariaLabel: string; x: number; width: number };
export type LayoutLane = {
  teamId: string;
  name: string;
  label: string;
  index: number;
  top: number;
  bottom: number;
  alt: boolean;
  hidden: boolean;
  count: number;
  hiddenCount: number;
  more: LaneMore | null;
  guide: { y1: number; y2: number } | null;
  eyeLabel: string;
};
export type LayoutRow = {
  id: string;
  teamId: string;
  title: string;
  label: string;
  y: number;
  done: boolean;
  status: Status;
  milestoneId: string | null;
  changed: boolean;
  eyeLabel: string;
};
type SegmentBase = { workItemId: string; x1: number; x2: number; y: number; tone: Tone };
export type LayoutSegment =
  | (SegmentBase & { kind: 'line' })
  | (SegmentBase & { kind: 'wait'; text: string; textX: number; textY: number });
export type LayoutEventGroup = {
  workItemId: string;
  eventIds: string[];
  topId: string;
  kind: EventKind;
  x: number;
  y: number;
  tone: Tone;
  changed: boolean;
  ariaLabel: string;
  tooltip: string;
};
/** The deadline of the milestone of a row, drawn on that row. */
export type LayoutGoalTick = {
  workItemId: string;
  milestoneId: string;
  date: string;
  dateLabel: string;
  dateAnchor: 'start' | 'end';
  x: number;
  y: number;
  tone: Tone;
  changed: boolean;
  ariaLabel: string;
  tooltip: string;
};
/** x is in the coordinates of the rail, which stays at the right edge while the time line scrolls. */
export type LayoutMsChip = {
  workItemId: string;
  milestoneId: string;
  text: string;
  tone: Tone;
  x: number;
  y: number;
  width: number;
  height: number;
  ariaLabel: string;
  tooltip: string;
};
export type LayoutStem = {
  workItemId: string;
  parentId: string | null;
  x: number;
  y1: number;
  y2: number;
  tone: Tone;
  ghost: boolean;
};
export type LayoutLink = Curve & {
  fromId: string;
  toId: string;
  tone: Tone;
  wait: boolean;
};
export type LayoutTrunk = { x1: number; x2: number; y: number };
export type LayoutTrunkSegment = {
  milestoneId: string;
  x1: number;
  x2: number;
  y: number;
  tone: Tone;
};
export type LayoutMilestone = {
  id: string;
  name: string;
  x: number;
  y: number;
  status: Status;
  tone: Tone;
  stroke: Tone;
  labelTone: Tone;
  filled: boolean;
  icon: 'tick' | 'bang' | null;
  changed: boolean;
  label: string;
  ariaLabel: string;
  labelX: number;
  labelY: number;
  anchor: 'start' | 'end';
  level: 0 | 1;
  labelBox: { x0: number; x1: number };
};
/** An arrow on a row whose parent or "leads from" source is not on the graph. */
export type LayoutChip = {
  workItemId: string;
  sources: string[];
  ariaLabel: string;
  tooltip: string;
  x: number;
  y: number;
  size: number;
};
export type LayoutLaneDrop = {
  teamId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  textX: number;
  textY: number;
};

export type TrackerLayout = {
  zoom: number;
  /** The right end of the time line content, including its right margin. */
  width: number;
  /** The right end of the plotted window. */
  x1: number;
  /** The width of the milestone chip column; 0 when no row has a milestone. */
  rail: number;
  height: number;
  x: (t: number) => number;
  t: (x: number) => number;
  window: LayoutWindow;
  ticks: LayoutTick[];
  tLine: LayoutTLine;
  lanes: LayoutLane[];
  rows: LayoutRow[];
  segments: LayoutSegment[];
  eventGroups: LayoutEventGroup[];
  goalTicks: LayoutGoalTick[];
  msChips: LayoutMsChip[];
  stems: LayoutStem[];
  links: LayoutLink[];
  trunk: LayoutTrunk;
  trunkSegments: LayoutTrunkSegment[];
  milestones: LayoutMilestone[];
  chips: LayoutChip[];
  laneDrops: LayoutLaneDrop[];
};

type Ctx = {
  state: TrackerState;
  view: View;
  marks: Marks | undefined;
  tz: string;
  today: string;
  windowStart: string;
  startMs: number;
  xt: number;
  x1: number;
  width: number;
  x: (t: number) => number;
  items: Map<string, WorkItem>;
  infos: Map<string, ItemInfo>;
  inWindow: Set<string>;
  /** Work items in the window that the viewer hid, by row or by team. */
  hidden: Set<string>;
  eventsOf: (id: string) => TrackerEvent[];
  rows: Map<string, LayoutRow>;
  name: (id: string) => string;
  dayStart: (date: string) => number;
  noonX: (date: string) => number;
  lateFrom: (w: WorkItem) => number;
};

type MsStatus = ReturnType<typeof milestoneStatus>;

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const later = (a: string, b: string) => (compareDay(a, b) >= 0 ? a : b);
const baseTone = (info: ItemInfo): Tone => (info.done ? 'proceed' : 'route');
const lateTone = (info: ItemInfo): Tone => (info.done ? 'caution' : 'danger');

function curve(x1: number, y1: number, x2: number, y2: number): Curve {
  const dx = Math.max(24, Math.abs(x2 - x1) / 2);
  return {
    from: { x: x1, y: y1 },
    c1: { x: x1 + dx, y: y1 },
    c2: { x: x2 - dx, y: y2 },
    to: { x: x2, y: y2 },
  };
}

function straight(x1: number, y1: number, x2: number, y2: number): Curve {
  return {
    from: { x: x1, y: y1 },
    c1: { x: x1, y: y1 },
    c2: { x: x2, y: y2 },
    to: { x: x2, y: y2 },
  };
}

function windowDays(
  state: TrackerState,
  view: View,
  infos: Map<string, ItemInfo>,
): { start: string; end: string } {
  const tz = view.timeZone;
  const today = dayOf(view.asOf, tz);
  const recent = addDays(today, -60);
  const starts = state.workItems.flatMap((w) => {
    const info = infos.get(w.id);
    if (!info?.start) return [];
    if (info.finishedAt && compareDay(dayOf(info.finishedAt, tz), recent) < 0) return [];
    return [Date.parse(info.start)];
  });
  const start =
    view.windowStart ??
    addDays(starts.length ? dayOf(new Date(Math.min(...starts)).toISOString(), tz) : today, -3);
  const plans = [
    ...state.workItems.map((w) => w.plannedFinish),
    ...state.milestones.map((m) => m.planned),
  ];
  const end = view.windowEnd ?? plans.map((p) => addDays(p, 3)).reduce(later, addDays(today, 7));
  return { start, end: compareDay(end, start) > 0 ? end : addDays(start, 1) };
}

// The lane name is 10.5 px bold capitals with letter spacing; the hidden button is 9.5 px text.
const LANE_CHAR = 7.6;
const MORE_CHAR = 5.4;

function laneMore(team: { name: string }, ids: string[]): LaneMore | null {
  if (!ids.length) return null;
  const text = `${ids.length} hidden`;
  const width = text.length * MORE_CHAR + 12;
  return {
    ids,
    text,
    ariaLabel: `Show ${plural(ids.length, 'hidden work item')} in ${team.name}`,
    x: X0 - 38 - width,
    width,
  };
}

function placeRows(c: Ctx): { lanes: LayoutLane[]; height: number } {
  const { state, view } = c;
  const lanes: LayoutLane[] = [];
  let y = TRUNK_Y + 16;
  state.teams.forEach((team, index) => {
    const top = y;
    const hidden = view.hiddenTeams.has(team.id);
    const members = state.workItems.filter((w) => w.teamId === team.id && c.inWindow.has(w.id));
    const shown = members.filter((w) => !c.hidden.has(w.id));
    y += HEAD;
    for (const w of shown) {
      const info = c.infos.get(w.id)!;
      c.rows.set(w.id, {
        id: w.id,
        teamId: team.id,
        title: w.title,
        label: trunc(w.title, 26),
        y: y + ROW / 2,
        done: info.done,
        status: itemStatus(w, c.eventsOf(w.id), view.asOf, c.tz),
        milestoneId: w.milestoneId,
        changed: !!c.marks?.workItems.has(w.id),
        eyeLabel: `Hide ${w.title}`,
      });
      y += ROW;
    }
    if (!hidden && !shown.length) y += 18;
    y += hidden ? 2 : 6;
    const lastY = Math.max(0, ...shown.map((w) => c.rows.get(w.id)!.y));
    const more = laneMore(
      team,
      members.filter((w) => c.hidden.has(w.id)).map((w) => w.id),
    );
    const upper = team.name.toUpperCase();
    lanes.push({
      teamId: team.id,
      name: team.name,
      label: trunc(upper, Math.floor(((more ? more.x - 6 : X0 - 40) - 12) / LANE_CHAR)),
      index,
      top,
      bottom: y,
      alt: index % 2 === 1,
      hidden,
      count: members.length,
      hiddenCount: more?.ids.length ?? 0,
      more,
      guide: !hidden && lastY ? { y1: top + 20, y2: lastY } : null,
      eyeLabel: `${hidden ? 'Show' : 'Hide'} ${team.name}`,
    });
  });
  return { lanes, height: y + 56 };
}

function startOf(c: Ctx, w: WorkItem): number {
  const info = c.infos.get(w.id)!;
  if (info.start) return Date.parse(info.start);
  const ends = w.after
    .map((id) => c.infos.get(id))
    .flatMap((i) => (i?.finishedAt ? [Date.parse(i.finishedAt)] : []));
  const sourcesDone = ends.length ? Math.max(...ends) : null;
  const asOf = Date.parse(c.view.asOf);
  // A demo project keeps asOf in the past while the item is placed today, so since can lie after the T line.
  if (w.since) return Math.max(Math.min(Date.parse(w.since), asOf), sourcesDone ?? 0);
  return sourcesDone ?? asOf - EMPTY_LEAD;
}

type AddChip = (id: string, source: string) => void;

function linesOf(c: Ctx, shown: LayoutRow[], addChip: AddChip) {
  const segments: LayoutSegment[] = [];
  const stems: LayoutStem[] = [];
  for (const r of shown) {
    const w = c.items.get(r.id)!;
    const info = c.infos.get(r.id)!;
    const begin = startOf(c, w);
    const sx = Math.max(X0, c.x(begin));
    if (begin >= c.startMs) stems.push(stemOf(c, w, r, sx, addChip));
    if (info.start === null) {
      const waits = w.after
        .map((id) => c.items.get(id))
        .filter((p): p is WorkItem => !!p && !c.infos.get(p.id)!.done);
      const text = waits.length
        ? `Waiting for ${waits.map((p) => p.title.split(' ')[0]).join(', ')}`
        : 'No events yet';
      segments.push({
        kind: 'wait',
        workItemId: w.id,
        x1: sx,
        x2: c.xt,
        y: r.y,
        tone: 'ink-3',
        text,
        textX: sx + 8,
        textY: r.y - 7,
      });
      continue;
    }
    const endAt = Date.parse(info.end ?? c.view.asOf);
    const lateFrom = c.lateFrom(w);
    const line = (x1: number, x2: number, tone: Tone) =>
      segments.push({ kind: 'line', workItemId: w.id, x1, x2, y: r.y, tone });
    if (endAt > lateFrom) {
      const lx = Math.max(sx, c.x(lateFrom));
      if (lx > sx) line(sx, lx, baseTone(info));
      line(lx, c.x(endAt), lateTone(info));
    } else line(sx, c.x(endAt), baseTone(info));
  }
  return { segments, stems };
}

function stemOf(c: Ctx, w: WorkItem, r: LayoutRow, sx: number, addChip: AddChip): LayoutStem {
  const info = c.infos.get(w.id)!;
  const parentId = w.parentId && c.items.has(w.parentId) ? w.parentId : null;
  const parentRow = parentId ? c.rows.get(parentId) : undefined;
  // A parent that is not on the graph gives no row to start from, so the stem starts at the trunk.
  const ghost = !!parentId && !parentRow;
  if (ghost) addChip(w.id, parentId);
  const tone: Tone = ghost || info.start === null ? 'ink-3' : baseTone(info);
  return { workItemId: w.id, parentId, x: sx, y1: parentRow?.y ?? TRUNK_Y, y2: r.y, tone, ghost };
}

function leadLinks(c: Ctx, shown: LayoutRow[], addChip: AddChip): LayoutLink[] {
  const links: LayoutLink[] = [];
  for (const r of shown) {
    const w = c.items.get(r.id)!;
    const begin = Math.max(X0, c.x(startOf(c, w)));
    for (const src of w.after) {
      const si = c.infos.get(src);
      if (!si) continue;
      const sr = c.rows.get(src);
      if (!sr) {
        addChip(w.id, src);
        continue;
      }
      const wait = !si.finishedAt;
      const path = si.finishedAt
        ? curve(c.x(Date.parse(si.finishedAt)), sr.y, begin, r.y)
        : straight(c.xt, sr.y, c.xt, r.y);
      links.push({ fromId: src, toId: w.id, tone: wait ? 'danger' : 'proceed', wait, ...path });
    }
  }
  return links;
}

/** Owner rule: done after the milestone day, or open while today or its own date is past that day. */
function makesLate(c: Ctx, w: WorkItem, planned: string): boolean {
  const info = c.infos.get(w.id)!;
  const after = (day: string) => compareDay(day, planned) > 0;
  if (info.finishedAt) return after(dayOf(info.finishedAt, c.tz));
  return after(c.today) || after(w.plannedFinish);
}

function memberOf(c: Ctx, shown: LayoutRow[]) {
  const byId = new Map(c.state.milestones.map((m) => [m.id, m]));
  return shown.flatMap((r) => {
    const m = r.milestoneId ? byId.get(r.milestoneId) : undefined;
    if (!m) return [];
    const w = c.items.get(r.id)!;
    const late = makesLate(c, w, m.planned);
    const tone: Tone = late ? (r.done ? 'caution' : 'danger') : 'ink-2';
    const reason = late ? (r.done ? 'finished after it' : 'makes it late') : null;
    return [{ r, m, late, tone, reason }];
  });
}

const CHIP_CHAR = 5.6;

function msChipsOf(c: Ctx, shown: LayoutRow[]): LayoutMsChip[] {
  return memberOf(c, shown).map(({ r, m, tone, reason }) => {
    const text = `◆ ${trunc(m.name, 18)}`;
    const width = text.length * CHIP_CHAR + 14;
    const day = formatDay(m.planned);
    return {
      workItemId: r.id,
      milestoneId: m.id,
      text,
      tone,
      x: RAIL - width - 6,
      y: r.y - 7,
      width,
      height: 14,
      ariaLabel: `Milestone ${m.name}, due ${day}${reason ? `, this work item ${reason}` : ''}`,
      tooltip: `${m.name} · ${day}${reason ? `\nThis work item ${reason}.` : ''}`,
    };
  });
}

const DATE_GAP = 6;
const DATE_CHAR = 5.4;

function goalTicksOf(c: Ctx, shown: LayoutRow[]): LayoutGoalTick[] {
  return memberOf(c, shown).flatMap(({ r, m, late, tone, reason }): LayoutGoalTick[] => {
    // A passed deadline matters only where it still explains a delay.
    if (compareDay(c.today, m.planned) > 0 && !late) return [];
    const day = formatDay(m.planned);
    const x = c.noonX(m.planned);
    const text = `Milestone ${m.name} due ${day}`;
    return [
      {
        workItemId: r.id,
        milestoneId: m.id,
        date: m.planned,
        dateLabel: day,
        // A date near the right edge goes to the left of its bar, so the graph never cuts the text.
        dateAnchor: x + DATE_GAP + day.length * DATE_CHAR > c.width ? 'end' : 'start',
        x,
        y: r.y,
        tone,
        changed: !!c.marks?.dates.has(`ms:${m.id}`),
        ariaLabel: text,
        tooltip: reason ? `${text}\nThis work item ${reason}.` : text,
      },
    ];
  });
}

function trunkSegmentsOf(c: Ctx, statusOf: Map<string, MsStatus>): LayoutTrunkSegment[] {
  return c.state.milestones.flatMap((m): LayoutTrunkSegment[] => {
    const { status, finishedAt } = statusOf.get(m.id)!;
    const mx = c.noonX(m.planned);
    const seg = (x1: number, x2: number, tone: Tone) => [
      { milestoneId: m.id, x1, x2, y: TRUNK_Y, tone },
    ];
    if (status === 'late') return seg(mx, c.xt, 'danger');
    if (!finishedAt) return [];
    const fx = c.x(Date.parse(finishedAt));
    if (status === 'flate') return seg(mx, fx, 'caution');
    if (status === 'early') return seg(fx, mx, 'teal');
    return [];
  });
}

function chipOf(c: Ctx, w: WorkItem, r: LayoutRow, sources: string[]): LayoutChip {
  const titles = sources.map((id) => c.items.get(id)!.title);
  const before = `finished before ${formatDay(c.windowStart)}`;
  const sx = Math.max(X0, c.x(startOf(c, w)));
  return {
    workItemId: w.id,
    sources,
    ariaLabel: `Show ${titles.join(', ')}`,
    tooltip: sources
      .map((id, i) => `From ${titles[i]} (${c.hidden.has(id) ? 'hidden' : before})`)
      .join('\n'),
    x: Math.max(SIDE + 2, sx - 22),
    y: r.y - 7,
    size: 14,
  };
}

function ticksOf(c: Ctx, start: string, endMs: number): LayoutTick[] {
  const ticks: LayoutTick[] = [];
  const daily = c.x(c.dayStart(addDays(start, 1))) - c.x(c.startMs) >= DAY_TICK;
  const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
  const first = daily ? addDays(start, 1) : addDays(start, (8 - weekday) % 7);
  for (let d = first; c.dayStart(d) < endMs; d = addDays(d, daily ? 1 : 7)) {
    const tx = c.x(c.dayStart(d));
    ticks.push({ date: d, x: tx, label: formatDay(d), labelled: Math.abs(tx - c.xt) > 56 });
  }
  return ticks;
}

function groupsOf(c: Ctx, w: WorkItem, r: LayoutRow, info: ItemInfo): LayoutEventGroup[] {
  const groups: Array<{ x: number; events: TrackerEvent[] }> = [];
  for (const e of info.events) {
    const at = Date.parse(e.at);
    if (at < c.startMs) continue;
    const ex = c.x(at);
    const last = groups.at(-1);
    if (last && ex - last.x < GROUP_GAP) {
      last.events.push(e);
      last.x = ex;
    } else groups.push({ x: ex, events: [e] });
  }
  const lateFrom = c.lateFrom(w);
  return groups.map(({ x, events }) => {
    const top = events[events.length - 1];
    const stamp = formatStamp(top.at, c.tz);
    const who = c.name(top.by);
    const n = events.length;
    const last = `${KIND_LABEL[top.kind]} by ${who}, ${stamp}`;
    return {
      workItemId: w.id,
      eventIds: events.map((e) => e.id),
      topId: top.id,
      kind: top.kind,
      x,
      y: r.y,
      tone: Date.parse(top.at) > lateFrom ? lateTone(info) : baseTone(info),
      changed: events.some((e) => c.marks?.events.has(e.id)),
      ariaLabel: n > 1 ? `${n} events, the last: ${last}` : last,
      tooltip: `${KIND_LABEL[top.kind]} · ${who} · ${stamp}\n${top.text}${n > 1 ? `\n${n} events here` : ''}`,
    };
  });
}

// The status circle has radius 8, so its label starts 14 units from its centre.
const MS_GAP = 14;

function placeMilestones(c: Ctx, statusOf: Map<string, MsStatus>): LayoutMilestone[] {
  const placed: LayoutMilestone[] = [];
  const sorted = [...c.state.milestones].sort((a, b) => compareDay(a.planned, b.planned));
  for (const m of sorted) {
    const { status } = statusOf.get(m.id)!;
    const tone = STATUS_TONE[status];
    const changed = !!c.marks?.milestones.has(m.id);
    const mx = c.noonX(m.planned);
    const right = mx > c.x1 - 280;
    const previous = c.marks?.dates.has(`ms:${m.id}`) ? m.moves.at(-1) : undefined;
    const was = previous ? ` (was ${formatDay(previous.from)})` : '';
    const label = `${m.name} · ${formatDay(m.planned)} · ${STATUS_LABEL[status]}${was}`;
    const w = label.length * 5.9;
    const x0 = right ? mx - MS_GAP - w : mx + MS_GAP;
    const x1 = x0 + w;
    const crowded = placed.some(
      (p) => p.level === 0 && x0 < p.labelBox.x1 + 8 && x1 > p.labelBox.x0 - 8,
    );
    const level = crowded ? 1 : 0;
    placed.push({
      id: m.id,
      name: m.name,
      x: mx,
      y: TRUNK_Y,
      status,
      tone,
      stroke: changed ? 'change' : tone,
      labelTone: tone,
      filled: status !== 'planned',
      icon: status === 'planned' ? null : status === 'late' ? 'bang' : 'tick',
      changed,
      label,
      ariaLabel: label,
      labelX: right ? mx - MS_GAP : mx + MS_GAP,
      labelY: level ? TRUNK_Y + 17 : MS_Y,
      anchor: right ? 'end' : 'start',
      level,
      labelBox: { x0, x1 },
    });
  }
  return placed;
}

export function layoutTracker(state: TrackerState, view: View, marks?: Marks): TrackerLayout {
  const tz = view.timeZone;
  const byItem = new Map<string, TrackerEvent[]>();
  for (const e of state.events) {
    const list = byItem.get(e.workItemId);
    if (list) list.push(e);
    else byItem.set(e.workItemId, [e]);
  }
  const eventsOf = (id: string) => byItem.get(id) ?? [];
  const infos = new Map(
    state.workItems.map((w) => [w.id, itemInfo(w, eventsOf(w.id), view.asOf)] as const),
  );
  const { start, end } = windowDays(state, view, infos);
  const dayStart = (date: string) => Date.parse(startOfDayInstant(date, tz));
  const startMs = dayStart(start);
  const endMs = dayStart(end);
  const inWindow = new Set(
    [...infos]
      .filter(([, i]) => !(i.finishedAt && Date.parse(i.finishedAt) < startMs))
      .map(([id]) => id),
  );
  const items = new Map(state.workItems.map((w) => [w.id, w]));
  const hidden = new Set(
    [...inWindow].filter((id) => {
      const w = items.get(id)!;
      return view.hiddenRows.has(id) || view.hiddenTeams.has(w.teamId);
    }),
  );
  const milestoneIds = new Set(state.milestones.map((m) => m.id));
  const teamIds = new Set(state.teams.map((tm) => tm.id));
  const rail = [...inWindow].some((id) => {
    const w = items.get(id)!;
    return (
      !hidden.has(id) && teamIds.has(w.teamId) && !!w.milestoneId && milestoneIds.has(w.milestoneId)
    );
  })
    ? RAIL
    : 0;
  const raw = view.zoom ?? 1;
  const zoom = Number.isFinite(raw) ? Math.min(MAX_ZOOM, Math.max(1, raw)) : 1;
  const x1 = X0 + (X1 - rail - X0) * zoom;
  const x = (t: number) => X0 + ((t - startMs) / (endMs - startMs)) * (x1 - X0);
  const t = (px: number) => startMs + ((px - X0) / (x1 - X0)) * (endMs - startMs);
  const people = new Map(state.people.map((p) => [p.id, p.name]));
  const c: Ctx = {
    state,
    view,
    marks,
    tz,
    today: dayOf(view.asOf, tz),
    windowStart: start,
    startMs,
    xt: x(Date.parse(view.asOf)),
    x1,
    width: x1 + RIGHT,
    x,
    items,
    infos,
    inWindow,
    hidden,
    eventsOf,
    rows: new Map(),
    name: (id) => (id === 'agent' ? 'Agent' : (people.get(id) ?? id)),
    dayStart,
    noonX: (date) => Math.min(x1 - 4, x(dayStart(date) + 12 * HOUR)),
    lateFrom: (w) => dayStart(addDays(w.plannedFinish, 1)),
  };
  const { lanes, height } = placeRows(c);
  const shown = [...c.rows.values()];
  const chipSources = new Map<string, Set<string>>();
  const addChip: AddChip = (id, source) =>
    chipSources.set(id, (chipSources.get(id) ?? new Set()).add(source));
  const { segments, stems } = linesOf(c, shown, addChip);
  const links = leadLinks(c, shown, addChip);
  const statusOf = new Map(
    state.milestones.map((m) => [
      m.id,
      milestoneStatus(m, state.workItems, state.events, view.asOf, tz),
    ]),
  );
  const item = (r: LayoutRow) => c.items.get(r.id)!;
  return {
    zoom,
    width: c.width,
    x1,
    rail,
    height,
    x,
    t,
    window: {
      start,
      end,
      startMs,
      endMs,
      label: `Work items from ${formatDay(start)} to ${formatDay(addDays(end, -1))}`,
    },
    ticks: ticksOf(c, start, endMs),
    tLine: { x: c.xt, y1: AXIS_Y + 5, y2: height, label: `T ${formatStamp(view.asOf, tz)}` },
    lanes,
    rows: shown,
    segments,
    eventGroups: shown.flatMap((r) => groupsOf(c, item(r), r, infos.get(r.id)!)),
    goalTicks: goalTicksOf(c, shown),
    msChips: msChipsOf(c, shown),
    stems,
    links,
    trunk: { x1: X0, x2: x1, y: TRUNK_Y },
    trunkSegments: trunkSegmentsOf(c, statusOf),
    milestones: placeMilestones(c, statusOf),
    chips: shown.flatMap((r) => {
      const sources = chipSources.get(r.id);
      return sources ? [chipOf(c, item(r), r, [...sources])] : [];
    }),
    laneDrops: lanes
      .filter((l) => !l.hidden)
      .map((l) => ({
        teamId: l.teamId,
        x: X0,
        y: l.top + 2,
        width: x1 - X0,
        height: 18,
        text: `Drop here: ${l.name}`,
        textX: X0 + 10,
        textY: l.top + 15,
      })),
  };
}
