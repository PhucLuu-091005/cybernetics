import { expect, it } from 'vitest';
import { EngineInputSchema, EngineOutputSchema } from '../../../src/contracts/engine';
import { LayoutOptionsSchema } from '../../../src/contracts/layout';
import { SaveEscalationAnalysisInputSchema } from '../../../src/contracts/escalations';
import { SnapshotPageSchema } from '../../../src/contracts/mcp';
const id = '10000000-0000-4000-8000-000000000001';

const snapshot = {
  schemaVersion: 1,
  context: {
    timeZone: 'Asia/Ho_Chi_Minh',
    windowStart: '2026-06-15',
    windowEnd: '2026-11-15',
    asOfOverride: null,
    holidays: [],
    replyWindowDays: 2,
    acceptWindowDays: 5,
    hedgeWindowDays: 5,
    atRiskWindowDays: 2,
    people: [],
    departments: [],
    milestones: [],
  },
  acts: [],
  loops: [],
  annotations: [],
  recordDecisions: [],
};
const T = '2026-10-12T02:00:00Z';
it('requires only the explicit clock on an otherwise valid engine input', () => {
  expect(EngineInputSchema.safeParse({ snapshot, records: [], T }).success).toBe(true);
  expect(EngineInputSchema.safeParse({ snapshot, records: [] }).success).toBe(false);
});
it('requires only the explicit clock on an otherwise valid engine output', () => {
  const output = {
    loops: [],
    milestones: [],
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
  expect(EngineOutputSchema.safeParse({ ...output, T }).success).toBe(true);
  expect(EngineOutputSchema.safeParse(output).success).toBe(false);
});
it('requires only the pinned occurrence timestamp on otherwise valid immutable metadata', () => {
  const record = {
    recordVersionId: id,
    bodyText: 'Promise',
    digest: 'a'.repeat(64),
    withdrawn: false,
    quotedRanges: [],
  };
  expect(
    EngineInputSchema.safeParse({ snapshot, records: [{ ...record, occurredAt: T }], T }).success,
  ).toBe(true);
  expect(EngineInputSchema.safeParse({ snapshot, records: [record], T }).success).toBe(false);
});
it('rejects nonpositive graph zoom rather than returning invalid coordinates', () => {
  expect(LayoutOptionsSchema.safeParse({ pxPerDay: 0 }).success).toBe(false);
});
it('requires expected revisions on saved analysis and at most six claims', () => {
  expect(
    SaveEscalationAnalysisInputSchema.safeParse({
      projectId: id,
      escalationId: id,
      claims: [],
      answerText: 'Uncited',
      idempotencyKey: 'one',
    }).success,
  ).toBe(false);
  const claim = {
    id,
    text: 'Mapping is late',
    type: 'timing',
    timeWindow: null,
    supportingActIds: [],
    contradictingActIds: [],
    openQuestions: [],
  };
  const input = {
    projectId: id,
    escalationId: id,
    graphCommitId: id,
    expectedMainCommitId: id,
    expectedEvidenceRevision: 0,
    expectedAnalysisRevision: null,
    claims: Array(6).fill(claim),
    answerText: 'Further evidence needed',
    idempotencyKey: 'one',
  };
  expect(SaveEscalationAnalysisInputSchema.safeParse(input).success).toBe(true);
  expect(
    SaveEscalationAnalysisInputSchema.safeParse({ ...input, claims: Array(7).fill(claim) }).success,
  ).toBe(false);
});
it('caps snapshot entity pages at fifty without silently discarding overflow', () => {
  const party = { kind: 'side', side: 'vendor' };
  const act = {
    id,
    citation: { recordVersionId: id, start: 0, end: 3 },
    type: 'promise',
    actor: party,
    customer: { kind: 'side', side: 'client' },
    performer: party,
    action: 'Send mapping',
    due: null,
    hedged: false,
    loopId: null,
    hidden: false,
    origin: 'human',
    confidence: null,
  };
  const page = {
    projectId: id,
    commitId: id,
    proposalId: null,
    proposalRevision: null,
    evidenceRevision: 0,
    collection: 'acts',
    items: Array(50).fill(act),
    nextCursor: null,
    requestId: 'req',
  };
  expect(SnapshotPageSchema.safeParse(page).success).toBe(true);
  expect(SnapshotPageSchema.safeParse({ ...page, items: Array(51).fill(act) }).success).toBe(false);
});
