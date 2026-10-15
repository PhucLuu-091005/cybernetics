import { z } from 'zod';
import { markerErrors } from './markers';
import {
  DateSchema,
  IdSchema,
  RevisionSchema,
  SideSchema,
  TextSchema,
  TimestampSchema,
  TimeZoneSchema,
  boundedJson,
} from './primitives';

export const ActTypeSchema = z.enum([
  'request',
  'promise',
  'counter',
  'decline',
  'renegotiate',
  'agree_change',
  'report_done',
  'accept',
  'reject',
  'cancel',
  'follow_up',
]);
export const DueSchema = z
  .strictObject({ date: DateSchema, precision: z.enum(['day', 'week', 'month']) })
  .nullable();
export const CitationSchema = z
  .strictObject({ recordVersionId: IdSchema, start: RevisionSchema, end: RevisionSchema })
  .refine(
    (value) => value.end > value.start && value.end - value.start <= 400,
    'Citation must span 1–400 UTF-16 code units',
  );
export const PartySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('person'), personId: IdSchema }),
  z.strictObject({ kind: z.literal('side'), side: SideSchema }),
]);
export const PersonSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(200),
  side: z.enum(['client', 'vendor', 'unknown']),
  departmentId: IdSchema.nullable(),
  role: z.string().max(200),
});
export const DepartmentSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(200),
  side: SideSchema,
  order: RevisionSchema,
});
export const MilestoneSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(200),
  order: RevisionSchema,
  plannedDate: DateSchema,
  currentDate: DateSchema,
  reachedAt: TimestampSchema.nullable(),
  anchorLoopId: IdSchema.nullable(),
});
export const ActSchema = z.strictObject({
  id: IdSchema,
  citation: CitationSchema,
  type: ActTypeSchema,
  actor: PartySchema,
  customer: PartySchema,
  performer: PartySchema,
  action: z.string().min(1).max(2000),
  due: DueSchema,
  hedged: z.boolean(),
  loopId: IdSchema.nullable(),
  hidden: z.boolean(),
  origin: z.enum(['human', 'agent']),
  confidence: z.number().min(0).max(1).nullable(),
});
export const LoopSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1).max(200),
  customer: PartySchema,
  performer: PartySchema,
  performerDepartmentId: IdSchema,
  milestoneId: IdSchema.nullable(),
  /** Present only on a task: the top-level loop (a promise) whose work this task carries. */
  parentLoopId: IdSchema.optional(),
  /** Present only on a task: sibling tasks that hand off to this one (Linear "blocked by"). */
  afterLoopIds: z.array(IdSchema).min(1).max(20).optional(),
});
export const RecordDecisionSchema = z
  .strictObject({
    recordVersionId: IdSchema,
    disposition: z.enum(['included', 'ignored']),
    reason: z.string().max(2000),
  })
  .refine(
    (value) => value.disposition !== 'ignored' || value.reason.trim().length > 0,
    'Ignored decisions require a reason',
  );
export const AnnotationSchema = z
  .strictObject({
    id: IdSchema,
    text: z.string().min(1).max(10000),
    actIds: z.array(IdSchema).max(3000),
  })
  .superRefine((value, ctx) => {
    for (const message of markerErrors(value.text, value.actIds))
      ctx.addIssue({ code: 'custom', path: ['text'], message });
  });
export const GraphContextSchema = z
  .strictObject({
    timeZone: TimeZoneSchema,
    windowStart: DateSchema,
    windowEnd: DateSchema,
    asOfOverride: TimestampSchema.nullable(),
    holidays: z.array(DateSchema).max(1000),
    replyWindowDays: RevisionSchema,
    acceptWindowDays: RevisionSchema,
    hedgeWindowDays: RevisionSchema,
    atRiskWindowDays: RevisionSchema,
    people: z.array(PersonSchema).max(1000),
    departments: z.array(DepartmentSchema).max(1000),
    milestones: z.array(MilestoneSchema).max(1000),
  })
  .refine((value) => value.windowStart <= value.windowEnd, 'Project window end precedes start');
const SnapshotShapeSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    context: GraphContextSchema,
    acts: z.array(ActSchema).max(3000),
    loops: z.array(LoopSchema).max(300),
    annotations: z.array(AnnotationSchema).max(1000),
    recordDecisions: z.array(RecordDecisionSchema).max(1000),
  })
  .superRefine((value, ctx) => {
    const arrays = [
      value.acts,
      value.loops,
      value.annotations,
      value.context.people,
      value.context.departments,
      value.context.milestones,
    ];
    for (const array of arrays)
      if (new Set(array.map((entity) => entity.id)).size !== array.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate entity IDs' });
    if (
      new Set(value.recordDecisions.map((entity) => entity.recordVersionId)).size !==
      value.recordDecisions.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate record decision IDs' });
    if (
      new Set([
        ...value.acts.map((act) => act.citation.recordVersionId),
        ...value.recordDecisions.map((decision) => decision.recordVersionId),
      ]).size > 1000
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Snapshot references more than 1,000 record versions',
      });
  });
export const GraphSnapshotSchema = boundedJson(SnapshotShapeSchema, 5 * 1024 * 1024);
export const CollectionSchema = z.enum(['acts', 'loops', 'annotations', 'recordDecisions']);
const put = z.discriminatedUnion('collection', [
  z.strictObject({
    op: z.literal('put'),
    collection: z.literal('acts'),
    value: ActSchema,
    quote: z.string().min(1).max(400),
  }),
  z.strictObject({ op: z.literal('put'), collection: z.literal('loops'), value: LoopSchema }),
  z.strictObject({
    op: z.literal('put'),
    collection: z.literal('annotations'),
    value: AnnotationSchema,
  }),
  z.strictObject({
    op: z.literal('put'),
    collection: z.literal('recordDecisions'),
    value: RecordDecisionSchema,
  }),
]);
const context = z.union([
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('timeZone'),
    value: TimeZoneSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('windowStart'),
    value: DateSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('windowEnd'),
    value: DateSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('asOfOverride'),
    value: TimestampSchema.nullable(),
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('holidays'),
    value: z.array(DateSchema).max(1000),
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('replyWindowDays'),
    value: RevisionSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('acceptWindowDays'),
    value: RevisionSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('hedgeWindowDays'),
    value: RevisionSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('atRiskWindowDays'),
    value: RevisionSchema,
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('people'),
    value: z.array(PersonSchema).max(1000),
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('departments'),
    value: z.array(DepartmentSchema).max(1000),
  }),
  z.strictObject({
    op: z.literal('set_context'),
    field: z.literal('milestones'),
    value: z.array(MilestoneSchema).max(1000),
  }),
]);
export const GraphOperationSchema = z.union([
  put,
  z.strictObject({ op: z.literal('remove'), collection: CollectionSchema, id: IdSchema }),
  context,
]);
export const GraphOperationsSchema = boundedJson(
  z.array(GraphOperationSchema).max(100),
  1024 * 1024,
);
export const EntityCollectionSchema = z.enum([
  'acts',
  'loops',
  'annotations',
  'recordDecisions',
  'people',
  'departments',
  'milestones',
  'context',
]);
export const GraphEntitySchema = z.union([
  ActSchema,
  LoopSchema,
  AnnotationSchema,
  RecordDecisionSchema,
  PersonSchema,
  DepartmentSchema,
  MilestoneSchema,
  DateSchema,
  TimestampSchema,
  TimeZoneSchema,
  RevisionSchema,
  z.array(DateSchema),
  z.null(),
]);
export const EntityChangeSchema = z.strictObject({
  collection: EntityCollectionSchema,
  id: TextSchema,
  kind: z.enum(['added', 'removed', 'changed']),
  before: GraphEntitySchema.nullable(),
  after: GraphEntitySchema.nullable(),
});
export const SnapshotDiffSchema = z.strictObject({ changes: z.array(EntityChangeSchema) });
export const ConflictSchema = z.strictObject({
  collection: EntityCollectionSchema,
  id: TextSchema,
  base: GraphEntitySchema.nullable(),
  main: GraphEntitySchema.nullable(),
  proposed: GraphEntitySchema.nullable(),
  reason: TextSchema,
});
export const RebaseResultSchema = z.strictObject({
  snapshot: GraphSnapshotSchema.nullable(),
  conflicts: z.array(ConflictSchema),
});
export const InverseResultSchema = RebaseResultSchema;
export type ActType = z.infer<typeof ActTypeSchema>;
export type Due = z.infer<typeof DueSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type Party = z.infer<typeof PartySchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Department = z.infer<typeof DepartmentSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Act = z.infer<typeof ActSchema>;
export type Loop = z.infer<typeof LoopSchema>;
export type RecordDecision = z.infer<typeof RecordDecisionSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type GraphContext = z.infer<typeof GraphContextSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
export type GraphOperation = z.infer<typeof GraphOperationSchema>;
export type EntityChange = z.infer<typeof EntityChangeSchema>;
export type SnapshotDiff = z.infer<typeof SnapshotDiffSchema>;
export type Conflict = z.infer<typeof ConflictSchema>;
export type RebaseResult = z.infer<typeof RebaseResultSchema>;
export type EntityCollection = z.infer<typeof EntityCollectionSchema>;
export type InverseResult = z.infer<typeof InverseResultSchema>;
