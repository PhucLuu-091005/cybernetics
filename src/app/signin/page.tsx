import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandMark } from '../../components/shell/BrandMark';
import { readAuthEnvironment, type AuthEnvironment } from '../../server/env';
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

function Flag({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g stroke={color} fill={color}>
      <line x1={x} y1={y} x2={x} y2={y - 18} strokeWidth="1.5" />
      <path d={`M${x} ${y - 18} l10 4 -10 4 z`} />
    </g>
  );
}

function Hero() {
  const label = { textAnchor: 'middle', fontSize: 12, fill: 'var(--ink-2)' } as const;
  const event = { r: 7, fill: 'var(--surface)', stroke: 'var(--proceed)', strokeWidth: 2.5 };
  return (
    <svg
      className="hero-svg"
      viewBox="0 0 560 172"
      role="img"
      aria-label="Two work items on a project graph: events along each row, a planned finish that moved with a reason, and the milestone they lead to"
    >
      <line x1="10" y1="34" x2="550" y2="34" stroke="var(--trunk)" strokeWidth="3" />
      <polygon
        points="480,26 488,34 480,42 472,34"
        fill="var(--surface)"
        stroke="var(--trunk)"
        strokeWidth="2"
      />
      <text x="480" y="16" {...label}>
        Go-live
      </text>
      <path className="draw" d="M40 84 H290" fill="none" stroke="var(--proceed)" strokeWidth="3" />
      <g className="pop" style={{ animationDelay: '.5s' }}>
        <circle cx="60" cy="84" {...event} />
        <text x="60" y="66" {...label}>
          Request
        </text>
      </g>
      <g className="pop" style={{ animationDelay: '1s' }}>
        <circle cx="170" cy="84" {...event} />
        <text x="170" y="66" {...label}>
          Handoff
        </text>
      </g>
      <g className="pop" style={{ animationDelay: '1.5s' }}>
        <circle cx="290" cy="84" r="7" fill="var(--proceed)" />
        <text x="290" y="66" {...label}>
          Done
        </text>
      </g>
      <path
        className="draw"
        d="M290 84 C318 84 306 136 334 136 H450"
        fill="none"
        stroke="var(--route)"
        strokeWidth="3"
      />
      <g className="pop" style={{ animationDelay: '2s' }}>
        <path d="M450 136 H500" fill="none" stroke="var(--danger)" strokeWidth="3" />
        <Flag x={400} y={136} color="var(--ink-3)" />
        <Flag x={450} y={136} color="var(--danger)" />
        <path d="M406 106 H440" stroke="var(--ink-3)" strokeWidth="1" />
        <path d="M444 106 l-6 -3.5 v7 z" fill="var(--ink-3)" />
        <text x="425" y="162" {...label}>
          Moved, with a reason
        </text>
      </g>
      <line
        className="pop"
        style={{ animationDelay: '2.4s' }}
        x1="500"
        y1="136"
        x2="480"
        y2="42"
        stroke="var(--ink-3)"
        strokeWidth="1"
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
  const { label } = await searchParams;
  const localLabel = typeof label === 'string' && /^[a-z0-9-]{1,40}$/.test(label) ? label : null;
  if (mode && (await optionalActor('/signin'))) redirect('/');
  return (
    <main className="signin">
      <div>
        <div className="brand" style={{ padding: 0, marginBottom: 28 }}>
          <BrandMark />
          <b>Promise Graph</b>
        </div>
        <h1>See every step of a project, and why the plan changed.</h1>
        <p className="lede">
          Every team, work item and event sits on one graph. A planned date keeps its first value
          and every move, with who moved it and why. Main changes only when its owner merges a
          change request.
        </p>
        <Hero />
      </div>
      <div className="card pad stack" style={{ maxWidth: 380 }}>
        <h2>Sign in</h2>
        {mode === 'google' && (
          <a className="gbtn" href="/api/auth/google">
            <GoogleLogo />
            Continue with Google
          </a>
        )}
        {mode === 'local' && (
          <form action="/api/auth/local" method="post">
            {localLabel && <input type="hidden" name="label" value={localLabel} />}
            <button className="gbtn" type="submit">
              Continue (local dev{localLabel ? `, ${localLabel}` : ''})
            </button>
          </form>
        )}
        {mode === null && (
          <p className="bad" role="alert">
            Sign-in is unavailable until authentication is configured.
          </p>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          Your first visit creates a private sandbox: a copy of the Larkspur Capital demo project
          with its teams, work items and change requests.
        </p>
        <hr style={{ border: 0, borderTop: '1px solid var(--rule-2)', width: '100%' }} />
        <p className="faint" style={{ fontSize: 12 }}>
          The app never calls an AI model. Your own agent reads the tracker and adds events and work
          items to the Queue through MCP. Main changes only when its owner merges a change request.
        </p>
      </div>
    </main>
  );
}
