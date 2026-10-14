import { z } from 'zod';
import { IdSchema, RevisionSchema, TimestampSchema } from './primitives';
import { DepartmentSchema, GraphSnapshotSchema, PersonSchema } from './graph';
import { EngineOutputSchema } from './engine';
import { ViewSelectionSchema } from './mcp';

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
});
export type GraphView = z.infer<typeof GraphViewSchema>;
