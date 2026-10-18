'use client';
import type { GraphLayout } from '../../contracts/layout';
import type { Viewport } from '../../lib/graph-layout';

// A "22 Sept" label needs about 44 px on screen; the T badge is 88 px wide.
const LABEL_SPACE = 48,
  T_HALF = 44,
  // Under 12 px the day borders read as hatching.
  BORDER_MIN_DAY = 12;

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** Day columns only (owner decision, 15 Oct 2026). */
export function TimeAxis({
  days: columns,
  xT: tAt,
  tLabel,
  viewport,
  width,
}: {
  days: GraphLayout['days'];
  xT: number;
  tLabel: string;
  viewport: Viewport;
  width: number;
}) {
  const days: { date: string; left: number; width: number; label: boolean; first: boolean }[] = [];
  let lastLabel = -Infinity;
  for (const column of columns) {
    const date = column.date,
      left = viewport.x + column.x * viewport.zoom,
      size = column.width * viewport.zoom;
    if (left + size < 0 || left > width) continue;
    const label = left - lastLabel >= LABEL_SPACE;
    if (label) lastLabel = left;
    days.push({ date, left, width: size, label, first: date.endsWith('-01') });
  }
  const xT = viewport.x + tAt * viewport.zoom;
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
        </div>
      ))}
      <div className="axis-t" style={{ left: xT - T_HALF, width: T_HALF * 2 }}>
        T {tLabel}
      </div>
    </div>
  );
}
