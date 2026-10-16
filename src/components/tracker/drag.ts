import {
  addDays,
  compareDay,
  dayOf,
  GEOMETRY,
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

const { X1 } = GEOMETRY;
// The hit boxes that TrackerGraph draws: the milestone `ms-hit`, the row `hit` and the lane `lane-drop`.
const MS_HIT = 15;
// The label is part of the milestone group, so the prototype drops on its 11 px text too.
const LABEL_UP = 11;
const LABEL_DOWN = 3;
const ROW_X0 = 22;
const ROW_X1 = X1 + 8;
const ROW_HALF = 15;
const SIDEWAYS = 40;
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
    (r) => r.fold === null && p.x >= ROW_X0 && p.x <= ROW_X1 && Math.abs(p.y - r.y) <= ROW_HALF,
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
  dx = 0,
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
      if (Math.abs(dx) > SIDEWAYS)
        return {
          kind: 'hint',
          text: 'An event stays at the time it happened. Drag it up or down to another work item.',
        };
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
  return Math.min(X1 - 4, layout.x(Date.parse(startOfDayInstant(date, tz)) + 12 * HOUR));
}

/** The first and last day of the window stay out of reach, as in the prototype. */
export function dayAtX(layout: TrackerLayout, x: number, tz: string): string {
  const day = dayOf(new Date(layout.t(x)).toISOString(), tz);
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
  const svg = el.closest('svg.pg');
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
        ? root.querySelector(`svg.pg [data-ms="${target.id}"]`)
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
  onStart: () => void;
  onMove: (event: PointerEvent) => void;
  onDrop: (event: PointerEvent, dx: number, dy: number) => void;
  onCancel: () => void;
};

// pointercancel ends without a drop: on touch it means the browser took the gesture to scroll.
export function trackPointer(start: { clientX: number; clientY: number }, t: PointerTrack) {
  const { clientX: sx, clientY: sy } = start;
  let active = false;
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, { capture: true });
  };
  const move = (event: PointerEvent) => {
    if (!active) {
      const far =
        t.axis === 'x'
          ? Math.abs(event.clientX - sx) >= t.threshold
          : Math.hypot(event.clientX - sx, event.clientY - sy) >= t.threshold;
      if (!far) return;
      active = true;
      t.onStart();
    }
    t.onMove(event);
  };
  const up = (event: PointerEvent) => {
    stop();
    if (active) t.onDrop(event, event.clientX - sx, event.clientY - sy);
  };
  const cancel = () => {
    stop();
    if (active) t.onCancel();
  };
  // Capture on window runs before the screen's own Escape handler, so Esc ends only the drag.
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !active) return;
    event.stopPropagation();
    event.preventDefault();
    cancel();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, { capture: true });
  return stop;
}
