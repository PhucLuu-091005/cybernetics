import { z } from 'zod';
import { IdSchema, TextSchema, TimeZoneSchema } from './primitives';

export const ProjectSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  title: z.string().min(1).max(200),
  clientName: z.string().min(1).max(200),
});
export type Project = z.infer<typeof ProjectSchema>;
export const GetProjectInputSchema = z.strictObject({ projectId: IdSchema });
export const GetProjectResultSchema = z.strictObject({
  project: ProjectSchema,
  timeZone: TimeZoneSchema,
  requestId: TextSchema,
});
export type GetProjectResult = z.infer<typeof GetProjectResultSchema>;
