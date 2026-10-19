import type { ActorContext } from '../../contracts';
import { browserActor, getApp } from '../app';
import { AppError, errorResponse, newRequestId, privateJson } from '../errors';
import { isId } from '../db/tx';
import type { LimitBucket } from '../http/actors';
import { personOnScreen } from '../domain/account';
import { readActAs } from '../http/act-as';
import { photoStore } from './config';
import { MAX_PHOTO_BYTES, PHOTO_RULE } from './image';
import {
  readMemberPhoto,
  readPhoto,
  removeMemberPhoto,
  removePhoto,
  setMemberPhoto,
  setPhoto,
} from './service';
import type { PhotoStore } from './store';

const off = () => new AppError('NOT_FOUND', 'Photos are off on this server');

async function readBytes(request: Request): Promise<Buffer> {
  const tooLarge = () => new AppError('LIMIT_EXCEEDED', PHOTO_RULE);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_PHOTO_BYTES) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      size += next.value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(next.value);
    }
  }
  return Buffer.concat(chunks);
}

/** The session check also charges the per-person write limit, as on every other write. */
async function handle(
  request: Request,
  work: (ctx: ActorContext, store: PhotoStore) => Promise<Response>,
  bucket?: LimitBucket,
): Promise<Response> {
  let ctx: ActorContext | undefined;
  try {
    ctx = await browserActor(request, bucket);
    const store = photoStore();
    if (!store) throw off();
    return await work(ctx, store);
  } catch (error) {
    return errorResponse(error, ctx?.requestId ?? newRequestId());
  }
}

/** `?project=` names the project on screen, whose act-as cookie says who the person is there. */
async function memberOnScreen(request: Request, ctx: ActorContext): Promise<string | null> {
  const projectId = new URL(request.url).searchParams.get('project');
  if (projectId === null) return null;
  if (!isId(projectId)) throw new AppError('VALIDATION', 'Unknown project');
  const seen = await personOnScreen(getApp().db, ctx, projectId, readActAs(request, projectId));
  return seen.seeded ? seen.member!.id : null;
}

export const uploadPhoto = (request: Request) =>
  handle(request, async (ctx, store) => {
    const member = await memberOnScreen(request, ctx);
    const bytes = await readBytes(request);
    const db = getApp().db;
    return privateJson(
      member
        ? await setMemberPhoto(db, store, ctx, member, bytes)
        : await setPhoto(db, store, ctx, bytes),
    );
  });

export const deletePhoto = (request: Request) =>
  handle(request, async (ctx, store) => {
    const member = await memberOnScreen(request, ctx);
    const db = getApp().db;
    return privateJson(
      member ? await removeMemberPhoto(db, store, ctx, member) : await removePhoto(db, store, ctx),
    );
  });

const photoResponse = (body: Buffer) =>
  new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(body.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      Vary: 'Cookie',
    },
  });

export const serveMemberPhoto = (request: Request, memberId: string, hash: string) =>
  handle(
    request,
    async (ctx, store) =>
      photoResponse(await readMemberPhoto(getApp().db, store, ctx, memberId, hash)),
    'photo',
  );

export const servePhoto = (request: Request, userId: string, hash: string) =>
  handle(
    request,
    async (ctx, store) => {
      const body = await readPhoto(getApp().db, store, ctx, userId, hash);
      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(body.length),
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          Vary: 'Cookie',
        },
      });
    },
    'photo',
  );
