import { expect, it } from 'vitest';
import { privateJson, errorResponse, HttpError } from '../../../src/server/http/errors';
import { getBrowserActor } from '../../../src/server/http/runtime';
import { GET } from '../../../src/app/api/health/route';
it('keeps health usable without provider credentials', async () => {
  const response = GET(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'ok' });
});
it('protects authenticated and error response caches', () => {
  expect(privateJson({ value: 1 }).headers.get('cache-control')).toBe('private, no-store');
  const response = errorResponse(new HttpError('FORBIDDEN', 'Denied', 403));
  expect(response.status).toBe(403); expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('fails closed without a configured identity repository', async () => {
  await expect(getBrowserActor(new Request('http://localhost:3000'))).rejects.toMatchObject({ status: 503 });
});
