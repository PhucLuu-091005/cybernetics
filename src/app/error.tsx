'use client';
import Link from 'next/link';
import { Notice } from '../components/shell/Notice';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset(): void;
}) {
  // Must match RATE_LIMITED_DIGEST in src/server/http/rsc.ts, which this client file cannot import.
  const limited = error.digest === 'RATE_LIMITED';
  return (
    <Notice
      page
      role="alert"
      title={limited ? 'Too many requests' : 'Something went wrong'}
      actions={
        <>
          <button className="btn btn-ink" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="btn" href="/">
            Go to your projects
          </Link>
        </>
      }
    >
      {limited
        ? 'You opened many pages in a short time. Wait a minute, then try again.'
        : 'The page could not load. Try again; if it keeps failing, reload the app.'}
    </Notice>
  );
}
