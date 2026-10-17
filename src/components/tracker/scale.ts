import { useCallback, useState } from 'react';
import { clampDayWidth, type TrackerLayout, type View } from '../../tracker';

export type TimeScale = Pick<View, 'span' | 'fitSpan' | 'dayWidth'>;

/** The first measured width fixes the fit, so a later wider graph shows more time, not bigger marks. */
export function useTimeScale() {
  const [scale, setScale] = useState<TimeScale>({});
  const onSpan = useCallback(
    (span: number) =>
      setScale((s) =>
        span < 1 || s.span === span ? s : { ...s, span, fitSpan: s.fitSpan ?? span },
      ),
    [],
  );
  const onZoom = useCallback((dayWidth: number) => setScale((s) => ({ ...s, dayWidth })), []);
  return { scale, onSpan, onZoom };
}

/** A factor of 0 fits again; zooming out stops at the fit, or where it is when already below. */
export function zoomTarget(
  L: Pick<TrackerLayout, 'fitDayWidth'>,
  from: number,
  factor: number,
): number {
  if (factor === 0) return L.fitDayWidth;
  const next = clampDayWidth(from * factor, L.fitDayWidth);
  return factor < 1 ? Math.max(next, Math.min(L.fitDayWidth, from)) : next;
}

const DAY = 86_400_000;
/** The first view shows five weeks before T and one after, so recent work reads at a calm scale. */
export const OPEN_DAYS = 42;
const OPEN_AFTER_T = 7 * DAY;
/** A week this wide holds its date label, also on a phone. */
export const OPEN_MIN_DAY_WIDTH = 10;

/** The day width of the first view and the moment at its right edge; Fit still shows the whole window. */
export function openScale(
  L: Pick<TrackerLayout, 'fitDayWidth' | 't'> & {
    window: Pick<TrackerLayout['window'], 'startMs' | 'endMs'>;
    tLine: Pick<TrackerLayout['tLine'], 'x'>;
  },
): { dayWidth: number; rightMs: number } {
  const visible = (L.fitDayWidth * (L.window.endMs - L.window.startMs)) / DAY;
  const want = Math.max(visible / OPEN_DAYS, OPEN_MIN_DAY_WIDTH);
  return {
    dayWidth: want <= L.fitDayWidth ? L.fitDayWidth : clampDayWidth(want, L.fitDayWidth),
    rightMs: L.t(L.tLine.x) + OPEN_AFTER_T,
  };
}
