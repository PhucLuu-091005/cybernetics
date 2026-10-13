import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
const clerk = clerkMiddleware();
/** Actual actor authorization remains in every protected handler. */
export default function proxy(request: NextRequest, event: Parameters<typeof clerk>[1]) {
  if (process.env.AUTH_MODE === 'clerk' && process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return clerk(request, event);
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)', '/(api|mcp)(.*)'] };
