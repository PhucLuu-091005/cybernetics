import { describe, expect, it } from 'vitest';
import {
  OPEN_DAYS,
  OPEN_MIN_DAY_WIDTH,
  openScale,
  zoomTarget,
} from '../../../src/components/tracker/scale';
import { GEOMETRY } from '../../../src/tracker/layout';

const { MIN_DAY_WIDTH, MAX_DAY_WIDTH } = GEOMETRY;

describe('zoomTarget: the next day width of a zoom step', () => {
  it('fits again with a factor of 0, also under the floor', () => {
    expect(zoomTarget({ fitDayWidth: 30 }, 90, 0)).toBe(30);
    expect(zoomTarget({ fitDayWidth: 0.5 }, 3, 0)).toBe(0.5);
  });

  it('stops zooming out at the fit, or at the current width when it is already below', () => {
    expect(zoomTarget({ fitDayWidth: 30 }, 40, 1 / 1.5)).toBe(30);
    expect(zoomTarget({ fitDayWidth: 30 }, 20, 1 / 1.5)).toBe(20);
    expect(zoomTarget({ fitDayWidth: 0.5 }, 0.6, 1 / 1.5)).toBe(0.5);
  });

  it('zooms in up to the ceiling', () => {
    expect(zoomTarget({ fitDayWidth: 30 }, 30, 1.5)).toBe(45);
    expect(zoomTarget({ fitDayWidth: 30 }, 400, 1.5)).toBe(MAX_DAY_WIDTH);
    expect(zoomTarget({ fitDayWidth: 5 }, 1, 1.5)).toBe(MIN_DAY_WIDTH);
  });
});

describe('openScale: the first view of a graph', () => {
  const DAY = 86_400_000;
  const T = Date.parse('2026-10-09T11:00:00Z');
  const layout = (days: number, fitDayWidth: number) => {
    const startMs = T - (days - 10) * DAY;
    return {
      fitDayWidth,
      window: { startMs, endMs: startMs + days * DAY },
      tLine: { x: 500 },
      t: () => T,
    };
  };

  it('shows the last weeks up to a week after T on a long window, and ends a week after T', () => {
    const open = openScale(layout(100, 9.5));
    expect(open.dayWidth).toBeCloseTo((9.5 * 100) / OPEN_DAYS, 9);
    expect(open.rightMs).toBe(T + 7 * DAY);
  });

  it('keeps the fit when the whole window is short enough to read', () => {
    expect(openScale(layout(37, 22)).dayWidth).toBe(22);
  });

  it('never opens narrower than a readable week on a phone', () => {
    expect(openScale(layout(100, 1.5)).dayWidth).toBe(OPEN_MIN_DAY_WIDTH);
  });
});
