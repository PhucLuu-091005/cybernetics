import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { ErrorCode, FieldError } from '../contracts';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  LIMIT_EXCEEDED: 413,
  INTERNAL: 500,
};
const BRAND = Symbol.for('promise-graph.AppError');
export class AppError extends Error {
  readonly [BRAND] = true;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly extras: { errors?: FieldError[]; details?: unknown } = {},
  ) {
    super(message);
  }
  // next dev bundles this module once per route, and globalThis singletons (limiter, identity store) cross routes.
  static [Symbol.hasInstance](value: unknown): value is AppError {
    return typeof value === 'object' && value !== null && BRAND in value;
  }
}
export const statusFor = (code: ErrorCode) => STATUS[code];
export function invalidInput(message: string, error: z.ZodError): AppError {
  return new AppError('VALIDATION', message, {
    errors: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}
export const newRequestId = () => randomUUID();
export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' },
  });
}
export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof AppError && error.code !== 'INTERNAL')
    return privateJson(
      { code: error.code, message: error.message, ...error.extras, requestId },
      statusFor(error.code),
    );
  console.error(
    JSON.stringify({ requestId, error: error instanceof Error ? error.name : 'unknown' }),
  );
  return privateJson({ code: 'INTERNAL', message: 'Internal error', requestId }, 500);
}
