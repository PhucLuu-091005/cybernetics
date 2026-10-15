'use client';
import type { PointerEvent } from 'react';
import type { GraphContext } from '../../contracts/graph';
import type { TimeScale, Viewport } from '../../lib/graph-layout';

// A "22 Sept" label needs about 44 px on screen; the T badge is 88 px wide.
const LABEL_SPACE = 48,
  T_HALF = 44,
  // A handle needs a few pixels between two others to stay grabbable; under 12 px the borders read as hatching.
  HANDLE_MIN_DAY = 8,
  BORDER_MIN_DAY = 12;

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const nextDate = (date: string) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

/**
 * Day columns only (owner decision, 15 Oct 2026). Each column has a resize handle on its right edge;
 * a double-click on the handle gives the column its default width back.
 */
export function TimeAxis({
  context,
  scale,
  T,
  tLabel,
  viewport,
  width,
  onResize,
}: {
  context: GraphContext;
  scale: TimeScale;
  T: string;
  tLabel: string;
  viewport: Viewport;
  width: number;
  onResize(date: string, width: number | null, done: boolean): void;
}) {
  const days: { date: string; left: number; width: number; label: boolean; first: boolean }[] = [];
  let lastLabel = -Infinity;
  for (let date = context.windowStart; date <= context.windowEnd; date = nextDate(date)) {
    const left = viewport.x + scale.dateStartX(date) * viewport.zoom,
      size = (scale.dateEndX(date) - scale.dateStartX(date)) * viewport.zoom;
    if (left + size < 0 || left > width) continue;
    const label = left - lastLabel >= LABEL_SPACE;
    if (label) lastLabel = left;
    days.push({ date, left, width: size, label, first: date.endsWith('-01') });
  }
  const startResize = (event: PointerEvent<HTMLDivElement>, date: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget,
      x0 = event.clientX,
      width0 = scale.dateEndX(date) - scale.dateStartX(date);
    handle.setPointerCapture(event.pointerId);
    const widthAt = (clientX: number) => width0 + (clientX - x0) / viewport.zoom;
    const onMove = (move: globalThis.PointerEvent) => onResize(date, widthAt(move.clientX), false);
    const onUp = (up: globalThis.PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      onResize(date, widthAt(up.clientX), true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };
  const xT = viewport.x + scale.x(T) * viewport.zoom;
  return (
    <div className="time-axis" data-testid="time-axis" style={{ width }}>
      {days.map((day) => (
        <div
          key={day.date}
          className={`axis-day${day.first ? ' first' : ''}${day.width < BORDER_MIN_DAY ? ' thin' : ''}`}
          data-date={day.date}
          style={{ left: day.left, width: day.width }}
        >
          {day.label && <span>{dayLabel(day.date)}</span>}
          {day.width >= HANDLE_MIN_DAY && (
            <div
              className="axis-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${dayLabel(day.date)}`}
              title="Drag to resize this day; double-click to reset it"
              onPointerDown={(event) => startResize(event, day.date)}
              onDoubleClick={() => onResize(day.date, null, true)}
            />
          )}
        </div>
      ))}
      <div className="axis-t" style={{ left: xT - T_HALF, width: T_HALF * 2 }}>
        T {tLabel}
      </div>
    </div>
  );
}
