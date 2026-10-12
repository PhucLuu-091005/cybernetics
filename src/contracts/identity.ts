import { z } from 'zod';
import { IdSchema, TimestampSchema, TextSchema } from './primitives';

export const ScopeSchema = z.enum(['project:read', 'records:import', 'graph:propose', 'graph:merge', 'escalations:write']);
export type Scope = z.infer<typeof ScopeSchema>;
export const DEFAULT_AGENT_SCOPES: readonly Scope[] = ['project:read', 'records:import', 'graph:propose'];
export const ActorReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: TextSchema }),
  z.strictObject({ kind: z.literal('agent'), userId: TextSchema, tokenId: IdSchema }),
]);
export type ActorReference = z.infer<typeof ActorReferenceSchema>;
const verified = { workspaceId: IdSchema, projectId: IdSchema, scopes: z.array(ScopeSchema), requestId: TextSchema };
export const ActorContextSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: TextSchema, ...verified }),
  z.strictObject({ kind: z.literal('agent'), userId: TextSchema, tokenId: IdSchema, ...verified }),
]);
export type ActorContext = z.infer<typeof ActorContextSchema>;
export const AgentTokenSchema = z.strictObject({ id: IdSchema, userId: TextSchema, projectId: IdSchema, prefix: TextSchema, scopes: z.array(ScopeSchema), createdAt: TimestampSchema, expiresAt: TimestampSchema, revokedAt: TimestampSchema.nullable() });
export type AgentToken = z.infer<typeof AgentTokenSchema>;
export const CreateAgentTokenInputSchema = z.strictObject({ projectId: IdSchema, scopes: z.array(ScopeSchema).min(1), expiresAt: TimestampSchema.optional(), label: z.string().min(1).max(200) });
export type CreateAgentTokenInput = z.infer<typeof CreateAgentTokenInputSchema>;
