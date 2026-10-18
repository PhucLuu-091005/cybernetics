/** A photo store that is on but misconfigured stops the server here, before the first request. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertPhotoConfig } = await import('./server/avatars/config');
    assertPhotoConfig();
  }
}
