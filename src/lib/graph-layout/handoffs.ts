import type {
  BranchLayout,
  ConnectorLayout,
  GatewayLayout,
  GraphLayout,
} from '../../contracts/layout';
import { CURVE, branchPath } from './path';

const num = (value: number) => String(Math.round(value * 100) / 100);
// A connector climbs or drops between lanes over two curve widths, like a branch fork.
const REACH = 2 * CURVE,
  NOTE_LIFT = 8;
const EARLY = 'started before handoff';

function curve(x0: number, y0: number, x1: number, y1: number): string {
  const middle = (x0 + x1) / 2;
  return `M${num(x0)} ${num(y0)} C${num(middle)} ${num(y0)} ${num(middle)} ${num(y1)} ${num(x1)} ${num(y1)}`;
}

/**
 * Redraws tasks from positions alone: a task without predecessors forks from its parent line at a
 * split, a task with successors ends at a handoff, a task with two or more predecessors starts
 * after a join, and a closed task without successors returns to its parent line.
 */
export function linkTasks(layout: GraphLayout): GraphLayout {
  const byLoop = new Map(layout.branches.map((branch) => [branch.loopId, branch]));
  const visibleTasks = layout.branches.filter(
    (branch) => branch.task && byLoop.has(branch.task.parentLoopId),
  );
  const predecessors = (branch: BranchLayout) =>
    (branch.task?.afterLoopIds ?? []).flatMap((id) => {
      const other = byLoop.get(id);
      return other?.task?.parentLoopId === branch.task?.parentLoopId && other ? [other] : [];
    });
  const successors = new Map<string, BranchLayout[]>();
  for (const branch of visibleTasks)
    for (const before of predecessors(branch))
      successors.set(before.loopId, [...(successors.get(before.loopId) ?? []), branch]);

  const gateways: GatewayLayout[] = [],
    connectors: ConnectorLayout[] = [];
  const splitAt = new Map<string, number>();
  const branches = layout.branches.map((branch) => {
    if (!branch.task) return branch;
    const parent = byLoop.get(branch.task.parentLoopId);
    if (!parent)
      return {
        ...branch,
        path: branchPath(
          branch.xStart,
          branch.xEnd,
          branch.y,
          layout.trunkY,
          branch.endKind === 'merge',
        ),
      };
    const before = predecessors(branch),
      after = successors.get(branch.loopId) ?? [];
    if (!before.length)
      splitAt.set(
        parent.loopId,
        Math.min(splitAt.get(parent.loopId) ?? Infinity, branch.xStart - CURVE),
      );
    const returns = branch.task.closed && !after.length;
    if (after.length)
      gateways.push({
        id: `handoff:${branch.loopId}`,
        kind: 'handoff',
        loopId: branch.loopId,
        x: branch.xEnd,
        y: branch.y,
        pending: !branch.task.closed,
        accessibleName: `Handoff: ${branch.title} to ${after.map((item) => item.title).join(', ')}${branch.task.closed ? '' : ', not yet'}`,
      });
    if (returns)
      gateways.push({
        id: `return:${branch.loopId}`,
        kind: 'return',
        loopId: branch.loopId,
        x: branch.xEnd + CURVE,
        y: parent.y,
        pending: false,
        accessibleName: `Return: ${branch.title} back to ${parent.title}`,
      });
    return {
      ...branch,
      path: branchPath(
        branch.xStart,
        branch.xEnd,
        branch.y,
        before.length ? branch.y : parent.y,
        returns,
        parent.y,
      ),
    };
  });

  for (const [loopId, x] of splitAt) {
    const parent = byLoop.get(loopId)!;
    gateways.push({
      id: `split:${loopId}`,
      kind: 'split',
      loopId,
      x,
      y: parent.y,
      pending: false,
      accessibleName: `Split: ${parent.title} hands work to its tasks`,
    });
  }

  for (const branch of visibleTasks) {
    const before = predecessors(branch);
    if (!before.length) continue;
    const task = branch.task!,
      noteText = task.early ? EARLY : task.wait;
    const tail = (fromX: number) => ({
      style: task.early
        ? ('dotted' as const)
        : task.wait
          ? ('dashed' as const)
          : ('solid' as const),
      tone: task.early || task.wait ? ('amber' as const) : branch.tone,
      note: noteText
        ? {
            x: task.early ? branch.xStart : (fromX + Math.max(fromX, branch.xStart)) / 2,
            y: branch.y - NOTE_LIFT,
            text: noteText,
          }
        : null,
    });
    if (before.length === 1) {
      const [from] = before,
        reach = from.xEnd + REACH;
      const path =
        task.early || branch.xStart <= reach
          ? curve(from.xEnd, from.y, branch.xStart, branch.y)
          : `${curve(from.xEnd, from.y, reach, branch.y)} H${num(branch.xStart)}`;
      connectors.push({ id: `${from.loopId}>${branch.loopId}`, path, ...tail(reach) });
      continue;
    }
    const joinX = Math.max(...before.map((item) => item.xEnd)) + REACH,
      joinId = `join:${branch.loopId}`;
    gateways.push({
      id: joinId,
      kind: 'join',
      loopId: branch.loopId,
      x: joinX,
      y: branch.y,
      pending: before.some((item) => !item.task?.closed),
      accessibleName: `Join: ${branch.title} waits for ${before.map((item) => item.title).join(', ')}`,
    });
    for (const from of before)
      connectors.push({
        id: `${from.loopId}>${joinId}`,
        path: curve(from.xEnd, from.y, joinX, branch.y),
        style: from.task?.closed ? 'solid' : 'dotted',
        tone: from.tone,
        note: null,
      });
    connectors.push({
      id: `${joinId}>${branch.loopId}`,
      path: `M${num(joinX)} ${num(branch.y)} H${num(branch.xStart)}`,
      ...tail(joinX),
    });
  }

  return { ...layout, branches, gateways, connectors };
}
