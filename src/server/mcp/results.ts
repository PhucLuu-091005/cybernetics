import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ActorContext, DomainError } from '../../contracts';
import { AppError } from '../errors';
import { withEnvelope } from '../http/envelope';

const MAX_RESULT_CHARS = 50_000;

export function toolResult(ctx: ActorContext, result: object): CallToolResult {
  const structured = withEnvelope(ctx, result),
    text = JSON.stringify(structured);
  if (text.length > MAX_RESULT_CHARS)
    throw new AppError(
      'LIMIT_EXCEEDED',
      `Result exceeds ${MAX_RESULT_CHARS} characters; request a smaller page`,
    );
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

export function toolError(error: unknown, requestId: string): CallToolResult {
  let body: DomainError;
  if (error instanceof AppError && error.code !== 'INTERNAL')
    body = { code: error.code, message: error.message, ...error.extras, requestId };
  else {
    console.error(
      JSON.stringify({ requestId, error: error instanceof Error ? error.name : 'unknown' }),
    );
    body = { code: 'INTERNAL', message: 'Internal error', requestId };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    isError: true,
  };
}
