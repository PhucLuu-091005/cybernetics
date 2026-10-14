import { z } from 'zod';
import {
  DigestSchema,
  IdSchema,
  IdempotencyKeySchema,
  RevisionSchema,
  TextSchema,
  TimestampSchema,
} from './primitives';
import { ActorReferenceSchema } from './identity';
import {
  ConflictSchema,
  EntityCollectionSchema,
  GraphEntitySchema,
  GraphOperationsSchema,
  GraphSnapshotSchema,
  SnapshotDiffSchema,
} from './graph';

export const ExpectedSchema = z.strictObject({
  mainCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
});
export const ReviewSchema = ExpectedSchema.extend({
  proposalRevision: RevisionSchema.optional(),
  digest: DigestSchema,
  T: TimestampSchema,
});
export const ProposalSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  baseCommitId: IdSchema,
  candidate: GraphSnapshotSchema,
  revision: RevisionSchema,
  author: ActorReferenceSchema,
  title: z.string().min(1).max(200),
  rationale: z.string().max(10000),
  evidenceRevision: RevisionSchema,
  status: z.enum(['draft', 'merged', 'closed']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  mergedCommitId: IdSchema.nullable(),
});
export const CommitBaseSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  sequence: RevisionSchema,
  parentId: IdSchema.nullable(),
  snapshot: GraphSnapshotSchema,
  snapshotHash: DigestSchema,
  actor: ActorReferenceSchema,
  message: z.string().min(1).max(2000),
  createdAt: TimestampSchema,
  kind: z.enum(['initial', 'merge', 'revert', 'restore']),
  proposalId: IdSchema.nullable(),
  targetCommitId: IdSchema.nullable(),
  reviewedEvidenceRevision: RevisionSchema,
});
export const CommitSchema = CommitBaseSchema.superRefine((value, ctx) => {
  if ((value.kind === 'initial') !== (value.parentId === null))
    ctx.addIssue({ code: 'custom', message: 'Only initial commits have no parent' });
  if (value.kind === 'merge' && value.proposalId === null)
    ctx.addIssue({ code: 'custom', message: 'Merge requires proposal provenance' });
  if (['revert', 'restore'].includes(value.kind) && value.targetCommitId === null)
    ctx.addIssue({ code: 'custom', message: 'Revert/restore requires a target commit' });
});
export const CreateProposalInputSchema = z.strictObject({
  projectId: IdSchema,
  baseCommitId: IdSchema,
  title: z.string().min(1).max(200),
  rationale: z.string().max(10000).default(''),
  expectedEvidenceRevision: RevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export const UpdateProposalInputSchema = z.strictObject({
  projectId: IdSchema,
  proposalId: IdSchema,
  expectedProposalRevision: RevisionSchema,
  expectedEvidenceRevision: RevisionSchema,
  operations: GraphOperationsSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export const ReviewProposalInputSchema = z.strictObject({
  projectId: IdSchema,
  proposalId: IdSchema,
  expectedMainCommitId: IdSchema,
  expectedProposalRevision: RevisionSchema,
  expectedEvidenceRevision: RevisionSchema,
  T: TimestampSchema,
});
export const ProposalReviewSchema = z.strictObject({
  projectId: IdSchema,
  proposalId: IdSchema,
  baseCommitId: IdSchema,
  proposalRevision: RevisionSchema,
  mainCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
  snapshotHash: DigestSchema,
  T: TimestampSchema,
  digest: DigestSchema,
  diff: SnapshotDiffSchema,
  conflicts: z.array(ConflictSchema),
  pendingEvidenceCount: RevisionSchema,
  author: ActorReferenceSchema,
  rationale: z.string(),
  citedRecordVersionIds: z.array(IdSchema).max(1000),
  effects: z.array(
    z.strictObject({
      loopId: IdSchema,
      beforeState: z.string().nullable(),
      afterState: z.string().nullable(),
      addedBreakdowns: z.array(z.string()),
      removedBreakdowns: z.array(z.string()),
    }),
  ),
  requestId: TextSchema,
});
const expected = {
  projectId: IdSchema,
  expectedMainCommitId: IdSchema,
  expectedEvidenceRevision: RevisionSchema,
};
const proposalExpected = {
  ...expected,
  proposalId: IdSchema,
  expectedProposalRevision: RevisionSchema,
};
const reviewed = {
  reviewDigest: DigestSchema,
  T: TimestampSchema,
  idempotencyKey: IdempotencyKeySchema,
};
export const MergeProposalInputSchema = z.strictObject({
  ...proposalExpected,
  ...reviewed,
  message: z.string().min(1).max(2000),
});
export const CommitReceiptSchema = z.strictObject({
  projectId: IdSchema,
  commitId: IdSchema,
  parentCommitId: IdSchema,
  sequence: RevisionSchema,
  snapshotHash: DigestSchema,
  evidenceRevision: RevisionSchema,
  kind: z.enum(['merge', 'revert', 'restore']),
  proposalId: IdSchema.nullable(),
  targetCommitId: IdSchema.nullable(),
  idempotencyKey: IdempotencyKeySchema,
  requestId: TextSchema,
});
export const ConflictResolutionSchema = z.union([
  z.strictObject({
    collection: EntityCollectionSchema,
    id: TextSchema,
    choice: z.enum(['main', 'proposal']),
  }),
  z.strictObject({
    collection: EntityCollectionSchema,
    id: TextSchema,
    choice: z.literal('replacement'),
    value: GraphEntitySchema.nullable(),
    quote: z.string().min(1).max(400).optional(),
  }),
]);
export const PreviewRebaseInputSchema = z.strictObject({ ...proposalExpected, T: TimestampSchema });
export const RebasePreviewSchema = z.strictObject({
  projectId: IdSchema,
  proposalId: IdSchema,
  baseCommitId: IdSchema,
  mainCommitId: IdSchema,
  proposalRevision: RevisionSchema,
  evidenceRevision: RevisionSchema,
  T: TimestampSchema,
  digest: DigestSchema,
  candidate: GraphSnapshotSchema.nullable(),
  conflicts: z.array(ConflictSchema),
  diff: SnapshotDiffSchema,
  requestId: TextSchema,
});
export const ApplyRebaseInputSchema = z.strictObject({
  ...proposalExpected,
  ...reviewed,
  resolutions: z.array(ConflictResolutionSchema).max(5000),
});
export const PreviewRevertInputSchema = z.strictObject({
  ...expected,
  targetCommitId: IdSchema,
  T: TimestampSchema,
});
export const PreviewRestoreInputSchema = PreviewRevertInputSchema;
export const CommitPreviewSchema = z.strictObject({
  projectId: IdSchema,
  kind: z.enum(['revert', 'restore']),
  targetCommitId: IdSchema,
  mainCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
  T: TimestampSchema,
  digest: DigestSchema,
  candidate: GraphSnapshotSchema.nullable(),
  conflicts: z.array(ConflictSchema),
  diff: SnapshotDiffSchema,
  requestId: TextSchema,
});
export const RevertCommitInputSchema = z.strictObject({
  ...expected,
  ...reviewed,
  targetCommitId: IdSchema,
  message: z.string().min(1).max(2000),
});
export const RestoreCommitInputSchema = RevertCommitInputSchema;
export const CloseProposalInputSchema = z.strictObject({
  projectId: IdSchema,
  proposalId: IdSchema,
  expectedProposalRevision: RevisionSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type Expected = z.infer<typeof ExpectedSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Commit = z.infer<typeof CommitSchema>;
export type CreateProposalInput = z.infer<typeof CreateProposalInputSchema>;
export type UpdateProposalInput = z.infer<typeof UpdateProposalInputSchema>;
export type ReviewProposalInput = z.infer<typeof ReviewProposalInputSchema>;
export type ProposalReview = z.infer<typeof ProposalReviewSchema>;
export type MergeProposalInput = z.infer<typeof MergeProposalInputSchema>;
export type CommitReceipt = z.infer<typeof CommitReceiptSchema>;
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;
export type PreviewRebaseInput = z.infer<typeof PreviewRebaseInputSchema>;
export type RebasePreview = z.infer<typeof RebasePreviewSchema>;
export type ApplyRebaseInput = z.infer<typeof ApplyRebaseInputSchema>;
export type PreviewRevertInput = z.infer<typeof PreviewRevertInputSchema>;
export type PreviewRestoreInput = z.infer<typeof PreviewRestoreInputSchema>;
export type CommitPreview = z.infer<typeof CommitPreviewSchema>;
export type RevertCommitInput = z.infer<typeof RevertCommitInputSchema>;
export type RestoreCommitInput = z.infer<typeof RestoreCommitInputSchema>;
export type CloseProposalInput = z.infer<typeof CloseProposalInputSchema>;
