import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readPhotoConfig } from '../../../src/server/avatars/config';
import {
  GcsPhotoStore,
  LocalPhotoStore,
  metadataToken,
  photoUrl,
} from '../../../src/server/avatars/store';

const user = randomUUID();
const hash = 'a'.repeat(64);
const key = `avatars/${user}/${hash}.webp`;
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('photo URL', () => {
  it('puts the hash of the photo in the URL, and gives none without a valid key', () => {
    expect(photoUrl(user, key)).toBe(`/api/v1/avatars/${user}/${hash}`);
    expect(photoUrl(null, key)).toBeNull();
    expect(photoUrl(user, null)).toBeNull();
    expect(photoUrl(user, '../../etc/passwd')).toBeNull();
  });
});

describe('local photo store', () => {
  it('writes, reads and removes a photo under its folder only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pg-photos-'));
    dirs.push(dir);
    const store = new LocalPhotoStore(dir);
    expect(await store.get(key)).toBeNull();
    await store.put(key, Buffer.from('webp'));
    expect((await store.get(key))?.toString()).toBe('webp');
    expect(await readdir(join(dir, 'avatars', user))).toEqual([`${hash}.webp`]);
    await store.remove(key);
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.put('avatars/../../x.webp', Buffer.from('x'))).rejects.toThrow(
      'Invalid photo key',
    );
  });
});

describe('Cloud Storage photo store', () => {
  type Call = { url: string; method: string; auth: string | null; type: string | null };
  const fake = (answers: Record<string, number>) => {
    const calls: Call[] = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        auth: headers.get('authorization'),
        type: headers.get('content-type'),
      });
      const status = answers[method] ?? 200;
      return new Response(status === 204 || status === 404 ? null : 'bytes', { status });
    }) as typeof globalThis.fetch;
    return { calls, fetch };
  };
  const store = (answers: Record<string, number> = {}) => {
    const { calls, fetch } = fake(answers);
    return {
      calls,
      store: new GcsPhotoStore('promise-graph-avatars', { fetch, token: async () => 'tok' }),
    };
  };

  it('uploads, reads and deletes through the JSON API with the service account token', async () => {
    const { calls, store: gcs } = store({ DELETE: 204 });
    await gcs.put(key, Buffer.from('webp'));
    expect((await gcs.get(key))?.toString()).toBe('bytes');
    await gcs.remove(key);
    const object = encodeURIComponent(key);
    expect(calls).toEqual([
      {
        url: `https://storage.googleapis.com/upload/storage/v1/b/promise-graph-avatars/o?uploadType=media&name=${object}`,
        method: 'POST',
        auth: 'Bearer tok',
        type: 'image/webp',
      },
      {
        url: `https://storage.googleapis.com/storage/v1/b/promise-graph-avatars/o/${object}?alt=media`,
        method: 'GET',
        auth: 'Bearer tok',
        type: null,
      },
      {
        url: `https://storage.googleapis.com/storage/v1/b/promise-graph-avatars/o/${object}`,
        method: 'DELETE',
        auth: 'Bearer tok',
        type: null,
      },
    ]);
  });

  it('reads a missing object as none, deletes a missing one quietly, and throws on a failure', async () => {
    const missing = store({ GET: 404, DELETE: 404 }).store;
    expect(await missing.get(key)).toBeNull();
    await expect(missing.remove(key)).resolves.toBeUndefined();
    const broken = store({ POST: 403, GET: 500 }).store;
    await expect(broken.put(key, Buffer.from('x'))).rejects.toThrow('Photo upload failed with 403');
    await expect(broken.get(key)).rejects.toThrow('Photo read failed with 500');
    await expect(broken.put('avatars/x', Buffer.from('x'))).rejects.toThrow('Invalid photo key');
  });

  it('takes the token from the metadata server once until it nearly expires', async () => {
    let now = 0;
    const asked: string[] = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      asked.push(`${url} ${new Headers(init.headers).get('metadata-flavor')}`);
      return Response.json({ access_token: `t${asked.length}`, expires_in: 3600 });
    }) as typeof globalThis.fetch;
    const token = metadataToken(fetch, () => now);
    expect(await token()).toBe('t1');
    now = 3_000_000;
    expect(await token()).toBe('t1');
    now = 3_600_000;
    expect(await token()).toBe('t2');
    expect(asked[0]).toBe(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token Google',
    );
  });
});

describe('photo store configuration', () => {
  it('keeps photos off without AVATAR_STORE', () => {
    expect(readPhotoConfig({})).toBeNull();
    expect(readPhotoConfig({ NODE_ENV: 'production', AVATAR_BUCKET: 'b-x' })).toBeNull();
  });
  it('needs a bucket for gcs, in production too, and refuses the local folder in production', () => {
    expect(
      readPhotoConfig({ AVATAR_STORE: 'gcs', AVATAR_BUCKET: 'promise-graph-avatars' }),
    ).toEqual({ driver: 'gcs', bucket: 'promise-graph-avatars' });
    expect(() => readPhotoConfig({ AVATAR_STORE: 'gcs', NODE_ENV: 'production' })).toThrow(
      'AVATAR_BUCKET is required',
    );
    expect(() => readPhotoConfig({ AVATAR_STORE: 'gcs', AVATAR_BUCKET: 'Bad Name' })).toThrow(
      'not a bucket name',
    );
    expect(readPhotoConfig({ AVATAR_STORE: 'local' })).toEqual({
      driver: 'local',
      dir: '.avatars',
    });
    expect(() => readPhotoConfig({ AVATAR_STORE: 'local', NODE_ENV: 'production' })).toThrow(
      'for development and tests',
    );
    expect(() => readPhotoConfig({ AVATAR_STORE: 's3' })).toThrow('gcs or local');
  });
});
