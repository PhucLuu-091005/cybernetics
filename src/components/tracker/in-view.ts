/** A cut name reads only from this many letters on. */
const MIN_LETTERS = 3;
const GAP = 4;
const MIN_ROOM = 40;

/**
 * Where a name that the scroll pushed under the pinned column starts again: just after the visible
 * edge, ending where it ended. 'whole' when it is fully in view, null when too little stays.
 */
export function keepInView(
  box: { x0: number; x1: number },
  left: number,
): 'whole' | { x: number; room: number } | null {
  if (box.x0 >= left) return 'whole';
  const room = box.x1 - left - GAP;
  return room >= MIN_ROOM ? { x: left + GAP, room } : null;
}

export function cutToFit(
  name: string,
  room: number,
  widthOf: (text: string) => number,
): string | null {
  if (widthOf(name) <= room) return name;
  for (let n = name.length - 1; n > 0; n--) {
    const head = name.slice(0, n).trimEnd();
    if (head.length < MIN_LETTERS) return null;
    const text = `${head}…`;
    if (widthOf(text) <= room) return text;
  }
  return null;
}

const BAR_ROOM = 12;

/**
 * The page scroll that shows the first change of a change request above the sticky zoom bar (all
 * boxes in screen pixels). The page stops where a block below the sticky top bar starts, so no row
 * of buttons is cut in half, and never past the end of the page.
 */
export function changeScroll(page: {
  scrollY: number;
  viewport: number;
  scrollHeight: number;
  first: { top: number; bottom: number };
  barHeight: number;
  stickyTop: number;
  axisHeight: number;
  stops: readonly number[];
}): number {
  const { scrollY: y, first, stickyTop } = page;
  const barTop = page.viewport - BAR_ROOM - page.barHeight;
  const need = first.bottom + y - (barTop - BAR_ROOM);
  if (need <= 0) return 0;
  const below = stickyTop + page.axisHeight;
  const stop = page.stops
    .map((top) => top + y - stickyTop)
    .filter((at) => at >= need && first.top + y - at >= below)
    .sort((a, b) => a - b)[0];
  return Math.round(Math.min(stop ?? need, Math.max(0, page.scrollHeight - page.viewport)));
}

/** A menu opens above when it does not fit below and above has more room; else it scrolls inside. */
export function menuPlace(room: { below: number; above: number; height: number }): {
  up: boolean;
  maxHeight: number | null;
} {
  if (room.height <= room.below) return { up: false, maxHeight: null };
  const up = room.above > room.below;
  const space = up ? room.above : room.below;
  return { up, maxHeight: room.height > space ? Math.floor(Math.max(0, space)) : null };
}
