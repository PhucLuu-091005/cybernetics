export const runtime = 'nodejs';
/** Liveness only: no DB/provider secrets required to build or start. */
export function GET(): Response { return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } }); }
