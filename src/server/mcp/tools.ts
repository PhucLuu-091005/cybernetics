import { z } from 'zod';
import { GetProjectInputSchema, type ActorContext, type Scope } from '../../contracts';
import type { Db } from '../db/tx';
import { getProject } from '../domain/projects';
import { invalidInput } from '../errors';
import {
  AddQueueEventInputSchema,
  AddQueueItemInputSchema,
  addQueueEvent,
  addQueueItem,
  getChangeRequest,
  GetChangeRequestInputSchema,
  getTrackerSummary,
  listChangeRequests,
  ListChangeRequestsInputSchema,
  listQueue,
  TrackerInputSchema,
} from '../tracker';
import { requireScope } from '../http/scopes';

type Shape = Record<string, z.ZodType>;
export type McpTool = {
  name: string;
  scope: Scope;
  description: string;
  readOnly: boolean;
  input: z.ZodObject<Shape>;
  run(db: Db, ctx: ActorContext, args: Record<string, unknown>): Promise<object>;
};

type DomainFn = (db: Db, ctx: ActorContext, input: never) => Promise<object>;

/** The token fixes the project, so the tool schema drops projectId and a smuggled projectId fails strict parsing instead of being overridden. */
function tool(
  name: string,
  scope: Scope,
  schema: { shape: Shape },
  description: string,
  fn: DomainFn,
): McpTool {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).filter(([key]) => key !== 'projectId'),
  );
  const input = z.strictObject(shape);
  return {
    name,
    scope,
    description,
    readOnly: /^(get|list)_/.test(name),
    input,
    async run(db, ctx, args) {
      requireScope(ctx, scope);
      const parsed = input.safeParse(args);
      if (!parsed.success) throw invalidInput(`Invalid ${name} arguments`, parsed.error);
      // The cast is safe because every domain entry point re-validates its full input, projectId included, with Zod.
      return fn(db, ctx, { ...args, projectId: ctx.projectId } as never);
    },
  };
}

const PEOPLE =
  'Person ids (by, doneBy, requestedBy) must be ids from the people list of get_tracker; milestoneId and after must be ids from get_tracker.';

export const MCP_TOOLS: readonly McpTool[] = [
  tool(
    'get_project',
    'project:read',
    GetProjectInputSchema,
    'Read the project title, client name and time zone. Start here, then read get_tracker.',
    getProject,
  ),
  tool(
    'get_tracker',
    'project:read',
    TrackerInputSchema,
    'Read Main of the event tracker: people (id and name), teams, work items with status and planned finish, milestones with status, and the open change requests. Statuses use asOf in the project time zone.',
    getTrackerSummary,
  ),
  tool(
    'list_queue',
    'project:read',
    TrackerInputSchema,
    'List the events and work items that wait in the Queue for a person to place them on the graph. agent is true for cards that an agent added.',
    listQueue,
  ),
  tool(
    'add_queue_event',
    'queue:add',
    AddQueueEventInputSchema,
    `Add an event (kind message, task, handoff, decision, meeting, delivery, issue or done; at as ISO 8601 with offset; by; text) to the Queue. Main does not change until a person places it through a change request. ${PEOPLE}`,
    addQueueEvent,
  ),
  tool(
    'add_queue_item',
    'queue:add',
    AddQueueItemInputSchema,
    `Add a work item (title, optional note, doneBy, requestedBy, optional milestoneId and after, plannedFinish as YYYY-MM-DD) to the Queue. Main does not change until a person places it through a change request. ${PEOPLE}`,
    addQueueItem,
  ),
  tool(
    'list_change_requests',
    'project:read',
    ListChangeRequestsInputSchema,
    'List the change requests of the project, optionally by status (draft, ready, merged or closed).',
    listChangeRequests,
  ),
  tool(
    'get_change_request',
    'project:read',
    GetChangeRequestInputSchema,
    'Read one change request by number: its changes in plain words, shares, asks, comments and merge resolutions.',
    getChangeRequest,
  ),
];
