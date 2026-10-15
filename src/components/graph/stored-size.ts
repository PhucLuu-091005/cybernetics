'use client';
import { useCallback, useEffect, useState } from 'react';

/** A width the user dragged, remembered per browser. `null` means the CSS default applies. */
export function useStoredSize(
  key: string,
  min: number,
  max: number,
): [number | null, (value: number | null, done: boolean) => void] {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      // Blocked storage: the CSS default applies.
    }
    const value = stored === null ? NaN : Number(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(value)) setSize(Math.min(max, Math.max(min, value)));
  }, [key, min, max]);
  const update = useCallback(
    (value: number | null, done: boolean) => {
      const next = value === null ? null : Math.round(Math.min(max, Math.max(min, value)));
      setSize(next);
      if (!done) return;
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(next));
      } catch {
        // Blocked storage keeps the width for this page view only.
      }
    },
    [key, min, max],
  );
  return [size, update];
}
