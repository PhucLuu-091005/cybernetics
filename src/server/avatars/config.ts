import { GcsPhotoStore, LocalPhotoStore, metadataToken, type PhotoStore } from './store';

type PhotoConfig = { driver: 'gcs'; bucket: string } | { driver: 'local'; dir: string };

const BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

/** No AVATAR_STORE means photos are off: initials only. A store that is on but broken stops the start. */
export function readPhotoConfig(
  values: Record<string, string | undefined> = process.env,
): PhotoConfig | null {
  const driver = values.AVATAR_STORE;
  if (!driver) return null;
  if (driver === 'gcs') {
    const bucket = values.AVATAR_BUCKET ?? '';
    if (!bucket) throw new Error('AVATAR_BUCKET is required when AVATAR_STORE is gcs');
    if (!BUCKET.test(bucket)) throw new Error('AVATAR_BUCKET is not a bucket name');
    return { driver, bucket };
  }
  if (driver === 'local') {
    if (values.NODE_ENV === 'production')
      throw new Error('AVATAR_STORE=local is for development and tests; use gcs in production');
    return { driver, dir: values.AVATAR_DIR || '.avatars' };
  }
  throw new Error('AVATAR_STORE must be gcs or local');
}

/** Next logs an error thrown in the instrumentation hook and keeps serving, so the start ends here. */
export function assertPhotoConfig(): void {
  try {
    readPhotoConfig();
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'photo_config_invalid', message: (error as Error).message }),
    );
    process.exit(1);
  }
}

const state = globalThis as typeof globalThis & { promisePhotoStore?: PhotoStore | null };

export function photoStore(): PhotoStore | null {
  if (state.promisePhotoStore !== undefined) return state.promisePhotoStore;
  const config = readPhotoConfig();
  state.promisePhotoStore =
    config === null
      ? null
      : config.driver === 'gcs'
        ? new GcsPhotoStore(config.bucket, { token: metadataToken() })
        : new LocalPhotoStore(config.dir);
  return state.promisePhotoStore;
}

/** Tests point the app at their own store, or at none to turn photos off. */
export function configurePhotoStore(store: PhotoStore | null | undefined): void {
  if (store === undefined) delete state.promisePhotoStore;
  else state.promisePhotoStore = store;
}

export const photosOn = () => photoStore() !== null;
