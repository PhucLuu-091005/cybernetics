import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
  type ForeignKeyBuilder,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import type { Scope } from '../../contracts';
import type {
  CrCommentKind,
  CrPermission,
  CrStatus,
  Op,
  QueueEventInput,
  QueueItemInput,
  Resolution,
  TrackerBase,
} from '../../tracker';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const tenantWorkspaceId = () => uuid('workspace_id').notNull();
const tenantProjectId = () => uuid('project_id').notNull();
type Pair = [AnyPgColumn, AnyPgColumn];
/** Composite keys make Postgres reject any reference that crosses a workspace or project boundary. */
const inProject = (
  name: string,
  table: { workspaceId: PgColumn; projectId: PgColumn },
): ForeignKeyBuilder =>
  foreignKey({
    name: `${name}_project_fk`,
    columns: [table.workspaceId, table.projectId],
    foreignColumns: [projects.workspaceId, projects.id],
  });
const sameProject = (
  name: string,
  columns: [PgColumn, PgColumn],
  target: () => Pair,
): ForeignKeyBuilder => foreignKey({ name, columns, foreignColumns: target() });

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
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId),
  ],
);
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    title: text('title').notNull(),
    clientName: text('client_name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('projects_workspace_idx').on(table.workspaceId),
    unique('projects_workspace_id_unique').on(table.workspaceId, table.id),
  ],
);
export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
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
    lastUsedAt: tz('last_used_at'),
    revokeKey: text('revoke_key'),
  },
  (table) => [
    unique('agent_tokens_creation_key_unique').on(
      table.userId,
      table.projectId,
      table.idempotencyKey,
    ),
    index('agent_tokens_project_idx').on(table.projectId),
    inProject('agent_tokens', table),
  ],
);

export const trackerMembers = pgTable(
  'tracker_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Rows written in one transaction share created_at, so seq keeps the order they were added in.
    seq: integer('seq').generatedAlwaysAsIdentity(),
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    name: text('name').notNull(),
    roleLabel: text('role_label').notNull(),
    color: text('color').notNull(),
    userId: uuid('user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    unique('tracker_members_project_id_unique').on(table.projectId, table.id),
    unique('tracker_members_project_user_unique').on(table.projectId, table.userId),
    inProject('tracker_members', table),
  ],
);
const memberIn = (name: string, projectId: PgColumn, memberId: PgColumn) =>
  sameProject(name, [projectId, memberId], (): Pair => [
    trackerMembers.projectId,
    trackerMembers.id,
  ]);
export const trackerProjects = pgTable(
  'tracker_projects',
  {
    projectId: uuid('project_id').primaryKey(),
    workspaceId: tenantWorkspaceId(),
    base: jsonb('base').$type<TrackerBase>().notNull(),
    timeZone: text('time_zone').notNull().default('Asia/Ho_Chi_Minh'),
    windowStart: date('window_start', { mode: 'string' }),
    asOf: tz('as_of'),
    demo: boolean('demo').notNull().default(false),
    ownerMemberId: uuid('owner_member_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    inProject('tracker_projects', table),
    memberIn('tracker_projects_owner_fk', table.projectId, table.ownerMemberId),
  ],
);
export const trackerQueue = pgTable(
  'tracker_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    kind: text('kind').$type<'event' | 'item'>().notNull(),
    payload: jsonb('payload').$type<QueueEventInput | QueueItemInput>().notNull(),
    addedByMember: uuid('added_by_member'),
    addedByAgent: boolean('added_by_agent').notNull().default(false),
    createdAt: createdAt(),
    dismissedAt: tz('dismissed_at'),
  },
  (table) => [
    index('tracker_queue_project_idx').on(table.projectId),
    inProject('tracker_queue', table),
    memberIn('tracker_queue_added_by_fk', table.projectId, table.addedByMember),
  ],
);
export const trackerCrs = pgTable(
  'tracker_crs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    num: integer('num').notNull(),
    title: text('title').notNull(),
    author: uuid('author').notNull(),
    editor: uuid('editor').notNull(),
    status: text('status').$type<CrStatus>().notNull(),
    ops: jsonb('ops').$type<Op[]>().notNull().default([]),
    revision: integer('revision').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    mergedRev: integer('merged_rev'),
    mergedBy: uuid('merged_by'),
    mergedAt: tz('merged_at'),
    closedBy: uuid('closed_by'),
    closedAt: tz('closed_at'),
    closedRev: integer('closed_rev'),
    resolutions: jsonb('resolutions').$type<Resolution[]>().notNull().default([]),
  },
  (table) => [
    unique('tracker_crs_project_num_unique').on(table.projectId, table.num),
    unique('tracker_crs_project_id_unique').on(table.projectId, table.id),
    inProject('tracker_crs', table),
    memberIn('tracker_crs_author_fk', table.projectId, table.author),
    memberIn('tracker_crs_editor_fk', table.projectId, table.editor),
    memberIn('tracker_crs_merged_by_fk', table.projectId, table.mergedBy),
    memberIn('tracker_crs_closed_by_fk', table.projectId, table.closedBy),
  ],
);
const crIn = (name: string, projectId: PgColumn, crId: PgColumn) =>
  sameProject(name, [projectId, crId], (): Pair => [trackerCrs.projectId, trackerCrs.id]);
export const trackerCommits = pgTable(
  'tracker_commits',
  {
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    rev: integer('rev').notNull(),
    crId: uuid('cr_id').notNull(),
    mergedBy: uuid('merged_by').notNull(),
    mergedAt: tz('merged_at').notNull(),
    ops: jsonb('ops').$type<Op[]>().notNull(),
    resolutions: jsonb('resolutions').$type<Resolution[]>().notNull().default([]),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.rev] }),
    index('tracker_commits_cr_idx').on(table.crId),
    inProject('tracker_commits', table),
    crIn('tracker_commits_cr_fk', table.projectId, table.crId),
    memberIn('tracker_commits_merged_by_fk', table.projectId, table.mergedBy),
  ],
);
export const trackerCrShares = pgTable(
  'tracker_cr_shares',
  {
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    crId: uuid('cr_id').notNull(),
    memberId: uuid('member_id').notNull(),
    permission: text('permission').$type<CrPermission>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.crId, table.memberId] }),
    index('tracker_cr_shares_project_idx').on(table.projectId),
    inProject('tracker_cr_shares', table),
    crIn('tracker_cr_shares_cr_fk', table.projectId, table.crId),
    memberIn('tracker_cr_shares_member_fk', table.projectId, table.memberId),
  ],
);
export const trackerCrAsks = pgTable(
  'tracker_cr_asks',
  {
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    crId: uuid('cr_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.crId, table.memberId] }),
    index('tracker_cr_asks_project_idx').on(table.projectId),
    inProject('tracker_cr_asks', table),
    crIn('tracker_cr_asks_cr_fk', table.projectId, table.crId),
    memberIn('tracker_cr_asks_member_fk', table.projectId, table.memberId),
  ],
);
export const trackerCrComments = pgTable(
  'tracker_cr_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: integer('seq').generatedAlwaysAsIdentity(),
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    crId: uuid('cr_id').notNull(),
    memberId: uuid('member_id').notNull(),
    kind: text('kind').$type<CrCommentKind>().notNull(),
    body: text('body'),
    opIndex: integer('op_index'),
    createdAt: createdAt(),
  },
  (table) => [
    index('tracker_cr_comments_cr_idx').on(table.crId),
    index('tracker_cr_comments_project_idx').on(table.projectId),
    inProject('tracker_cr_comments', table),
    crIn('tracker_cr_comments_cr_fk', table.projectId, table.crId),
    memberIn('tracker_cr_comments_member_fk', table.projectId, table.memberId),
  ],
);
// A display choice of one person, so it lives outside the change requests and the graph history.
export const trackerEventOffsets = pgTable(
  'tracker_event_offsets',
  {
    workspaceId: tenantWorkspaceId(),
    projectId: tenantProjectId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    eventId: text('event_id').notNull(),
    offsetMinutes: integer('offset_minutes').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId, table.eventId] }),
    inProject('tracker_event_offsets', table),
  ],
);
