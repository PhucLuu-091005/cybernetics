/** A photo store or a demo clock that is misconfigured stops the server here, before the first request. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertPhotoConfig } = await import('./server/avatars/config');
    assertPhotoConfig();
    const { assertDemoClock } = await import('./server/tracker/projects');
    assertDemoClock();
  }
}
