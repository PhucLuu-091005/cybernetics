import { getApp } from '../../../../server/app';
import { readAuthEnvironment } from '../../../../server/env';
import { AppError, errorResponse, newRequestId, statusFor } from '../../../../server/errors';
import { enterDemo, restartDemo } from '../../../../server/http/demo';
import { getRateLimiter } from '../../../../server/http/runtime';
export const runtime = 'nodejs';

const deps = () => ({
  env: readAuthEnvironment(),
  store: getApp().identity,
  limiter: getRateLimiter(),
});
const redirect = ({ location, cookie }: { location: string; cookie?: string }) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'private, no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });

export async function GET(request: Request): Promise<Response> {
  try {
    return redirect(await enterDemo(request, deps()));
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
export const HEAD = GET;

// Start over is a form post, so a refusal is a page the person reads, not JSON.
export async function POST(request: Request): Promise<Response> {
  try {
    return redirect(await restartDemo(request, deps()));
  } catch (error) {
    const known = error instanceof AppError && error.code !== 'INTERNAL';
    if (!known)
      console.error(
        JSON.stringify({
          requestId: newRequestId(),
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Promise Graph</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 16px"><h1 style="font-size:20px">Start over did not work</h1><p>Open the demo again and use Start over from its menu.</p><p><a href="/">Open the demo</a></p>',
      {
        status: known ? statusFor(error.code) : 500,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      },
    );
  }
}
