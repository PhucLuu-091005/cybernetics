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
