import type { ActorContext } from './identity';
import type { IngestEnvelope, IngestReceipt, ReadRecordChunkInput, RecordChunk } from './records';
import type {
  ApplyRebaseInput,
  CommitPreview,
  CommitReceipt,
  CreateProposalInput,
  MergeProposalInput,
  PreviewRebaseInput,
  PreviewRestoreInput,
  PreviewRevertInput,
  Proposal,
  ProposalReview,
  RebasePreview,
  RestoreCommitInput,
  RevertCommitInput,
  ReviewProposalInput,
  UpdateProposalInput,
} from './proposals';
import type { GraphSnapshot, InverseResult, RebaseResult, SnapshotDiff } from './graph';
import type { EngineInput, EngineOutput } from './engine';
import type { GraphLayout, LayoutInput, LayoutOptions } from './layout';

/** Shared browser/MCP domain boundary. Context is verified by the adapter before invocation. */
export interface RecordDomainOperations {
  ingestRecords(ctx: ActorContext, input: IngestEnvelope): Promise<IngestReceipt>;
  readRecordChunk(ctx: ActorContext, input: ReadRecordChunkInput): Promise<RecordChunk>;
}
export interface ProposalDomainOperations {
  createProposal(ctx: ActorContext, input: CreateProposalInput): Promise<Proposal>;
  updateProposal(ctx: ActorContext, input: UpdateProposalInput): Promise<Proposal>;
  reviewProposal(ctx: ActorContext, input: ReviewProposalInput): Promise<ProposalReview>;
  mergeProposal(ctx: ActorContext, input: MergeProposalInput): Promise<CommitReceipt>;
  previewRebase(ctx: ActorContext, input: PreviewRebaseInput): Promise<RebasePreview>;
  applyRebase(ctx: ActorContext, input: ApplyRebaseInput): Promise<Proposal>;
  previewRevert(ctx: ActorContext, input: PreviewRevertInput): Promise<CommitPreview>;
  revertCommit(ctx: ActorContext, input: RevertCommitInput): Promise<CommitReceipt>;
  previewRestore(ctx: ActorContext, input: PreviewRestoreInput): Promise<CommitPreview>;
  restoreCommit(ctx: ActorContext, input: RestoreCommitInput): Promise<CommitReceipt>;
}
export type DiffSnapshots = (base: GraphSnapshot, candidate: GraphSnapshot) => SnapshotDiff;
export type ThreeWayRebase = (
  base: GraphSnapshot,
  candidate: GraphSnapshot,
  main: GraphSnapshot,
) => RebaseResult;
export type InverseCommit = (
  parent: GraphSnapshot,
  target: GraphSnapshot,
  main: GraphSnapshot,
) => InverseResult;
export type DeriveProject = (input: EngineInput) => EngineOutput;
export type LayoutPromiseGraph = (
  engine: EngineOutput,
  input: LayoutInput,
  options: LayoutOptions,
) => GraphLayout;
