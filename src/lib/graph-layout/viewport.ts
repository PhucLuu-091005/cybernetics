export type Viewport = { x: number; y: number; zoom: number };
export type Box = { x0: number; x1: number; y0: number; y1: number };
export type Size = { width: number; height: number };

// Days wide enough for their cards make a long timeline; 2 % still fits a five-month project on one screen.
export const MIN_ZOOM = 0.02,
  MAX_ZOOM = 4;
export const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
// The canvas scale at 100 %: a day column wide enough for its "22 Sept" label, and a row.
export const BASE_PX_PER_DAY = 64,
  BASE_ROW_HEIGHT = 64;
/** Event card size in layout px (owner decision, 14 Oct 2026). */
export const CARD = { width: 176, height: 108, gap: 10 } as const;
// Cards are unreadable below this zoom; only the event icons show.
export const CARD_MIN_ZOOM = 0.45;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function fitViewport(box: Box, size: Size, padding = 32, maxZoom = MAX_ZOOM): Viewport {
  const width = box.x1 - box.x0,
    height = box.y1 - box.y0;
  const zoom = clamp(
    Math.min((size.width - padding * 2) / width, (size.height - padding * 2) / height),
    MIN_ZOOM,
    maxZoom,
  );
  return {
    zoom,
    x: (size.width - width * zoom) / 2 - box.x0 * zoom,
    y: (size.height - height * zoom) / 2 - box.y0 * zoom,
  };
}

export function nextZoom(zoom: number, direction: 1 | -1): number {
  return direction > 0
    ? (ZOOM_STEPS.find((step) => step > zoom + 1e-3) ?? MAX_ZOOM)
    : ([...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-3) ?? MIN_ZOOM);
}

export function zoomAround(
  view: Viewport,
  zoom: number,
  point: { x: number; y: number },
): Viewport {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const worldX = (point.x - view.x) / view.zoom,
    worldY = (point.y - view.y) / view.zoom;
  return { zoom: next, x: point.x - worldX * next, y: point.y - worldY * next };
}

export type Lod = 0 | 1 | 2;
// Under 60 % the 11 px titles fall below 7 px; under 80 % the 10 px labels fall below 8 px.
export const lodOf = (zoom: number): Lod => (zoom >= 0.8 ? 2 : zoom >= 0.6 ? 1 : 0);
