import { z } from 'zod';
import {
  IdSchema,
  IdempotencyKeySchema,
  PageInputSchema,
  TimestampSchema,
  TextSchema,
} from './primitives';

/**
 * One scope per right a person can hold in a project. No scope manages tokens, deletes the project or
 * hands over the project lead: those stay browser actions.
 */
export const ScopeSchema = z.enum([
  'project:read',
  'queue:add',
  'queue:dismiss',
  'crs:edit',
  'crs:ready',
  'crs:comment',
  'crs:merge',
  'crs:close',
  'members:manage',
  'teams:manage',
]);
export type Scope = z.infer<typeof ScopeSchema>;
/** A stored token may hold a scope that no longer exists (round 14 had project:lead); it grants nothing. */
export const knownScopes = (stored: readonly string[]): Scope[] =>
  stored.filter((scope): scope is Scope => ScopeSchema.safeParse(scope).success);
export const DEFAULT_AGENT_SCOPES: readonly Scope[] = ['project:read', 'queue:add'];
/** A project key works in one project; a personal key works in every project of its person. */
export const KeyKindSchema = z.enum(['project', 'personal']);
export type KeyKind = z.infer<typeof KeyKindSchema>;
const KeyLabelSchema = z.string().min(1).max(200);
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
  // A personal key has no project until a call names one; the MCP adapter then binds it per call.
  z.strictObject({
    kind: z.literal('agent'),
    userId: TextSchema,
    tokenId: IdSchema,
    key: KeyKindSchema,
    keyLabel: KeyLabelSchema,
    /** The seeded demo member the key acts as instead of its person's own member. */
    memberId: IdSchema.optional(),
    ...verified,
    projectId: IdSchema.nullable(),
  }),
]);
export type ActorContext = z.infer<typeof ActorContextSchema>;
export const AgentTokenSchema = z.strictObject({
  id: IdSchema,
  userId: TextSchema,
  kind: KeyKindSchema,
  projectId: IdSchema.nullable(),
  prefix: TextSchema,
  label: KeyLabelSchema,
  scopes: z.array(ScopeSchema),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
  lastUsedAt: TimestampSchema.nullable(),
  /** The seeded demo person the key acts as, when it was made while the visitor acted as them. */
  actsAs: z.strictObject({ memberId: IdSchema, name: TextSchema }).optional(),
});
export type AgentToken = z.infer<typeof AgentTokenSchema>;
export const CreateAgentTokenInputSchema = z.strictObject({
  projectId: IdSchema,
  scopes: z
    .array(ScopeSchema)
    .min(1)
    .default(() => [...DEFAULT_AGENT_SCOPES]),
  expiresAt: TimestampSchema.optional(),
  label: KeyLabelSchema,
  idempotencyKey: IdempotencyKeySchema,
});
export type CreateAgentTokenInput = z.infer<typeof CreateAgentTokenInputSchema>;
export const CreatePersonalKeyInputSchema = CreateAgentTokenInputSchema.omit({ projectId: true });
export type CreatePersonalKeyInput = z.infer<typeof CreatePersonalKeyInputSchema>;

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
export const RevokePersonalKeyInputSchema = RevokeAgentTokenInputSchema.omit({ projectId: true });
export const RevokeAgentTokenResultSchema = z.strictObject({
  projectId: IdSchema.nullable(),
  tokenId: IdSchema,
  revokedAt: TimestampSchema,
  requestId: TextSchema,
});
export const ListAgentTokensInputSchema = PageInputSchema.extend({ projectId: IdSchema });
export const ListPersonalKeysInputSchema = PageInputSchema;
export const ListAgentTokensResultSchema = z.strictObject({
  projectId: IdSchema.nullable(),
  items: z.array(AgentTokenSchema).max(50),
  nextCursor: z.string().nullable(),
  requestId: TextSchema,
});
export type TokenCreated = z.infer<typeof TokenCreatedSchema>;
export type RevokeAgentTokenInput = z.infer<typeof RevokeAgentTokenInputSchema>;
export type RevokePersonalKeyInput = z.infer<typeof RevokePersonalKeyInputSchema>;
export type RevokeAgentTokenResult = z.infer<typeof RevokeAgentTokenResultSchema>;
export type ListAgentTokensInput = z.infer<typeof ListAgentTokensInputSchema>;
export type ListAgentTokensResult = z.infer<typeof ListAgentTokensResultSchema>;
