import type { GraphSnapshot } from '../../src/contracts';
import { fixtureSnapshot as snapshot, LARKSPUR_T, larkspurRecords as records, rekeyFixture } from '../../src/server/domain/seed';

export { headOf, ingestEnvelope, mergeOperations, seedLarkspur, type LarkspurSeed } from '../../src/server/domain/seed';
export const larkspurT = LARKSPUR_T;
export const larkspurRecords = records;
export const fixtureSnapshot: GraphSnapshot = snapshot;
/** Test seeds keep fixture entity IDs, so only record version IDs change. */
export function rekey<T>(value: T, versionIds: Map<string, string>): T {
  return rekeyFixture(value, { versionIds, entityId: id => id });
}
