import type { ActorContext } from '../../contracts';
/** REST and MCP results both carry the actor's project and request IDs, so a domain result without them gets the same envelope in either adapter. */
export function withEnvelope<R extends object>(
  ctx: ActorContext,
  result: R,
): { projectId?: string; requestId: string } & R {
  return {
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...result,
    requestId: (result as { requestId?: string }).requestId ?? ctx.requestId,
  };
}
