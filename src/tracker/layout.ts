import {
  KIND_LABEL,
  STATUS_LABEL,
  type EventKind,
  type Milestone,
  type Status,
  type TrackerEvent,
  type TrackerState,
  type WorkItem,
} from './model';
import { deadlinesByItem, formatDeadline, milestoneDeadline } from './deadline';
import { descendantsOf } from './focus';
import { drawnTimes, type Offsets } from './offsets';
import type { Marks } from './ops';
import { itemInfo, itemStatus, milestoneStatus, type ItemInfo } from './status';
import { addDays, compareDay, dayOf, formatDay, formatStamp, startOfDayInstant } from './time';

/**
 * One unit is one CSS pixel. SIDE is the fixed label column; VW - SIDE is the visible time line when
 * the view does not give its width. Everything above TOP (the axis and the milestone line) stays
 * pinned while the rows scroll.
 */
export const GEOMETRY = {
  VW: 1060,
  X0: 236,
  X1: 1046,
  SIDE: 228,
  AXIS_Y: 15,
  MS_Y: 33,
  TRUNK_Y: 48,
  TOP: 64,
  ROW: 32,
  HEAD: 22,
  INDENT: 12,
  MAX_ZOOM: 12,
  MIN_DAY_WIDTH: 2,
  MAX_DAY_WIDTH: 480,
} as const;

const { VW, X0, X1, SIDE, AXIS_Y, MS_Y, TRUNK_Y, TOP, ROW, HEAD, MAX_ZOOM } = GEOMETRY;
const { MIN_DAY_WIDTH, MAX_DAY_WIDTH } = GEOMETRY;
/** A window so long that its fit is under the floor can still fit. */
export const clampDayWidth = (dayWidth: number, fitDayWidth: number) =>
  Math.min(MAX_DAY_WIDTH, Math.max(Math.min(MIN_DAY_WIDTH, fitDayWidth), dayWidth));
const RIGHT = VW - X1;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const GROUP_GAP = 16;
const EMPTY_LEAD = 48 * HOUR;
// A day this wide fits its own "14 Sept" label, so the axis can tick every day.
const DAY_TICK = 60;
// Half the T pill (88 wide) plus half a tick label such as "12 Oct", so the pill never covers a date.
const T_PILL_ROOM = 66;

export type Tone =
  'proceed' | 'route' | 'danger' | 'caution' | 'teal' | 'ink-2' | 'ink-3' | 'change';

export const STATUS_TONE: Record<Status, Tone> = {
  planned: 'ink-3',
  early: 'teal',
  ontime: 'proceed',
  late: 'danger',
  flate: 'caution',
};

/** Rows that match the filters, and their ancestors, which show dimmed so the tree stays readable. */
export type RowMatch = { match: ReadonlySet<string>; context: ReadonlySet<string> };

export type View = {
  hiddenRows: Set<string>;
  hiddenTeams: Set<string>;
  asOf: string;
  timeZone: string;
  windowStart?: string;
  windowEnd?: string;
  /** The visible width of the time line; a wider view shows more time at the same scale. */
  span?: number;
  /** Units per day. Without it the scale is `zoom` times the fit of the window to `fitSpan`. */
  dayWidth?: number;
  /** The width the first fit used, so the scale does not follow later changes of `span`. */
  fitSpan?: number;
  /** 1 fits the window to `fitSpan`; more widens the time line. Used only without `dayWidth`. */
  zoom?: number;
  offsets?: Offsets;
  focus?: string | null;
  filter?: RowMatch | null;
  /** Rows carry a focus button next to the eye, so their labels are cut shorter. */
  focusButtons?: boolean;
};

export type Point = { x: number; y: number };

export type LayoutWindow = {
  start: string;
  end: string;
  startMs: number;
  endMs: number;
  label: string;
};
export type LayoutTick = { date: string; x: number; label: string; labelled: boolean };
export type LayoutTLine = { x: number; y1: number; y2: number; label: string };
export type LayoutLane = {
  teamId: string;
  name: string;
  label: string;
  index: number;
  top: number;
  bottom: number;
  alt: boolean;
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
  focused: boolean;
  focusLabel: string;
  depth: number;
  dimmed: boolean;
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
/** It also tells which milestone the row belongs to, so rows need no milestone chip. */
export type LayoutDeadline = {
  workItemId: string;
  milestoneId: string;
  date: string;
  time: string | null;
  x: number;
  y: number;
  tone: Tone;
  stroke: Tone;
  filled: boolean;
  changed: boolean;
  /** The milestone name, on the first member row of each team only, and only where it has room. */
  label: string | null;
  labelX: number;
  labelY: number;
  labelAnchor: 'start' | 'end';
  ariaLabel: string;
  tooltip: string;
};
export type LayoutHandoffTarget = {
  id: string;
  teamId: string;
  team: string;
  title: string;
  text: string;
};
export type LayoutHandoff = {
  fromId: string;
  targets: LayoutHandoffTarget[];
  /** The Handoff event the mark sits on, or null when it sits after the finish or the T line. */
  eventId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  dir: 'up' | 'down' | 'both';
  tone: Tone;
  wait: boolean;
  ariaLabel: string;
  tooltip: string;
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
/** A chip on a row whose own parent or "leads from" source is not on the graph. */
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
  /** The day width over the fit to the current `span`: 1 at fit, less when the view widened since. */
  zoom: number;
  dayWidth: number;
  /** The day width that fits the window to the current `span`. */
  fitDayWidth: number;
  /** The right end of the time line content, including its right margin. */
  width: number;
  /** The right end of the plotted window. */
  x1: number;
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
  deadlines: LayoutDeadline[];
  handoffs: LayoutHandoff[];
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
  /** Work items in the window outside the focus or the filters; they get no chip, as the focus panel lists the parent. */
  outside: Set<string>;
  eventsOf: (id: string) => TrackerEvent[];
  rows: Map<string, LayoutRow>;
  name: (id: string) => string;
  dayStart: (date: string) => number;
  /** The milestone deadline of each member work item. */
  deadlines: Map<string, number>;
  deadlineX: (m: Milestone) => number;
  lateFrom: (w: WorkItem) => number;
};

type MsStatus = ReturnType<typeof milestoneStatus>;

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const later = (a: string, b: string) => (compareDay(a, b) >= 0 ? a : b);
const baseTone = (info: ItemInfo): Tone => (info.done ? 'proceed' : 'route');
const lateTone = (info: ItemInfo): Tone => (info.done ? 'caution' : 'danger');

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

// The lane name is 10.5 px bold capitals with letter spacing.
const LANE_CHAR = 7.6;
const MAX_DEPTH = 3;

/** Children follow their parent inside a team, so the indent of the labels reads as a tree. */
function treeOrder(shown: WorkItem[]): Array<{ w: WorkItem; depth: number }> {
  const ids = new Set(shown.map((w) => w.id));
  const kids = new Map<string, WorkItem[]>();
  for (const w of shown)
    if (w.parentId && w.parentId !== w.id && ids.has(w.parentId))
      kids.set(w.parentId, [...(kids.get(w.parentId) ?? []), w]);
  const out: Array<{ w: WorkItem; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (w: WorkItem, depth: number) => {
    if (seen.has(w.id)) return;
    seen.add(w.id);
    out.push({ w, depth: Math.min(depth, MAX_DEPTH) });
    for (const k of kids.get(w.id) ?? []) visit(k, depth + 1);
  };
  for (const w of shown) if (!w.parentId || !ids.has(w.parentId)) visit(w, 0);
  // A parent loop has no root, so its rows join at the top level.
  for (const w of shown) visit(w, 0);
  return out;
}

function placeRows(c: Ctx): { lanes: LayoutLane[]; height: number } {
  const { state, view } = c;
  const lanes: LayoutLane[] = [];
  let y = TOP;
  for (const team of state.teams) {
    const members = state.workItems.filter((w) => w.teamId === team.id && c.inWindow.has(w.id));
    const shown = members.filter((w) => !c.hidden.has(w.id) && !c.outside.has(w.id));
    if (view.hiddenTeams.has(team.id)) continue;
    if (!shown.length && (members.length || view.focus || view.filter)) continue;
    const top = y;
    y += HEAD;
    for (const { w, depth } of treeOrder(shown)) {
      const info = c.infos.get(w.id)!;
      const focused = view.focus === w.id;
      c.rows.set(w.id, {
        id: w.id,
        teamId: team.id,
        title: w.title,
        label: trunc(w.title, (view.focusButtons ? 24 : 26) - 2 * depth),
        y: y + ROW / 2,
        done: info.done,
        status: itemStatus(w, c.eventsOf(w.id), view.asOf, c.tz),
        milestoneId: w.milestoneId,
        changed: !!c.marks?.workItems.has(w.id),
        eyeLabel: `Hide ${w.title}`,
        focused,
        focusLabel: `Focus on ${w.title}`,
        depth,
        dimmed: !!view.filter && !view.filter.match.has(w.id),
      });
      y += ROW;
    }
    if (!shown.length) y += 18;
    y += 6;
    const lastY = Math.max(0, ...shown.map((w) => c.rows.get(w.id)!.y));
    const index = lanes.length;
    lanes.push({
      teamId: team.id,
      name: team.name,
      label: trunc(team.name.toUpperCase(), Math.floor((X0 - 40 - 12) / LANE_CHAR)),
      index,
      top,
      bottom: y,
      alt: index % 2 === 1,
      guide: lastY ? { y1: top + 20, y2: lastY } : null,
      eyeLabel: `Hide ${team.name}`,
    });
  }
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

function linesOf(c: Ctx, shown: LayoutRow[]): LayoutSegment[] {
  const segments: LayoutSegment[] = [];
  for (const r of shown) {
    const w = c.items.get(r.id)!;
    const info = c.infos.get(r.id)!;
    const sx = Math.max(X0, c.x(startOf(c, w)));
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
  return segments;
}

/** A parent or source that is not on the graph gets the arrow chip, as the owner wants no ghost lines. */
function chipSourcesOf(c: Ctx, shown: LayoutRow[]): Map<string, string[]> {
  const sources = new Map<string, string[]>();
  for (const r of shown) {
    const w = c.items.get(r.id)!;
    const up = [...new Set(w.parentId ? [w.parentId, ...w.after] : w.after)];
    const off = up.filter((id) => c.items.has(id) && !c.rows.has(id) && !c.outside.has(id));
    if (off.length) sources.set(r.id, off);
  }
  return sources;
}

const MARK = 14;
const MARK_WIDE = 24;
// A done source ends in its Done icon (radius 10); an open one ends at the T line, where an editor has the + button.
const MARK_AFTER_DONE = 12;
const MARK_AFTER_OPEN = 32;
// On a Handoff event the mark is a badge on the top right of its icon (radius 10), inside the row band.
const BADGE_DX = 5;
const ICON_R = 10;
const BADGE_RISE = 16;

function handoffEventOf(
  c: Ctx,
  id: string,
  groups: LayoutEventGroup[],
): { id: string; x: number } | null {
  const ev = c.infos
    .get(id)!
    .events.filter((e) => e.kind === 'handoff')
    .at(-1);
  const group = ev && groups.find((g) => g.workItemId === id && g.eventIds.includes(ev.id));
  return ev && group ? { id: ev.id, x: group.x } : null;
}

function handoffsOf(c: Ctx, groups: LayoutEventGroup[]): LayoutHandoff[] {
  const teamIndex = new Map(c.state.teams.map((t, i) => [t.id, i]));
  const teamName = new Map(c.state.teams.map((t) => [t.id, t.name]));
  const itemIndex = new Map(c.state.workItems.map((w, i) => [w.id, i]));
  const team = (w: WorkItem) => teamIndex.get(w.teamId) ?? Infinity;
  // A hidden row has no y, so inside one team the order of the work items decides.
  const below = (a: WorkItem, b: WorkItem) => {
    const ya = c.rows.get(a.id)?.y;
    const yb = c.rows.get(b.id)?.y;
    const inTeam =
      ya !== undefined && yb !== undefined ? ya - yb : itemIndex.get(a.id)! - itemIndex.get(b.id)!;
    return team(a) - team(b) || inTeam;
  };
  const receivers = [...c.items.values()]
    .filter((w) => c.inWindow.has(w.id) && teamIndex.has(w.teamId))
    .sort(below);
  const bySource = new Map<string, WorkItem[]>();
  for (const w of receivers)
    for (const src of new Set(w.after))
      if (src !== w.id && c.rows.has(src)) bySource.set(src, [...(bySource.get(src) ?? []), w]);
  return [...bySource].map(([src, list]): LayoutHandoff => {
    const source = c.items.get(src)!;
    const sr = c.rows.get(src)!;
    const finishedAt = c.infos.get(src)!.finishedAt;
    const handoff = handoffEventOf(c, src, groups);
    const wait = !finishedAt && !handoff;
    const end = handoff ? handoff.x : wait ? c.xt : c.x(Date.parse(finishedAt!));
    const width = list.length > 1 ? MARK_WIDE : MARK;
    const gap = handoff ? BADGE_DX : wait ? MARK_AFTER_OPEN : MARK_AFTER_DONE;
    const after = end + gap;
    // Near the right edge the mark goes left of the end, so the graph never cuts it.
    // Near the edge a badge goes left of its icon (radius 10) instead of covering it.
    const before = end - (handoff ? ICON_R + BADGE_DX : MARK_AFTER_DONE) - width;
    const x = after + width <= c.width - 2 ? after : before;
    const targets = list.map((w) => {
      const team = teamName.get(w.teamId)!;
      const text = wait
        ? `Hands over to ${team} when done · received in ${w.title}`
        : `Handed over to ${team} · received in ${w.title}`;
      return { id: w.id, teamId: w.teamId, team, title: w.title, text };
    });
    const ups = list.map((w) => below(w, source) < 0);
    const lines = targets.map((t) => t.text);
    return {
      fromId: src,
      targets,
      eventId: handoff?.id ?? null,
      x,
      y: handoff ? sr.y - BADGE_RISE : sr.y - MARK / 2,
      width,
      height: MARK,
      dir: ups.every(Boolean) ? 'up' : ups.some(Boolean) ? 'both' : 'down',
      tone: wait ? 'danger' : 'proceed',
      wait,
      ariaLabel:
        lines.length > 1
          ? `${lines.length} handoffs from ${source.title}: ${lines.join('; ')}`
          : lines[0],
      tooltip: lines.join('\n'),
    };
  });
}

/** Owner rule: done after the deadline, or open while now or its own planned day is past it. */
function makesLate(c: Ctx, w: WorkItem, m: Milestone): boolean {
  const info = c.infos.get(w.id)!;
  const deadline = milestoneDeadline(m, c.tz);
  if (info.finishedAt) return Date.parse(info.finishedAt) > deadline;
  return Date.parse(c.view.asOf) > deadline || compareDay(w.plannedFinish, m.planned) > 0;
}

type Span = [number, number];
const LABEL_GAP = 9;
// The 9.5 px name sits just above the line and stays inside the 32-unit band of its own row.
const LABEL_RISE = 6;
const LABEL_CHAR = 5.4;
const EVENT_ROOM = 11;
const WAIT_CHAR = 5.6;

/** What already sits on each row near the line, so the milestone name goes only where it is free. */
function busyOf(
  segments: LayoutSegment[],
  groups: LayoutEventGroup[],
  handoffs: LayoutHandoff[],
  chips: LayoutChip[],
): Map<string, Span[]> {
  const busy = new Map<string, Span[]>();
  const add = (id: string | undefined, span: Span) => {
    if (id) busy.set(id, [...(busy.get(id) ?? []), span]);
  };
  for (const g of groups) add(g.workItemId, [g.x - EVENT_ROOM, g.x + EVENT_ROOM]);
  for (const h of handoffs) add(h.fromId, [h.x - 2, h.x + h.width + 2]);
  for (const ch of chips) add(ch.workItemId, [ch.x - 2, ch.x + ch.size + 2]);
  for (const s of segments)
    if (s.kind === 'wait') add(s.workItemId, [s.textX - 2, s.textX + s.text.length * WAIT_CHAR]);
  return busy;
}

function deadlinesOf(
  c: Ctx,
  shown: LayoutRow[],
  statusOf: Map<string, MsStatus>,
  busy: Map<string, Span[]>,
): LayoutDeadline[] {
  const byId = new Map(c.state.milestones.map((m) => [m.id, m]));
  const named = new Set<string>();
  return shown.flatMap((r): LayoutDeadline[] => {
    const m = r.milestoneId ? byId.get(r.milestoneId) : undefined;
    if (!m) return [];
    // A deadline left of the window would sit on the edge and look like the start of the row.
    if (milestoneDeadline(m, c.tz) < c.startMs) return [];
    const first = !named.has(`${r.teamId}|${m.id}`);
    named.add(`${r.teamId}|${m.id}`);
    const w = c.items.get(r.id)!;
    const { status } = statusOf.get(m.id)!;
    const tone = STATUS_TONE[status];
    const changed = !!c.marks?.dates.has(`ms:${m.id}`);
    const reason = makesLate(c, w, m) ? (r.done ? 'finished after it' : 'makes it late') : null;
    const x = c.deadlineX(m);
    const text = `${m.name} · deadline ${formatDeadline(m.planned, m.plannedTime)} · ${STATUS_LABEL[status]}`;
    const width = m.name.length * LABEL_CHAR;
    const free = ([a, b]: Span) =>
      a >= X0 && b <= c.width - 2 && (busy.get(r.id) ?? []).every(([p, q]) => b < p || a > q);
    const right: Span = [x + LABEL_GAP, x + LABEL_GAP + width];
    const left: Span = [x - LABEL_GAP - width, x - LABEL_GAP];
    const side = !first ? null : free(right) ? 'start' : free(left) ? 'end' : null;
    return [
      {
        workItemId: r.id,
        milestoneId: m.id,
        date: m.planned,
        time: m.plannedTime ?? null,
        x,
        y: r.y,
        tone,
        stroke: changed ? 'change' : tone,
        filled: status !== 'planned',
        changed,
        label: side ? m.name : null,
        labelX: side === 'end' ? x - LABEL_GAP : x + LABEL_GAP,
        labelY: r.y - LABEL_RISE,
        labelAnchor: side ?? 'start',
        ariaLabel: reason ? `${text}, this work item ${reason}` : text,
        tooltip: reason ? `${text}\nThis work item ${reason}.` : text,
      },
    ];
  });
}

function trunkSegmentsOf(c: Ctx, statusOf: Map<string, MsStatus>): LayoutTrunkSegment[] {
  return c.state.milestones.flatMap((m): LayoutTrunkSegment[] => {
    const { status, finishedAt } = statusOf.get(m.id)!;
    const mx = c.deadlineX(m);
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

function comesFrom(c: Ctx, from: string, source: string): boolean {
  const seen = new Set<string>();
  const todo = [from];
  while (todo.length) {
    const w = c.items.get(todo.pop()!);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    const up = w.parentId ? [w.parentId, ...w.after] : w.after;
    if (up.includes(source)) return true;
    todo.push(...up);
  }
  return false;
}

/** The owner wants the chip on direct children only: a row that comes from the source through a shown row is a grandchild. */
const throughShownRow = (c: Ctx, w: WorkItem, source: string) =>
  [w.parentId, ...w.after].some(
    (id) => !!id && id !== source && c.rows.has(id) && comesFrom(c, id, source),
  );

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
    ticks.push({
      date: d,
      x: tx,
      label: formatDay(d),
      labelled: Math.abs(tx - c.xt) > T_PILL_ROOM,
    });
  }
  return ticks;
}

function groupsOf(c: Ctx, w: WorkItem, r: LayoutRow, info: ItemInfo): LayoutEventGroup[] {
  const times = drawnTimes(info.events, c.view.offsets ?? {}, c.tz, c.deadlines);
  const real = new Map(info.events.map((e, i) => [e.id, i]));
  const drawn = info.events
    .map((e) => ({ e, at: times.get(e.id)! }))
    .sort((a, b) => a.at - b.at || real.get(a.e.id)! - real.get(b.e.id)!);
  const groups: Array<{ x: number; events: TrackerEvent[] }> = [];
  for (const { e, at } of drawn) {
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
  const sorted = [...c.state.milestones].sort(
    (a, b) => milestoneDeadline(a, c.tz) - milestoneDeadline(b, c.tz),
  );
  for (const m of sorted) {
    const { status } = statusOf.get(m.id)!;
    const tone = STATUS_TONE[status];
    const changed = !!c.marks?.milestones.has(m.id);
    const mx = c.deadlineX(m);
    const right = mx > c.x1 - 280;
    const previous = c.marks?.dates.has(`ms:${m.id}`) ? m.moves.at(-1) : undefined;
    const was = previous ? ` (was ${formatDeadline(previous.from, previous.fromTime)})` : '';
    const label = `${m.name} · ${formatDeadline(m.planned, m.plannedTime)} · ${STATUS_LABEL[status]}${was}`;
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
      labelY: level ? TRUNK_Y + 13 : MS_Y,
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
  const focus = view.focus && items.has(view.focus) ? view.focus : null;
  const inFocus = focus ? descendantsOf(state, focus) : null;
  const filter = view.filter ?? null;
  const outside = new Set(
    [...inWindow].filter(
      (id) =>
        (inFocus && !inFocus.has(id)) ||
        (filter && !filter.match.has(id) && !filter.context.has(id)),
    ),
  );
  const days = (endMs - startMs) / DAY;
  const room = (span: number | undefined) =>
    Math.max(1, (span && Number.isFinite(span) ? span : VW - SIDE) - (X0 - SIDE) - RIGHT);
  const visible = room(view.span);
  const given = view.dayWidth;
  let plot: number;
  if (given !== undefined && Number.isFinite(given) && given > 0) {
    plot = clampDayWidth(given, visible / days) * days;
  } else {
    const raw = view.zoom ?? 1;
    const zoom = Number.isFinite(raw) ? Math.min(MAX_ZOOM, Math.max(1, raw)) : 1;
    plot = room(view.fitSpan ?? view.span) * zoom;
  }
  // A fit computed from the day width can land a hair past the view, which would add a scroll bar.
  const x1 = X0 + (plot - visible > 1e-6 ? plot : visible);
  const x = (t: number) => X0 + ((t - startMs) / (endMs - startMs)) * plot;
  const t = (px: number) => startMs + ((px - X0) / plot) * (endMs - startMs);
  const plotEndMs = t(x1);
  const people = new Map(state.people.map((p) => [p.id, p.name]));
  const c: Ctx = {
    state,
    view: { ...view, focus, filter },
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
    outside,
    eventsOf,
    rows: new Map(),
    name: (id) => (id === 'agent' ? 'Agent' : (people.get(id) ?? id)),
    dayStart,
    deadlines: deadlinesByItem(state, tz),
    deadlineX: (m) => Math.min(x1 - 4, x(milestoneDeadline(m, tz))),
    lateFrom: (w) => dayStart(addDays(w.plannedFinish, 1)),
  };
  const { lanes, height } = placeRows(c);
  const shown = [...c.rows.values()].sort((a, b) => a.y - b.y);
  const segments = linesOf(c, shown);
  const statusOf = new Map(
    state.milestones.map((m) => [
      m.id,
      milestoneStatus(m, state.workItems, state.events, view.asOf, tz),
    ]),
  );
  const item = (r: LayoutRow) => c.items.get(r.id)!;
  const chipSources = chipSourcesOf(c, shown);
  const chips = shown.flatMap((r) => {
    const w = item(r);
    const sources = (chipSources.get(r.id) ?? []).filter((id) => !throughShownRow(c, w, id));
    return sources.length ? [chipOf(c, w, r, sources)] : [];
  });
  const eventGroups = shown.flatMap((r) => groupsOf(c, item(r), r, infos.get(r.id)!));
  const handoffs = handoffsOf(c, eventGroups);
  const busy = busyOf(segments, eventGroups, handoffs, chips);
  return {
    zoom: plot / visible,
    dayWidth: plot / days,
    fitDayWidth: visible / days,
    width: c.width,
    x1,
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
    ticks: ticksOf(c, start, plotEndMs),
    tLine: { x: c.xt, y1: AXIS_Y + 5, y2: height, label: `T ${formatStamp(view.asOf, tz)}` },
    lanes,
    rows: shown,
    segments,
    eventGroups,
    deadlines: deadlinesOf(c, shown, statusOf, busy),
    handoffs,
    trunk: { x1: X0, x2: x1, y: TRUNK_Y },
    trunkSegments: trunkSegmentsOf(c, statusOf),
    milestones: placeMilestones(c, statusOf),
    chips,
    laneDrops: lanes.map((l) => ({
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
