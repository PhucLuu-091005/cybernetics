import { z } from 'zod';
import { DateSchema, IdSchema, RevisionSchema, SideSchema, TextSchema } from './primitives';
import { ActTypeSchema, GraphContextSchema } from './graph';

const coordinate = z.number().finite();
// A day column narrower than 24 px cannot hold its resize handle; wider than 480 px leaves no room for others.
export const DAY_WIDTH_MIN = 24,
  DAY_WIDTH_MAX = 480;
export const LayoutInputSchema = z.strictObject({ context: GraphContextSchema });
export const LayoutOptionsSchema = z.strictObject({
  pxPerDay: z.number().positive(),
  rowHeight: z.number().positive().default(28),
  lanePadding: z.number().nonnegative().default(12),
  branchGap: z.number().nonnegative().default(16),
  /** Day columns the user resized, by local date, in px at 100 % zoom. */
  dayWidths: z.record(DateSchema, z.number().min(DAY_WIDTH_MIN).max(DAY_WIDTH_MAX)).optional(),
  /** Event cards above each branch line; the layout reserves their shelves inside the branch row. */
  cards: z
    .strictObject({
      width: z.number().positive(),
      height: z.number().positive(),
      gap: z.number().nonnegative(),
    })
    .optional(),
});
export const LaneLayoutSchema = z.strictObject({
  id: IdSchema,
  departmentId: IdSchema,
  name: TextSchema,
  side: SideSchema,
  order: RevisionSchema,
  y: coordinate,
  height: z.number().nonnegative(),
  subRows: RevisionSchema,
});
export const ActGlyphSchema = z.strictObject({
  id: IdSchema,
  loopId: IdSchema,
  type: ActTypeSchema,
  x: coordinate,
  y: coordinate,
  dayStartX: coordinate,
  dayEndX: coordinate,
  /** Top-left corner of the event card, present when the layout places cards. */
  card: z.strictObject({ x: coordinate, y: coordinate }).optional(),
  glyph: TextSchema,
  label: TextSchema,
  accessibleName: TextSchema,
});
export const BranchSegmentSchema = z.strictObject({
  startX: coordinate,
  endX: coordinate,
  style: z.enum(['solid', 'dotted', 'dashed']),
  tone: z.enum(['green', 'blue', 'red', 'amber', 'gray']),
});
export const BranchLayoutSchema = z.strictObject({
  id: IdSchema,
  loopId: IdSchema,
  departmentId: IdSchema,
  row: RevisionSchema,
  xStart: coordinate,
  xEnd: coordinate,
  y: coordinate,
  path: TextSchema,
  segments: z.array(BranchSegmentSchema),
  glyphs: z.array(ActGlyphSchema),
  tone: z.enum(['green', 'blue', 'red', 'amber', 'gray']),
  endKind: z.enum(['open', 'merge', 'cap']),
  breakdownMarkers: z.array(z.strictObject({ x: coordinate, y: coordinate, label: TextSchema })),
  title: TextSchema,
  accessibleName: TextSchema,
  /** On a task: what the handoff drawing needs. `wait` and `early` come from times, the rest from positions. */
  task: z
    .strictObject({
      parentLoopId: IdSchema,
      afterLoopIds: z.array(IdSchema),
      closed: z.boolean(),
      wait: TextSchema.nullable(),
      early: z.boolean(),
    })
    .optional(),
  /** On a loop with tasks: how many there are and how many are closed. */
  tasks: z.strictObject({ count: RevisionSchema, done: RevisionSchema }).optional(),
});
export const GatewayLayoutSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['split', 'handoff', 'join', 'return']),
  loopId: IdSchema,
  x: coordinate,
  y: coordinate,
  /** A handoff from a task that is still open: the work has not moved yet. */
  pending: z.boolean(),
  accessibleName: TextSchema,
});
export const ConnectorLayoutSchema = z.strictObject({
  id: z.string().min(1),
  path: z.string(),
  tone: z.enum(['green', 'blue', 'red', 'amber', 'gray']),
  style: z.enum(['solid', 'dotted', 'dashed']),
  /** A waiting or early-start note, drawn at (x, y). Display only; the engine does not see it. */
  note: z.strictObject({ x: coordinate, y: coordinate, text: TextSchema }).nullable(),
});
export const MilestoneLayoutSchema = z.strictObject({
  id: IdSchema,
  x: coordinate,
  y: coordinate,
  ghostX: coordinate.nullable(),
  slipPath: z.string().nullable(),
  label: TextSchema,
  accessibleName: TextSchema,
  openLoopCount: RevisionSchema,
  brokenLoopCount: RevisionSchema,
});
export const GraphLayoutSchema = z.strictObject({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  trunkY: coordinate,
  lanes: z.array(LaneLayoutSchema),
  branches: z.array(BranchLayoutSchema),
  milestones: z.array(MilestoneLayoutSchema),
  gateways: z.array(GatewayLayoutSchema),
  connectors: z.array(ConnectorLayoutSchema),
  zoomLevel: z.enum(['milestones', 'branches', 'detail']),
  navigation: z.strictObject({ milestoneIds: z.array(IdSchema), loopIds: z.array(IdSchema) }),
});
export type LayoutInput = z.infer<typeof LayoutInputSchema>;
export type LayoutOptions = z.input<typeof LayoutOptionsSchema>;
export type ResolvedLayoutOptions = z.infer<typeof LayoutOptionsSchema>;
export type LaneLayout = z.infer<typeof LaneLayoutSchema>;
export type ActGlyph = z.infer<typeof ActGlyphSchema>;
export type BranchSegment = z.infer<typeof BranchSegmentSchema>;
export type BranchLayout = z.infer<typeof BranchLayoutSchema>;
export type MilestoneLayout = z.infer<typeof MilestoneLayoutSchema>;
export type GatewayLayout = z.infer<typeof GatewayLayoutSchema>;
export type ConnectorLayout = z.infer<typeof ConnectorLayoutSchema>;
export type GraphLayout = z.infer<typeof GraphLayoutSchema>;
