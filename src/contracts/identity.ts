import { z } from 'zod';
import {
  IdSchema,
  IdempotencyKeySchema,
  PageInputSchema,
  TimestampSchema,
  TextSchema,
} from './primitives';

export const ScopeSchema = z.enum(['project:read', 'queue:add']);
export type Scope = z.infer<typeof ScopeSchema>;
export const DEFAULT_AGENT_SCOPES: readonly Scope[] = ['project:read', 'queue:add'];
export const ActorReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), userId: TextSchema }),
  z.strictObject({ kind: z.literal('agent'), userId: TextSchema, tokenId: IdSchema }),
]);
export type ActorReference = z.infer<typeof ActorReferenceSchema>;
const verified = {
  workspaceId: IdSchema,
  projectId: IdSchema,
  scopes: z.array(ScopeSchema),
  requestId: TextSchema,
};
export const ActorContextSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('user'),
    userId: TextSchema,
    ...verified,
    projectId: IdSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal('agent'), userId: TextSchema, tokenId: IdSchema, ...verified }),
]);
export type ActorContext = z.infer<typeof ActorContextSchema>;
export const AgentTokenSchema = z.strictObject({
  id: IdSchema,
  userId: TextSchema,
  projectId: IdSchema,
  prefix: TextSchema,
  label: z.string().min(1).max(200),
  scopes: z.array(ScopeSchema),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
  lastUsedAt: TimestampSchema.nullable(),
});
export type AgentToken = z.infer<typeof AgentTokenSchema>;
export const CreateAgentTokenInputSchema = z.strictObject({
  projectId: IdSchema,
  scopes: z
    .array(ScopeSchema)
    .min(1)
    .default(() => [...DEFAULT_AGENT_SCOPES]),
  expiresAt: TimestampSchema.optional(),
  label: z.string().min(1).max(200),
  idempotencyKey: IdempotencyKeySchema,
});
export type CreateAgentTokenInput = z.infer<typeof CreateAgentTokenInputSchema>;

/** The secret is returned once. Persist only its hash; a reused creation key must conflict, never replay the secret. */
export const TokenCreatedSchema = z.strictObject({
  token: AgentTokenSchema,
  secret: z.string().min(32).max(512),
  requestId: TextSchema,
});
export const RevokeAgentTokenInputSchema = z.strictObject({
  projectId: IdSchema,
  tokenId: IdSchema,
  idempotencyKey: z.string().min(1).max(256),
});
export const RevokeAgentTokenResultSchema = z.strictObject({
  projectId: IdSchema,
  tokenId: IdSchema,
  revokedAt: TimestampSchema,
  requestId: TextSchema,
});
export const ListAgentTokensInputSchema = PageInputSchema.extend({ projectId: IdSchema });
export const ListAgentTokensResultSchema = z.strictObject({
  projectId: IdSchema,
  items: z.array(AgentTokenSchema).max(50),
  nextCursor: z.string().nullable(),
  requestId: TextSchema,
});
export type TokenCreated = z.infer<typeof TokenCreatedSchema>;
export type RevokeAgentTokenInput = z.infer<typeof RevokeAgentTokenInputSchema>;
export type RevokeAgentTokenResult = z.infer<typeof RevokeAgentTokenResultSchema>;
export type ListAgentTokensInput = z.infer<typeof ListAgentTokensInputSchema>;
export type ListAgentTokensResult = z.infer<typeof ListAgentTokensResultSchema>;
