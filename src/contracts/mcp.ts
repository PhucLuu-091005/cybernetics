import { z } from 'zod';
import { DomainErrorSchema, IdSchema, PageInputSchema, RevisionSchema, TextSchema, TimestampSchema, boundedJson } from './primitives';
import { ActSchema, AnnotationSchema, DepartmentSchema, GraphContextSchema, LoopSchema, MilestoneSchema, PersonSchema, RecordDecisionSchema } from './graph';
import { DerivedLoopSchema, DerivedMilestoneSchema, EngineOutputSchema } from './engine';
import { CommitBaseSchema, ProposalSchema, ProposalReviewSchema } from './proposals';

export const ProjectSchema = z.strictObject({ id: IdSchema, workspaceId: IdSchema, title: z.string().min(1).max(200), clientName: z.string().min(1).max(200), mainCommitId: IdSchema, evidenceRevision: RevisionSchema, sourceRouting: z.array(z.strictObject({ sourceLabel: TextSchema, source: z.enum(['paste', 'agent', 'slack', 'gmail']), externalScope: z.string().nullable() })) });
export const GetProjectInputSchema = z.strictObject({ projectId: IdSchema });
export const GetProjectResultSchema = z.strictObject({ project: ProjectSchema, context: GraphContextSchema, pendingEvidenceCount: RevisionSchema, analysisFreshness: z.enum(['current', 'stale', 'none']), requestId: TextSchema });
export const ViewSelectionSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('main') }), z.strictObject({ kind: z.literal('commit'), commitId: IdSchema }), z.strictObject({ kind: z.literal('proposal'), proposalId: IdSchema, proposalRevision: RevisionSchema })]);
export const GraphReadInputSchema = z.strictObject({ projectId: IdSchema, view: ViewSelectionSchema, T: TimestampSchema.optional() });
export const SnapshotCollectionSchema = z.enum(['context', 'acts', 'loops', 'annotations', 'recordDecisions', 'people', 'departments', 'milestones']);
export const GetSnapshotInputSchema = PageInputSchema.extend({ projectId: IdSchema, view: ViewSelectionSchema, collection: SnapshotCollectionSchema });
const pageFields = { projectId: IdSchema, commitId: IdSchema.nullable(), proposalId: IdSchema.nullable(), proposalRevision: RevisionSchema.nullable(), evidenceRevision: RevisionSchema, nextCursor: z.string().nullable(), requestId: TextSchema };
export const SnapshotPageSchema = boundedJson(z.discriminatedUnion('collection', [
  z.strictObject({ ...pageFields, collection: z.literal('context'), items: z.array(GraphContextSchema).max(1) }),
  z.strictObject({ ...pageFields, collection: z.literal('acts'), items: z.array(ActSchema).max(50) }),
  z.strictObject({ ...pageFields, collection: z.literal('loops'), items: z.array(LoopSchema).max(50) }),
  z.strictObject({ ...pageFields, collection: z.literal('annotations'), items: z.array(AnnotationSchema).max(50) }),
  z.strictObject({ ...pageFields, collection: z.literal('recordDecisions'), items: z.array(RecordDecisionSchema).max(50) }),
  z.strictObject({ ...pageFields, collection: z.literal('people'), items: z.array(PersonSchema).max(50) }),
  z.strictObject({ ...pageFields, collection: z.literal('departments'), items: z.array(DepartmentSchema).max(50) }),
  z.strictObject({ ...pageFields, collection: z.literal('milestones'), items: z.array(MilestoneSchema).max(50) }),
]), 50000);
export const GetGraphInputSchema = GraphReadInputSchema.extend({ cursor: z.string().nullable().optional(), limit: z.number().int().min(1).max(50).default(50) });
export const GetGraphResultSchema = boundedJson(z.strictObject({ ...pageFields, T: TimestampSchema, loops: z.array(DerivedLoopSchema).max(50), milestones: z.array(DerivedMilestoneSchema).max(50), counts: EngineOutputSchema.shape.counts }), 50000);
export const ListLoopsInputSchema = GetGraphInputSchema.extend({ states: z.array(z.enum(['requested', 'negotiating', 'promised', 'change_pending', 'delivered', 'closed', 'declined', 'cancelled'])).optional(), departmentIds: z.array(IdSchema).optional(), milestoneId: IdSchema.optional(), query: z.string().max(200).optional() });
export const GetLoopInputSchema = GraphReadInputSchema.extend({ loopId: IdSchema });
export const GetLoopResultSchema = z.strictObject({ ...pageFields, T: TimestampSchema, loop: DerivedLoopSchema });
export const ListMilestonesInputSchema = GetGraphInputSchema;
export const ListMilestonesResultSchema = z.strictObject({ ...pageFields, T: TimestampSchema, items: z.array(DerivedMilestoneSchema).max(50) });
export const ListHistoryInputSchema = PageInputSchema.extend({ projectId: IdSchema });
export const CommitSummarySchema = CommitBaseSchema.omit({ snapshot: true });
export const ListHistoryResultSchema = z.strictObject({ projectId: IdSchema, mainCommitId: IdSchema, evidenceRevision: RevisionSchema, items: z.array(CommitSummarySchema).max(50), nextCursor: z.string().nullable(), requestId: TextSchema });
export const GetCommitInputSchema = z.strictObject({ projectId: IdSchema, commitId: IdSchema });
export const GetCommitResultSchema = z.strictObject({ projectId: IdSchema, commit: CommitSummarySchema, requestId: TextSchema });
export const GetProposalInputSchema = z.strictObject({ projectId: IdSchema, proposalId: IdSchema, T: TimestampSchema.optional() });
export const GetProposalResultSchema = z.strictObject({ projectId: IdSchema, proposal: ProposalSchema.omit({ candidate: true }), requestId: TextSchema });
export const DiffProposalInputSchema = GetProposalInputSchema;
export const DiffProposalResultSchema = ProposalReviewSchema;
export const McpErrorSchema = DomainErrorSchema;
export type Project = z.infer<typeof ProjectSchema>;
export type GetProjectInput = z.infer<typeof GetProjectInputSchema>;
export type GetProjectResult = z.infer<typeof GetProjectResultSchema>;
export type ViewSelection = z.infer<typeof ViewSelectionSchema>;
export type GraphReadInput = z.infer<typeof GraphReadInputSchema>;
export type GetSnapshotInput = z.infer<typeof GetSnapshotInputSchema>;
export type SnapshotPage = z.infer<typeof SnapshotPageSchema>;
export type GetGraphInput = z.infer<typeof GetGraphInputSchema>;
export type GetGraphResult = z.infer<typeof GetGraphResultSchema>;
export type ListLoopsInput = z.infer<typeof ListLoopsInputSchema>;
export type ListLoopsResult = GetGraphResult;
export type GetLoopInput = z.infer<typeof GetLoopInputSchema>;
export type GetLoopResult = z.infer<typeof GetLoopResultSchema>;
export type ListMilestonesInput = z.infer<typeof ListMilestonesInputSchema>;
export type ListMilestonesResult = z.infer<typeof ListMilestonesResultSchema>;
export type ListHistoryInput = z.infer<typeof ListHistoryInputSchema>;
export type ListHistoryResult = z.infer<typeof ListHistoryResultSchema>;
export type GetCommitInput = z.infer<typeof GetCommitInputSchema>;
export type GetCommitResult = z.infer<typeof GetCommitResultSchema>;
export type GetProposalInput = z.infer<typeof GetProposalInputSchema>;
export type GetProposalResult = z.infer<typeof GetProposalResultSchema>;
export type DiffProposalInput = z.infer<typeof DiffProposalInputSchema>;
export type DiffProposalResult = z.infer<typeof DiffProposalResultSchema>;
