import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandMark } from '../../components/shell/BrandMark';
import { Hero } from '../../components/shell/Hero';
import { readAuthEnvironment, type AuthEnvironment } from '../../server/env';
import { demoEntryPath } from '../../server/http/demo';
import { returnPath } from '../../server/http/return-path';
import { optionalActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in · Promise Graph' };

function authMode(): AuthEnvironment['mode'] | null {
  try {
    return readAuthEnvironment().mode;
  } catch {
    return null;
  }
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.7-3.9-13.6-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const mode = authMode();
  const params = await searchParams;
  const { label } = params;
  const localLabel = typeof label === 'string' && /^[a-z0-9-]{1,40}$/.test(label) ? label : null;
  const next = returnPath(params.next);
  if (mode === 'demo') redirect(demoEntryPath(next));
  if (mode && (await optionalActor('/signin'))) redirect(next ?? '/');
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  return (
    <main className="signin" id="content" tabIndex={-1}>
      <div>
        <div className="brand" style={{ padding: 0, marginBottom: 28 }}>
          <BrandMark />
          <b>Promise Graph</b>
        </div>
        <h1>See every step of a project, and why the plan changed.</h1>
        <p className="lede">
          Every team, work item and event sits on one graph. A planned date keeps its first value
          and every move, with who moved it and why. Main changes only when a person with the Merge
          right merges a change request.
        </p>
        <Hero />
      </div>
      <div className="card pad stack" style={{ maxWidth: 380 }}>
        <h2>Sign in</h2>
        {mode === 'google' && (
          <a className="btn big btn-block" href={`/api/auth/google${query}`}>
            <GoogleLogo />
            Continue with Google
          </a>
        )}
        {mode === 'local' && (
          <form action={`/api/auth/local${query}`} method="post">
            {localLabel && <input type="hidden" name="label" value={localLabel} />}
            <button className="btn big btn-block" type="submit">
              Continue (local dev{localLabel ? `, ${localLabel}` : ''})
            </button>
          </form>
        )}
        {mode === null && (
          <p className="bad" role="alert">
            Sign-in is unavailable until authentication is configured.
          </p>
        )}
        <p className="muted small">
          Your first visit creates a private sandbox: a copy of the Larkspur Capital demo project
          with its teams, work items and change requests.
        </p>
        <hr style={{ border: 0, borderTop: '1px solid var(--rule-2)', width: '100%' }} />
        <p className="faint xsmall">
          The app never calls an AI model. Your own agent works in the tracker through MCP, with the
          permissions that you give its token.
        </p>
      </div>
    </main>
  );
}
