import { cpus } from 'node:os';
import { describe, expect, it } from 'vitest';
import { layoutPromiseGraph } from '../../../src/lib/graph-layout';
import type {
  DerivedAct,
  DerivedLoop,
  EngineOutput,
  LoopState,
} from '../../../src/contracts/engine';
import type { ActType, GraphContext } from '../../../src/contracts/graph';

const id = (kind: number, n: number) =>
  `00000000-0000-4000-8${kind.toString(16).padStart(3, '0')}-${n.toString(16).padStart(12, '0')}`;
const iso = (epoch: number) => new Date(epoch).toISOString().replace('Z', '+00:00');

function syntheticProject(): { engine: EngineOutput; context: GraphContext } {
  let seed = 42;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const departments = Array.from({ length: 8 }, (_, i) => ({
    id: id(1, i),
    name: `Department ${i}`,
    side: i < 4 ? ('vendor' as const) : ('client' as const),
    order: i % 4,
  }));
  const people = departments.map((department, i) => ({
    id: id(2, i),
    name: `Person Number ${i}`,
    side: department.side,
    departmentId: department.id,
    role: '',
  }));
  const milestones = Array.from({ length: 10 }, (_, i) => ({
    id: id(3, i),
    name: `Milestone ${i}`,
    order: i,
    plannedDate: `2026-${String(7 + Math.floor(i / 3)).padStart(2, '0')}-1${i % 3}`,
    currentDate: `2026-${String(7 + Math.floor(i / 3)).padStart(2, '0')}-1${(i + 1) % 3}`,
    reachedAt: null,
    anchorLoopId: null,
  }));
  const context: GraphContext = {
    timeZone: 'America/New_York',
    windowStart: '2026-06-01',
    windowEnd: '2026-12-31',
    asOfOverride: null,
    holidays: [],
    replyWindowDays: 2,
    acceptWindowDays: 5,
    hedgeWindowDays: 5,
    atRiskWindowDays: 2,
    people,
    departments,
    milestones,
  };
  const start = Date.parse('2026-06-01T13:00:00Z'),
    T = Date.parse('2026-12-01T12:00:00Z');
  const types: ActType[] = [
    'request',
    'promise',
    'counter',
    'follow_up',
    'renegotiate',
    'agree_change',
    'report_done',
    'reject',
    'report_done',
    'accept',
  ];
  const states: LoopState[] = [
    'closed',
    'promised',
    'requested',
    'declined',
    'delivered',
    'change_pending',
  ];
  const loops: DerivedLoop[] = Array.from({ length: 300 }, (_, li) => {
    const performer = people[li % 8],
      customerParty = { kind: 'person' as const, personId: people[(li + 4) % 8].id };
    let at = start + Math.floor(random() * 150) * 86_400_000;
    const acts: DerivedAct[] = types.map((type, ai) => {
      at += Math.floor(random() * 3 * 86_400_000);
      return {
        id: id(4, li * 10 + ai),
        citation: { recordVersionId: id(5, li * 10 + ai), start: 0, end: 10 },
        type,
        actor: ai % 2 ? { kind: 'person', personId: performer.id } : customerParty,
        customer: customerParty,
        performer: { kind: 'person', personId: performer.id },
        action: 'deliver',
        due: null,
        hedged: type === 'promise' && li % 7 === 0,
        loopId: id(6, li),
        hidden: false,
        origin: 'human',
        confidence: null,
        occurredAt: iso(at),
        quote: 'quoted text',
        unavailable: false,
        flags: [],
      };
    });
    const state = states[li % states.length],
      last = acts.at(-1)!.occurredAt;
    const broken = li % 5 === 0;
    return {
      loop: {
        id: id(6, li),
        title: `Loop ${li}`,
        customer: customerParty,
        performer: { kind: 'person', personId: performer.id },
        performerDepartmentId: performer.departmentId!,
        milestoneId: milestones[li % 10].id,
      },
      state,
      acts,
      firstActAt: acts[0].occurredAt,
      lastActAt: last,
      requestedAt: acts[0].occurredAt,
      promisedAt: acts[1].occurredAt,
      deliveredAt: null,
      closedAt: state === 'closed' ? last : null,
      terminatedAt: state === 'declined' ? last : null,
      due: null,
      originalDue: null,
      dueAt: iso(T + 86_400_000),
      hedged: li % 7 === 0,
      nudges: 0,
      rejections: 0,
      pendingTerms:
        state === 'change_pending'
          ? {
              action: 'deliver',
              due: null,
              proposer: { kind: 'person', personId: performer.id },
              actId: acts[4].id,
              proposedAt: acts[4].occurredAt,
              kind: 'renegotiate',
            }
          : null,
      cycleStartedAt: null,
      rejectionActIds: [],
      breakdowns: broken
        ? [
            {
              type: 'late_delivery',
              severity: 'broken',
              loopId: id(6, li),
              proofActIds: [acts[1].id],
              sentence: 'Late.',
              startAt: acts[3].occurredAt,
              endAt: null,
              businessDays: 3,
            },
          ]
        : li % 5 === 1
          ? [
              {
                type: 'ambiguous_promise',
                severity: 'warning',
                loopId: id(6, li),
                proofActIds: [acts[1].id],
                sentence: 'Hedged.',
                startAt: acts[2].occurredAt,
                endAt: null,
                businessDays: null,
              },
            ]
          : [],
      dueSoon: state === 'promised' && li % 4 === 1,
    };
  });
  const engine: EngineOutput = {
    T: iso(T),
    loops,
    milestones: milestones.map((milestone) => ({
      milestone,
      currentDate: milestone.currentDate,
      status: 'on_track',
      reason: 'No milestone risk rule matches.',
      loopIds: [],
      openLoopCount: 0,
      brokenLoopCount: 0,
    })),
    counts: {
      states: {
        requested: 0,
        negotiating: 0,
        promised: 0,
        change_pending: 0,
        delivered: 0,
        closed: 0,
        declined: 0,
        cancelled: 0,
      },
      breakdowns: {
        unanswered_request: 0,
        silent_overdue: 0,
        late_delivery: 0,
        unilateral_change: 0,
        rejected_delivery: 0,
        ambiguous_promise: 0,
        unconfirmed_delivery: 0,
      },
      brokenLoops: 0,
      warningLoops: 0,
      openLoops: 0,
      closedLoops: 0,
    },
    unassignedActIds: [],
    unavailableEvidenceCount: 0,
  };
  return { engine, context };
}

describe('layoutPromiseGraph benchmark', () => {
  it('lays out 300 loops and 3,000 acts in under 50 ms (median of 5 runs)', () => {
    const { engine, context } = syntheticProject();
    expect(engine.loops.reduce((sum, loop) => sum + loop.acts.length, 0)).toBe(3000);
    expect(new Set(engine.loops.map((loop) => loop.loop.performerDepartmentId)).size).toBe(8);
    const run = () => layoutPromiseGraph(engine, { context }, { pxPerDay: 12 });
    expect(run().branches).toHaveLength(300);
    const times = Array.from({ length: 5 }, () => {
      const started = performance.now();
      run();
      return performance.now() - started;
    }).sort((a, b) => a - b);
    const median = times[2];
    console.info(`layout median ms ${median.toFixed(2)} on ${cpus()[0]?.model ?? 'unknown CPU'}`);
    expect(median).toBeLessThan(50);
  });
});
