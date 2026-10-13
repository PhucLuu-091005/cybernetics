import { date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn, type ForeignKeyBuilder, type PgColumn } from 'drizzle-orm/pg-core';
import type { ActorReference, Alias, AnswerApproval, ClaimAssessment, Commit, GraphSnapshot, Project, Proposal, QuotedRange, RecordVersion, Scope, SourceKind } from '../../contracts';

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const tenantWorkspaceId = () => uuid('workspace_id').notNull();
const tenantProjectId = () => uuid('project_id').notNull();
type Pair = [AnyPgColumn, AnyPgColumn];
/** Composite keys make Postgres reject any reference that crosses a workspace or project boundary. */
const inProject = (name: string, table: { workspaceId: PgColumn; projectId: PgColumn }): ForeignKeyBuilder => foreignKey({ name: `${name}_project_fk`, columns: [table.workspaceId, table.projectId], foreignColumns: [projects.workspaceId, projects.id] });
const sameProject = (name: string, columns: [PgColumn, PgColumn], target: () => Pair): ForeignKeyBuilder => foreignKey({ name, columns, foreignColumns: target() });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  subject: text('subject').notNull().unique(),
  email: text('email'),
  name: text('name').notNull(),
  createdAt: createdAt(),
});
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});
// created_at orders memberships so the personal workspace stays the session default after later joins.
export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, table => [primaryKey({ columns: [table.workspaceId, table.userId] }), index('workspace_members_user_idx').on(table.userId)]);
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  title: text('title').notNull(),
  clientName: text('client_name').notNull(),
  mainCommitId: uuid('main_commit_id'),
  evidenceRevision: integer('evidence_revision').notNull().default(0),
  sourceRouting: jsonb('source_routing').$type<Project['sourceRouting']>().notNull().default([]),
  createdAt: createdAt(),
}, table => [index('projects_workspace_idx').on(table.workspaceId), unique('projects_workspace_id_unique').on(table.workspaceId, table.id), sameProject('projects_main_commit_fk', [table.id, table.mainCommitId], (): Pair => [graphCommits.projectId, graphCommits.id])]);
export const records = pgTable('records', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  source: text('source').$type<SourceKind>().notNull(),
  externalId: text('external_id'),
  currentVersionId: uuid('current_version_id'),
  withdrawnAt: tz('withdrawn_at'),
  withdrawnReason: text('withdrawn_reason'),
}, table => [unique('records_project_source_external_unique').on(table.projectId, table.source, table.externalId), unique('records_project_id_unique').on(table.projectId, table.id), inProject('records', table), sameProject('records_current_version_fk', [table.projectId, table.currentVersionId], (): Pair => [recordVersions.projectId, recordVersions.id])]);
export const recordVersions = pgTable('record_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  recordId: uuid('record_id').notNull(),
  versionNo: integer('version_no').notNull(),
  digest: text('digest').notNull(),
  source: text('source').$type<SourceKind>().notNull(),
  sourceLabel: text('source_label').notNull(),
  externalId: text('external_id'),
  threadExternalId: text('thread_external_id'),
  parentExternalId: text('parent_external_id'),
  title: text('title').notNull(),
  bodyText: text('body_text').notNull(),
  // Accent-folded copies filled at insert because the database has no unaccent extension; the title copy lets withdrawn records match without exposing their body.
  searchText: text('search_text').notNull(),
  searchTitle: text('search_title').notNull(),
  occurredAt: tz('occurred_at').notNull(),
  occurredDate: date('occurred_date', { mode: 'string' }),
  occurredTimeZone: text('occurred_time_zone'),
  timePrecision: text('time_precision').$type<RecordVersion['timePrecision']>().notNull(),
  author: jsonb('author').$type<Alias>().notNull(),
  recipients: jsonb('recipients').$type<Alias[]>().notNull(),
  quotedRanges: jsonb('quoted_ranges').$type<QuotedRange[]>().notNull(),
  attachmentNames: jsonb('attachment_names').$type<string[]>().notNull(),
  permalink: text('permalink'),
  provenance: jsonb('provenance').$type<RecordVersion['provenance']>().notNull(),
  evidenceRevision: integer('evidence_revision').notNull(),
  createdAt: createdAt(),
}, table => [unique('record_versions_record_version_unique').on(table.recordId, table.versionNo), index('record_versions_project_occurred_idx').on(table.projectId, table.occurredAt), index('record_versions_project_source_digest_idx').on(table.projectId, table.source, table.digest), unique('record_versions_project_id_unique').on(table.projectId, table.id), inProject('record_versions', table), sameProject('record_versions_record_fk', [table.projectId, table.recordId], (): Pair => [records.projectId, records.id])]);
export const mutationReceipts = pgTable('mutation_receipts', {
  projectId: uuid('project_id').notNull().references(() => projects.id),
  actorKey: text('actor_key').notNull(),
  operation: text('operation').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  result: jsonb('result').$type<unknown>().notNull(),
  createdAt: createdAt(),
}, table => [primaryKey({ columns: [table.projectId, table.actorKey, table.operation, table.idempotencyKey] })]);
export const graphCommits = pgTable('graph_commits', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  sequence: integer('sequence').notNull(),
  parentId: uuid('parent_id'),
  snapshot: jsonb('snapshot').$type<GraphSnapshot>().notNull(),
  snapshotHash: text('snapshot_hash').notNull(),
  actor: jsonb('actor').$type<ActorReference>().notNull(),
  message: text('message').notNull(),
  kind: text('kind').$type<Commit['kind']>().notNull(),
  proposalId: uuid('proposal_id'),
  targetCommitId: uuid('target_commit_id'),
  reviewedEvidenceRevision: integer('reviewed_evidence_revision').notNull(),
  createdAt: createdAt(),
}, table => [
  unique('graph_commits_project_sequence_unique').on(table.projectId, table.sequence), index('graph_commits_parent_idx').on(table.parentId), unique('graph_commits_project_id_unique').on(table.projectId, table.id), inProject('graph_commits', table),
  sameProject('graph_commits_parent_fk', [table.projectId, table.parentId], (): Pair => [graphCommits.projectId, graphCommits.id]),
  sameProject('graph_commits_proposal_fk', [table.projectId, table.proposalId], (): Pair => [graphProposals.projectId, graphProposals.id]),
  sameProject('graph_commits_target_fk', [table.projectId, table.targetCommitId], (): Pair => [graphCommits.projectId, graphCommits.id]),
]);
export const graphProposals = pgTable('graph_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  baseCommitId: uuid('base_commit_id').notNull(),
  candidate: jsonb('candidate').$type<GraphSnapshot>().notNull(),
  revision: integer('revision').notNull(),
  author: jsonb('author').$type<ActorReference>().notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  evidenceRevision: integer('evidence_revision').notNull(),
  status: text('status').$type<Proposal['status']>().notNull(),
  mergedCommitId: uuid('merged_commit_id'),
  createdAt: createdAt(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
}, table => [
  index('graph_proposals_project_status_idx').on(table.projectId, table.status), unique('graph_proposals_project_id_unique').on(table.projectId, table.id), inProject('graph_proposals', table),
  sameProject('graph_proposals_base_commit_fk', [table.projectId, table.baseCommitId], (): Pair => [graphCommits.projectId, graphCommits.id]),
  sameProject('graph_proposals_merged_commit_fk', [table.projectId, table.mergedCommitId], (): Pair => [graphCommits.projectId, graphCommits.id]),
]);
export const escalations = pgTable('escalations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  complaint: text('complaint').notNull(),
  author: jsonb('author').$type<ActorReference>().notNull(),
  createdAt: createdAt(),
}, table => [index('escalations_project_idx').on(table.projectId), unique('escalations_project_id_unique').on(table.projectId, table.id), inProject('escalations', table)]);
export const escalationAnalyses = pgTable('escalation_analyses', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  escalationId: uuid('escalation_id').notNull(),
  revision: integer('revision').notNull(),
  graphCommitId: uuid('graph_commit_id').notNull(),
  evidenceRevision: integer('evidence_revision').notNull(),
  claims: jsonb('claims').$type<ClaimAssessment[]>().notNull(),
  answerText: text('answer_text').notNull(),
  author: jsonb('author').$type<ActorReference>().notNull(),
  contentHash: text('content_hash').notNull(),
  approval: jsonb('approval').$type<AnswerApproval>(),
  createdAt: createdAt(),
}, table => [
  unique('escalation_analyses_escalation_revision_unique').on(table.escalationId, table.revision), inProject('escalation_analyses', table),
  sameProject('escalation_analyses_escalation_fk', [table.projectId, table.escalationId], (): Pair => [escalations.projectId, escalations.id]),
  sameProject('escalation_analyses_commit_fk', [table.projectId, table.graphCommitId], (): Pair => [graphCommits.projectId, graphCommits.id]),
]);
export const agentTokens = pgTable('agent_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: tenantWorkspaceId(),
  projectId: tenantProjectId(),
  userId: uuid('user_id').notNull().references(() => users.id),
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull().unique(),
  label: text('label').notNull(),
  scopes: text('scopes').array().$type<Scope[]>().notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  // Nullable because the HttpIdentityStore port declares requestDigest optional.
  requestDigest: text('request_digest'),
  createdAt: createdAt(),
  expiresAt: tz('expires_at').notNull(),
  revokedAt: tz('revoked_at'),
  revokeKey: text('revoke_key'),
}, table => [unique('agent_tokens_creation_key_unique').on(table.userId, table.projectId, table.idempotencyKey), index('agent_tokens_project_idx').on(table.projectId), inProject('agent_tokens', table)]);
