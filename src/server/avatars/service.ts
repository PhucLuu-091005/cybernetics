import { and, eq } from 'drizzle-orm';
import type { ActorContext } from '../../contracts';
import { projects, trackerMembers, users } from '../db/schema';
import { isId, projectOpenTo, withTransaction, type Db } from '../db/tx';
import { AppError } from '../errors';
import { normalizePhoto } from './image';
import { memberPhotoKey, memberPhotoUrl, photoUrl, type PhotoStore } from './store';

const HASH = /^[0-9a-f]{64}$/;

function requirePerson(ctx: ActorContext): void {
  if (ctx.kind !== 'user')
    throw new AppError('FORBIDDEN', 'Only a person in the browser can change a photo');
}

async function forget(store: PhotoStore, key: string): Promise<void> {
  try {
    await store.remove(key);
  } catch (error) {
    // The new photo is saved; an old object that stays costs a few kilobytes, not a failed save.
    console.error(
      JSON.stringify({ event: 'photo_cleanup_failed', key, error: (error as Error).name }),
    );
  }
}

export async function setPhoto(
  db: Db,
  store: PhotoStore,
  ctx: ActorContext,
  bytes: Buffer,
): Promise<{ photo: string }> {
  requirePerson(ctx);
  const { body, hash } = await normalizePhoto(bytes);
  const key = `avatars/${ctx.userId}/${hash}.webp`;
  // The row lock covers the object writes too, so a slower upload of the same photo can never
  // land after a newer upload deleted that object.
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ key: users.avatarKey })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .for('update');
    if (!row) throw new AppError('UNAUTHENTICATED', 'Unknown session');
    await store.put(key, body);
    await tx.update(users).set({ avatarKey: key }).where(eq(users.id, ctx.userId));
    if (row.key && row.key !== key) await forget(store, row.key);
  });
  return { photo: photoUrl(ctx.userId, key)! };
}

export async function removePhoto(
  db: Db,
  store: PhotoStore,
  ctx: ActorContext,
): Promise<{ photo: null }> {
  requirePerson(ctx);
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ key: users.avatarKey })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .for('update');
    await tx.update(users).set({ avatarKey: null }).where(eq(users.id, ctx.userId));
    if (row?.key) await forget(store, row.key);
  });
  return { photo: null };
}

export async function setMemberPhoto(
  db: Db,
  store: PhotoStore,
  ctx: ActorContext,
  memberId: string,
  bytes: Buffer,
): Promise<{ photo: string }> {
  requirePerson(ctx);
  const { body, hash } = await normalizePhoto(bytes);
  const key = memberPhotoKey(memberId, hash);
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ key: trackerMembers.avatarKey })
      .from(trackerMembers)
      .where(eq(trackerMembers.id, memberId))
      .for('update');
    if (!row) throw new AppError('NOT_FOUND', 'Member not found');
    await store.put(key, body);
    await tx.update(trackerMembers).set({ avatarKey: key }).where(eq(trackerMembers.id, memberId));
    if (row.key && row.key !== key) await forget(store, row.key);
  });
  return { photo: memberPhotoUrl({ id: memberId, userId: null, avatarKey: key }, null)! };
}

export async function removeMemberPhoto(
  db: Db,
  store: PhotoStore,
  ctx: ActorContext,
  memberId: string,
): Promise<{ photo: null }> {
  requirePerson(ctx);
  await withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ key: trackerMembers.avatarKey })
      .from(trackerMembers)
      .where(eq(trackerMembers.id, memberId))
      .for('update');
    await tx.update(trackerMembers).set({ avatarKey: null }).where(eq(trackerMembers.id, memberId));
    if (row?.key) await forget(store, row.key);
  });
  return { photo: null };
}

export async function readMemberPhoto(
  db: Db,
  store: PhotoStore,
  ctx: ActorContext,
  memberId: string,
  hash: string,
): Promise<Buffer> {
  const missing = () => new AppError('NOT_FOUND', 'Photo not found');
  if (!isId(memberId) || !HASH.test(hash)) throw missing();
  const [row] = await db
    .select({ key: trackerMembers.avatarKey })
    .from(projects)
    .innerJoin(
      trackerMembers,
      and(eq(trackerMembers.projectId, projects.id), eq(trackerMembers.id, memberId)),
    )
    .where(projectOpenTo(ctx.userId))
    .limit(1);
  if (!row || row.key !== memberPhotoKey(memberId, hash)) throw missing();
  const body = await store.get(row.key);
  if (!body) throw missing();
  return body;
}

/** A photo shows to its person and to anyone who shares a project with them, removed members too. */
async function maySee(db: Db, viewer: string, target: string): Promise<boolean> {
  if (viewer === target) return true;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      trackerMembers,
      and(eq(trackerMembers.projectId, projects.id), eq(trackerMembers.userId, target)),
    )
    .where(projectOpenTo(viewer))
    .limit(1);
  return !!row;
}

export async function readPhoto(
  db: Db,
  store: PhotoStore,
  ctx: ActorContext,
  userId: string,
  hash: string,
): Promise<Buffer> {
  const missing = () => new AppError('NOT_FOUND', 'Photo not found');
  if (!isId(userId) || !HASH.test(hash) || !(await maySee(db, ctx.userId, userId))) throw missing();
  const [row] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (row?.key !== `avatars/${userId}/${hash}.webp`) throw missing();
  const body = await store.get(row.key);
  if (!body) throw missing();
  return body;
}
