// Curve geometry from the approved design file (docs/design/2026-10-13-promise-graph-ui.html).
export const CURVE = 16;
const num = (value: number) => String(Math.round(value * 100) / 100);

/** A branch line from xStart to xEnd at y. It forks from forkY (none when forkY is y) and merges into mergeY. */
export function branchPath(
  xStart: number,
  xEnd: number,
  y: number,
  forkY: number,
  merge: boolean,
  mergeY = forkY,
): string {
  const fork =
    forkY === y
      ? `M${num(xStart)} ${num(y)} H${num(xEnd)}`
      : `M${num(xStart - CURVE)} ${num(forkY)} C${num(xStart - 4)} ${num(forkY)} ${num(xStart - 12)} ${num(y)} ${num(xStart)} ${num(y)} H${num(xEnd)}`;
  return merge
    ? `${fork} C${num(xEnd + 12)} ${num(y)} ${num(xEnd + 4)} ${num(mergeY)} ${num(xEnd + CURVE)} ${num(mergeY)}`
    : fork;
}
