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

export const GEOMETRY = {
  VW: 1060,
  X0: 236,
  X1: 1046,
  AXIS_Y: 15,
  MS_Y: 33,
  TRUNK_Y: 48,
  ROW: 32,
  HEAD: 22,
  FOLD: 13,
} as const;

const { VW, X0, X1, AXIS_Y, MS_Y, TRUNK_Y, ROW, HEAD, FOLD } = GEOMETRY;
const HOUR = 3_600_000;
const GROUP_GAP = 16;
const EMPTY_LEAD = 48 * HOUR;

export type Tone =
  'proceed' | 'route' | 'danger' | 'caution' | 'teal' | 'ink-2' | 'ink-3' | 'draft';

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
export type LayoutLane = {
  teamId: string;
  name: string;
  index: number;
  top: number;
  bottom: number;
  alt: boolean;
  hidden: boolean;
  count: number;
  hiddenCount: number;
  guide: { y1: number; y2: number } | null;
  eyeLabel: string;
};
export type LayoutRow = {
  id: string;
  teamId: string;
  title: string;
  label: string;
  y: number;
  fold: 'row' | 'team' | null;
  done: boolean;
  status: Status;
  milestoneId: string | null;
  draft: boolean;
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
  draft: boolean;
  ariaLabel: string;
  tooltip: string;
};
export type LayoutFlag = {
  workItemId: string;
  date: string;
  x: number;
  y: number;
  status: Status;
  tone: Tone;
  draft: boolean;
  moves: number;
  ariaLabel: string;
  tooltip: string;
};
export type LayoutSlip = {
  workItemId: string;
  from: string;
  to: string;
  x1: number;
  x2: number;
  y: number;
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
  ghost: boolean;
  wait: boolean;
};
export type LayoutMsLink = Curve & { workItemId: string; milestoneId: string; tone: Tone };
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
  draft: boolean;
  label: string;
  ariaLabel: string;
  labelX: number;
  labelY: number;
  anchor: 'start' | 'end';
  level: 0 | 1;
  labelBox: { x0: number; x1: number };
};
type FoldBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  textY: number;
  text: string;
  ariaLabel: string;
};
export type LayoutFold =
  | (FoldBox & { kind: 'team'; teamId: string; count: number })
  | (FoldBox & { kind: 'row'; workItemId: string; iconX: number });
export type LayoutChip = {
  workItemId: string;
  sources: string[];
  label: string;
  ariaLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  width: number;
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
  flags: LayoutFlag[];
  slips: LayoutSlip[];
  stems: LayoutStem[];
  links: LayoutLink[];
  msLinks: LayoutMsLink[];
  trunk: LayoutTrunk;
  trunkSegments: LayoutTrunkSegment[];
  milestones: LayoutMilestone[];
  folds: LayoutFold[];
  chips: LayoutChip[];
  laneDrops: LayoutLaneDrop[];
};

type Ctx = {
  state: TrackerState;
  view: View;
  marks: Marks | undefined;
  tz: string;
  startMs: number;
  xt: number;
  x: (t: number) => number;
  items: Map<string, WorkItem>;
  infos: Map<string, ItemInfo>;
  inWindow: Set<string>;
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

function placeRows(c: Ctx): { lanes: LayoutLane[]; height: number } {
  const { state, view } = c;
  const lanes: LayoutLane[] = [];
  let y = TRUNK_Y + 16;
  state.teams.forEach((team, index) => {
    const top = y;
    const hidden = view.hiddenTeams.has(team.id);
    const members = state.workItems.filter((w) => w.teamId === team.id && c.inWindow.has(w.id));
    y += HEAD;
    const row = (w: WorkItem, rowY: number, fold: LayoutRow['fold']) => {
      const info = c.infos.get(w.id)!;
      c.rows.set(w.id, {
        id: w.id,
        teamId: team.id,
        title: w.title,
        label: trunc(w.title, 26),
        y: rowY,
        fold,
        done: info.done,
        status: itemStatus(w, c.eventsOf(w.id), view.asOf, c.tz),
        milestoneId: w.milestoneId,
        draft: !!c.marks?.workItems.has(w.id),
        eyeLabel: `Hide ${w.title}`,
      });
    };
    if (hidden) {
      members.forEach((w) => row(w, y + FOLD / 2, 'team'));
      if (members.length) y += FOLD + 2;
    } else {
      for (const w of members) {
        if (view.hiddenRows.has(w.id)) {
          row(w, y + FOLD / 2, 'row');
          y += FOLD;
        } else {
          row(w, y + ROW / 2, null);
          y += ROW;
        }
      }
      if (!members.length) y += 18;
    }
    y += 6;
    const lastY = Math.max(0, ...members.map((w) => c.rows.get(w.id)!.y));
    lanes.push({
      teamId: team.id,
      name: team.name,
      index,
      top,
      bottom: y,
      alt: index % 2 === 1,
      hidden,
      count: members.length,
      hiddenCount: members.filter((w) => hidden || view.hiddenRows.has(w.id)).length,
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
  let y1: number = TRUNK_Y;
  let ghost = false;
  if (parentId) {
    const pr = c.rows.get(parentId);
    if (pr) {
      y1 = pr.y;
      ghost = pr.fold !== null;
    } else {
      ghost = true;
      addChip(w.id, parentId);
    }
  }
  const tone: Tone = ghost || info.start === null ? 'ink-3' : baseTone(info);
  return { workItemId: w.id, parentId, x: sx, y1, y2: r.y, tone, ghost };
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
      const ghost = sr.fold !== null;
      const wait = !si.finishedAt;
      const path = si.finishedAt
        ? curve(c.x(Date.parse(si.finishedAt)), sr.y, begin, r.y)
        : straight(c.xt, sr.y, c.xt, r.y);
      const tone: Tone = ghost ? 'ink-3' : wait ? 'danger' : 'proceed';
      links.push({ fromId: src, toId: w.id, tone, ghost, wait, ...path });
    }
  }
  return links;
}

function milestoneLinks(c: Ctx, shown: LayoutRow[]): LayoutMsLink[] {
  const byId = new Map(c.state.milestones.map((m) => [m.id, m]));
  return shown.flatMap((r) => {
    const m = r.milestoneId ? byId.get(r.milestoneId) : undefined;
    if (!m) return [];
    const w = c.items.get(r.id)!;
    const info = c.infos.get(r.id)!;
    const mx = c.noonX(m.planned);
    const ex = info.start === null ? c.xt : c.x(Date.parse(info.end ?? c.view.asOf));
    const after = (day: string) => compareDay(day, m.planned) > 0;
    let tone: Tone = 'ink-2';
    if (info.finishedAt) {
      if (after(dayOf(info.finishedAt, c.tz))) tone = 'caution';
    } else if (after(w.plannedFinish)) tone = 'danger';
    return [
      {
        workItemId: w.id,
        milestoneId: m.id,
        tone,
        from: { x: ex, y: r.y },
        c1: { x: ex, y: r.y - 30 },
        c2: { x: mx, y: TRUNK_Y + 34 },
        to: { x: mx, y: TRUNK_Y + 8 },
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

function flagOf(c: Ctx, w: WorkItem, r: LayoutRow): LayoutFlag {
  const label = STATUS_LABEL[r.status];
  const moved = w.moves.length ? ` · moved ${w.moves.length}×` : '';
  return {
    workItemId: w.id,
    date: w.plannedFinish,
    x: c.noonX(w.plannedFinish),
    y: r.y,
    status: r.status,
    tone: STATUS_TONE[r.status],
    draft: !!c.marks?.dates.has(w.id),
    moves: w.moves.length,
    ariaLabel: `Planned finish ${formatDay(w.plannedFinish)}, ${label}`,
    tooltip: `Planned finish ${formatDay(w.plannedFinish)} · ${label}${moved}`,
  };
}

function chipOf(c: Ctx, w: WorkItem, r: LayoutRow, sources: string[]): LayoutChip {
  const titles = sources.map((id) => c.items.get(id)!.title);
  const text =
    sources.length === 1
      ? `from ${trunc(titles[0], 24)} (hidden)`
      : `from ${sources.length} hidden items`;
  const width = text.length * 5.6 + 22;
  const sx = Math.max(X0, c.x(startOf(c, w)));
  return {
    workItemId: w.id,
    sources,
    label: `↖ ${text}`,
    ariaLabel: `Show ${titles.join(', ')}`,
    x: Math.min(sx + 6, X1 - width),
    y: r.y - 26,
    width,
    height: 15,
  };
}

function ticksOf(c: Ctx, start: string, endMs: number): LayoutTick[] {
  const ticks: LayoutTick[] = [];
  const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
  for (let d = addDays(start, (8 - weekday) % 7); c.dayStart(d) < endMs; d = addDays(d, 7)) {
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
    const more = events.length > 1 ? `\n${events.length} events on this day` : '';
    return {
      workItemId: w.id,
      eventIds: events.map((e) => e.id),
      topId: top.id,
      kind: top.kind,
      x,
      y: r.y,
      tone: Date.parse(top.at) > lateFrom ? lateTone(info) : baseTone(info),
      draft: events.some((e) => c.marks?.events.has(e.id)),
      ariaLabel: `${KIND_LABEL[top.kind]} by ${who}, ${stamp}`,
      tooltip: `${KIND_LABEL[top.kind]} · ${who} · ${stamp}\n${top.text}${more}`,
    };
  });
}

function placeMilestones(c: Ctx, statusOf: Map<string, MsStatus>): LayoutMilestone[] {
  const placed: LayoutMilestone[] = [];
  const sorted = [...c.state.milestones].sort((a, b) => compareDay(a.planned, b.planned));
  for (const m of sorted) {
    const { status } = statusOf.get(m.id)!;
    const tone = STATUS_TONE[status];
    const draft = !!c.marks?.milestones.has(m.id);
    const mx = c.noonX(m.planned);
    const right = mx > X1 - 280;
    const label = `${m.name} · ${formatDay(m.planned)} · ${STATUS_LABEL[status]}`;
    const w = label.length * 5.9;
    const x0 = right ? mx - 13 - w : mx + 13;
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
      stroke: draft ? 'draft' : tone,
      labelTone: draft ? 'draft' : tone,
      filled: status !== 'planned',
      draft,
      label,
      ariaLabel: label,
      labelX: right ? mx - 13 : mx + 13,
      labelY: level ? TRUNK_Y + 17 : MS_Y,
      anchor: right ? 'end' : 'start',
      level,
      labelBox: { x0, x1 },
    });
  }
  return placed;
}

function foldsOf(c: Ctx): LayoutFold[] {
  const folds: LayoutFold[] = [];
  const teamsDone = new Set<string>();
  for (const r of c.rows.values()) {
    if (r.fold === 'team') {
      if (teamsDone.has(r.teamId)) continue;
      teamsDone.add(r.teamId);
      const team = c.state.teams.find((tm) => tm.id === r.teamId)!;
      const count = [...c.rows.values()].filter(
        (x) => x.teamId === r.teamId && x.fold === 'team',
      ).length;
      folds.push({
        kind: 'team',
        teamId: r.teamId,
        count,
        x: 22,
        y: r.y - FOLD / 2,
        width: X1 - 22,
        height: FOLD,
        textX: 30,
        textY: r.y + 3.5,
        text: `${plural(count, 'hidden item')} in ${team.name}. Click to show.`,
        ariaLabel: `Show ${team.name}`,
      });
    } else if (r.fold === 'row') {
      folds.push({
        kind: 'row',
        workItemId: r.id,
        x: 30,
        y: r.y - FOLD / 2 + 1,
        width: X1 - 30,
        height: FOLD - 2,
        iconX: 38,
        textX: 48,
        textY: r.y + 3.5,
        text: `${trunc(r.title, 40)} (hidden)`,
        ariaLabel: `Show ${r.title}`,
      });
    }
  }
  return folds;
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
  const x = (t: number) => X0 + ((t - startMs) / (endMs - startMs)) * (X1 - X0);
  const t = (px: number) => startMs + ((px - X0) / (X1 - X0)) * (endMs - startMs);
  const people = new Map(state.people.map((p) => [p.id, p.name]));
  const c: Ctx = {
    state,
    view,
    marks,
    tz,
    startMs,
    xt: x(Date.parse(view.asOf)),
    x,
    items: new Map(state.workItems.map((w) => [w.id, w])),
    infos,
    inWindow: new Set(
      [...infos]
        .filter(([, i]) => !(i.finishedAt && Date.parse(i.finishedAt) < startMs))
        .map(([id]) => id),
    ),
    eventsOf,
    rows: new Map(),
    name: (id) => (id === 'agent' ? 'Agent' : (people.get(id) ?? id)),
    dayStart,
    noonX: (date) => Math.min(X1 - 4, x(dayStart(date) + 12 * HOUR)),
    lateFrom: (w) => dayStart(addDays(w.plannedFinish, 1)),
  };
  const { lanes, height } = placeRows(c);
  const shown = [...c.rows.values()].filter((r) => r.fold === null);
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
    width: VW,
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
    rows: [...c.rows.values()],
    segments,
    eventGroups: shown.flatMap((r) => groupsOf(c, item(r), r, infos.get(r.id)!)),
    flags: shown.map((r) => flagOf(c, item(r), r)),
    slips: shown.flatMap((r) => {
      const w = item(r);
      if (w.firstPlannedFinish === w.plannedFinish) return [];
      const from = w.firstPlannedFinish;
      const to = w.plannedFinish;
      return [{ workItemId: w.id, from, to, x1: c.noonX(from), x2: c.noonX(to), y: r.y - 12 }];
    }),
    stems,
    links,
    msLinks: milestoneLinks(c, shown),
    trunk: { x1: X0, x2: X1, y: TRUNK_Y },
    trunkSegments: trunkSegmentsOf(c, statusOf),
    milestones: placeMilestones(c, statusOf),
    folds: foldsOf(c),
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
        width: X1 - X0,
        height: 18,
        text: `Drop here: ${l.name}`,
        textX: X0 + 10,
        textY: l.top + 15,
      })),
  };
}
