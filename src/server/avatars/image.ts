import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../errors';

import { MAX_PHOTO_BYTES, PHOTO_RULE } from '../../contracts/photo';

export { MAX_PHOTO_BYTES, PHOTO_RULE };
const PHOTO_SIZE = 256;

type Kind = 'png' | 'jpeg' | 'webp';

// A lossless PNG or WebP decodes in full (about 6 bytes a pixel in libvips), while a JPEG shrinks
// on load, so 16 megapixels keeps one decode near 100 MB on a 512 MiB instance.
const MAX_PIXELS: Record<Kind, number> = { png: 16_000_000, webp: 16_000_000, jpeg: 40_000_000 };
const tooMany = (kind: Kind) =>
  `The photo has too many pixels. Use one under ${MAX_PIXELS[kind] / 1_000_000} megapixels.`;

sharp.cache(false);
sharp.concurrency(1);
// One decode at a time for the whole process: a few parallel uploads must not add up to the memory limit.
const gate = globalThis as typeof globalThis & { promisePhotoBusy?: boolean };

const starts = (bytes: Buffer, at: number, sig: readonly number[]) =>
  bytes.length >= at + sig.length && sig.every((value, index) => bytes[at + index] === value);

/** The first bytes decide the type; a file name or a Content-Type header is never trusted. */
export function sniffPhoto(bytes: Buffer): Kind | null {
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, 8, [0x57, 0x45, 0x42, 0x50]))
    return 'webp';
  return null;
}

const refuse = (message = PHOTO_RULE) =>
  new AppError('VALIDATION', message, { errors: [{ path: 'photo', message }] });

/**
 * Every photo is decoded and drawn again as a 256 px WebP: that drops EXIF and other metadata, and
 * a polyglot file keeps nothing but its pixels.
 */
export async function normalizePhoto(bytes: Buffer): Promise<{ body: Buffer; hash: string }> {
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw refuse();
  const kind = sniffPhoto(bytes);
  if (!kind) throw refuse();
  if (gate.promisePhotoBusy)
    throw new AppError('RATE_LIMITED', 'Another photo is being saved. Try again in a moment.');
  gate.promisePhotoBusy = true;
  let body: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS[kind], failOn: 'error' });
    const meta = await image.metadata();
    if (meta.format !== kind) throw refuse();
    if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS[kind]) throw refuse(tooMany(kind));
    body = await image
      .rotate()
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw refuse(/pixel limit/i.test((error as Error).message) ? tooMany(kind) : PHOTO_RULE);
  } finally {
    gate.promisePhotoBusy = false;
  }
  return { body, hash: createHash('sha256').update(body).digest('hex') };
}
