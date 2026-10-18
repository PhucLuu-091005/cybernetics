import { NextResponse, type NextRequest } from 'next/server';
import { RETURN_PATH_HEADER } from './server/http/return-path';

/** Actual actor authorization remains in every protected handler. */
export default function proxy(request: NextRequest) {
  const asked = request.nextUrl.clone();
  asked.searchParams.delete('_rsc');
  const headers = new Headers(request.headers);
  headers.set(RETURN_PATH_HEADER, asked.pathname + asked.search);
  return NextResponse.next({ request: { headers } });
}
export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)',
    '/(api|mcp)(.*)',
  ],
};
