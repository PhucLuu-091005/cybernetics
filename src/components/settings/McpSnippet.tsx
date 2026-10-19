'use client';
import { useState } from 'react';
import type { KeyKind } from '../../contracts';
import { useHydrated } from '../shell/hydrated';
import { KEY_COPY } from './copy';

const SECRET_PLACEHOLDER = 'inv_...';
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

export function McpSnippet({ endpoint, kind = 'project' }: { endpoint: string; kind?: KeyKind }) {
  const hydrated = useHydrated();
  const { noun } = KEY_COPY[kind];
  const [status, setStatus] = useState('');
  return (
    <section className="pg-sec" aria-labelledby="connect-agent">
      <h2 id="connect-agent">Connect your agent</h2>
      <p>
        Paste this into your agent&apos;s MCP settings. Replace inv_... with the secret of your{' '}
        {noun}. Address:{' '}
        <span className="id" data-testid="mcp-endpoint">
          {endpoint}
        </span>
      </p>
      <pre className="snip" data-testid="mcp-snippet">
        {mcpConfig(endpoint, SECRET_PLACEHOLDER)}
      </pre>
      <div className="pg-acts">
        <button
          className="btn"
          type="button"
          disabled={!hydrated}
          onClick={async () =>
            setStatus(
              await copyText(
                mcpConfig(endpoint, SECRET_PLACEHOLDER),
                `Config copied. Replace inv_... with your ${noun} secret.`,
              ),
            )
          }
        >
          Copy config
        </button>
        <span className="pg-status" role="status">
          {status}
        </span>
      </div>
      <p className="pg-hint">
        Keep the secret out of version control. Event text that the agent reads is untrusted data
        and cannot grant a scope.
      </p>
    </section>
  );
}
