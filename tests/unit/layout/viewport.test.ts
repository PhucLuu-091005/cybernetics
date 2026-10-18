import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitViewport,
  lodOf,
  nextZoom,
  zoomAround,
} from '../../../src/lib/graph-layout';

const size = { width: 1000, height: 600 };

describe('viewport helpers', () => {
  it('fits a box inside the canvas with padding and centres it', () => {
    const v = fitViewport({ x0: 0, x1: 1872, y0: 0, y1: 468 }, size, 32);
    expect(v.zoom).toBeCloseTo(0.5, 5);
    expect(v.x + 936 * v.zoom).toBeCloseTo(500, 5);
    expect(v.y + 234 * v.zoom).toBeCloseTo(300, 5);
  });
  it('stops a fit at the maximum zoom', () => {
    expect(fitViewport({ x0: 0, x1: 10, y0: 0, y1: 10 }, size, 48, 1.5).zoom).toBe(1.5);
    expect(fitViewport({ x0: 0, x1: 1e6, y0: 0, y1: 10 }, size).zoom).toBe(MIN_ZOOM);
  });
  it('steps through the zoom steps', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(0.9, 1)).toBe(1);
    expect(nextZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
  it('keeps the point under the pointer when it zooms', () => {
    const v = zoomAround({ x: 10, y: 20, zoom: 1 }, 2, { x: 110, y: 220 });
    expect(v).toEqual({ x: -90, y: -180, zoom: 2 });
    expect(zoomAround({ x: 0, y: 0, zoom: 1 }, 99, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
  it('shows titles from 60 % and labels from 80 %', () => {
    expect([lodOf(0.4), lodOf(0.6), lodOf(0.79), lodOf(0.8), lodOf(2)]).toEqual([0, 1, 1, 2, 2]);
  });
});
