import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandMark } from '../../components/shell/BrandMark';
import { readAuthEnvironment, type AuthEnvironment } from '../../server/env';
import { optionalActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in · Promise Graph' };

function authMode(): AuthEnvironment['mode'] | null {
  try { return readAuthEnvironment().mode; }
  catch { return null; }
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
      <path fill="#FBBC05" d="M10.4 28.8c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.7-3.9-13.6-9.7l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function Hero() {
  return (
    <svg className="hero-svg" viewBox="0 0 560 150" role="img" aria-label="A request forks from the project trunk, gets a promise, a delivery, and merges back when the client accepts">
      <line x1="10" y1="118" x2="550" y2="118" stroke="var(--trunk)" strokeWidth="3" />
      <path className="draw" d="M70 118 C95 118 85 48 115 48 H405 C435 48 425 118 450 118" fill="none" stroke="var(--proceed)" strokeWidth="3" />
      <g className="pop" style={{ animationDelay: '.7s' }}><circle cx="130" cy="48" r="7" fill="var(--surface)" stroke="var(--proceed)" strokeWidth="2.5" /><text x="130" y="30" textAnchor="middle" fontSize="12" fill="var(--ink-2)">Request</text></g>
      <g className="pop" style={{ animationDelay: '1.2s' }}><circle cx="220" cy="48" r="7" fill="var(--proceed)" /><text x="220" y="30" textAnchor="middle" fontSize="12" fill="var(--ink-2)">Promise</text></g>
      <g className="pop" style={{ animationDelay: '1.8s' }}><path d="M330 41 A7 7 0 0 1 330 55 Z" fill="var(--proceed)" /><circle cx="330" cy="48" r="7" fill="none" stroke="var(--proceed)" strokeWidth="2.5" /><text x="330" y="30" textAnchor="middle" fontSize="12" fill="var(--ink-2)">Done</text></g>
      <g className="pop" style={{ animationDelay: '2.4s' }}><circle cx="450" cy="118" r="6" fill="var(--proceed)" /><text x="450" y="142" textAnchor="middle" fontSize="12" fill="var(--ink-2)">Accepted</text></g>
      <polygon points="40,110 48,118 40,126 32,118" fill="var(--trunk)" /><text x="40" y="142" textAnchor="middle" fontSize="12" fill="var(--ink-2)">Kickoff</text>
      <polygon points="520,110 528,118 520,126 512,118" fill="var(--trunk)" /><text x="520" y="142" textAnchor="middle" fontSize="12" fill="var(--ink-2)">Go-live</text>
    </svg>
  );
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = authMode();
  const { label } = await searchParams;
  const localLabel = typeof label === 'string' && /^[a-z0-9-]{1,40}$/.test(label) ? label : null;
  if (mode && await optionalActor('/signin')) redirect('/');
  return (
    <main className="signin">
      <div>
        <div className="brand" style={{ padding: 0, marginBottom: 28 }}><BrandMark /><b>Promise Graph</b></div>
        <h1>Every promise, traced to the message that made it.</h1>
        <p className="lede">See who asked for what, who committed, what was delivered and where the project stalled. Every line on the graph points to its source message.</p>
        <Hero />
      </div>
      <div className="card pad stack" style={{ maxWidth: 380 }}>
        <h2>Sign in</h2>
        {mode === 'google' && <a className="gbtn" href="/api/auth/google"><GoogleLogo />Continue with Google</a>}
        {mode === 'local' && <form action="/api/auth/local" method="post">{localLabel && <input type="hidden" name="label" value={localLabel} />}<button className="gbtn" type="submit">Continue (local dev{localLabel ? `, ${localLabel}` : ''})</button></form>}
        {mode === null && <p className="bad" role="alert">Sign-in is unavailable until authentication is configured.</p>}
        <p className="muted" style={{ fontSize: 13 }}>Your first visit creates a private sandbox: a copy of the Larkspur Capital demo project with its imported records and reviewed loops. Building it can take about 10 seconds on the free host.</p>
        <hr style={{ border: 0, borderTop: '1px solid var(--rule-2)', width: '100%' }} />
        <p className="faint" style={{ fontSize: 12 }}>The app never calls an AI model. Your own agent reads evidence and submits proposals through MCP. Nothing changes the graph until a person merges it.</p>
      </div>
    </main>
  );
}
