import type { GraphSnapshot } from '../../contracts/graph';
export function restoreSnapshot(target: GraphSnapshot): GraphSnapshot {
  return structuredClone(target);
}
