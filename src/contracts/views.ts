import { z } from 'zod';
import { IdSchema, RevisionSchema, TimestampSchema } from './primitives';
import { DepartmentSchema, GraphSnapshotSchema, PersonSchema } from './graph';
import { EngineOutputSchema } from './engine';
import { ViewSelectionSchema } from './mcp';
import { PermalinkSchema, SourceKindSchema } from './records';

/** Where a cited record version came from. The browser decides which permalinks are links. */
export const GraphSourceSchema = z.strictObject({
  source: SourceKindSchema,
  sourceLabel: z.string().min(1).max(200),
  permalink: PermalinkSchema.nullable(),
});

/** Browser-only and unpaginated: snapshot caps bound it, so MCP reads use the paged get_graph instead. */
export const GraphViewSchema = z.strictObject({
  projectId: IdSchema,
  view: ViewSelectionSchema,
  commitId: IdSchema.nullable(),
  proposalId: IdSchema.nullable(),
  proposalRevision: RevisionSchema.nullable(),
  mainCommitId: IdSchema,
  evidenceRevision: RevisionSchema,
  pendingEvidenceCount: RevisionSchema,
  T: TimestampSchema,
  snapshot: GraphSnapshotSchema,
  engine: EngineOutputSchema,
  people: z.array(PersonSchema),
  departments: z.array(DepartmentSchema),
  sources: z.record(IdSchema, GraphSourceSchema),
});
export type GraphView = z.infer<typeof GraphViewSchema>;
export type GraphSource = z.infer<typeof GraphSourceSchema>;
