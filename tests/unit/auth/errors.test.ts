import { describe, expect, it } from 'vitest';
import { AppError, errorResponse, statusFor } from '../../../src/server/errors';

describe('error mapping', () => {
  it('maps each domain code to its HTTP status', () => {
    expect([statusFor('UNAUTHENTICATED'), statusFor('FORBIDDEN'), statusFor('NOT_FOUND'), statusFor('VALIDATION'), statusFor('CONFLICT'), statusFor('RATE_LIMITED'), statusFor('LIMIT_EXCEEDED'), statusFor('INTERNAL')])
      .toEqual([401, 403, 404, 400, 409, 429, 413, 500]);
  });
  it('keeps field errors and conflict details in the body', async () => {
    const response = errorResponse(new AppError('CONFLICT', 'Main moved', { details: { actualMainCommitId: 'x' } }), 'req-1');
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ code: 'CONFLICT', message: 'Main moved', details: { actualMainCommitId: 'x' }, requestId: 'req-1' });
  });
  it('turns an unknown error into a 500 INTERNAL without leaking its message', async () => {
    const response = errorResponse(new Error('password=hunter2'), 'req-2');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INTERNAL', message: 'Internal error', requestId: 'req-2' });
  });
});
