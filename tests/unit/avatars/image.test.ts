import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizePhoto, PHOTO_RULE, sniffPhoto } from '../../../src/server/avatars/image';
import { hugePng, solid } from '../../support/photos';

const refused = (message = PHOTO_RULE) => ({ code: 'VALIDATION', message });

describe('photo checks and re-encoding', () => {
  it('reads the type from the first bytes, never from a name', async () => {
    expect(sniffPhoto(await solid('png'))).toBe('png');
    expect(sniffPhoto(await solid('jpeg'))).toBe('jpeg');
    expect(sniffPhoto(await solid('webp'))).toBe('webp');
    expect(sniffPhoto(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('draws every PNG, JPEG and WebP again as a 256 px square WebP, cut from the centre', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const { body, hash } = await normalizePhoto(await solid(format, 600, 200));
      const meta = await sharp(body).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('drops the metadata of the upload', async () => {
    const tagged = await sharp(await solid('jpeg'))
      .withExif({ IFD0: { Copyright: 'secret place', Artist: 'someone' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const { body } = await normalizePhoto(tagged);
    const meta = await sharp(body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(body.includes(Buffer.from('secret place'))).toBe(false);
  });

  it('refuses a text file named .png, an empty file and one over 5 MB', async () => {
    await expect(normalizePhoto(Buffer.from('not an image at all'))).rejects.toMatchObject(
      refused(),
    );
    await expect(normalizePhoto(Buffer.alloc(0))).rejects.toMatchObject(refused());
    const big = Buffer.concat([await solid('png'), Buffer.alloc(5 * 1024 * 1024)]);
    await expect(normalizePhoto(big)).rejects.toMatchObject(refused());
  });

  it('refuses a file that starts like a PNG but is not one, and a type that lies about itself', async () => {
    const fake = Buffer.concat([(await solid('png')).subarray(0, 8), Buffer.from('<?php ?>')]);
    await expect(normalizePhoto(fake)).rejects.toMatchObject(refused());
    const gif = await sharp(await solid('png'))
      .gif()
      .toBuffer();
    await expect(normalizePhoto(gif)).rejects.toMatchObject(refused());
  });

  it('refuses an image whose header claims too many pixels, before it decodes them', async () => {
    await expect(normalizePhoto(hugePng())).rejects.toMatchObject(
      refused('The photo has too many pixels. Use one under 16 megapixels.'),
    );
  });

  it('caps a PNG and a WebP at 16 megapixels, and lets a JPEG keep 40 with shrink-on-load', async () => {
    const tooMany = refused('The photo has too many pixels. Use one under 16 megapixels.');
    await expect(normalizePhoto(hugePng(5000, 3300))).rejects.toMatchObject(tooMany);
    const webp = await sharp({
      create: { width: 4200, height: 4000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp({ lossless: true })
      .toBuffer();
    await expect(normalizePhoto(webp)).rejects.toMatchObject(tooMany);
    const jpeg = await solid('jpeg', 6000, 4000);
    expect((await sharp((await normalizePhoto(jpeg)).body).metadata()).width).toBe(256);
  });

  it('decodes one photo at a time in the process, and answers RATE_LIMITED to the others', async () => {
    const png = await solid('png');
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => normalizePhoto(png)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((r) => r.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'RATE_LIMITED' });
    await expect(normalizePhoto(Buffer.from('nope'))).rejects.toMatchObject(refused());
    await expect(normalizePhoto(hugePng())).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(normalizePhoto(png)).resolves.toMatchObject({ hash: expect.any(String) });
  });

  it('keeps a polyglot to its pixels: bytes after the image do not reach the output', async () => {
    const tail = Buffer.from('<script>alert(1)</script>');
    const { body } = await normalizePhoto(Buffer.concat([await solid('png'), tail]));
    expect(body.includes(tail)).toBe(false);
    expect((await sharp(body).metadata()).format).toBe('webp');
  });
});
