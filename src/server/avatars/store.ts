import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** One small interface, so production keeps photos in a bucket and dev and tests in a folder. */
export interface PhotoStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const KEY = /^avatars\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/;
export const isPhotoKey = (key: string) => KEY.test(key);
/** The hash in the URL changes with the photo, so a browser may keep each URL for good. */
export function photoUrl(userId: string | null, key: string | null): string | null {
  if (!userId || !key || !isPhotoKey(key)) return null;
  return `/api/v1/avatars/${userId}/${key.slice(-69, -5)}`;
}
function assertKey(key: string): void {
  if (!isPhotoKey(key)) throw new Error('Invalid photo key');
}

export class LocalPhotoStore implements PhotoStore {
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }
  private path(key: string): string {
    assertKey(key);
    return join(this.root, key);
  }
  async put(key: string, body: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    // A reader never sees half a file: the bytes land under another name first.
    const part = `${path}.${process.pid}.part`;
    await writeFile(part, body);
    await rename(part, path);
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

type Fetch = typeof fetch;
const METADATA_TOKEN =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/**
 * Application Default Credentials on Cloud Run come from the metadata server of the service
 * account; the token is cached until a minute before it expires.
 */
export function metadataToken(fetchFn: Fetch = fetch, now: () => number = Date.now) {
  let cached: { token: string; until: number } | null = null;
  return async (): Promise<string> => {
    if (cached && cached.until > now()) return cached.token;
    const response = await fetchFn(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!response.ok) throw new Error(`Metadata token failed with ${response.status}`);
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number')
      throw new Error('Metadata token has no access token');
    cached = { token: body.access_token, until: now() + (body.expires_in - 60) * 1000 };
    return cached.token;
  };
}

/** The Cloud Storage JSON API through fetch, so the image carries no Google client library. */
export class GcsPhotoStore implements PhotoStore {
  constructor(
    private readonly bucket: string,
    private readonly options: { fetch?: Fetch; token: () => Promise<string> },
  ) {}
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.options.token()}`);
    return (this.options.fetch ?? fetch)(url, { ...init, headers });
  }
  private object(key: string): string {
    assertKey(key);
    return `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(key)}`;
  }
  async put(key: string, body: Buffer): Promise<void> {
    assertKey(key);
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const response = await this.call(url, {
      method: 'POST',
      headers: { 'Content-Type': 'image/webp' },
      body: new Uint8Array(body),
    });
    if (!response.ok) throw new Error(`Photo upload failed with ${response.status}`);
  }
  async get(key: string): Promise<Buffer | null> {
    const response = await this.call(`${this.object(key)}?alt=media`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Photo read failed with ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  async remove(key: string): Promise<void> {
    const response = await this.call(this.object(key), { method: 'DELETE' });
    if (!response.ok && response.status !== 404)
      throw new Error(`Photo delete failed with ${response.status}`);
  }
}
