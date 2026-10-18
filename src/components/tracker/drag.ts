import {
  addDays,
  compareDay,
  dayOf,
  deadlineMs,
  startOfDayInstant,
  type Point,
  type TrackerLayout,
  type TrackerState,
} from '../../tracker';
import type { OpInput } from './api';

export type DropTarget =
  | { type: 'bin' }
  | { type: 'ms'; id: string }
  | { type: 'lane'; teamId: string }
  | { type: 'loop'; id: string };

export type DragSource =
  | { kind: 'queueEvent'; id: string }
  | { kind: 'queueItem'; id: string }
  | { kind: 'event'; id: string; from: string }
  | { kind: 'row'; id: string };

export type DropAction =
  | { kind: 'none' }
  | { kind: 'op'; op: OpInput }
  | { kind: 'fromEvent'; eventId: string; teamId: string }
  | { kind: 'dismiss'; id: string }
  | { kind: 'hint'; text: string };

// The hit boxes that TrackerGraph draws: the milestone `ms-hit`, the row `hit` and the lane `lane-drop`.
const MS_HIT = 15;
// The label is part of the milestone group, so the prototype drops on its 11 px text too.
const LABEL_UP = 11;
const LABEL_DOWN = 3;
const ROW_X0 = 22;
const ROW_PAST_END = 8;
const ROW_HALF = 15;
const HOUR = 3_600_000;

const inBox = (p: Point, b: { x: number; y: number; width: number; height: number }) =>
  p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** The SVG draws the milestones last, so a milestone wins over a row or a team under it. */
export function targetAt(layout: TrackerLayout, p: Point): DropTarget | null {
  const ms = [...layout.milestones]
    .reverse()
    .find(
      (m) =>
        (Math.abs(p.x - m.x) <= MS_HIT && Math.abs(p.y - m.y) <= MS_HIT) ||
        (p.x >= m.labelBox.x0 &&
          p.x <= m.labelBox.x1 &&
          p.y >= m.labelY - LABEL_UP &&
          p.y <= m.labelY + LABEL_DOWN),
    );
  if (ms) return { type: 'ms', id: ms.id };
  const drop = layout.laneDrops.find((d) => inBox(p, d));
  if (drop) return { type: 'lane', teamId: drop.teamId };
  const row = layout.rows.find(
    (r) => p.x >= ROW_X0 && p.x <= layout.x1 + ROW_PAST_END && Math.abs(p.y - r.y) <= ROW_HALF,
  );
  if (row) return { type: 'loop', id: row.id };
  const lane = layout.lanes.find((l) => p.y >= l.top && p.y < l.bottom);
  return lane ? { type: 'lane', teamId: lane.teamId } : null;
}

/** A queue work item goes onto a team, so a row under the pointer stands for its team. */
export function retarget(
  source: DragSource,
  target: DropTarget | null,
  state: TrackerState,
): DropTarget | null {
  if (source.kind !== 'queueItem' || target?.type !== 'loop') return target;
  const item = state.workItems.find((w) => w.id === target.id);
  return item ? { type: 'lane', teamId: item.teamId } : null;
}

const NONE: DropAction = { kind: 'none' };

export function dropAction(
  source: DragSource,
  target: DropTarget | null,
  state: TrackerState,
): DropAction {
  switch (source.kind) {
    case 'queueEvent':
      if (target?.type === 'loop')
        return {
          kind: 'op',
          op: { op: 'attach', a: { eventId: source.id, workItemId: target.id } },
        };
      if (target?.type === 'lane')
        return { kind: 'fromEvent', eventId: source.id, teamId: target.teamId };
      if (target?.type === 'bin') return { kind: 'dismiss', id: source.id };
      return NONE;
    case 'queueItem':
      if (target?.type === 'lane')
        return { kind: 'op', op: { op: 'place', a: { itemId: source.id, teamId: target.teamId } } };
      if (target?.type === 'ms')
        return { kind: 'op', op: { op: 'qms', a: { itemId: source.id, milestoneId: target.id } } };
      if (target?.type === 'bin') return { kind: 'dismiss', id: source.id };
      return NONE;
    case 'event':
      if (target?.type === 'loop' && target.id !== source.from)
        return { kind: 'op', op: { op: 'move', a: { eventId: source.id, to: target.id } } };
      if (target?.type === 'bin')
        return { kind: 'op', op: { op: 'hide', a: { eventId: source.id } } };
      return NONE;
    case 'row': {
      if (!target) return NONE;
      if (target.type !== 'ms')
        return {
          kind: 'hint',
          text: 'Drop a work item name on a milestone diamond to add it to that milestone.',
        };
      const item = state.workItems.find((w) => w.id === source.id);
      if (!item || item.milestoneId === target.id) return NONE;
      return {
        kind: 'op',
        op: { op: 'msAdd', a: { workItemId: source.id, milestoneId: target.id } },
      };
    }
  }
}

export function noonX(layout: TrackerLayout, date: string, tz: string): number {
  return Math.min(layout.x1 - 4, layout.x(Date.parse(startOfDayInstant(date, tz)) + 12 * HOUR));
}

export function deadlineX(
  layout: TrackerLayout,
  date: string,
  time: string | null | undefined,
  tz: string,
): number {
  return Math.min(layout.x1 - 4, layout.x(deadlineMs(date, time, tz)));
}

const dayPart = (at: 'noon' | 'end' | string) => {
  if (at === 'noon') return 12 * HOUR;
  if (at === 'end') return 24 * HOUR;
  const [h, m] = at.split(':').map(Number);
  return h * HOUR + m * 60_000;
};

/**
 * `at` is where the mark sits inside its day (noon, the end, or a time), so the day changes halfway
 * between two marks. The first and last day of the window stay out of reach, as in the prototype.
 */
export function dayAtX(
  layout: TrackerLayout,
  x: number,
  tz: string,
  at: 'noon' | 'end' | string = 'noon',
): string {
  const t = layout.t(x) - dayPart(at) + 12 * HOUR;
  const day = dayOf(new Date(t).toISOString(), tz);
  const first = addDays(layout.window.start, 1);
  const last = addDays(layout.window.end, -1);
  if (compareDay(day, first) < 0) return first;
  if (compareDay(day, last) > 0) return last;
  return day;
}

export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: Number.NaN, y: Number.NaN };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** The bin and the graph sit under a drawer or a pop, so the element under the pointer decides first. */
export function targetUnder(
  root: Element,
  layout: TrackerLayout,
  clientX: number,
  clientY: number,
): DropTarget | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el || !root.contains(el)) return null;
  if (el.closest('.bin')) return { type: 'bin' };
  const svg = el.closest('svg.tg');
  if (!(svg instanceof SVGSVGElement)) return null;
  return targetAt(layout, svgPoint(svg, clientX, clientY));
}

export function markTarget(root: Element, target: DropTarget | null, from: string | null) {
  root.querySelectorAll('.glow').forEach((n) => n.classList.remove('glow'));
  if (!target) return;
  const el =
    target.type === 'bin'
      ? root.querySelector('.bin')
      : target.type === 'ms'
        ? root.querySelector(`svg.tg [data-ms="${target.id}"]`)
        : target.type === 'lane'
          ? root.querySelector(`svg.pg [data-lane="${target.teamId}"]`)
          : target.id !== from
            ? root.querySelector(`svg.pg [data-loop="${target.id}"]`)
            : null;
  el?.classList.add('glow');
}

export type PointerTrack = {
  /** Pixels the pointer moves before the drag starts; `x` counts only the horizontal move. */
  threshold: number;
  axis: 'any' | 'x';
  onStart: (event: PointerEvent) => void;
  onMove: (event: PointerEvent) => void;
  onDrop: (event: PointerEvent, dx: number, dy: number) => void;
  onCancel: () => void;
  /** The button came up after a drag, so a click follows that must not reach the page. */
  onRelease?: () => void;
};

type Start = { clientX: number; clientY: number; pointerId: number };

/**
 * pointercancel, a lost button (released outside the window) and a window blur end without a drop:
 * on touch, pointercancel means the browser took the gesture to scroll. After Esc the release still
 * counts, because its click lands on whatever is under the pointer.
 */
export function trackPointer(start: Start, t: PointerTrack, target: EventTarget = window) {
  const { clientX: sx, clientY: sy, pointerId } = start;
  let active = false;
  const on = (type: string, fn: (event: Event) => void, capture = false) => {
    target.addEventListener(type, fn, { capture });
    return () => target.removeEventListener(type, fn, { capture });
  };
  const mine = (event: Event) => (event as PointerEvent).pointerId === pointerId;
  let offs: Array<() => void> = [];
  const stop = () => {
    offs.forEach((off) => off());
    offs = [];
  };
  const cancel = () => {
    stop();
    if (active) t.onCancel();
  };
  const move = (raw: Event) => {
    const event = raw as PointerEvent;
    if (!mine(event)) return;
    if (event.buttons === 0) return cancel();
    if (!active) {
      const far =
        t.axis === 'x'
          ? Math.abs(event.clientX - sx) >= t.threshold
          : Math.hypot(event.clientX - sx, event.clientY - sy) >= t.threshold;
      if (!far) return;
      active = true;
      t.onStart(event);
    }
    t.onMove(event);
  };
  const up = (raw: Event) => {
    const event = raw as PointerEvent;
    if (!mine(event)) return;
    stop();
    if (!active) return;
    t.onDrop(event, event.clientX - sx, event.clientY - sy);
    t.onRelease?.();
  };
  // Capture runs before the screen's own Escape handler, so Esc ends only the drag.
  const key = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (event.key !== 'Escape' || !active) return;
    event.stopPropagation();
    event.preventDefault();
    cancel();
    // A release outside the window never arrives here; the next press ends the wait instead.
    offs = [
      on('pointerup', (e) => {
        if (!mine(e)) return;
        stop();
        t.onRelease?.();
      }),
      on('pointerdown', stop),
      on('pointercancel', stop),
      on('blur', stop),
    ];
  };
  offs = [
    on('pointermove', move),
    on('pointerup', up),
    on('pointercancel', (e) => mine(e) && cancel()),
    on('blur', cancel),
    on('keydown', key, true),
  ];
  return stop;
}
