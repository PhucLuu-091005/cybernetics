import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, PUT } from '../../../src/app/api/v1/me/avatar/route';
import { GET } from '../../../src/app/api/v1/avatars/[userId]/[hash]/route';
import { configureApp, resetApp } from '../../../src/server/app';
import { configurePhotoStore } from '../../../src/server/avatars/config';
import { removePhoto, setPhoto } from '../../../src/server/avatars/service';
import { LocalPhotoStore } from '../../../src/server/avatars/store';
import { users } from '../../../src/server/db/schema';
import { SESSION_COOKIE, signSession } from '../../../src/server/http/session';
import {
  getTrackerPayload,
  inviteMember,
  listProjectMembers,
  removeMember,
} from '../../../src/server/tracker';
import type { ActorContext } from '../../../src/contracts';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { solid } from '../../support/photos';
import { seedDemo, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
const secret = 'photo-route-test-secret-of-32-bytes!!';
const cookie = (userId: string) =>
  `${SESSION_COOKIE}=${signSession({ userId, expiresAt: Date.now() + 600_000 }, secret)}`;
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!process.env.TEST_DATABASE_URL)('profile photos', () => {
  let t: TestDb, dir: string, store: LocalPhotoStore, demo: Demo, guest: ActorContext;
  let guestMember: string;
  const upload = (userId: string, body: Buffer, type = 'image/png') =>
    PUT(
      new Request(`${origin}/api/v1/me/avatar`, {
        method: 'PUT',
        headers: { cookie: cookie(userId), origin, 'content-type': type },
        body: new Uint8Array(body),
      }),
    );
  const remove = (userId: string) =>
    DELETE(
      new Request(`${origin}/api/v1/me/avatar`, {
        method: 'DELETE',
        headers: { cookie: cookie(userId), origin },
      }),
    );
  const read = (viewer: string, url: string) => {
    const [, , , , userId, hash] = url.split('/');
    return GET(new Request(`${origin}${url}`, { headers: { cookie: cookie(viewer) } }), {
      params: Promise.resolve({ userId, hash }),
    });
  };
  const files = async () => {
    try {
      return await readdir(join(dir, 'avatars', demo.owner.userId));
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', secret);
    configureApp({ db: t.db });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    configurePhotoStore(undefined);
    resetApp();
    await t?.close();
  });
  beforeEach(async () => {
    delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown }).promiseRateLimiter;
    dir = await mkdtemp(join(tmpdir(), 'pg-photo-it-'));
    store = new LocalPhotoStore(dir);
    configurePhotoStore(store);
    demo = await seedDemo(t.db, await testActor(t.db));
    const email = `${randomUUID()}@example.com`;
    guest = await testActor(t.db, { email });
    const list = await inviteMember(t.db, demo.owner, { projectId: demo.projectId, email });
    guestMember = list.members.find((m) => m.email === email)!.id;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores a 256 px WebP by its hash, and names it on the user and in every member list', async () => {
    const reply = await upload(demo.owner.userId, await solid('png'), 'image/jpeg');
    expect(reply.status).toBe(200);
    const { photo } = (await reply.json()) as Json;
    expect(photo).toMatch(new RegExp(`^/api/v1/avatars/${demo.owner.userId}/[0-9a-f]{64}$`));
    const [row] = await t.db.select().from(users).where(eq(users.id, demo.owner.userId));
    expect(row.avatarKey).toBe(`avatars/${demo.owner.userId}/${photo.split('/').pop()}.webp`);
    expect(await files()).toEqual([`${photo.split('/').pop()}.webp`]);

    const payload = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(payload.members.find((m) => m.id === demo.ids.minh)?.photo).toBe(photo);
    expect(payload.members.find((m) => m.id === demo.ids.lan)?.photo).toBeUndefined();
    const members = await listProjectMembers(t.db, demo.owner, { projectId: demo.projectId });
    expect(members.members.find((m) => m.id === demo.ids.minh)?.photo).toBe(photo);
    expect(members.members.filter((m) => m.pending).every((m) => m.photo === null)).toBe(true);
  });

  it('shows a photo to its person and to people who share a project, and to no one else', async () => {
    const { photo } = (await (await upload(demo.owner.userId, await solid('jpeg'))).json()) as Json;
    const own = await read(demo.owner.userId, photo);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/webp');
    expect(own.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(own.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await sharp(Buffer.from(await own.arrayBuffer())).metadata()).width).toBe(256);
    expect((await read(guest.userId, photo)).status).toBe(200);
    const stranger = await testActor(t.db);
    expect((await read(stranger.userId, photo)).status).toBe(404);
    const wrongHash = photo.replace(/[0-9a-f]{64}$/, 'b'.repeat(64));
    expect((await read(demo.owner.userId, wrongHash)).status).toBe(404);
  });

  it('keeps the photo of a removed member on past work for the people of the project', async () => {
    const { photo } = (await (await upload(guest.userId, await solid('webp'))).json()) as Json;
    await removeMember(t.db, demo.owner, { projectId: demo.projectId, memberId: guestMember });
    const payload = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(payload.members.find((m) => m.id === guestMember)).toMatchObject({
      removed: true,
      photo,
    });
    expect((await read(demo.owner.userId, photo)).status).toBe(200);
  });

  it('deletes the old object after a new photo is saved, and on Remove photo', async () => {
    const first = (await (await upload(demo.owner.userId, await solid('png'))).json()) as Json;
    const second = (await (
      await upload(demo.owner.userId, await solid('png', 90, 300, { r: 20, g: 120, b: 200 }))
    ).json()) as Json;
    expect(second.photo).not.toBe(first.photo);
    expect(await files()).toEqual([`${second.photo.split('/').pop()}.webp`]);
    expect((await read(demo.owner.userId, first.photo)).status).toBe(404);
    const removed = await remove(demo.owner.userId);
    expect(await removed.json()).toMatchObject({ photo: null });
    expect(await files()).toEqual([]);
    const [row] = await t.db.select().from(users).where(eq(users.id, demo.owner.userId));
    expect(row.avatarKey).toBeNull();
    expect((await read(demo.owner.userId, second.photo)).status).toBe(404);
  });

  it('refuses a wrong file in plain English and keeps the old photo', async () => {
    const { photo } = (await (await upload(demo.owner.userId, await solid('png'))).json()) as Json;
    const text = await upload(demo.owner.userId, Buffer.from('hello, I am a text file'));
    expect(text.status).toBe(400);
    expect(await text.json()).toMatchObject({
      code: 'VALIDATION',
      message: 'Use a PNG, JPEG or WebP under 5 MB.',
    });
    const big = await upload(demo.owner.userId, Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    expect(big.status).toBe(413);
    expect((await read(demo.owner.userId, photo)).status).toBe(200);
  });

  it('answers 429 while another photo is being decoded, so memory stays bounded', async () => {
    const png = await solid('png');
    const busy = globalThis as typeof globalThis & { promisePhotoBusy?: boolean };
    busy.promisePhotoBusy = true;
    try {
      const reply = await upload(demo.owner.userId, png);
      expect(reply.status).toBe(429);
      expect(await reply.json()).toMatchObject({ code: 'RATE_LIMITED' });
    } finally {
      busy.promisePhotoBusy = false;
    }
    expect((await upload(demo.owner.userId, png)).status).toBe(200);
  });

  it('never deletes the object that the row names, when a slow upload of the same photo overlaps a newer one', async () => {
    const x = await solid('png');
    const y = await solid('png', 400, 300, { r: 10, g: 200, b: 90 });
    await setPhoto(t.db, store, demo.owner, x);
    let release!: () => void;
    let stored!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const written = new Promise<void>((resolve) => (stored = resolve));
    let slow = true;
    const slowStore = {
      put: async (key: string, body: Buffer) => {
        await store.put(key, body);
        if (!slow) return;
        slow = false;
        stored();
        await gate;
      },
      get: (key: string) => store.get(key),
      remove: (key: string) => store.remove(key),
    };
    const again = setPhoto(t.db, slowStore, demo.owner, x);
    await written;
    const newer = setPhoto(t.db, slowStore, demo.owner, y);
    await Promise.race([newer, new Promise((resolve) => setTimeout(resolve, 300))]);
    release();
    await Promise.all([again, newer]);
    const [row] = await t.db.select().from(users).where(eq(users.id, demo.owner.userId));
    expect(await store.get(row.avatarKey!)).not.toBeNull();
    expect(await files()).toEqual([row.avatarKey!.split('/').pop()]);
  });

  it('lets only the person in the browser change their own photo, never a key', async () => {
    const agent = agentActor(demo.owner, demo.projectId, ['project:read']);
    await expect(setPhoto(t.db, store, agent, await solid('png'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(removePhoto(t.db, store, agent)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const crossSite = await PUT(
      new Request(`${origin}/api/v1/me/avatar`, {
        method: 'PUT',
        headers: { cookie: cookie(demo.owner.userId), origin: 'https://evil.example' },
        body: new Uint8Array(await solid('png')),
      }),
    );
    expect(crossSite.status).toBe(403);
    const anonymous = await PUT(
      new Request(`${origin}/api/v1/me/avatar`, {
        method: 'PUT',
        headers: { origin },
        body: new Uint8Array(await solid('png')),
      }),
    );
    expect(anonymous.status).toBe(401);
  });

  it('answers 404 and shows initials only while photos are off', async () => {
    const { photo } = (await (await upload(demo.owner.userId, await solid('png'))).json()) as Json;
    configurePhotoStore(null);
    expect((await upload(demo.owner.userId, await solid('png'))).status).toBe(404);
    expect((await read(demo.owner.userId, photo)).status).toBe(404);
    const payload = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(payload.members.every((m) => m.photo === undefined)).toBe(true);
  });
});
