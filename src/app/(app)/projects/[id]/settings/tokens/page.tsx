import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../../contracts';
import { shortDay } from '../../../../../../components/graph/labels';
import { McpSnippet } from '../../../../../../components/settings/McpSnippet';
import { TokenCreate } from '../../../../../../components/settings/TokenCreate';
import { TokenList } from '../../../../../../components/settings/TokenList';
import { getApp, listAgentTokens } from '../../../../../../server/app';
import { readAuthEnvironment } from '../../../../../../server/env';
import { getProject } from '../../../../../../server/domain/graph';
import { notFoundOn, requireActor } from '../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agent tokens · Promise Graph' };
const DAY = 86_400_000;

/** The request time belongs to the data load: token expiry and the expiry choices are read at the same instant. */
async function loadTokens(projectId: string) {
  const actor = await requireActor(`/projects/${projectId}/settings/tokens`);
  const [{ project, context }, page] = await Promise.all([notFoundOn(getProject(getApp().db, actor, { projectId })), notFoundOn(listAgentTokens(actor, { projectId }))]);
  const now = Date.now(), timeZone = context.timeZone;
  const expiryOptions = [30, 7].map(days => ({ days, label: `In ${days} days (${shortDay(new Date(now + days * DAY).toISOString(), timeZone, true)})` }));
  return { project, timeZone, page, expiryOptions, now: new Date(now).toISOString() };
}

export default async function AgentTokensPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const { project, timeZone, page, expiryOptions, now } = await loadTokens(id);
  const endpoint = `${readAuthEnvironment().appOrigin}/mcp`;

  return (
    <>
      <header className="topbar">
        <div className="proj"><b>{project.title}</b><small>{project.clientName} project, time zone {timeZone}</small></div>
      </header>
      <div className="screen">
        <div className="screen-head">
          <h1>Agent tokens</h1>
          <p>A token lets your own AI agent use this project through MCP. A token belongs to one project and expires after 30 days by default. The app stores only a hash of the secret.</p>
        </div>
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <TokenList projectId={id} tokens={page.items} now={now} timeZone={timeZone} more={page.nextCursor !== null} />
            <McpSnippet endpoint={endpoint} />
          </div>
          <TokenCreate projectId={id} endpoint={endpoint} expiryOptions={expiryOptions} />
        </div>
      </div>
    </>
  );
}
