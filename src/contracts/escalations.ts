import { z } from 'zod';
import {
  DateSchema,
  DigestSchema,
  IdSchema,
  IdempotencyKeySchema,
  PageInputSchema,
  RevisionSchema,
  TextSchema,
  TimestampSchema,
} from './primitives';
import { ActorReferenceSchema } from './identity';

export const VerdictSchema = z.enum(['supported', 'contradicted', 'contested', 'insufficient']);
export const ClaimInputSchema = z.strictObject({
  id: IdSchema,
  text: z.string().min(1).max(2000),
  type: z.string().min(1).max(200),
  timeWindow: z.strictObject({ start: DateSchema, end: DateSchema }).nullable(),
  supportingActIds: z.array(IdSchema).max(3000),
  contradictingActIds: z.array(IdSchema).max(3000),
  openQuestions: z.array(z.string().min(1).max(2000)).max(20),
});
export const ClaimAssessmentSchema = ClaimInputSchema.extend({ verdict: VerdictSchema });
export const AnswerApprovalSchema = z.strictObject({
  actor: ActorReferenceSchema,
  approvedAt: TimestampSchema,
  contentHash: DigestSchema,
  mainCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
});
export const EscalationAnalysisSchema = z.strictObject({
  id: IdSchema,
  escalationId: IdSchema,
  projectId: IdSchema,
  revision: RevisionSchema,
  graphCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
  claims: z.array(ClaimAssessmentSchema).min(1).max(6),
  answerText: z.string().max(20000),
  author: ActorReferenceSchema,
  createdAt: TimestampSchema,
  contentHash: DigestSchema,
  approval: AnswerApprovalSchema.nullable(),
});
export const EscalationSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  complaint: z.string().min(1).max(20000),
  author: ActorReferenceSchema,
  createdAt: TimestampSchema,
  latestAnalysisRevision: RevisionSchema.nullable(),
});
export const OpenEscalationInputSchema = z.strictObject({
  projectId: IdSchema,
  complaint: z.string().min(1).max(20000),
  idempotencyKey: IdempotencyKeySchema,
});
export const SaveEscalationAnalysisInputSchema = z.strictObject({
  projectId: IdSchema,
  escalationId: IdSchema,
  graphCommitId: IdSchema,
  expectedMainCommitId: IdSchema,
  expectedEvidenceRevision: RevisionSchema,
  expectedAnalysisRevision: RevisionSchema.nullable(),
  claims: z.array(ClaimInputSchema).min(1).max(6),
  answerText: z.string().max(20000),
  idempotencyKey: IdempotencyKeySchema,
});
export const ApproveAnswerInputSchema = z.strictObject({
  projectId: IdSchema,
  escalationId: IdSchema,
  analysisId: IdSchema,
  expectedAnalysisRevision: RevisionSchema,
  expectedMainCommitId: IdSchema,
  expectedEvidenceRevision: RevisionSchema,
  contentHash: DigestSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export const GetEscalationInputSchema = PageInputSchema.extend({
  projectId: IdSchema,
  escalationId: IdSchema,
});
export const GetEscalationResultSchema = z.strictObject({
  projectId: IdSchema,
  escalation: EscalationSchema,
  analyses: z.array(EscalationAnalysisSchema).max(50),
  mainCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
  stale: z.boolean(),
  nextCursor: z.string().nullable(),
  requestId: TextSchema,
});
export type Verdict = z.infer<typeof VerdictSchema>;
export type ClaimInput = z.infer<typeof ClaimInputSchema>;
export type ClaimAssessment = z.infer<typeof ClaimAssessmentSchema>;
export type AnswerApproval = z.infer<typeof AnswerApprovalSchema>;
export type EscalationAnalysis = z.infer<typeof EscalationAnalysisSchema>;
export type Escalation = z.infer<typeof EscalationSchema>;
export type OpenEscalationInput = z.infer<typeof OpenEscalationInputSchema>;
export type SaveEscalationAnalysisInput = z.infer<typeof SaveEscalationAnalysisInputSchema>;
export type ApproveAnswerInput = z.infer<typeof ApproveAnswerInputSchema>;
export type GetEscalationInput = z.infer<typeof GetEscalationInputSchema>;
export type GetEscalationResult = z.infer<typeof GetEscalationResultSchema>;
