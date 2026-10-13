'use client';
import Link from 'next/link';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  // Must match RATE_LIMITED_DIGEST in src/server/http/rsc.ts, which this client file cannot import.
  const limited = error.digest === 'RATE_LIMITED';
  return (
    <main className="signin" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 560 }}>
      <div className="card pad stack" role="alert">
        <h1>{limited ? 'Too many requests' : 'Something went wrong'}</h1>
        <p className="muted">{limited ? 'You opened many pages in a short time. Wait a minute, then try again.' : 'The page could not load. Try again; if it keeps failing, reload the app.'}</p>
        <div className="row">
          <button className="btn btn-ink" type="button" onClick={reset}>Try again</button>
          <Link className="btn" href="/">Go to your projects</Link>
        </div>
      </div>
    </main>
  );
}
