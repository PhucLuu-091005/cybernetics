export const dynamic = 'force-dynamic';
export default function HomePage() {
  const local = process.env.NODE_ENV !== 'production' && process.env.AUTH_MODE === 'local';
  const google =
    process.env.AUTH_MODE === 'google' &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET;
  return (
    <>
      <h1>Your workspace</h1>
      <p>Review evidence, trace commitments, and make graph changes through proposals.</p>
      {local ? (
        <form action="/api/auth/local" method="post">
          <button type="submit">Start a local workspace</button>
        </form>
      ) : google ? (
        <a href="/api/auth/google">Sign in with Google</a>
      ) : (
        <p>Sign-in is unavailable until authentication is configured.</p>
      )}
      <div className="status">
        New records enter the inbox. Reviewed proposals update the graph.
      </div>
    </>
  );
}
