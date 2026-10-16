import { z } from 'zod';
import {
  EVENT_KINDS,
  type DateMove,
  type Milestone,
  type Person,
  type QueueEvent,
  type QueueItem,
  type Team,
  type TrackerBase,
  type TrackerEvent,
  type TrackerState,
  type WorkItem,
} from './model';

// Clash keys join ids with ':', so an id must never contain one.
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const DateString = z.iso.date();
const MINUTE_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/;
const Instant = z.preprocess(
  (value) => (typeof value === 'string' ? value.replace(MINUTE_INSTANT, '$1:00$2') : value),
  z.iso.datetime({ offset: true }),
);
const filled = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== '', 'Must not be empty');
const Title = filled(200);
const Body = filled(4000);
const Why = filled(1000);
const Note = z.string().max(2000);

export const EventKindSchema = z.enum(EVENT_KINDS);

export const PersonSchema = z.strictObject({ id: Id, name: Title }) satisfies z.ZodType<Person>;

export const TeamSchema = z.strictObject({
  id: Id,
  name: Title,
  leadId: Id.nullable(),
}) satisfies z.ZodType<Team>;

export const DateMoveSchema = z.strictObject({
  from: DateString,
  to: DateString,
  why: Why,
  by: Id,
  at: Instant,
}) satisfies z.ZodType<DateMove>;

export const MilestoneSchema = z.strictObject({
  id: Id,
  name: Title,
  planned: DateString,
  firstPlanned: DateString,
  moves: z.array(DateMoveSchema),
}) satisfies z.ZodType<Milestone>;

export const WorkItemSchema = z.strictObject({
  id: Id,
  title: Title,
  teamId: Id,
  doneBy: Id,
  requestedBy: Id,
  milestoneId: Id.nullable(),
  parentId: Id.nullable(),
  after: z.array(Id),
  plannedFinish: DateString,
  firstPlannedFinish: DateString,
  moves: z.array(DateMoveSchema),
  since: Instant.nullable(),
}) satisfies z.ZodType<WorkItem>;

export const TrackerEventSchema = z.strictObject({
  id: Id,
  workItemId: Id,
  kind: EventKindSchema,
  at: Instant,
  by: Id,
  text: Body,
  addedBy: Id.nullable(),
  hidden: z.boolean(),
}) satisfies z.ZodType<TrackerEvent>;

export const QueueEventInputSchema = z.strictObject({
  kind: EventKindSchema,
  at: Instant,
  by: Id,
  text: Body,
});
export type QueueEventInput = z.infer<typeof QueueEventInputSchema>;

export const QueueItemInputSchema = z.strictObject({
  title: Title,
  note: Note.default(''),
  doneBy: Id,
  requestedBy: Id,
  milestoneId: Id.nullable().default(null),
  after: Id.nullable().default(null),
  plannedFinish: DateString,
});
export type QueueItemInput = z.infer<typeof QueueItemInputSchema>;

const queued = { addedBy: Id.nullable(), agent: z.boolean(), createdAt: Instant };

export const QueueEventSchema = z.strictObject({
  id: Id,
  ...QueueEventInputSchema.shape,
  ...queued,
}) satisfies z.ZodType<QueueEvent>;

export const QueueItemSchema = z.strictObject({
  id: Id,
  ...QueueItemInputSchema.shape,
  note: Note,
  milestoneId: Id.nullable(),
  after: Id.nullable(),
  ...queued,
}) satisfies z.ZodType<QueueItem>;

export const TrackerBaseSchema = z.strictObject({
  people: z.array(PersonSchema),
  teams: z.array(TeamSchema),
  milestones: z.array(MilestoneSchema),
  workItems: z.array(WorkItemSchema),
  events: z.array(TrackerEventSchema),
}) satisfies z.ZodType<TrackerBase>;

export const TrackerStateSchema = z.strictObject({
  ...TrackerBaseSchema.shape,
  queue: z.strictObject({ events: z.array(QueueEventSchema), items: z.array(QueueItemSchema) }),
}) satisfies z.ZodType<TrackerState>;

export const AttachArgsSchema = z.strictObject({ eventId: Id, workItemId: Id });
export const PlaceArgsSchema = z.strictObject({
  itemId: Id,
  teamId: Id,
  plannedFinish: DateString.optional(),
});
export const QmsArgsSchema = z.strictObject({ itemId: Id, milestoneId: Id });
export const FromEventArgsSchema = z.strictObject({
  id: Id,
  eventId: Id,
  teamId: Id,
  title: Title,
  doneBy: Id,
  requestedBy: Id,
  after: Id.nullable(),
  plannedFinish: DateString,
});
export const NewEventSchema = z.strictObject({ id: Id, ...QueueEventInputSchema.shape });
export const AddEventArgsSchema = z.strictObject({ workItemId: Id, ev: NewEventSchema });
export const MoveArgsSchema = z.strictObject({ eventId: Id, to: Id });
export const KindArgsSchema = z.strictObject({ eventId: Id, kind: EventKindSchema });
export const HideArgsSchema = z.strictObject({ eventId: Id });
const dateMoveArgs = { date: DateString, why: Why, by: Id, at: Instant };
export const MsDateArgsSchema = z.strictObject({ milestoneId: Id, ...dateMoveArgs });
export const MsNameArgsSchema = z.strictObject({ milestoneId: Id, name: Title });
export const MsRemoveArgsSchema = z.strictObject({ workItemId: Id });
export const MsAddArgsSchema = z.strictObject({ workItemId: Id, milestoneId: Id });
export const NewMsArgsSchema = z.strictObject({
  id: Id,
  name: Title,
  planned: DateString,
  members: z.array(Id).max(500),
});
export const RenameArgsSchema = z.strictObject({ workItemId: Id, title: Title });
export const DueArgsSchema = z.strictObject({ workItemId: Id, ...dateMoveArgs });
export const AddTeamArgsSchema = z.strictObject({ id: Id, name: Title, leadId: Id.nullable() });

export const OpDescriptionSchema = z.strictObject({
  item: z.string(),
  change: z.string(),
  before: z.string(),
  after: z.string(),
  icon: EventKindSchema.optional(),
  why: z.string().optional(),
});

const opOf = <N extends string, A extends z.ZodType>(op: N, a: A) =>
  z.strictObject({
    op: z.literal(op),
    a,
    rev: z.number().int().nonnegative(),
    by: Id,
    d: OpDescriptionSchema.optional(),
  });

export const OpSchema = z.discriminatedUnion('op', [
  opOf('attach', AttachArgsSchema),
  opOf('place', PlaceArgsSchema),
  opOf('qms', QmsArgsSchema),
  opOf('fromEvent', FromEventArgsSchema),
  opOf('addEvent', AddEventArgsSchema),
  opOf('move', MoveArgsSchema),
  opOf('kind', KindArgsSchema),
  opOf('hide', HideArgsSchema),
  opOf('msDate', MsDateArgsSchema),
  opOf('msName', MsNameArgsSchema),
  opOf('msRemove', MsRemoveArgsSchema),
  opOf('msAdd', MsAddArgsSchema),
  opOf('newMs', NewMsArgsSchema),
  opOf('rename', RenameArgsSchema),
  opOf('due', DueArgsSchema),
  opOf('addTeam', AddTeamArgsSchema),
]);
