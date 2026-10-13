import { NextResponse } from 'next/server';
/** Actual actor authorization remains in every protected handler. */
export default function proxy() {
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)', '/(api|mcp)(.*)'] };
