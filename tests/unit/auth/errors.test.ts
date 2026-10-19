import { describe, expect, it, vi } from 'vitest';
import { AppError, errorResponse, statusFor } from '../../../src/server/errors';

describe('error mapping', () => {
  it('maps each domain code to its HTTP status', () => {
    expect([
      statusFor('UNAUTHENTICATED'),
      statusFor('FORBIDDEN'),
      statusFor('NOT_FOUND'),
      statusFor('VALIDATION'),
      statusFor('CONFLICT'),
      statusFor('RATE_LIMITED'),
      statusFor('LIMIT_EXCEEDED'),
      statusFor('INTERNAL'),
    ]).toEqual([401, 403, 404, 400, 409, 429, 413, 500]);
  });
  it('keeps field errors and conflict details in the body', async () => {
    const response = errorResponse(
      new AppError('CONFLICT', 'Main moved', { details: { actualMainCommitId: 'x' } }),
      'req-1',
    );
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      code: 'CONFLICT',
      message: 'Main moved',
      details: { actualMainCommitId: 'x' },
      requestId: 'req-1',
    });
  });
  it('turns an unknown error into a 500 INTERNAL without leaking its message', async () => {
    const response = errorResponse(new Error('password=hunter2'), 'req-2');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'INTERNAL',
      message: 'Internal error',
      requestId: 'req-2',
    });
  });
  it('never sends a constructed INTERNAL message or extras', async () => {
    const response = errorResponse(
      new AppError('INTERNAL', 'pool exhausted at db-1', { details: { host: 'db-1' } }),
      'req-3',
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 'INTERNAL',
      message: 'Internal error',
      requestId: 'req-3',
    });
  });
  it('knows an AppError from another copy of the module, as next dev builds one per route', async () => {
    vi.resetModules();
    const other = await import('../../../src/server/errors');
    expect(other.AppError).not.toBe(AppError);
    const foreign = new other.AppError('RATE_LIMITED', 'Rate limit exceeded');
    expect(foreign instanceof AppError).toBe(true);
    expect(errorResponse(foreign, 'req-4').status).toBe(429);
    expect(new Error('RATE_LIMITED') instanceof AppError).toBe(false);
    expect({ code: 'RATE_LIMITED' } instanceof AppError).toBe(false);
  });
  it('needs a string code on a branded value, and leaves a subclass to the normal check', () => {
    const brand = Symbol.for('promise-graph.AppError');
    expect({ [brand]: true } instanceof AppError).toBe(false);
    expect({ [brand]: true, code: 7 } instanceof AppError).toBe(false);
    expect({ [brand]: true, code: 'NOT_FOUND' } instanceof AppError).toBe(true);
    class Narrow extends AppError {}
    expect(new Narrow('CONFLICT', 'x') instanceof Narrow).toBe(true);
    expect(new Narrow('CONFLICT', 'x') instanceof AppError).toBe(true);
    expect(new AppError('CONFLICT', 'x') instanceof Narrow).toBe(false);
  });
});
