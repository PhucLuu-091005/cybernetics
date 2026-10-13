import { randomUUID } from 'node:crypto';
import type { ErrorCode } from '../../contracts';
export class HttpError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly status: number) { super(message); }
}
export function requestId(): string { return randomUUID(); }
export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization' } });
}
export function errorResponse(error: unknown, id = requestId()): Response {
  if (error instanceof HttpError) return privateJson({ code: error.code, message: error.message, requestId: id }, error.status);
  return privateJson({ code: 'UNAUTHENTICATED', message: 'Authentication is unavailable', requestId: id }, 503);
}
