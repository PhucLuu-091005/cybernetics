import { expect, it } from 'vitest';
import { EngineInputSchema, EngineOutputSchema } from '../../../src/contracts/engine';
import { LayoutOptionsSchema } from '../../../src/contracts/layout';
import { SaveEscalationAnalysisInputSchema } from '../../../src/contracts/escalations';
import { SnapshotPageSchema } from '../../../src/contracts/mcp';
const id = '10000000-0000-4000-8000-000000000001';

it('requires an explicit engine clock and pinned immutable occurrence metadata', () => {
  expect(EngineInputSchema.safeParse({snapshot:{},records:[]}).success).toBe(false);
  expect(EngineOutputSchema.safeParse({T:'yesterday',loops:[],milestones:[]}).success).toBe(false);
});
it('rejects nonpositive graph zoom rather than returning invalid coordinates', () => {
  expect(LayoutOptionsSchema.safeParse({pxPerDay:0}).success).toBe(false);
});
it('requires expected revisions on saved analysis and at most six claims', () => {
  expect(SaveEscalationAnalysisInputSchema.safeParse({projectId:id,escalationId:id,claims:[],answerText:'Uncited',idempotencyKey:'one'}).success).toBe(false);
});
it('caps snapshot entity pages at fifty without silently discarding overflow', () => {
  expect(SnapshotPageSchema.safeParse({projectId:id,commitId:id,proposalId:null,proposalRevision:null,evidenceRevision:0,collection:'acts',items:Array(51).fill({}),nextCursor:null,requestId:'req'}).success).toBe(false);
});
