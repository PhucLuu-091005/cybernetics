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
  const claim = {id,text:'Mapping is late',type:'timing',timeWindow:null,supportingActIds:[],contradictingActIds:[],openQuestions:[]};
  const input = {projectId:id,escalationId:id,graphCommitId:id,expectedMainCommitId:id,expectedEvidenceRevision:0,expectedAnalysisRevision:null,claims:Array(6).fill(claim),answerText:'Further evidence needed',idempotencyKey:'one'};
  expect(SaveEscalationAnalysisInputSchema.safeParse(input).success).toBe(true);
  expect(SaveEscalationAnalysisInputSchema.safeParse({...input,claims:Array(7).fill(claim)}).success).toBe(false);
});
it('caps snapshot entity pages at fifty without silently discarding overflow', () => {
  const party = {kind:'side',side:'vendor'};
  const act = {id,citation:{recordVersionId:id,start:0,end:3},type:'promise',actor:party,customer:{kind:'side',side:'client'},performer:party,action:'Send mapping',due:null,hedged:false,loopId:null,hidden:false,origin:'human',confidence:null};
  const page = {projectId:id,commitId:id,proposalId:null,proposalRevision:null,evidenceRevision:0,collection:'acts',items:Array(50).fill(act),nextCursor:null,requestId:'req'};
  expect(SnapshotPageSchema.safeParse(page).success).toBe(true);
  expect(SnapshotPageSchema.safeParse({...page,items:Array(51).fill(act)}).success).toBe(false);
});
