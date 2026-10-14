import goldJson from '../fixtures/gold.json';
import historyJson from '../fixtures/history.json';
import mainJson from '../fixtures/main-snapshot.json';
import proposalsJson from '../fixtures/proposals.json';
import recordsJson from '../fixtures/records.json';
import { engineInputFromFixtures, type FixtureRecord } from '../scripts/build-fixtures';
import type { Act, GraphOperation, GraphSnapshot } from '../src/contracts';
import { canonicalHash } from '../src/lib/canonical-json';
import type { EvidenceRecord } from '../src/server/domain/records/metadata';
import { applyOperations } from '../src/server/graph/apply-operations';
import { diffSnapshots } from '../src/server/graph/diff';
import { threeWayRebase } from '../src/server/graph/rebase';
import { restoreSnapshot } from '../src/server/graph/restore';
import { inverseCommit } from '../src/server/graph/revert';
import { validateSnapshot, verifyQuote } from '../src/server/graph/validate';
import { deriveProject } from '../src/server/loops/engine';

type Change = { collection: string; id: string; kind: string };
export type HistoryEntry = {
  key: string;
  kind: 'merge' | 'revert';
  message: string;
  targetKey: string | null;
  snapshot: GraphSnapshot;
  expectedDiff: Change[];
};
export type ProposalEntry = {
  key: string;
  title: string;
  competesWith: string | null;
  operations: GraphOperation[];
  candidate: GraphSnapshot;
  expectedDiff: Change[];
};
export type FixtureSet = {
  records: FixtureRecord[];
  main: GraphSnapshot;
  gold: { T: string; loops: Record<string, { state: string | null; breakdowns: string[] }> };
  history: HistoryEntry[];
  proposals: ProposalEntry[];
};
export type Metric = { name: string; passed: number; total: number; failures: string[] };

export function loadFixtures(): FixtureSet {
  return structuredClone({
    records: (recordsJson as FixtureRecord[]).filter((item) => item.projectKey === 'larkspur'),
    main: mainJson as GraphSnapshot,
    gold: { T: goldJson.T, loops: goldJson.loops },
    history: historyJson as HistoryEntry[],
    proposals: proposalsJson as ProposalEntry[],
  });
}
export function formatMetric({ name, passed, total }: Metric): string {
  return `${name}: ${(total ? (passed / total) * 100 : 0).toFixed(1)}% (${passed}/${total})`;
}
function measure(name: string, cases: [label: string, problem: string | null][]): Metric {
  const failures = cases.flatMap(([label, problem]) =>
    problem === null ? [] : [`${label}: ${problem}`],
  );
  return { name, passed: cases.length - failures.length, total: cases.length, failures };
}
const changeKeys = (changes: Change[]) =>
  changes.map(({ collection, id, kind }) => `${collection}/${id}/${kind}`).sort();
const sameChanges = (actual: Change[], expected: Change[]) =>
  JSON.stringify(changeKeys(actual)) === JSON.stringify(changeKeys(expected));
const same = (a: GraphSnapshot | null, b: GraphSnapshot) =>
  a !== null && canonicalHash(a) === canonicalHash(b);
const head = (fixtures: FixtureSet) => fixtures.history.at(-1)!.snapshot;

export function transitionAccuracy(fixtures: FixtureSet): Metric {
  const derived = new Map(
    deriveProject(
      engineInputFromFixtures(fixtures.main, fixtures.records, fixtures.gold.T),
    ).loops.map((loop) => [loop.loop.id, loop]),
  );
  return measure(
    'transition/breakdown accuracy',
    Object.entries(fixtures.gold.loops).map(([id, expected]) => {
      const loop = derived.get(id);
      if (!loop) return [id, 'loop missing from engine output'];
      const actual = {
          state: loop.state,
          breakdowns: loop.breakdowns.map((item) => item.type).sort(),
        },
        wanted = { state: expected.state, breakdowns: [...expected.breakdowns].sort() };
      return [
        id,
        JSON.stringify(actual) === JSON.stringify(wanted)
          ? null
          : `expected ${JSON.stringify(wanted)}, engine gave ${JSON.stringify(actual)}`,
      ];
    }),
  );
}

/** Every distinct citation in every fixture snapshot, plus every quote an operation submits, must locate the exact cited text. */
export function quoteValidity(fixtures: FixtureSet): Metric {
  const evidence = new Map<string, EvidenceRecord>(
    fixtures.records.map(({ recordVersionId, record }) => [
      recordVersionId,
      {
        recordVersionId,
        projectId: 'fixtures',
        recordId: recordVersionId,
        occurredAt: record.occurredAt ?? fixtures.gold.T,
        bodyText: record.bodyText,
        digest: '',
        withdrawn: false,
        superseded: false,
        quotedRanges: (record.quotedRanges ?? []).map(({ start, end }) => ({ start, end })),
      },
    ]),
  );
  const cases = new Map<string, string | null>();
  for (const snapshot of [
    fixtures.main,
    ...fixtures.history.map((item) => item.snapshot),
    ...fixtures.proposals.map((item) => item.candidate),
  ]) {
    const errors = new Map(
      validateSnapshot(snapshot, evidence).map((error) => [error.path, error.message]),
    );
    for (const act of snapshot.acts) {
      const { recordVersionId, start, end } = act.citation;
      cases.set(
        `act ${act.id} @ ${recordVersionId}[${start},${end})`,
        errors.get(`acts.${act.id}.citation`) ?? (start < end ? null : 'empty citation'),
      );
    }
  }
  for (const proposal of fixtures.proposals) {
    for (const op of proposal.operations) {
      if (op.op !== 'put' || op.collection !== 'acts') continue;
      cases.set(
        `proposal ${proposal.key} quote for act ${op.value.id}`,
        verifyQuote(op.value as Act, op.quote, evidence)?.message ?? null,
      );
    }
  }
  return measure('quote validity', [...cases]);
}

export function expectedDiffMatches(fixtures: FixtureSet): Metric {
  const cases: [string, string | null][] = [];
  let parent = fixtures.main;
  for (const entry of fixtures.history) {
    cases.push([
      `history ${entry.key}`,
      sameChanges(diffSnapshots(parent, entry.snapshot).changes, entry.expectedDiff)
        ? null
        : 'diff differs from expectedDiff',
    ]);
    parent = entry.snapshot;
  }
  for (const proposal of fixtures.proposals) {
    const applied = applyOperations(head(fixtures), proposal.operations).snapshot;
    const problem = !same(applied, proposal.candidate)
      ? 'operations do not produce the candidate'
      : !sameChanges(
            diffSnapshots(head(fixtures), proposal.candidate).changes,
            proposal.expectedDiff,
          )
        ? 'diff differs from expectedDiff'
        : null;
    cases.push([`proposal ${proposal.key}`, problem]);
  }
  return measure('expected diff matches', cases);
}

/** Competing proposals must conflict on exactly the entities both change; every other pair must rebase cleanly. */
export function conflictDetection(fixtures: FixtureSet): Metric {
  const touched = (proposal: ProposalEntry) =>
    new Set(proposal.expectedDiff.map((change) => `${change.collection}/${change.id}`));
  const cases: [string, string | null][] = [];
  for (const merged of fixtures.proposals) {
    for (const rebased of fixtures.proposals) {
      if (merged === rebased) continue;
      const competing = rebased.competesWith === merged.key;
      const expected = competing
        ? [...touched(rebased)].filter((key) => touched(merged).has(key)).sort()
        : [];
      const actual = threeWayRebase(head(fixtures), rebased.candidate, merged.candidate)
        .conflicts.map((item) => `${item.collection}/${item.id}`)
        .sort();
      const problem =
        competing && !expected.length
          ? 'competing proposals share no entity'
          : JSON.stringify(actual) === JSON.stringify(expected)
            ? null
            : `expected conflicts ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      cases.push([`rebase ${rebased.key} onto ${merged.key}`, problem]);
    }
  }
  return measure('conflict detection', cases);
}

export function revertRestoreCorrectness(fixtures: FixtureSet): Metric {
  const snapshots = [fixtures.main, ...fixtures.history.map((item) => item.snapshot)];
  const cases: [string, string | null][] = [];
  fixtures.history.forEach((entry, index) => {
    if (entry.kind !== 'revert') return;
    const target = fixtures.history.findIndex((item) => item.key === entry.targetKey);
    if (target < 0) {
      cases.push([`revert ${entry.key}`, `unknown target ${entry.targetKey}`]);
      return;
    }
    const inverse = inverseCommit(snapshots[target], snapshots[target + 1], snapshots[index]);
    cases.push([
      `revert ${entry.key} keeps later merges`,
      inverse.conflicts.length
        ? `unexpected conflicts ${inverse.conflicts.length}`
        : same(inverse.snapshot, entry.snapshot)
          ? null
          : 'inverse differs from the stored revert',
    ]);
    const again = inverseCommit(snapshots[index], snapshots[index + 1], snapshots[index + 1]);
    cases.push([
      `revert of ${entry.key} restores the reverted merge`,
      same(again.snapshot, snapshots[index])
        ? null
        : 'reverting the revert does not give back its parent',
    ]);
    const stale = inverseCommit(snapshots[target], snapshots[target + 1], snapshots[index + 1]);
    cases.push([
      `second revert of ${entry.targetKey} conflicts`,
      stale.conflicts.length ? null : 'reverting an already reverted merge reported no conflict',
    ]);
  });
  const restored = restoreSnapshot(fixtures.main);
  cases.push([
    'restore of the main snapshot from the head',
    same(restored, fixtures.main) &&
    sameChanges(
      diffSnapshots(head(fixtures), restored).changes,
      diffSnapshots(head(fixtures), fixtures.main).changes,
    )
      ? null
      : 'restore differs from its source commit',
  ]);
  return measure('revert/restore correctness', cases);
}
