'use client';
import { useState } from 'react';
import { useHydrated } from '../review/hydrated';

export const SECRET_PLACEHOLDER = 'inv_...';
/** Same shape as docs/mcp-agent-recipe.md, so the page and the recipe never disagree. */
export const mcpConfig = (endpoint: string, secret: string) =>
  JSON.stringify(
    {
      mcpServers: {
        'promise-graph': {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );

export async function copyText(text: string, done: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(text);
    return done;
  } catch {
    return 'Copy failed. Select the text and copy it by hand.';
  }
}

export function McpSnippet({ endpoint }: { endpoint: string }) {
  const hydrated = useHydrated();
  const [status, setStatus] = useState('');
  return (
    <section className="card pad stack" aria-labelledby="connect-agent">
      <h2 id="connect-agent">Connect your agent</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Paste this into your agent&apos;s MCP settings. Replace inv_... with the secret of your
        token. Address:{' '}
        <span className="id" data-testid="mcp-endpoint">
          {endpoint}
        </span>
      </p>
      <pre className="snip" data-testid="mcp-snippet">
        {mcpConfig(endpoint, SECRET_PLACEHOLDER)}
      </pre>
      <div className="row">
        <button
          className="btn"
          type="button"
          disabled={!hydrated}
          onClick={async () =>
            setStatus(
              await copyText(
                mcpConfig(endpoint, SECRET_PLACEHOLDER),
                'Config copied. Replace inv_... with your token secret.',
              ),
            )
          }
        >
          Copy config
        </button>
        <span className="faint" role="status" style={{ fontSize: 12 }}>
          {status}
        </span>
      </div>
      <p className="faint" style={{ fontSize: 12 }}>
        Keep the secret out of version control. Record text that the agent reads is untrusted data
        and cannot grant a scope.
      </p>
    </section>
  );
}
