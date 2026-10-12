import { expect, it } from 'vitest';
import { ActorContextSchema, CreateAgentTokenInputSchema } from '../../../src/contracts/identity';
import { IngestEnvelopeSchema } from '../../../src/contracts/records';
import { SnapshotPageSchema } from '../../../src/contracts/mcp';
import { businessDaysBetween, resolveDueInstant, zonedStartOfDay } from '../../../src/lib/calendar';
import { buildRecordHeader } from '../../../src/lib/record-header';

const id = '10000000-0000-4000-8000-000000000001';
const actor = {kind:'user',userId:'user_clerk',workspaceId:id,projectId:null,scopes:['project:read'],requestId:'test'};

it('defaults tokens to read/import/propose without granting merge', () => {
  const parsed = CreateAgentTokenInputSchema.safeParse({projectId:id,label:'Desktop agent'});
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data.scopes).toEqual(['project:read','records:import','graph:propose']);
});
it('allows browser bootstrap without a project while keeping agents project bound', () => {
  expect(ActorContextSchema.safeParse(actor).success).toBe(true);
  expect(ActorContextSchema.safeParse({...actor,kind:'agent',tokenId:id}).success).toBe(false);
});
it('accepts invalid import items for item receipts but rejects oversized batches and requests', () => {
  const batch = {projectId:id,source:'paste',sourceLabel:'Pasted evidence',records:[{title:''}],idempotencyKey:'batch'};
  expect(IngestEnvelopeSchema.safeParse(batch).success).toBe(true);
  expect(IngestEnvelopeSchema.safeParse({...batch,records:Array(26).fill({title:''})}).success).toBe(false);
  expect(IngestEnvelopeSchema.safeParse({...batch,records:[{bodyText:'a'.repeat(2*1024*1024)}]}).success).toBe(false);
});
it('paginates graph context scalars separately from entity collections', () => {
  const context = {timeZone:'Asia/Ho_Chi_Minh',windowStart:'2026-06-15',windowEnd:'2026-11-15',asOfOverride:null,holidays:[],replyWindowDays:2,acceptWindowDays:5,hedgeWindowDays:5,atRiskWindowDays:2};
  const page = {projectId:id,commitId:id,proposalId:null,proposalRevision:null,evidenceRevision:0,collection:'context',items:[context],nextCursor:null,requestId:'req'};
  expect(SnapshotPageSchema.safeParse(page).success).toBe(true);
  expect(SnapshotPageSchema.safeParse({...page,items:[{...context,people:[]}]}).success).toBe(false);
});
it('resolves date-only evidence to immutable local start including DST transitions', () => {
  expect(zonedStartOfDay('2026-10-12','Asia/Ho_Chi_Minh')).toBe('2026-10-11T17:00:00.000Z');
  expect(zonedStartOfDay('2026-03-08','America/New_York')).toBe('2026-03-08T05:00:00.000Z');
  expect(zonedStartOfDay('2018-11-04','America/Sao_Paulo')).toBe('2018-11-04T03:00:00.000Z');
});
it('resolves due precision to the final instant of the local day/week/month', () => {
  expect(resolveDueInstant({date:'2026-10-12',precision:'day'},'Asia/Ho_Chi_Minh')).toBe('2026-10-12T16:59:59.999Z');
  expect(resolveDueInstant({date:'2026-10-12',precision:'week'},'Asia/Ho_Chi_Minh')).toBe('2026-10-18T16:59:59.999Z');
  expect(resolveDueInstant({date:'2026-02-01',precision:'month'},'Asia/Ho_Chi_Minh')).toBe('2026-02-28T16:59:59.999Z');
});
it('rejects malformed date strings before counting calendar days', () => {
  expect(() => businessDaysBetween('2026-02-31','2026-03-02',{timeZone:'UTC',holidays:[]})).toThrow();
});
it('builds a readable local header and masks withdrawn evidence titles', () => {
  const version = {id,recordId:id,projectId:id,source:'paste' as const,sourceLabel:'Team email',externalId:null,threadExternalId:null,parentExternalId:null,title:'CRM mapping',bodyText:'Xin 😀 chào',digest:'a'.repeat(64),occurredAt:'2026-10-12T02:00:00Z',occurredDate:null,occurredTimeZone:null,timePrecision:'instant' as const,author:{name:'Minh Trần',email:null,slackUserId:null},recipients:[{name:'Sarah Kim',email:null,slackUserId:null}],quotedRanges:[],attachmentNames:[],permalink:null,provenance:{actor:{kind:'user' as const,userId:'user_clerk'},importedAt:'2026-10-12T02:00:00Z'},withdrawn:false};
  expect(buildRecordHeader(version,{timeZone:'Asia/Ho_Chi_Minh'})).toBe('CRM mapping — Minh Trần → Sarah Kim — 2026-10-12 09:00 (Asia/Ho_Chi_Minh) — Team email [paste] — version '+id);
  expect(buildRecordHeader({...version,withdrawn:true},{timeZone:'Asia/Ho_Chi_Minh'})).toBe('Unavailable evidence — version '+id);
});
