import type { BranchLayout, GraphLayout } from '../../contracts/layout';
import { branchPath } from './path';

export type LayoutOffsets = {
  /** Position of the dot inside its local day: 0 = day start, 1 = day end. */
  acts: Record<string, number>;
  /** Vertical shift of the branch line in px. Positive moves down. */
  loops: Record<string, number>;
};
export const NO_OFFSETS: LayoutOffsets = { acts: {}, loops: {} };

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
// Half a pixel short of the next day, so a dot at the right edge never reads as the next date.
const DAY_EDGE = 0.5;

export function actXInDay(dayStartX: number, dayEndX: number, fraction: number): number {
  return round(clamp(dayStartX + fraction * (dayEndX - dayStartX), dayStartX, dayEndX - DAY_EDGE));
}

export function applyLayoutOffsets(
  layout: GraphLayout,
  offsets: LayoutOffsets,
  rowHeight: number,
): GraphLayout {
  const lanes = new Map(layout.lanes.map((lane) => [lane.departmentId, lane]));
  let changed = false;
  const branches = layout.branches.map((branch): BranchLayout => {
    const shift = offsets.loops[branch.loopId];
    const moved = branch.glyphs.some((glyph) => offsets.acts[glyph.id] !== undefined);
    const lane = lanes.get(branch.departmentId);
    if ((shift === undefined && !moved) || !lane) return branch;
    changed = true;
    // The card shelves above the line must stay inside the lane too.
    const cardTop = Math.min(
      branch.y - rowHeight / 2,
      ...branch.glyphs.map((glyph) => glyph.card?.y ?? Infinity),
    );
    const y =
      shift === undefined
        ? branch.y
        : round(
            clamp(
              branch.y + shift,
              lane.y + (branch.y - cardTop),
              lane.y + lane.height - rowHeight / 2,
            ),
          );
    const dy = y - branch.y;
    const glyphs = branch.glyphs.map((glyph) => {
      const fraction = offsets.acts[glyph.id];
      const x =
        fraction === undefined ? glyph.x : actXInDay(glyph.dayStartX, glyph.dayEndX, fraction);
      return {
        ...glyph,
        y,
        x,
        ...(glyph.card
          ? { card: { x: round(glyph.card.x + x - glyph.x), y: round(glyph.card.y + dy) } }
          : {}),
      };
    });
    const xs = glyphs.map((glyph) => glyph.x);
    const xStart = Math.min(branch.xStart, ...xs),
      xEnd = Math.max(branch.xEnd, ...xs);
    const segments = branch.segments.map((segment, index, all) => ({
      ...segment,
      startX: index === 0 ? Math.min(segment.startX, xStart) : segment.startX,
      endX: index === all.length - 1 ? Math.max(segment.endX, xEnd) : segment.endX,
    }));
    return {
      ...branch,
      y,
      xStart,
      xEnd,
      glyphs,
      segments,
      breakdownMarkers: branch.breakdownMarkers.map((marker) => ({ ...marker, y })),
      path: branchPath(xStart, xEnd, y, layout.trunkY, branch.endKind === 'merge'),
    };
  });
  return changed ? { ...layout, branches } : layout;
}
