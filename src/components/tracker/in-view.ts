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
