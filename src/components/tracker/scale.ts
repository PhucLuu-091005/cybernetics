import { useCallback, useState } from 'react';
import type { View } from '../../tracker';

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
