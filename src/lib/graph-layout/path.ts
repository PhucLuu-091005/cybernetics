// Curve geometry from the approved design file (docs/design/2026-10-13-promise-graph-ui.html).
export const CURVE = 16;
const num = (value: number) => String(Math.round(value * 100) / 100);

export function branchPath(
  xStart: number,
  xEnd: number,
  y: number,
  trunkY: number,
  merge: boolean,
): string {
  const fork = `M${num(xStart - CURVE)} ${num(trunkY)} C${num(xStart - 4)} ${num(trunkY)} ${num(xStart - 12)} ${num(y)} ${num(xStart)} ${num(y)} H${num(xEnd)}`;
  return merge
    ? `${fork} C${num(xEnd + 12)} ${num(y)} ${num(xEnd + 4)} ${num(trunkY)} ${num(xEnd + CURVE)} ${num(trunkY)}`
    : fork;
}
