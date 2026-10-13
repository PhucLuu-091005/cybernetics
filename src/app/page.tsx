import { SignInButton } from '@clerk/nextjs';
export const dynamic = 'force-dynamic';
export default function HomePage() {
  const local = process.env.NODE_ENV !== 'production' && process.env.AUTH_MODE === 'local';
  const clerk = process.env.AUTH_MODE === 'clerk' && process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return <><h1>Your workspace</h1><p>Review evidence, trace commitments, and make graph changes through proposals.</p>{local ? <form action="/api/auth/local" method="post"><button type="submit">Start a local workspace</button></form> : clerk ? <SignInButton mode="modal"><button>Sign in</button></SignInButton> : <p>Sign-in is unavailable until authentication is configured.</p>}<div className="status">New records enter the inbox. Reviewed proposals update the graph.</div></>;
}
