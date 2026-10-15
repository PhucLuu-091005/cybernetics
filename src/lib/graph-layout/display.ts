import type { ActGlyph, BranchLayout, GraphLayout } from '../../contracts/layout';
import { CARD_MIN_ZOOM } from './viewport';

/** Screen sizes that hold at every zoom (owner decisions, 15 Oct 2026). */
export const SCREEN_MIN = {
  /** Two rows of one lane. */
  row: 22,
  /** A row and the border of its lane. */
  edge: 8,
  /** The trunk band under the date axis. */
  trunkBand: 30,
  line: 2.5,
  trunk: 4.5,
  icon: 14,
} as const;
const AXIS_HEIGHT = 26,
  TRUNK_BAND = 58;

/** Per department: how much the user stretched (above 1) or squeezed (below 1) its lane. */
export type LaneScale = Readonly<Record<string, number>>;

/** A layout length that is never thinner than `min` screen px at this zoom. */
export const atLeast = (length: number, min: number, zoom: number) => Math.max(length, min / zoom);

type Band = { top: number; bottom: number; keys: number[]; out: number[] };

/**
 * Where the canvas draws a layout y. The trunk moves to the top, under the date axis, and the lanes keep
 * their order below it. Each lane can be stretched, and with the cards hidden its rows keep `SCREEN_MIN`.
 */
export function displayY(
  layout: GraphLayout,
  zoom: number,
  laneScale: LaneScale = {},
): { y: (value: number) => number; height: number; trunkY: number } {
  const compact = zoom < CARD_MIN_ZOOM;
  const gap = (length: number, min: number) => (compact ? atLeast(length, min, zoom) : length);
  const trunkY = AXIS_HEIGHT + gap(TRUNK_BAND, SCREEN_MIN.trunkBand) / 2;
  const rows = new Set(layout.branches.map((branch) => branch.y));
  const lanes = [...layout.lanes].sort((a, b) => a.y - b.y);
  const bands: Band[] = [];
  let at = trunkY * 2 - AXIS_HEIGHT;
  for (const lane of lanes) {
    const bottom = lane.y + lane.height;
    const inside = [...rows].filter((y) => y > lane.y && y < bottom).sort((a, b) => a - b);
    const keys = [lane.y, ...inside, bottom];
    const gaps = keys
      .slice(1)
      .map((key, index) =>
        gap(
          key - keys[index],
          index === 0 || index === keys.length - 2 ? SCREEN_MIN.edge : SCREEN_MIN.row,
        ),
      );
    const scale = laneScale[lane.departmentId] ?? 1;
    const out = [at];
    for (const length of gaps) out.push(out[out.length - 1] + length * scale);
    bands.push({ top: lane.y, bottom, keys, out });
    at = out[out.length - 1];
  }
  const y = (value: number) => {
    if (value === layout.trunkY) return trunkY;
    const band = bands.find((item) => value >= item.top && value <= item.bottom);
    if (!band) return value < (bands[0]?.top ?? 0) ? value : trunkY;
    const { keys, out } = band;
    let index = 1;
    while (index < keys.length - 1 && keys[index] < value) index++;
    const span = keys[index] - keys[index - 1] || 1;
    return out[index - 1] + ((value - keys[index - 1]) / span) * (out[index] - out[index - 1]);
  };
  return { y, height: at + gap(16, SCREEN_MIN.edge), trunkY };
}

// Layout paths use absolute M, L, H, V, C, S, Q and T only, so each number is an x or a y by its place.
export function mapPathY(path: string, y: (value: number) => number): string {
  let command = '',
    place = 0;
  const num = (value: number) => String(Math.round(value * 100) / 100);
  return path.replace(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g, (token) => {
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      place = 0;
      return token;
    }
    const value = Number(token),
      isY = command === 'V' || (command !== 'H' && place % 2 === 1);
    place++;
    return isY ? num(y(value)) : token;
  });
}

/** The layout as the canvas draws it at this zoom; x never changes. */
export function displayLayout(
  layout: GraphLayout,
  zoom: number,
  laneScale: LaneScale = {},
): GraphLayout {
  const { y, height, trunkY } = displayY(layout, zoom, laneScale);
  const glyph = (item: ActGlyph): ActGlyph => ({
    ...item,
    y: y(item.y),
    card: item.card && { x: item.card.x, y: y(item.card.y) },
  });
  const branch = (item: BranchLayout): BranchLayout => ({
    ...item,
    y: y(item.y),
    path: mapPathY(item.path, y),
    glyphs: item.glyphs.map(glyph),
    breakdownMarkers: item.breakdownMarkers.map((marker) => ({ ...marker, y: y(marker.y) })),
  });
  return {
    ...layout,
    height,
    trunkY,
    lanes: layout.lanes.map((lane) => {
      const top = y(lane.y);
      return { ...lane, y: top, height: y(lane.y + lane.height) - top };
    }),
    branches: layout.branches.map(branch),
    milestones: layout.milestones.map((item) => ({
      ...item,
      y: trunkY,
      slipPath: item.slipPath && mapPathY(item.slipPath, y),
    })),
    gateways: layout.gateways.map((item) => ({ ...item, y: y(item.y) })),
    connectors: layout.connectors.map((item) => ({
      ...item,
      path: mapPathY(item.path, y),
      note: item.note && { ...item.note, y: y(item.note.y) },
    })),
  };
}

// A stack shows its most telling event; on a tie, the latest one.
const PRIORITY: Partial<Record<ActGlyph['type'], number>> = {
  reject: 6,
  decline: 5,
  cancel: 5,
  report_done: 4,
  accept: 4,
  renegotiate: 3,
  counter: 3,
  agree_change: 3,
  promise: 2,
};

export type GlyphStack = { lead: ActGlyph; glyphs: ActGlyph[] };

/** Icons of one branch closer than an icon on screen merge into one stack, so none hides another. */
export function stackGlyphs(glyphs: readonly ActGlyph[], zoom: number): GlyphStack[] {
  const reach = (SCREEN_MIN.icon * 0.9) / zoom;
  const groups: ActGlyph[][] = [];
  for (const item of [...glyphs].sort((a, b) => a.x - b.x)) {
    const last = groups[groups.length - 1];
    if (last && item.x - last[last.length - 1].x < reach) last.push(item);
    else groups.push([item]);
  }
  return groups.map((group) => ({
    lead: group.reduce((best, item) =>
      (PRIORITY[item.type] ?? 1) >= (PRIORITY[best.type] ?? 1) ? item : best,
    ),
    glyphs: group,
  }));
}
