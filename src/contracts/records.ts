import { z } from 'zod';
import { DateSchema, DigestSchema, FieldErrorSchema, IdSchema, IdempotencyKeySchema, PageInputSchema, RevisionSchema, TextSchema, TimestampSchema, TimeZoneSchema, boundedJson, isUtf16Boundary, utf8Bytes } from './primitives';
import { ActorReferenceSchema } from './identity';

export const SourceKindSchema = z.enum(['paste', 'agent', 'slack', 'gmail']);
/** Slack and Gmail records arrive only through native connectors (P1), so their permalinks can be trusted; P0 imports cannot claim those sources. */
export const ImportSourceSchema = SourceKindSchema.extract(['paste', 'agent']);
export const AliasSchema = z.strictObject({ name: z.string().min(1).max(200), email: z.email().nullable().optional(), slackUserId: z.string().min(1).max(256).nullable().optional() });
export const QuotedRangeSchema = z.strictObject({ start: RevisionSchema, end: RevisionSchema }).refine(value => value.start < value.end, 'Range end must follow start');
export const PermalinkSchema = z.url().refine(value => new URL(value).protocol === 'https:', 'Only HTTPS permalinks are supported');
const recordFields = { externalId: z.string().min(1).max(256).optional(), threadExternalId: z.string().min(1).max(256).optional(), parentExternalId: z.string().min(1).max(256).optional(), sourceLabel: z.string().min(1).max(200), occurredAt: TimestampSchema.optional(), occurredDate: DateSchema.optional(), author: AliasSchema, recipients: z.array(AliasSchema).max(50), title: z.string().min(1).max(200), bodyText: z.string().min(1).refine(value => utf8Bytes(value) <= 65536, 'Record body exceeds 65,536 UTF-8 bytes'), permalink: PermalinkSchema.optional(), quotedRanges: z.array(QuotedRangeSchema).max(1000).optional(), attachmentNames: z.array(z.string().min(1).max(256)).max(100).optional() };
export const RecordInputSchema = z.strictObject(recordFields).superRefine((value, ctx) => {
  if ((value.occurredAt === undefined) === (value.occurredDate === undefined)) ctx.addIssue({ code: 'custom', path: ['occurredAt'], message: 'Supply exactly one of occurredAt or occurredDate' });
  value.quotedRanges?.forEach((range, index) => {
    if (!isUtf16Boundary(value.bodyText, range.start) || !isUtf16Boundary(value.bodyText, range.end)) ctx.addIssue({ code: 'custom', path: ['quotedRanges', index], message: 'Range must use valid absolute UTF-16 boundaries within the body' });
  });
});
export const RecordVersionBaseSchema = z.strictObject({ id: IdSchema, recordId: IdSchema, projectId: IdSchema, source: SourceKindSchema, sourceLabel: recordFields.sourceLabel, externalId: recordFields.externalId.unwrap().nullable(), threadExternalId: recordFields.threadExternalId.unwrap().nullable(), parentExternalId: recordFields.parentExternalId.unwrap().nullable(), title: recordFields.title, bodyText: recordFields.bodyText, digest: DigestSchema, occurredAt: TimestampSchema, occurredDate: DateSchema.nullable(), occurredTimeZone: TimeZoneSchema.nullable(), timePrecision: z.enum(['instant', 'day']), author: AliasSchema, recipients: recordFields.recipients, quotedRanges: z.array(QuotedRangeSchema), attachmentNames: z.array(z.string()), permalink: PermalinkSchema.nullable(), provenance: z.strictObject({ actor: ActorReferenceSchema, importedAt: TimestampSchema }), withdrawn: z.boolean() });
export const RecordVersionSchema = RecordVersionBaseSchema.superRefine((value, ctx) => {
  if (value.timePrecision === 'day' && (value.occurredDate === null || value.occurredTimeZone === null)) ctx.addIssue({ code: 'custom', message: 'Day precision requires original date and ingestion time zone' });
  value.quotedRanges.forEach((range, index) => {
    if (!isUtf16Boundary(value.bodyText, range.start) || !isUtf16Boundary(value.bodyText, range.end)) ctx.addIssue({ code: 'custom', path: ['quotedRanges', index], message: 'Range must use valid absolute UTF-16 boundaries within the body' });
  });
});
export const IngestRecordsInputSchema = boundedJson(z.strictObject({ projectId: IdSchema, source: ImportSourceSchema, sourceLabel: recordFields.sourceLabel, records: z.array(RecordInputSchema).min(1).max(25), idempotencyKey: IdempotencyKeySchema }), 2 * 1024 * 1024);
export const IngestItemResultSchema = z.discriminatedUnion('decision', [
  z.strictObject({ index: RevisionSchema, decision: z.enum(['new', 'duplicate', 'new_version']), recordId: IdSchema, recordVersionId: IdSchema }),
  z.strictObject({ index: RevisionSchema, decision: z.literal('invalid'), errors: z.array(FieldErrorSchema).min(1) }),
]);
export const IngestReceiptSchema = z.strictObject({ projectId: IdSchema, requestId: TextSchema, evidenceRevision: RevisionSchema, mainCommitId: IdSchema, items: z.array(IngestItemResultSchema).max(25), idempotencyKey: IdempotencyKeySchema });
export const ReadRecordChunkInputSchema = z.strictObject({ projectId: IdSchema, recordVersionId: IdSchema, cursor: z.string().max(4096).nullable().optional(), limit: z.number().int().min(1).max(8000).default(8000) });
export const RecordChunkSchema = z.strictObject({ projectId: IdSchema, recordVersionId: IdSchema, digest: DigestSchema, start: RevisionSchema, end: RevisionSchema, text: z.string().max(8000), nextCursor: z.string().nullable(), totalLength: RevisionSchema, withdrawn: z.boolean(), header: z.string(), metadata: RecordVersionBaseSchema.omit({ bodyText: true }), requestId: TextSchema }).superRefine((value, ctx) => {
  if (value.end < value.start || value.end > value.totalLength || value.end - value.start !== value.text.length) ctx.addIssue({ code: 'custom', message: 'Chunk offsets must match absolute UTF-16 text length' });
  if (value.withdrawn && (value.text.length > 0 || value.metadata.permalink !== null)) ctx.addIssue({ code: 'custom', message: 'Withdrawn chunk must mask body and permalink' });
});
export const InboxStateSchema = z.enum(['pending', 'included', 'ignored', 'superseded', 'withdrawn']);
export const ListInboxInputSchema = PageInputSchema.extend({ projectId: IdSchema, state: InboxStateSchema.optional(), commitId: IdSchema.optional(), proposalId: IdSchema.optional(), proposalRevision: RevisionSchema.optional() });
export const SearchRecordsInputSchema = PageInputSchema.extend({ projectId: IdSchema, query: z.string().max(200), source: SourceKindSchema.optional(), after: TimestampSchema.optional(), before: TimestampSchema.optional() });
export const InboxItemSchema = z.strictObject({ recordVersionId: IdSchema, recordId: IdSchema, state: InboxStateSchema, header: z.string(), title: recordFields.title, occurredAt: TimestampSchema, author: AliasSchema, source: SourceKindSchema, sourceLabel: recordFields.sourceLabel, threadExternalId: z.string().nullable(), parentExternalId: z.string().nullable(), proposedDisposition: z.enum(['included', 'ignored']).nullable() });
export const ListInboxResultSchema = z.strictObject({ projectId: IdSchema, mainCommitId: IdSchema, evidenceRevision: RevisionSchema, items: z.array(InboxItemSchema).max(50), nextCursor: z.string().nullable(), requestId: TextSchema });
export const SearchRecordsResultSchema = z.strictObject({ projectId: IdSchema, evidenceRevision: RevisionSchema, items: z.array(z.strictObject({ recordVersionId: IdSchema, recordId: IdSchema, title: recordFields.title, excerpt: z.string().max(1000), start: RevisionSchema, end: RevisionSchema, withdrawn: z.boolean() })).max(50), nextCursor: z.string().nullable(), requestId: TextSchema });
export const WithdrawRecordInputSchema = z.strictObject({ projectId: IdSchema, recordId: IdSchema, expectedEvidenceRevision: RevisionSchema, reason: z.string().min(1).max(2000), idempotencyKey: IdempotencyKeySchema });
export const WithdrawRecordResultSchema = z.strictObject({ projectId: IdSchema, recordId: IdSchema, evidenceRevision: RevisionSchema, withdrawn: z.literal(true), requestId: TextSchema });
export type RecordInput = z.infer<typeof RecordInputSchema>;
export type RecordVersion = z.infer<typeof RecordVersionSchema>;
export type Alias = z.infer<typeof AliasSchema>;
export type QuotedRange = z.infer<typeof QuotedRangeSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type IngestRecordsInput = z.infer<typeof IngestRecordsInputSchema>;
export type IngestItemResult = z.infer<typeof IngestItemResultSchema>;
export type IngestReceipt = z.infer<typeof IngestReceiptSchema>;
export type ReadRecordChunkInput = z.infer<typeof ReadRecordChunkInputSchema>;
export type RecordChunk = z.infer<typeof RecordChunkSchema>;
export type InboxState = z.infer<typeof InboxStateSchema>;
export type ListInboxInput = z.infer<typeof ListInboxInputSchema>;
export type ListInboxResult = z.infer<typeof ListInboxResultSchema>;
export type SearchRecordsInput = z.infer<typeof SearchRecordsInputSchema>;
export type SearchRecordsResult = z.infer<typeof SearchRecordsResultSchema>;
export type WithdrawRecordInput = z.infer<typeof WithdrawRecordInputSchema>;
export type WithdrawRecordResult = z.infer<typeof WithdrawRecordResultSchema>;
/** Validate the batch envelope first, then each item separately to retain invalid-item receipts. */
export const IngestEnvelopeSchema = boundedJson(z.strictObject({ projectId: IdSchema, source: ImportSourceSchema, sourceLabel: recordFields.sourceLabel, records: z.array(z.json()).min(1).max(25), idempotencyKey: IdempotencyKeySchema }), 2 * 1024 * 1024);
export type IngestEnvelope = z.infer<typeof IngestEnvelopeSchema>;
