import { describe, expect, it } from 'vitest';
import { zoomTarget } from '../../../src/components/tracker/scale';
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
