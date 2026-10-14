import { afterAll, describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '../src/contracts';
import {
  conflictDetection,
  expectedDiffMatches,
  formatMetric,
  loadFixtures,
  quoteValidity,
  revertRestoreCorrectness,
  transitionAccuracy,
  type FixtureSet,
  type Metric,
} from './metrics';

const metrics: [string, (fixtures: FixtureSet) => Metric][] = [
  ['transition/breakdown accuracy', transitionAccuracy],
  ['quote validity', quoteValidity],
  ['expected diff matches', expectedDiffMatches],
  ['conflict detection', conflictDetection],
  ['revert/restore correctness', revertRestoreCorrectness],
];

describe('pnpm eval: gold fixtures', () => {
  const lines: string[] = [];
  // Written after the run so the metric lines stay together and print whatever the reporter does with test console output.
  afterAll(() => {
    process.stdout.write(`\n${lines.join('\n')}\n\n`);
  });
  for (const [name, measure] of metrics) {
    it(`${name} is 100%`, () => {
      const metric = measure(loadFixtures());
      lines.push(formatMetric(metric));
      expect(metric.name).toBe(name);
      expect(metric.total).toBeGreaterThan(0);
      expect(metric.failures).toEqual([]);
      expect(metric.passed).toBe(metric.total);
    });
  }
});

describe('pnpm eval: every metric detects a corrupted fixture', () => {
  const corrupt = (mutate: (fixtures: FixtureSet) => void) => {
    const fixtures = loadFixtures();
    mutate(fixtures);
    return fixtures;
  };
  const loopOf = (snapshot: GraphSnapshot, title: RegExp) =>
    snapshot.loops.find((loop) => title.test(loop.title))!;

  it('formats one metric line with one decimal', () => {
    expect(formatMetric({ name: 'quote validity', passed: 29, total: 30, failures: ['x'] })).toBe(
      'quote validity: 96.7% (29/30)',
    );
    expect(formatMetric({ name: 'quote validity', passed: 30, total: 30, failures: [] })).toBe(
      'quote validity: 100.0% (30/30)',
    );
  });
  it('transition/breakdown accuracy drops when gold disagrees with the engine', () => {
    const metric = transitionAccuracy(
      corrupt((fixtures) => {
        const [first] = Object.values(fixtures.gold.loops);
        first.breakdowns = [...first.breakdowns, 'silent_overdue'];
      }),
    );
    expect(metric.passed).toBe(metric.total - 1);
  });
  it('quote validity drops when a citation crosses a quoted range or a submitted quote differs', () => {
    const reply = loadFixtures().records.find(
      (item) => (item.record.quotedRanges ?? []).length > 0,
    )!;
    const metric = quoteValidity(
      corrupt((fixtures) => {
        const act = fixtures.main.acts.find(
          (item) => item.citation.recordVersionId !== reply.recordVersionId,
        )!;
        const range = reply.record.quotedRanges![0];
        act.citation = {
          recordVersionId: reply.recordVersionId,
          start: range.start,
          end: range.start + 5,
        };
        const op = fixtures.proposals
          .flatMap((item) => item.operations)
          .find((item) => item.op === 'put' && item.collection === 'acts')!;
        if (op.op === 'put' && op.collection === 'acts') op.quote = `${op.quote} (edited)`;
      }),
    );
    expect(metric.total - metric.passed).toBe(2);
  });
  it('expected diff matches drop when an expected diff or a candidate is wrong', () => {
    const metric = expectedDiffMatches(
      corrupt((fixtures) => {
        fixtures.history[1].expectedDiff = [];
        fixtures.proposals[0].candidate.loops[0].title = 'Hand-edited candidate';
      }),
    );
    expect(metric.total - metric.passed).toBe(2);
  });
  it('conflict detection drops when the competing proposals make the same change', () => {
    const metric = conflictDetection(
      corrupt((fixtures) => {
        const [first, second] = fixtures.proposals;
        second.candidate = structuredClone(first.candidate);
      }),
    );
    expect(metric.passed).toBeLessThan(metric.total);
  });
  it('revert/restore correctness drops when the stored revert keeps the reverted change', () => {
    const metric = revertRestoreCorrectness(
      corrupt((fixtures) => {
        const revert = fixtures.history.find((item) => item.kind === 'revert')!;
        loopOf(revert.snapshot, /secret|Azure/i).title = 'Edited after revert';
      }),
    );
    expect(metric.passed).toBeLessThan(metric.total);
  });
});
