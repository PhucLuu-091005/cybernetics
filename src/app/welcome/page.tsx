import type { Metadata } from 'next';
import { BrandMark } from '../../components/shell/BrandMark';
import { Hero } from '../../components/shell/Hero';

const DESCRIPTION =
  'A live demo of an event tracker for a whole project: every team, work item and event on one graph. Opening it makes your own copy of the Larkspur Capital project, with no sign-in.';

export const metadata: Metadata = {
  title: 'Promise Graph: a live demo',
  description: DESCRIPTION,
  openGraph: { title: 'Promise Graph: a live demo', description: DESCRIPTION, type: 'website' },
};

const REFUSED: Record<string, { title: string; text: string; retry: boolean }> = {
  busy: {
    title: 'Too many new demo copies',
    text: 'This network opened many new demo copies in the last hour. Try again later.',
    retry: false,
  },
  cookies: {
    title: 'This browser did not keep the cookie',
    text: 'The demo keeps your copy with one cookie. Allow cookies for this site, or open the link in a tab of its own, not inside another page. Then open the demo again.',
    retry: true,
  },
};

/** Link previews, crawlers and refused visits land here; the page reads and writes nothing. */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const reason = (await searchParams).reason;
  const refused = typeof reason === 'string' ? REFUSED[reason] : undefined;
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
        {refused ? (
          <>
            <h2>{refused.title}</h2>
            <p className="muted small" role="alert">
              {refused.text}
            </p>
          </>
        ) : (
          <h2>Live demo</h2>
        )}
        {(!refused || refused.retry) && (
          <>
            {/* A Link would prefetch the app, and that prefetch alone would make a sandbox. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="btn big btn-block" href="/" rel="nofollow">
              Open the demo
            </a>
          </>
        )}
        {!refused && (
          <p className="muted small">
            No sign-in. Opening the demo makes your own copy of the Larkspur Capital project with
            its teams, work items and change requests. Nobody else sees your changes.
          </p>
        )}
        <hr style={{ border: 0, borderTop: '1px solid var(--rule-2)', width: '100%' }} />
        <p className="faint xsmall">
          The app never calls an AI model. Your own agent works in the tracker through MCP, with the
          permissions that you give its token.
        </p>
      </div>
    </main>
  );
}
