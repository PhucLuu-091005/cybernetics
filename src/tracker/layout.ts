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
import { formatDeadline, itemDeadline, milestoneDeadline } from './deadline';
import { descendantsOf, teamDescendants } from './focus';
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
  /** A phone keeps the names pinned beside the time line in a column this wide, with no row buttons. */
  NARROW_SIDE: 128,
  AXIS_Y: 15,
  MS_Y: 33,
  TRUNK_Y: 48,
  TOP: 64,
  INDENT: 12,
  MAX_ZOOM: 12,
  MIN_DAY_WIDTH: 2,
  MAX_DAY_WIDTH: 480,
} as const;

const { VW, X0, X1, SIDE, AXIS_Y, MS_Y, TRUNK_Y, TOP, MAX_ZOOM, INDENT } = GEOMETRY;
const { MIN_DAY_WIDTH, MAX_DAY_WIDTH } = GEOMETRY;
/** A window so long that its fit is under the floor can still fit. */
export const clampDayWidth = (dayWidth: number, fitDayWidth: number) =>
  Math.min(MAX_DAY_WIDTH, Math.max(Math.min(MIN_DAY_WIDTH, fitDayWidth), dayWidth));
export type Density = 'comfortable' | 'compact' | 'dense';

/** Sizes in units that follow the row height, so no mark leaves its own row band. */
export type RowLevel = {
  row: number;
  /** The height of the row's click band; never under 12, so a Dense row stays easy to hit. */
  hit: number;
  head: number;
  /** Event circle radius; at Dense an event is a filled dot with no icon (`icon` 0). */
  r: number;
  icon: number;
  gap: number;
  font: number;
  labelDy: number;
  seg: number;
  /** Half the diagonal of the deadline diamond. */
  diamond: number;
  mark: number;
  markWide: number;
  markIcon: number;
  chip: number;
  chipIcon: number;
  btn: number;
  btnIcon: number;
  plus: number;
  nameFont: number;
  /** The milestone name baseline above the row centre; negative puts it below. */
  nameRise: number;
  waitText: boolean;
  waitRise: number;
  /** The receiver count on a Handoff icon; 0 leaves it to the tooltip and the list. */
  count: number;
};

export const ROW_LEVELS: Record<Density, RowLevel> = {
  comfortable: {
    row: 32,
    hit: 30,
    head: 28,
    r: 10,
    icon: 13,
    gap: 16,
    font: 12,
    labelDy: 4,
    seg: 3,
    diamond: 6,
    mark: 14,
    markWide: 24,
    markIcon: 10,
    chip: 14,
    chipIcon: 10,
    btn: 18,
    btnIcon: 12,
    plus: 9,
    nameFont: 9.5,
    nameRise: 6,
    waitText: true,
    waitRise: 7,
    count: 8.5,
  },
  compact: {
    row: 20,
    hit: 18,
    head: 28,
    r: 7,
    icon: 9,
    gap: 12,
    font: 11,
    labelDy: 3.8,
    seg: 2.5,
    diamond: 4.5,
    mark: 12,
    markWide: 21,
    markIcon: 8.5,
    chip: 12,
    chipIcon: 8.5,
    btn: 16,
    btnIcon: 11,
    plus: 7,
    nameFont: 9,
    nameRise: 3,
    waitText: true,
    waitRise: 3.5,
    count: 7.5,
  },
  dense: {
    row: 12,
    hit: 12,
    head: 24,
    r: 3,
    icon: 0,
    gap: 7,
    font: 9.5,
    labelDy: 3.3,
    seg: 2,
    diamond: 3.5,
    mark: 10,
    markWide: 18,
    markIcon: 7,
    chip: 10,
    chipIcon: 7,
    btn: 12,
    btnIcon: 9,
    plus: 5,
    nameFont: 8,
    nameRise: -2.8,
    waitText: false,
    waitRise: 0,
    count: 0,
  },
};

const RIGHT = VW - X1;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const EMPTY_LEAD = 48 * HOUR;
// The widest date label ("28 Sept") with a gap on each side, so two neighbouring labels never touch.
const TICK_ROOM = 64;
// Half the T pill (88 wide) plus half a tick label such as "12 Oct", so the pill never covers a date.
const T_PILL_ROOM = 66;

export type Tone =
  'proceed' | 'route' | 'danger' | 'caution' | 'teal' | 'ink-2' | 'ink-3' | 'isolated' | 'change';

export const STATUS_TONE: Record<Status, Tone> = {
  planned: 'ink-3',
  early: 'teal',
  ontime: 'proceed',
  late: 'danger',
  flate: 'caution',
  cancelled: 'isolated',
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
  focus?: string | null;
  focusTeam?: string | null;
  filter?: RowMatch | null;
  /** Rows carry a focus button next to the eye, so their labels are cut shorter. */
  focusButtons?: boolean;
  /** Comfortable when not given. */
  density?: Density;
  /** An editable view draws + after the T line on each open row, so names keep off it. */
  plusButtons?: boolean;
  /** These teams show their summary row only. */
  collapsedTeams?: ReadonlySet<string>;
  /** The width of the label column; narrower than SIDE, it has no row buttons. */
  side?: number;
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
export type LayoutTeamSummary = {
  count: number;
  late: number;
  notYet: number;
  done: number;
  cancelled: number;
  /** The team holds a change of the change request on screen. */
  changed: boolean;
  ariaLabel: string;
};
export type LayoutLane = {
  teamId: string;
  name: string;
  label: string;
  index: number;
  top: number;
  bottom: number;
  /** The height of the summary row at the top of the lane. */
  head: number;
  collapsed: boolean;
  summary: LayoutTeamSummary;
  alt: boolean;
  guide: { y1: number; y2: number } | null;
  eyeLabel: string;
  focused: boolean;
  focusLabel: string;
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
  /** The Handoff event whose icon is the mark, or null when the mark sits after the finish or the T line. */
  eventId: string | null;
  /** The top event of the icon group that holds that Handoff event; the group draws the mark. */
  groupId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  dir: 'up' | 'down' | 'both';
  tone: Tone;
  wait: boolean;
  /** The source was cancelled, so the receivers get nothing from it. */
  cancelled: boolean;
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
  level: RowLevel;
  side: number;
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
  level: RowLevel;
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
  /** Shown work items of collapsed teams. */
  folded: Set<string>;
  eventsOf: (id: string) => TrackerEvent[];
  rows: Map<string, LayoutRow>;
  name: (id: string) => string;
  dayStart: (date: string) => number;
  deadlineX: (m: Milestone) => number;
  lateFrom: (w: WorkItem) => number;
};

type MsStatus = ReturnType<typeof milestoneStatus>;

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const later = (a: string, b: string) => (compareDay(a, b) >= 0 ? a : b);
const baseTone = (info: ItemInfo): Tone =>
  info.cancelled ? 'isolated' : info.done ? 'proceed' : 'route';
const lateTone = (info: ItemInfo): Tone =>
  info.cancelled ? 'isolated' : info.done ? 'caution' : 'danger';

/** The first and last day that the payload on screen touches: events, work item lives, plans and milestones. */
function spanDays(
  state: TrackerState,
  infos: Map<string, ItemInfo>,
  asOf: string,
  tz: string,
): { first: string | null; last: string | null } {
  const times = state.events.map((e) => Date.parse(e.at));
  for (const w of state.workItems) times.push(itemStartMs(w, infos, asOf));
  const days = [
    ...state.workItems.map((w) => w.plannedFinish),
    ...state.milestones.map((m) => m.planned),
    ...(times.length ? [dayOf(new Date(Math.max(...times)).toISOString(), tz)] : []),
  ];
  return {
    first: times.length ? dayOf(new Date(Math.min(...times)).toISOString(), tz) : null,
    last: days.length ? days.reduce(later) : null,
  };
}

/**
 * Owner rule (round 24): the range always covers every event, work item and milestone on screen, so
 * nothing is ever missing from the graph; a given window only widens, with a margin, to reach them.
 */
function windowDays(
  state: TrackerState,
  view: View,
  infos: Map<string, ItemInfo>,
): { start: string; end: string } {
  const tz = view.timeZone;
  const today = dayOf(view.asOf, tz);
  const { first, last } = spanDays(state, infos, view.asOf, tz);
  let start = view.windowStart ?? addDays(first ?? today, -START_MARGIN_DAYS);
  if (first && compareDay(first, start) < 0) start = addDays(first, -START_MARGIN_DAYS);
  let end =
    view.windowEnd ?? (last ? later(addDays(last, 3), addDays(today, 7)) : addDays(today, 7));
  if (last && compareDay(last, end) >= 0) end = addDays(last, 3);
  return { start, end: compareDay(end, start) > 0 ? end : addDays(start, 1) };
}

const START_MARGIN_DAYS = 3;

/** The project's window start, moved earlier when a work item or an event lies before it. */
export function windowStartFor(
  state: Pick<TrackerState, 'workItems' | 'events'>,
  windowStart: string | null | undefined,
  asOf: string,
  timeZone: string,
): string | undefined {
  if (!windowStart) return undefined;
  const startMs = Date.parse(startOfDayInstant(windowStart, timeZone));
  const infos = new Map(state.workItems.map((w) => [w.id, itemInfo(w, state.events, asOf)]));
  let earliest = Infinity;
  for (const w of state.workItems) earliest = Math.min(earliest, itemStartMs(w, infos, asOf));
  for (const e of state.events) earliest = Math.min(earliest, Date.parse(e.at));
  if (!(earliest < startMs)) return windowStart;
  return addDays(dayOf(new Date(earliest).toISOString(), timeZone), -START_MARGIN_DAYS);
}

// Advance widths of Geist 10.5px weight 600 capitals with 0.07em letter spacing, as the browser
// measured them, so the pure layout can cut a team name before the buttons of its summary row.
const CAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CAP_W = [
  8.2, 8, 8.4, 8.3, 7.2, 6.9, 8.4, 8.2, 3.7, 7.1, 7.7, 6.7, 10.1, 8.5, 8.8, 7.6, 8.7, 8, 7.8, 7,
  8.2, 8.1, 11.1, 7.7, 7.4, 6.8, 8.1, 4.9, 7.5, 7.5, 7.5, 7.7, 7.2, 6.6, 7.5, 7.3,
];
const PUNCT_W: Record<string, number> = { ' ': 3, '·': 3.1, '.': 3.1, ',': 3.1, "'": 2.8, '…': 8 };
const WIDE = 8.8;
// The " · N" count after the name is weight 500 with no letter spacing.
const COUNT_SEP = 7.5;
const digitWidth = (d: string) => (d === '1' ? 4.1 : 6.8);
// The name ends 6 units before the focus button (16 wide, centred 43 left of X0), or before the eye.
const NAME_ROOM = X0 - 43 - 8 - 6 - 24;
const FOCUS_BUTTON_ROOM = 19;
// A Comfortable row name letter takes about 6.6 units; the names start at 28 and the lanes at 24.
const ROW_CHAR = 6.6;
const ROW_LABEL_X = 28;
const LANE_LABEL_X = 24;
const NARROW_END = 4;
const MAX_DEPTH = 3;

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** User-perceived characters in NFC, so a cut never splits a surrogate pair or drops a mark. */
function graphemes(text: string): string[] {
  const nfc = text.normalize('NFC');
  return segmenter ? Array.from(segmenter.segment(nfc), (g) => g.segment) : Array.from(nfc);
}

function glyphWidth(g: string): number {
  const base = g.normalize('NFD')[0];
  const i = CAPS.indexOf(base);
  return i >= 0 ? CAP_W[i] : (PUNCT_W[base] ?? (/[-/()]/.test(base) ? 5.1 : WIDE));
}

/** The width of a lane name in capitals, or with `count` of its " · N" part. */
export function laneNameWidth(text: string, count = false): number {
  if (count)
    return [...text].reduce((w, ch) => w + (/\d/.test(ch) ? digitWidth(ch) : 0), COUNT_SEP);
  return graphemes(text).reduce((w, g) => w + glyphWidth(g), 0);
}

/** Cuts a lane name by grapheme to `room` units, ending with an ellipsis when it is cut. */
export function cutToWidth(text: string, room: number): string {
  const parts = graphemes(text);
  if (laneNameWidth(text) <= room) return parts.join('');
  let w = PUNCT_W['…'];
  let n = 0;
  while (n < parts.length && w + glyphWidth(parts[n]) <= room) w += glyphWidth(parts[n++]);
  return `${parts.slice(0, n).join('').trimEnd()}…`;
}

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

function summaryOf(c: Ctx, name: string, shown: WorkItem[]): LayoutTeamSummary {
  let late = 0;
  let done = 0;
  let cancelled = 0;
  let changed = false;
  for (const w of shown) {
    const info = c.infos.get(w.id)!;
    changed ||=
      !!c.marks?.workItems.has(w.id) ||
      !!c.marks?.dates.has(w.id) ||
      info.events.some((e) => c.marks?.events.has(e.id));
    if (info.cancelled) cancelled += 1;
    else if (info.done) done += 1;
    else if (itemStatus(w, c.eventsOf(w.id), c.view.asOf, c.tz) === 'late') late += 1;
  }
  const notYet = shown.length - late - done - cancelled;
  const count = shown.length;
  const parts = [
    ...(late ? [`${late} late`] : []),
    ...(notYet ? [`${notYet} not yet`] : []),
    ...(done ? [`${done} done`] : []),
    ...(cancelled ? [`${cancelled} cancelled`] : []),
    ...(changed ? ['changed in this change request'] : []),
  ];
  return {
    count,
    late,
    notYet,
    done,
    cancelled,
    changed,
    ariaLabel: `${name}, ${count} work item${count === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}`,
  };
}

function placeRows(c: Ctx): { lanes: LayoutLane[]; height: number } {
  const { state, view, level } = c;
  const lanes: LayoutLane[] = [];
  const labelChars = Math.round(
    ((view.focusButtons ? 24 : 26) * ROW_LEVELS.comfortable.font) / level.font,
  );
  const narrow = view.side !== undefined && view.side < SIDE ? view.side : null;
  const narrowChar = (ROW_CHAR * level.font) / ROW_LEVELS.comfortable.font;
  let y = TOP;
  for (const team of state.teams) {
    const members = state.workItems.filter((w) => w.teamId === team.id && c.inWindow.has(w.id));
    const shown = members.filter((w) => !c.hidden.has(w.id) && !c.outside.has(w.id));
    if (view.hiddenTeams.has(team.id)) continue;
    if (!shown.length && (members.length || view.focus || view.focusTeam || view.filter)) continue;
    const collapsed = !!view.collapsedTeams?.has(team.id) && shown.length > 0;
    const top = y;
    y += level.head;
    if (collapsed) for (const w of shown) c.folded.add(w.id);
    else
      for (const { w, depth } of treeOrder(shown)) {
        const info = c.infos.get(w.id)!;
        const focused = view.focus === w.id;
        c.rows.set(w.id, {
          id: w.id,
          teamId: team.id,
          title: w.title,
          label: trunc(
            w.title,
            narrow
              ? Math.floor((narrow - NARROW_END - ROW_LABEL_X - depth * INDENT) / narrowChar)
              : labelChars - 2 * depth,
          ),
          y: y + level.row / 2,
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
        y += level.row;
      }
    if (!shown.length) y += 18;
    y += collapsed ? 2 : 6;
    const lastY = collapsed ? 0 : Math.max(0, ...shown.map((w) => c.rows.get(w.id)!.y));
    const index = lanes.length;
    const summary = summaryOf(c, team.name, shown);
    const countRoom = laneNameWidth(` · ${shown.length}`, true);
    const room =
      (narrow
        ? narrow - NARROW_END - LANE_LABEL_X
        : view.focusButtons
          ? NAME_ROOM
          : NAME_ROOM + FOCUS_BUTTON_ROOM) - countRoom;
    lanes.push({
      teamId: team.id,
      name: team.name,
      label: cutToWidth(team.name.toUpperCase(), room),
      index,
      top,
      bottom: y,
      head: level.head,
      collapsed,
      summary,
      alt: index % 2 === 1,
      guide: lastY ? { y1: top + level.head - 4, y2: lastY } : null,
      eyeLabel: `Hide ${team.name}`,
      focused: view.focusTeam === team.id,
      focusLabel: `Focus on ${team.name}`,
    });
  }
  return { lanes, height: y + 56 };
}

function itemStartMs(w: WorkItem, infos: ReadonlyMap<string, ItemInfo>, asOfIso: string): number {
  const info = infos.get(w.id)!;
  if (info.start) return Date.parse(info.start);
  // A cancelled source delivers nothing, so its cancel never starts the receiver.
  const ends = w.after
    .map((id) => infos.get(id))
    .flatMap((i) => (i?.finishedAt && !i.cancelled ? [Date.parse(i.finishedAt)] : []));
  const sourcesDone = ends.length ? Math.max(...ends) : null;
  const asOf = Date.parse(asOfIso);
  // A demo project keeps asOf in the past while the item is placed today, so since can lie after the T line.
  if (w.since) return Math.max(Math.min(Date.parse(w.since), asOf), sourcesDone ?? 0);
  return sourcesDone ?? asOf - EMPTY_LEAD;
}

const startOf = (c: Ctx, w: WorkItem) => itemStartMs(w, c.infos, c.view.asOf);

function linesOf(c: Ctx, shown: LayoutRow[]): LayoutSegment[] {
  const segments: LayoutSegment[] = [];
  for (const r of shown) {
    const w = c.items.get(r.id)!;
    const info = c.infos.get(r.id)!;
    const sx = Math.max(X0, c.x(startOf(c, w)));
    if (info.start === null) {
      const sources = w.after.map((id) => c.items.get(id)).filter((p): p is WorkItem => !!p);
      const short = (list: WorkItem[]) => list.map((p) => p.title.split(' ')[0]).join(', ');
      const waits = sources.filter((p) => !c.infos.get(p.id)!.done);
      const gone = sources.filter((p) => c.infos.get(p.id)!.cancelled);
      const parts = [
        ...(waits.length ? [`Waiting for ${short(waits)}`] : []),
        ...(gone.length ? [`${short(gone)} ${gone.length > 1 ? 'were' : 'was'} cancelled`] : []),
      ];
      const text = parts.length ? parts.join(' · ') : 'No events yet';
      segments.push({
        kind: 'wait',
        workItemId: w.id,
        x1: sx,
        x2: c.xt,
        y: r.y,
        tone: 'ink-3',
        text,
        textX: sx + 8,
        textY: r.y - c.level.waitRise,
      });
      continue;
    }
    const endAt = Date.parse(info.end ?? c.view.asOf);
    const lateFrom = c.lateFrom(w);
    const line = (x1: number, x2: number, tone: Tone) =>
      segments.push({ kind: 'line', workItemId: w.id, x1, x2, y: r.y, tone });
    if (endAt > lateFrom && !info.cancelled) {
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

// A done source ends in its Done icon; an open one ends at the T line, where an editor has the + button.
const MARK_AFTER_OPEN = 32;
/** The + button of an editable view sits this far right of the T line. */
export const PLUS_GAP = 20;

function handoffEventOf(
  c: Ctx,
  id: string,
  groups: LayoutEventGroup[],
): { id: string; group: LayoutEventGroup } | null {
  const ev = c.infos
    .get(id)!
    .events.filter((e) => e.kind === 'handoff')
    .at(-1);
  const group = ev && groups.find((g) => g.workItemId === id && g.eventIds.includes(ev.id));
  return ev && group ? { id: ev.id, group } : null;
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
    const { finishedAt, cancelled } = c.infos.get(src)!;
    // A cancelled source is not a delivery, even when it had a Handoff before the cancel.
    const handoff = cancelled ? null : handoffEventOf(c, src, groups);
    const wait = !finishedAt && !handoff;
    const end = wait ? c.xt : c.x(Date.parse(finishedAt ?? c.view.asOf));
    const { r, mark, markWide } = c.level;
    const afterDone = r + 2;
    const width = handoff ? 2 * r : list.length > 1 ? markWide : mark;
    const after = end + (wait ? MARK_AFTER_OPEN : afterDone);
    // Near the right edge the mark goes left of the end, so the graph never cuts it.
    const before = end - afterDone - width;
    const x = handoff ? handoff.group.x - r : after + width <= c.width - 2 ? after : before;
    const targets = list.map((w) => {
      const team = teamName.get(w.teamId)!;
      const text = cancelled
        ? `Cancelled · ${w.title} no longer gets it from here`
        : wait
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
      groupId: handoff?.group.topId ?? null,
      x,
      y: handoff ? sr.y - r : sr.y - mark / 2,
      width,
      height: handoff ? 2 * r : mark,
      dir: ups.every(Boolean) ? 'up' : ups.some(Boolean) ? 'both' : 'down',
      tone: cancelled ? 'isolated' : wait ? 'danger' : 'proceed',
      wait,
      cancelled,
      ariaLabel:
        lines.length > 1
          ? `${cancelled ? `${source.title} was cancelled, ${lines.length} work items` : `${lines.length} handoffs from ${source.title}`}: ${lines.join('; ')}`
          : lines[0],
      tooltip: lines.join('\n'),
    };
  });
}

/** Owner rule: done after the deadline, or open while now or its own planned day is past it. */
function makesLate(c: Ctx, w: WorkItem, m: Milestone): boolean {
  const info = c.infos.get(w.id)!;
  const deadline = milestoneDeadline(m, c.tz);
  if (info.cancelled) return false;
  if (info.finishedAt) return Date.parse(info.finishedAt) > deadline;
  return Date.parse(c.view.asOf) > deadline || itemDeadline(w, c.tz) > deadline;
}

type Span = [number, number];
const LABEL_GAP = 9;
// At 9.5 px a name letter takes about 5.4 units; smaller rows scale it with their font.
const LABEL_CHAR = 5.4 / 9.5;
export const WAIT_CHAR = 5.6;

/**
 * What already sits on each row near the line, so the milestone name goes only where it is free.
 * The Dense name sits on the row centre, so there the line itself is busy too.
 */
function busyOf(
  level: RowLevel,
  segments: LayoutSegment[],
  groups: LayoutEventGroup[],
  handoffs: LayoutHandoff[],
  chips: LayoutChip[],
): Map<string, Span[]> {
  const busy = new Map<string, Span[]>();
  const add = (id: string | undefined, span: Span) => {
    if (id) busy.set(id, [...(busy.get(id) ?? []), span]);
  };
  const room = level.r + 1;
  for (const g of groups) add(g.workItemId, [g.x - room, g.x + room]);
  for (const h of handoffs) add(h.fromId, [h.x - 2, h.x + h.width + 2]);
  for (const ch of chips) add(ch.workItemId, [ch.x - 2, ch.x + ch.size + 2]);
  for (const s of segments) {
    if (s.kind === 'wait' && level.waitText)
      add(s.workItemId, [s.textX - 2, s.textX + s.text.length * WAIT_CHAR]);
    if (level.nameRise < 0) add(s.workItemId, [s.x1 - 2, s.x2 + 2]);
  }
  return busy;
}

/**
 * A handoff mark, a chip or the + button of the row sits on the waiting text, so the text starts
 * after it. Near the right edge the text ends with an ellipsis, before or after the marks, on the
 * side with more room.
 */
function waitsClearOfMarks(
  c: Ctx,
  segments: LayoutSegment[],
  handoffs: LayoutHandoff[],
  chips: LayoutChip[],
): LayoutSegment[] {
  const marks = new Map<string, Span[]>();
  const add = (id: string, span: Span) => marks.set(id, [...(marks.get(id) ?? []), span]);
  for (const h of handoffs) add(h.fromId, [h.x - 4, h.x + h.width + 4]);
  for (const ch of chips) add(ch.workItemId, [ch.x - 4, ch.x + ch.size + 4]);
  // The + buttons of this row and the row above sit at the same x, so they count as a mark.
  const plus = c.xt + PLUS_GAP;
  const plusSpan: Span = [plus - c.level.plus - 2, plus + c.level.plus + 4];
  return segments.map((s) => {
    if (s.kind !== 'wait') return s;
    // The T line runs through every row, so a text that crosses it reads as struck through.
    const tSpan: Span = [c.xt - 4, c.xt + 4];
    const spans = [
      ...(marks.get(s.workItemId) ?? []),
      tSpan,
      ...(c.view.plusButtons ? [plusSpan] : []),
    ];
    const width = s.text.length * WAIT_CHAR;
    let x = s.textX;
    let first: Span | null = null;
    for (const span of spans.sort((a, b) => a[0] - b[0]))
      if (x < span[1] && x + width > span[0]) {
        first ??= span;
        x = span[1];
      }
    if (!first) return s;
    const after = c.width - 2 - x;
    if (width <= after) return { ...s, textX: x };
    const before = first[0] - s.textX;
    const [room, textX] = before >= after ? [before, s.textX] : [after, x];
    const cut = (from: number, space: number) => ({
      ...s,
      textX: from,
      text: `${s.text.slice(0, Math.floor(space / WAIT_CHAR) - 1).trimEnd()}…`,
    });
    if (room >= MIN_CUT * WAIT_CHAR) return cut(textX, room);
    // No room beside the marks: the text moves left over the empty time line and ends before them.
    const floor = Math.max(X0 + 2, ...spans.filter(([, b]) => b <= first[0]).map(([, b]) => b));
    const from = Math.max(floor, first[0] - width);
    return first[0] - from >= width ? { ...s, textX: from } : cut(from, first[0] - from);
  });
}

const MIN_CUT = 8;
const T_ROOM = 3;

/**
 * The full name on the right of the mark, else on its left, else the longer of the two cut with an
 * ellipsis. The T line counts as busy, so a name never sits across it.
 */
function placeName(
  c: Ctx,
  name: string,
  x: number,
  rowBusy: readonly Span[],
): { label: string; side: 'start' | 'end' } | null {
  const spans: Span[] = [...rowBusy, [c.xt - T_ROOM, c.xt + T_ROOM]];
  const char = LABEL_CHAR * c.level.nameFont;
  const inside = (at: number) => spans.some(([p, q]) => p <= at && at <= q);
  const a = x + LABEL_GAP;
  const b = x - LABEL_GAP;
  const right = inside(a)
    ? 0
    : Math.min(c.width - 2, ...spans.filter(([p]) => p > a).map(([p]) => p - 1)) - a;
  const left = inside(b)
    ? 0
    : b - Math.max(X0, ...spans.filter(([, q]) => q < b).map(([, q]) => q + 1));
  const fit = (room: number) => {
    if (name.length * char <= room) return name;
    const n = Math.floor(room / char) - 1;
    return n >= MIN_CUT ? `${name.slice(0, n).trimEnd()}…` : null;
  };
  const full = name.length * char;
  const side: 'start' | 'end' | null =
    full <= right
      ? 'start'
      : full <= left
        ? 'end'
        : fit(Math.max(right, left))
          ? right >= left
            ? 'start'
            : 'end'
          : null;
  if (!side) return null;
  return { label: fit(side === 'start' ? right : left)!, side };
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
    const placed = first ? placeName(c, m.name, x, busy.get(r.id) ?? []) : null;
    const side = placed?.side ?? null;
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
        label: placed?.label ?? null,
        labelX: side === 'end' ? x - LABEL_GAP : x + LABEL_GAP,
        labelY: r.y - c.level.nameRise,
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
  const where = (id: string) => {
    if (c.hidden.has(id)) return 'hidden';
    if (!c.folded.has(id)) return before;
    const teamId = c.items.get(id)!.teamId;
    return `in ${c.state.teams.find((t) => t.id === teamId)?.name ?? 'a team'}, collapsed`;
  };
  const sx = Math.max(X0, c.x(startOf(c, w)));
  const size = c.level.chip;
  return {
    workItemId: w.id,
    sources,
    ariaLabel: `Show ${titles.join(', ')}`,
    tooltip: sources.map((id, i) => `From ${titles[i]} (${where(id)})`).join('\n'),
    x: Math.max(SIDE + 2, sx - size - 8),
    y: r.y - size / 2,
    size,
  };
}

/** The first day of a month from `start` on whose month number is a multiple of `months` plus 1. */
function nextMonthStart(start: string, months: number): string {
  let [y, m] = start.split('-').map(Number);
  do {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  } while ((m - 1) % months !== 0);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function addMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** The shortest step whose shortest gap still holds a label, so neighbouring dates never touch. */
function tickStep(dayWidth: number): {
  first: (start: string) => string;
  next: (d: string) => string;
} {
  const weekly = (days: number) => ({
    first: (start: string) => {
      const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
      return addDays(start, (8 - weekday) % 7 || 7);
    },
    next: (d: string) => addDays(d, days),
  });
  const monthly = (months: number) => ({
    first: (start: string) => nextMonthStart(start, months),
    next: (d: string) => addMonths(d, months),
  });
  // A tick on the first day would sit on the label column and lose half its date.
  if (dayWidth >= TICK_ROOM)
    return { first: (start) => addDays(start, 1), next: (d) => addDays(d, 1) };
  if (7 * dayWidth >= TICK_ROOM) return weekly(7);
  if (14 * dayWidth >= TICK_ROOM) return weekly(14);
  if (28 * dayWidth >= TICK_ROOM) return monthly(1);
  if (89 * dayWidth >= TICK_ROOM) return monthly(3);
  return monthly(12);
}

function ticksOf(c: Ctx, start: string, endMs: number): LayoutTick[] {
  const ticks: LayoutTick[] = [];
  const step = tickStep(c.x(c.dayStart(addDays(start, 1))) - c.x(c.startMs));
  for (let d = step.first(start); c.dayStart(d) < endMs; d = step.next(d)) {
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
  const groups: Array<{ x: number; events: TrackerEvent[] }> = [];
  for (const e of info.events) {
    const ex = c.x(Date.parse(e.at));
    const last = groups.at(-1);
    if (last && ex - last.x < c.level.gap) {
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

// Half the status circle (radius 8) and a gap, so a label below the axis never runs over a marker.
const MS_MARKER = 12;
const MS_LABEL_GAP = 8;

type MsSpot = { level: 0 | 1; right: boolean; x0: number; x1: number; text: string };
/** `texts` runs from the whole label to the name alone (QA 19 Oct, M1: drop the status, then the date). */
type MsDraft = { m: Milestone; mx: number; texts: string[]; preferRight: boolean };

const MS_CHAR = 5.9;
const msWidth = (text: string) => text.length * MS_CHAR;

function* cutNames(name: string) {
  for (let n = name.length - 1; n > 0; n -= 1) yield `${name.slice(0, n).trimEnd()}…`;
}

/**
 * Each label tries, in order: above the axis on its usual side, below it, then the other side. A
 * spot is free when no label on its line is near and, below the axis, no marker is under it. When
 * no spot is free the label gets shorter (no status, then no date, then a cut name) and, with no
 * room at all, it shows no text; the full label stays in its accessible name. Labels never overlap.
 * The deadline order and the reverse order both run; the one that shortens less wins.
 */
function placeMilestoneLabels(c: Ctx, drafts: readonly MsDraft[]): Map<string, MsSpot> {
  const markers = drafts.map((d) => d.mx);
  const spotOf = (d: MsDraft, level: 0 | 1, right: boolean, text: string): MsSpot => {
    const w = msWidth(text);
    const x0 = right ? d.mx - MS_GAP - w : d.mx + MS_GAP;
    return { level, right, x0, x1: x0 + w, text };
  };
  const covers = (spot: MsSpot, own: number) =>
    spot.level === 1 &&
    markers.some((x) => x !== own && spot.x0 < x + MS_MARKER && spot.x1 > x - MS_MARKER);
  const inside = (spot: MsSpot) => spot.x0 >= X0 && spot.x1 <= c.x1;
  const run = (order: readonly MsDraft[]) => {
    const placed = new Map<string, MsSpot>();
    let cost = 0;
    for (const d of order) {
      const near = (spot: MsSpot) =>
        [...placed.values()].some(
          (p) =>
            p.text !== '' &&
            p.level === spot.level &&
            spot.x0 < p.x1 + MS_LABEL_GAP &&
            spot.x1 > p.x0 - MS_LABEL_GAP,
        );
      // A label never starts under the pinned names or runs past the edge, as nothing may be hidden.
      const fits = (text: string) =>
        [
          spotOf(d, 0, d.preferRight, text),
          spotOf(d, 1, d.preferRight, text),
          spotOf(d, 0, !d.preferRight, text),
          spotOf(d, 1, !d.preferRight, text),
        ].find((spot) => inside(spot) && !near(spot) && !covers(spot, d.mx));
      let spot: MsSpot | undefined;
      let step = 0;
      for (const text of [...d.texts, ...cutNames(d.m.name)]) {
        spot = fits(text);
        if (spot) break;
        step += 1;
      }
      cost += step;
      placed.set(d.m.id, spot ?? { ...spotOf(d, 0, d.preferRight, ''), text: '' });
    }
    return { placed, cost };
  };
  const forward = run(drafts);
  if (!forward.cost) return forward.placed;
  const backward = run([...drafts].reverse());
  return backward.cost < forward.cost ? backward.placed : forward.placed;
}

function placeMilestones(c: Ctx, statusOf: Map<string, MsStatus>): LayoutMilestone[] {
  const sorted = [...c.state.milestones].sort(
    (a, b) => milestoneDeadline(a, c.tz) - milestoneDeadline(b, c.tz),
  );
  const drafts = sorted.map((m): MsDraft => {
    const { status } = statusOf.get(m.id)!;
    const previous = c.marks?.dates.has(`ms:${m.id}`) ? m.moves.at(-1) : undefined;
    const was = previous ? ` (was ${formatDeadline(previous.from, previous.fromTime)})` : '';
    const date = formatDeadline(m.planned, m.plannedTime);
    const mx = c.deadlineX(m);
    const full = `${m.name} · ${date} · ${STATUS_LABEL[status]}${was}`;
    return {
      m,
      mx,
      texts: [full, `${m.name} · ${date}${was}`, m.name],
      preferRight: mx > c.x1 - 280,
    };
  });
  const spots = placeMilestoneLabels(c, drafts);
  return drafts.map(({ m, mx, texts }): LayoutMilestone => {
    const { status } = statusOf.get(m.id)!;
    const tone = STATUS_TONE[status];
    const changed = !!c.marks?.milestones.has(m.id);
    const { level, right, x0, x1, text } = spots.get(m.id)!;
    return {
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
      label: text,
      ariaLabel: texts[0],
      labelX: right ? mx - MS_GAP : mx + MS_GAP,
      labelY: level ? TRUNK_Y + 13 : MS_Y,
      anchor: right ? 'end' : 'start',
      level,
      labelBox: { x0, x1 },
    };
  });
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
  const inWindow = new Set(infos.keys());
  const items = new Map(state.workItems.map((w) => [w.id, w]));
  const hidden = new Set(
    [...inWindow].filter((id) => {
      const w = items.get(id)!;
      return view.hiddenRows.has(id) || view.hiddenTeams.has(w.teamId);
    }),
  );
  const focus = view.focus && items.has(view.focus) ? view.focus : null;
  const focusTeam =
    !focus && view.focusTeam && state.teams.some((t) => t.id === view.focusTeam)
      ? view.focusTeam
      : null;
  const inFocus = focus
    ? descendantsOf(state, focus)
    : focusTeam
      ? teamDescendants(state, focusTeam)
      : null;
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
  const level = ROW_LEVELS[view.density ?? 'comfortable'];
  const c: Ctx = {
    state,
    view: { ...view, focus, focusTeam, filter },
    level,
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
    folded: new Set(),
    eventsOf,
    rows: new Map(),
    name: (id) => people.get(id) ?? id,
    dayStart,
    deadlineX: (m) => Math.min(x1 - 4, x(milestoneDeadline(m, tz))),
    lateFrom: (w) => itemDeadline(w, tz),
  };
  const { lanes, height } = placeRows(c);
  const shown = [...c.rows.values()].sort((a, b) => a.y - b.y);
  const lines = linesOf(c, shown);
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
  const segments = waitsClearOfMarks(c, lines, handoffs, chips);
  const busy = busyOf(level, segments, eventGroups, handoffs, chips);
  if (view.plusButtons) {
    const plus = c.xt + PLUS_GAP;
    for (const r of shown)
      if (!r.done)
        busy.set(r.id, [...(busy.get(r.id) ?? []), [plus - level.plus - 2, plus + level.plus + 2]]);
  }
  return {
    level,
    side: view.side ?? SIDE,
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
      height: l.head - 4,
      text: `Drop here: ${l.name}`,
      textX: X0 + 10,
      textY: l.top + l.head / 2 + 4,
    })),
  };
}
