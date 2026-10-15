import type { BranchLayout, GraphLayout } from '../../contracts/layout';
import { linkTasks } from './handoffs';
import { branchPath } from './path';

export type LayoutOffsets = {
  /** Position of the dot inside its local day: 0 = day start, 1 = day end. */
  acts: Record<string, number>;
  /** Vertical shift of the branch line in px. Positive moves down. */
  loops: Record<string, number>;
  /** A card moved on its own, in px from where its act puts it. */
  cards?: Record<string, { dx: number; dy: number }>;
};
export const NO_OFFSETS: LayoutOffsets = { acts: {}, loops: {} };

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
// Half a pixel short of the next day, so a dot at the right edge never reads as the next date.
const DAY_EDGE = 0.5,
  // A dragged act stays this far from its neighbours, so the order of the acts never changes.
  ORDER_GAP = 2;

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
    const moved = branch.glyphs.some(
      (glyph) => offsets.acts[glyph.id] !== undefined || offsets.cards?.[glyph.id] !== undefined,
    );
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
    // Acts the user did not drag keep their place; a dragged act stays between its neighbours, so the
    // order of the acts never changes.
    const dragged = branch.glyphs.map((glyph) => offsets.acts[glyph.id] !== undefined);
    const placed: number[] = [];
    const glyphs = branch.glyphs.map((glyph, index) => {
      let x = glyph.x;
      if (dragged[index]) {
        let next = index + 1;
        while (next < branch.glyphs.length && dragged[next]) next++;
        const room = (next - index) * ORDER_GAP,
          low = Math.max(index > 0 ? placed[index - 1] + ORDER_GAP : -Infinity, glyph.dayStartX),
          high = Math.min(
            next < branch.glyphs.length ? branch.glyphs[next].x - room : Infinity,
            glyph.dayEndX - DAY_EDGE,
          );
        x = round(
          clamp(actXInDay(glyph.dayStartX, glyph.dayEndX, offsets.acts[glyph.id]), low, high),
        );
      }
      placed.push(x);
      const own = offsets.cards?.[glyph.id] ?? { dx: 0, dy: 0 };
      return {
        ...glyph,
        y,
        x,
        ...(glyph.card
          ? {
              card: {
                x: round(glyph.card.x + x - glyph.x + own.dx),
                y: round(glyph.card.y + dy + own.dy),
              },
            }
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
  return changed ? linkTasks({ ...layout, branches }) : layout;
}

/** The vertical shift range that keeps a branch line and its card shelves inside the lane. */
export function loopShiftRange(
  layout: GraphLayout,
  loopId: string,
  rowHeight: number,
): [number, number] | null {
  const branch = layout.branches.find((item) => item.loopId === loopId),
    lane = layout.lanes.find((item) => item.departmentId === branch?.departmentId);
  if (!branch || !lane) return null;
  const cardTop = Math.min(
    branch.y - rowHeight / 2,
    ...branch.glyphs.map((glyph) => glyph.card?.y ?? Infinity),
  );
  return [
    lane.y + (branch.y - cardTop) - branch.y,
    lane.y + lane.height - rowHeight / 2 - branch.y,
  ];
}
