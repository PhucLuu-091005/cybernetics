import { expect, it } from 'vitest';
import { AppError, errorResponse, privateJson } from '../../../src/server/errors';
import { getBrowserActor } from '../../../src/server/http/runtime';
import { GET } from '../../../src/app/api/health/route';
it('keeps health usable without provider credentials', async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});
it('protects authenticated and error response caches', () => {
  expect(privateJson({ value: 1 }).headers.get('cache-control')).toBe('private, no-store');
  const response = errorResponse(new AppError('FORBIDDEN', 'Denied'), 'req-1');
  expect(response.status).toBe(403);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('fails closed without a configured identity repository', async () => {
  await expect(getBrowserActor(new Request('http://localhost:3000'))).rejects.toThrow(
    'Identity persistence is unavailable',
  );
});
