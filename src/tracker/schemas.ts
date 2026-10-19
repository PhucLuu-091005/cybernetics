import { z } from 'zod';
import {
  EVENT_KINDS,
  type DateMove,
  type EventKind,
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
import { TIME_OF_DAY } from './deadline';

// Clash keys join ids with ':', so an id must never contain one.
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const DateString = z.iso.date();
const TimeOfDay = z.string().regex(TIME_OF_DAY, 'Use a time like 17:00');
const MINUTE_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/;
const Instant = z.preprocess(
  (value) => (typeof value === 'string' ? value.replace(MINUTE_INSTANT, '$1:00$2') : value),
  z.iso.datetime({ offset: true }),
);
// Postgres refuses NUL in text and jsonb, so a NUL must fail validation instead of the insert.
export const noNul = <T extends z.ZodType<string>>(schema: T) =>
  schema.refine((value) => !value.includes('\u0000'), 'Remove the NUL character');
/** The longest text each kind of field takes; the inputs cap at the same numbers. */
export const TEXT_MAX = { title: 200, body: 4000, why: 1000, note: 2000 } as const;
export const atMost = (max: number) => `at most ${max} characters`;
const filled = (max: number) =>
  noNul(
    z
      .string()
      .max(max, atMost(max))
      .refine((value) => value.trim() !== '', 'Must not be empty'),
  );
const Title = filled(TEXT_MAX.title);
const Body = filled(TEXT_MAX.body);
const Why = filled(TEXT_MAX.why);
const Note = noNul(z.string().max(TEXT_MAX.note, atMost(TEXT_MAX.note)));

export const EventKindSchema = z.enum(EVENT_KINDS);

/** `finishes: false` and no flag must be one change, or a CR op and its Main twin would clash. */
function normaliseFinish<T extends { kind: EventKind; finishes?: boolean }>(
  value: T,
): Omit<T, 'finishes'> & { finishes?: boolean } {
  const { finishes, ...rest } = value;
  return value.kind === 'handoff' && finishes === true ? { ...rest, finishes: true } : rest;
}

const PersonSchema = z.strictObject({ id: Id, name: Title }) satisfies z.ZodType<Person>;

const TeamSchema = z.strictObject({
  id: Id,
  name: Title,
  leadId: Id.nullable(),
}) satisfies z.ZodType<Team>;

const DateMoveSchema = z.strictObject({
  from: DateString,
  fromTime: TimeOfDay.optional(),
  to: DateString,
  toTime: TimeOfDay.optional(),
  why: Why,
  by: Id,
  at: Instant,
}) satisfies z.ZodType<DateMove>;

export const MilestoneSchema = z.strictObject({
  id: Id,
  name: Title,
  planned: DateString,
  plannedTime: TimeOfDay.optional(),
  firstPlanned: DateString,
  firstPlannedTime: TimeOfDay.optional(),
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
  plannedFinishTime: TimeOfDay.optional(),
  firstPlannedFinish: DateString,
  firstPlannedFinishTime: TimeOfDay.optional(),
  moves: z.array(DateMoveSchema),
  since: Instant.nullable(),
}) satisfies z.ZodType<WorkItem>;

const eventFields = {
  kind: EventKindSchema,
  at: Instant,
  by: Id,
  text: Body,
  finishes: z.boolean().optional(),
};

export const TrackerEventSchema = z
  .strictObject({
    id: Id,
    workItemId: Id,
    ...eventFields,
    addedBy: Id.nullable(),
    hidden: z.boolean(),
  })
  .transform(normaliseFinish) satisfies z.ZodType<TrackerEvent>;

/** Without the normalising step, for schemas that need its shape; parse with QueueEventInputSchema. */
export const QueueEventFieldsSchema = z.strictObject(eventFields);
export const QueueEventInputSchema = QueueEventFieldsSchema.transform(normaliseFinish);
export type QueueEventInput = z.infer<typeof QueueEventInputSchema>;

export const QueueItemInputSchema = z.strictObject({
  title: Title,
  note: Note.default(''),
  doneBy: Id,
  requestedBy: Id,
  milestoneId: Id.nullable().default(null),
  after: Id.nullable().default(null),
  plannedFinish: DateString,
  plannedFinishTime: TimeOfDay.optional(),
});
export type QueueItemInput = z.infer<typeof QueueItemInputSchema>;

const queued = { addedBy: Id.nullable(), agent: z.boolean(), createdAt: Instant };

export const QueueEventSchema = z
  .strictObject({ id: Id, ...eventFields, ...queued })
  .transform(normaliseFinish) satisfies z.ZodType<QueueEvent>;

const QueueItemSchema = z.strictObject({
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

const AttachArgsSchema = z.strictObject({ eventId: Id, workItemId: Id });
export const PlaceArgsSchema = z.strictObject({
  itemId: Id,
  teamId: Id,
  /** The seed history keeps the story ids and its open start; a person's place takes the card's. */
  id: Id.optional(),
  since: Instant.nullable().optional(),
  plannedFinish: DateString.optional(),
  /** Read only with plannedFinish; absent means the end of that day. */
  plannedFinishTime: TimeOfDay.optional(),
});
const QmsArgsSchema = z.strictObject({ itemId: Id, milestoneId: Id });
export const FromEventArgsSchema = z.strictObject({
  id: Id,
  eventId: Id,
  teamId: Id,
  title: Title,
  doneBy: Id,
  requestedBy: Id,
  after: Id.nullable(),
  plannedFinish: DateString,
  plannedFinishTime: TimeOfDay.optional(),
});
export const NewEventSchema = z.strictObject({ id: Id, ...eventFields }).transform(normaliseFinish);
export const AddEventArgsSchema = z.strictObject({ workItemId: Id, ev: NewEventSchema });
const MoveArgsSchema = z.strictObject({ eventId: Id, to: Id });
export const KindArgsSchema = z
  .strictObject({ eventId: Id, kind: EventKindSchema, finishes: z.boolean().optional() })
  .transform(normaliseFinish);
const HideArgsSchema = z.strictObject({ eventId: Id });
const dateMoveArgs = { date: DateString, why: Why, by: Id, at: Instant };
export const MsDateArgsSchema = z.strictObject({
  milestoneId: Id,
  ...dateMoveArgs,
  time: TimeOfDay.optional(),
});
const MsNameArgsSchema = z.strictObject({ milestoneId: Id, name: Title });
const MsRemoveArgsSchema = z.strictObject({ workItemId: Id });
const MsAddArgsSchema = z.strictObject({ workItemId: Id, milestoneId: Id });
export const NewMsArgsSchema = z.strictObject({
  id: Id,
  name: Title,
  planned: DateString,
  time: TimeOfDay.optional(),
  members: z.array(Id).max(500),
});
const RenameArgsSchema = z.strictObject({ workItemId: Id, title: Title });
export const DueArgsSchema = z.strictObject({
  workItemId: Id,
  ...dateMoveArgs,
  time: TimeOfDay.optional(),
});
const DoneByArgsSchema = z.strictObject({ workItemId: Id, personId: Id });
const RequestedByArgsSchema = z.strictObject({ workItemId: Id, personId: Id });
const TeamArgsSchema = z.strictObject({ workItemId: Id, teamId: Id });
const ParentArgsSchema = z.strictObject({ workItemId: Id, parentId: Id.nullable() });
const AfterArgsSchema = z.strictObject({ workItemId: Id, after: z.array(Id).max(50) });
const AddTeamArgsSchema = z.strictObject({ id: Id, name: Title, leadId: Id.nullable() });

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
    /** An agent added it for `by`; audit only, the app shows `by` as the author. */
    agent: z.literal(true).optional(),
    /** The label of the key, shown as a small detail in History. */
    via: z.string().min(1).max(200).optional(),
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
  opOf('doneBy', DoneByArgsSchema),
  opOf('requestedBy', RequestedByArgsSchema),
  opOf('team', TeamArgsSchema),
  opOf('parent', ParentArgsSchema),
  opOf('after', AfterArgsSchema),
]);

const TeamName = noNul(z.string().trim().max(200, 'Keep each team name to 200 characters'));
/** The New project form sends one team per line, so blank lines drop out. */
export const ProjectTeamsSchema = z
  .array(TeamName)
  .max(50, 'Add at most 50 teams')
  .default([])
  .transform((teams) => teams.filter((team) => team !== ''))
  .refine((teams) => teams.length > 0, 'Add at least one team')
  .refine(
    (teams) => new Set(teams.map((team) => team.toLocaleLowerCase())).size === teams.length,
    'Each team needs its own name',
  );
export const FirstMilestoneSchema = z
  .strictObject({
    name: noNul(z.string().trim().min(1).max(200, 'Keep the milestone name to 200 characters')),
    date: DateString,
    time: TimeOfDay.optional(),
  })
  .nullish();
