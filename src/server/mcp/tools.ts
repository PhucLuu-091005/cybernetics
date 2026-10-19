import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  GetProjectInputSchema,
  IdSchema,
  RevisionSchema,
  type ActorContext,
  type Scope,
} from '../../contracts';
import { OpSchema } from '../../tracker';
import { projects } from '../db/schema';
import { keyReaches, projectOpenTo, type Db } from '../db/tx';
import { getProject, listProjects } from '../domain/projects';
import { AppError, invalidInput } from '../errors';
import {
  AddQueueEventInputSchema,
  AddQueueItemInputSchema,
  addQueueEvent,
  addQueueItem,
  addTeam,
  AddTeamInputSchema,
  crAction,
  crBrief,
  createCr,
  appendOp,
  removeOp,
  deleteTeam,
  DeleteTeamInputSchema,
  dismissQueueEntry,
  DismissQueueEntryInputSchema,
  getChangeRequest,
  GetChangeRequestInputSchema,
  getTrackerSummary,
  GrantsSchema,
  inviteMember,
  InviteMemberInputSchema,
  listChangeRequests,
  ListChangeRequestsInputSchema,
  listProjectMembers,
  listQueue,
  ListQueueInputSchema,
  removeMember,
  RemoveMemberInputSchema,
  TrackerInputSchema,
  updateMember,
  updateTeam,
  UpdateTeamInputSchema,
  type CrActionInput,
} from '../tracker';
import { requireScope } from '../http/scopes';

type Shape = Record<string, z.ZodType>;
type McpTool = {
  name: string;
  /** Null for list_projects, which only names the projects a personal key can reach. */
  scope: Scope | null;
  description: string;
  readOnly: boolean;
  input: z.ZodObject<Shape>;
  personalInput: z.ZodObject<Shape>;
  personalOnly: boolean;
  run(db: Db, ctx: ActorContext, args: Record<string, unknown>): Promise<object>;
};

export const isPersonal = (ctx: ActorContext) => ctx.kind === 'agent' && ctx.key === 'personal';

/** The same project rule as a project key, checked at each call, so a removal stops the key at once. */
async function bindProject(db: Db, ctx: ActorContext, projectId: string): Promise<ActorContext> {
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), projectOpenTo(ctx.userId), keyReaches(ctx)))
    .limit(1);
  if (!row) throw new AppError('NOT_FOUND', 'Project not found');
  return { ...ctx, projectId, workspaceId: row.workspaceId };
}

type Input = Record<string, unknown> & { projectId: string | null };
type Run = (db: Db, ctx: ActorContext, input: Input) => Promise<object>;

/**
 * A project key fixes the project and its person, so its tool schema drops projectId and actAs, and
 * a smuggled one fails strict parsing instead of being overridden. A personal key fixes the person
 * only, so its schema requires projectId and still refuses actAs.
 */
function tool(name: string, scope: Scope, shape: Shape, description: string, run: Run): McpTool {
  const kept = Object.fromEntries(
    Object.entries(shape).filter(([key]) => key !== 'projectId' && key !== 'actAs'),
  );
  const input = z.strictObject(kept);
  const personalInput = z.strictObject({ projectId: IdSchema, ...kept });
  return {
    name,
    scope,
    description: `${description} Scope: ${scope}.`,
    readOnly: /^(get|list)_/.test(name),
    input,
    personalInput,
    personalOnly: false,
    async run(db, ctx, args) {
      requireScope(ctx, scope);
      const personal = isPersonal(ctx);
      const parsed = (personal ? personalInput : input).safeParse(args);
      if (!parsed.success) throw invalidInput(`Invalid ${name} arguments`, parsed.error);
      // The raw arguments go on, because every use case validates its full input again with Zod.
      if (!personal) return run(db, ctx, { ...args, projectId: ctx.projectId });
      const bound = await bindProject(db, ctx, parsed.data.projectId as string);
      const result = await run(db, bound, { ...args, projectId: bound.projectId });
      return { projectId: bound.projectId, ...result };
    },
  };
}

const listProjectsTool: McpTool = {
  name: 'list_projects',
  scope: null,
  description:
    'List the projects your person belongs to, with id and name. Every other tool takes one of these ids as projectId. A project your person joins later shows here too. Scope: none, personal keys only.',
  readOnly: true,
  input: z.strictObject({}),
  personalInput: z.strictObject({}),
  personalOnly: true,
  async run(db, ctx, args) {
    if (!isPersonal(ctx)) throw new AppError('NOT_FOUND', 'Unknown tool list_projects');
    const parsed = z.strictObject({}).safeParse(args);
    if (!parsed.success) throw invalidInput('Invalid list_projects arguments', parsed.error);
    const rows = await listProjects(db, ctx);
    return { projects: rows.map((project) => ({ id: project.id, name: project.title })) };
  },
};

// The use cases type their input exactly; each one validates it again, so the cast loses nothing.
const typed = <I>(input: Input) => input as unknown as I;

const PEOPLE =
  'Person ids (by, doneBy, requestedBy) must be ids from the people list of get_tracker; milestoneId and after must be ids from get_tracker.';
const PAGE =
  'Newest first, at most limit entries (default 50, at most 200) and 40,000 characters; pass nextBefore as before to read the next page, until nextBefore is null.';
const SEEN =
  'expectedRevision is the revision from get_change_request; a change request that changed since then answers CONFLICT.';

const OP_NAMES = OpSchema.options.map((option) => option.shape.op.value) as [string, ...string[]];
const OpInputSchema = z.strictObject({
  op: z.enum(OP_NAMES),
  a: z.record(z.string(), z.unknown()),
});
const Num = { num: z.number().int().positive() };
const Seen = { ...Num, expectedRevision: RevisionSchema.optional() };
const Reviewed = { ...Num, expectedRevision: RevisionSchema };
const MemberRef = z.string().max(100);

type Action = CrActionInput['action'];
/** One tool per change request action, so each action has its own scope. */
function crTool(name: string, scope: Scope, action: Action, shape: Shape, description: string) {
  return tool(name, scope, shape, description, async (db, ctx, input) =>
    crBrief(
      await crAction(db, ctx, typed<CrActionInput>({ ...input, action })),
      input.num as number,
    ),
  );
}

const OPS = [
  'Each change is {op, a}; the server adds who and when. The kinds and their a:',
  'attach {eventId, workItemId} puts a Queue event on a work item;',
  'place {itemId, teamId, plannedFinish?, plannedFinishTime?} puts a Queue work item in a team;',
  'qms {itemId, milestoneId} gives a placed Queue work item a milestone;',
  'fromEvent {id, eventId, teamId, title, doneBy, requestedBy, after, plannedFinish, plannedFinishTime?} makes a work item from a Queue event;',
  'addEvent {workItemId, ev: {id, kind, at, by, text, finishes?}};',
  'move {eventId, to} moves an event to another work item; kind {eventId, kind, finishes?}; hide {eventId};',
  'rename {workItemId, title}; due {workItemId, date, why, time?} moves a planned finish;',
  'doneBy and requestedBy {workItemId, personId}; team {workItemId, teamId}; parent {workItemId, parentId}; after {workItemId, after: [ids]};',
  'newMs {id, name, planned, time?, members: [workItemIds]}; msDate {milestoneId, date, why, time?}; msName {milestoneId, name}; msAdd {workItemId, milestoneId}; msRemove {workItemId};',
  'addTeam {id, name, leadId}.',
  'A new id (event, work item, milestone, team) is yours to choose: letters, digits, _ and -.',
].join(' ');

export const MCP_TOOLS: readonly McpTool[] = [
  listProjectsTool,
  tool(
    'get_project',
    'project:read',
    GetProjectInputSchema.shape,
    'Read the project title, client name and time zone. Start here, then read get_tracker.',
    (db, ctx, input) => getProject(db, ctx, typed(input)),
  ),
  tool(
    'get_tracker',
    'project:read',
    TrackerInputSchema.shape,
    'Read Main of the event tracker: revision, people (id and name), teams, work items with status and planned finish (plannedFinish, and plannedFinishTime as HH:mm or null for the end of that day; firstPlannedFinish and firstPlannedFinishTime the same for the first plan), milestones with status and deadline (planned and plannedTime; firstPlanned and firstPlannedTime for the first plan), and the open change requests. Statuses and times use the project time zone; asOf is the moment the statuses use. Read it before you write, to get the ids.',
    (db, ctx, input) => getTrackerSummary(db, ctx, typed(input)),
  ),
  tool(
    'list_queue',
    'project:read',
    ListQueueInputSchema.shape,
    `List the events and work items that wait in the Queue for a person to place them. agent is true for cards that an agent added. ${PAGE} before is a created time (ISO 8601).`,
    (db, ctx, input) => listQueue(db, ctx, typed(input)),
  ),
  tool(
    'list_change_requests',
    'project:read',
    ListChangeRequestsInputSchema.shape,
    `List the change requests, optionally by status (draft, ready, merged or closed), with their revision and editor. ${PAGE} before is a change request number.`,
    (db, ctx, input) => listChangeRequests(db, ctx, typed(input)),
  ),
  tool(
    'get_change_request',
    'project:read',
    GetChangeRequestInputSchema.shape,
    'Read one change request by number: revision, editor, its changes in plain words (index, kind, who, agent), shares, asks to edit, comments and merge resolutions. Read it before a write on it, for its revision and change indexes.',
    (db, ctx, input) => getChangeRequest(db, ctx, typed(input)),
  ),
  tool(
    'list_members',
    'project:read',
    {},
    'List the members (id, name, email, project lead, grants, rights, teams) and the teams (id, name, lead, people). canManage and canManageTeams say whether this token may manage members and teams. Use it for the member ids that share, hand over, decline and the member and team tools take.',
    (db, ctx, input) => listProjectMembers(db, ctx, typed(input)),
  ),
  tool(
    'add_queue_event',
    'queue:add',
    AddQueueEventInputSchema.shape,
    `Add an event to the Queue: kind (idea, message, issue, task, meeting, decision, delivery, handoff, done or cancelled), at as ISO 8601 with offset, by (optional; your person when you leave it out), text, optional finishes. Done, Cancelled and a Handoff with finishes true finish the work item; Cancelled needs the reason as its text. Main does not change until a person places it through a change request. ${PEOPLE} Example: {"kind":"issue","at":"2026-10-09T16:30+07:00","by":"sarah","text":"Sync gap"}.`,
    (db, ctx, input) => addQueueEvent(db, ctx, typed(input)),
  ),
  tool(
    'add_queue_item',
    'queue:add',
    AddQueueItemInputSchema.shape,
    `Add a work item to the Queue: title, optional note, doneBy, requestedBy, optional milestoneId and after, plannedFinish as YYYY-MM-DD, optional plannedFinishTime as HH:mm in the project time zone. Main does not change until a person places it. ${PEOPLE}`,
    (db, ctx, input) => addQueueItem(db, ctx, typed(input)),
  ),
  tool(
    'remove_queue_card',
    'queue:dismiss',
    DismissQueueEntryInputSchema.shape,
    'Remove a wrong or duplicate card from the Queue by its id (queueId from list_queue). A card that Main or an open change request uses stays (CONFLICT).',
    async (db, ctx, input) => {
      await dismissQueueEntry(db, ctx, typed(input));
      return { removed: input.queueId };
    },
  ),
  tool(
    'create_change_request',
    'crs:edit',
    { title: z.string().min(1).max(200), ops: z.array(OpInputSchema).max(500).optional() },
    `Open a draft change request with a title and optional first changes; you edit it. Answers its number and revision. ${OPS} Example: {"title":"Place PG-204","ops":[{"op":"place","a":{"itemId":"<queue item id>","teamId":"engineering"}}]}.`,
    async (db, ctx, input) => {
      const { num, payload } = await createCr(db, ctx, typed(input));
      return crBrief(payload, num);
    },
  ),
  tool(
    'add_change',
    'crs:edit',
    { ...Num, expectedRevision: RevisionSchema, op: OpInputSchema },
    `Add one change to a draft change request that you edit. ${SEEN} The change kinds are in create_change_request. Example: {"num":5,"expectedRevision":2,"op":{"op":"rename","a":{"workItemId":"pg203","title":"PG-203 Country list"}}}.`,
    async (db, ctx, input) => crBrief(await appendOp(db, ctx, typed(input)), input.num as number),
  ),
  tool(
    'remove_change',
    'crs:edit',
    {
      ...Num,
      expectedRevision: RevisionSchema,
      index: z.union([z.literal('last'), z.number().int().nonnegative()]),
    },
    `Remove one change (its index from get_change_request, or "last") from a draft change request that you edit. ${SEEN}`,
    async (db, ctx, input) => crBrief(await removeOp(db, ctx, typed(input)), input.num as number),
  ),
  crTool(
    'hand_over_change_request',
    'crs:edit',
    'handover',
    { ...Seen, to: MemberRef },
    'Let another member edit a change request that you edit now. They need edit access first (share_change_request).',
  ),
  crTool(
    'share_change_request',
    'crs:edit',
    'share',
    { ...Seen, memberId: MemberRef, permission: z.enum(['edit', 'view', 'remove']) },
    'Give a member edit or view access to a change request that you edit, or take it back with remove.',
  ),
  crTool(
    'ask_to_edit',
    'crs:edit',
    'ask',
    Seen,
    'Ask the person who edits a change request to let you edit it.',
  ),
  crTool(
    'cancel_ask_to_edit',
    'crs:edit',
    'cancel-ask',
    Seen,
    'Take back your ask to edit a change request.',
  ),
  crTool(
    'decline_ask_to_edit',
    'crs:edit',
    'decline',
    { ...Seen, who: MemberRef },
    'Say no to the ask of a member (who) to edit a change request that you edit.',
  ),
  crTool(
    'mark_ready',
    'crs:ready',
    'ready',
    Seen,
    'Mark a draft change request that you edit as ready to merge. It needs at least one change.',
  ),
  crTool(
    'mark_draft',
    'crs:ready',
    'unready',
    Seen,
    'Move a ready change request that you edit back to draft, to change it again.',
  ),
  crTool(
    'comment_change_request',
    'crs:comment',
    'comment',
    {
      ...Seen,
      body: z.string().min(1).max(4000),
      opIndex: z.number().int().nonnegative().nullish(),
    },
    'Comment on an open change request, or on one of its changes with opIndex.',
  ),
  crTool(
    'merge_change_request',
    'crs:merge',
    'merge',
    { ...Reviewed, picks: z.record(z.string().max(300), z.enum(['main', 'cr'])).optional() },
    `Merge a ready change request into Main. Where a change clashes with a newer Main change, picks names the version to keep per clash key: "main" or "cr". A wrong or missing key answers CONFLICT with the keys in details. ${SEEN} Example: {"num":2,"expectedRevision":3,"picks":{"rename:pg203":"cr"}}.`,
  ),
  crTool(
    'request_changes',
    'crs:merge',
    'request-changes',
    { ...Reviewed, note: z.string().min(1).max(4000) },
    `Send a ready change request back to draft with a note of what to change. ${SEEN}`,
  ),
  crTool(
    'cancel_change_request',
    'crs:close',
    'close',
    { ...Reviewed, reason: z.string().min(1).max(1000) },
    `Cancel an open change request with a reason. Your person can cancel one they wrote or edit; any other one needs the Merge right and also the crs:merge scope. ${SEEN}`,
  ),
  tool(
    'invite_member',
    'members:manage',
    InviteMemberInputSchema.shape,
    'Invite a person by email, with optional grants (default: view Main, view and create change requests). They join when they sign in with that email. Example: {"email":"lan@example.com","grants":{"viewMain":true,"viewCrs":true,"createCrs":true,"mergeCrs":false}}.',
    (db, ctx, input) => inviteMember(db, ctx, typed(input)),
  ),
  tool(
    'set_member_grants',
    'members:manage',
    { memberId: IdSchema, grants: GrantsSchema },
    'Set the four grants of a member (viewMain, viewCrs, createCrs, mergeCrs). Create and merge also turn on the view grants. The project lead has every right and keeps it.',
    (db, ctx, input) => updateMember(db, ctx, typed(input)),
  ),
  tool(
    'remove_member',
    'members:manage',
    RemoveMemberInputSchema.shape,
    'Remove a member from the project. Their name stays on past work; their shares end and their agent tokens stop working.',
    (db, ctx, input) => removeMember(db, ctx, typed(input)),
  ),
  tool(
    'add_team',
    'teams:manage',
    AddTeamInputSchema.shape,
    'Add a team with a name. Its work items come later through change requests.',
    (db, ctx, input) => addTeam(db, ctx, typed(input)),
  ),
  tool(
    'update_team',
    'teams:manage',
    UpdateTeamInputSchema.shape,
    'Rename a team, set its lead (a member id, or null) and its people (memberIds replaces the list). Leave out what stays. Example: {"teamId":"engineering","leadId":"<member id>","memberIds":["<member id>"]}.',
    (db, ctx, input) => updateTeam(db, ctx, typed(input)),
  ),
  tool(
    'delete_team',
    'teams:manage',
    DeleteTeamInputSchema.shape,
    'Delete a team that has no work items and that no change request uses. The last team stays.',
    (db, ctx, input) => deleteTeam(db, ctx, typed(input)),
  ),
];
