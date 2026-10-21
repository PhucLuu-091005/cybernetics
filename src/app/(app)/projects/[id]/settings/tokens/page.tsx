import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import '../../../../../../components/tracker/tracker.css';
import { IdSchema } from '../../../../../../contracts';
import { shortDay } from '../../../../../../components/settings/dates';
import { McpSnippet } from '../../../../../../components/settings/McpSnippet';
import { TokenCreate } from '../../../../../../components/settings/TokenCreate';
import { TokenList } from '../../../../../../components/settings/TokenList';
import { PageHead } from '../../../../../../components/shell/PageHead';
import { getApp, listAgentTokens } from '../../../../../../server/app';
import { projectAccount } from '../../../../../../server/domain/account';
import { readAuthEnvironment } from '../../../../../../server/env';
import { getProject } from '../../../../../../server/domain/projects';
import {
  notFoundOn,
  notFoundOnCursor,
  requireActor,
  searchCursor,
} from '../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings · Promise Graph' };
const DAY = 86_400_000;

/** The request time belongs to the data load: token expiry and the expiry choices are read at the same instant. */
async function loadTokens(projectId: string, cursor: string | null) {
  const actor = await requireActor(`/projects/${projectId}/settings/tokens`);
  const actAs = (await cookies()).get(`pg_act_${projectId}`)?.value;
  const [{ project, timeZone }, page, account] = await Promise.all([
    notFoundOn(getProject(getApp().db, actor, { projectId })),
    notFoundOnCursor(listAgentTokens(actor, { projectId, cursor }), cursor),
    projectAccount(getApp().db, actor, projectId, actAs),
  ]);
  const now = Date.now();
  const expiryOptions = [30, 7].map((days) => ({
    days,
    label: `In ${days} days (${shortDay(new Date(now + days * DAY).toISOString(), timeZone, true)})`,
  }));
  return {
    project,
    timeZone,
    page,
    account,
    expiryOptions,
    now: new Date(now).toISOString(),
  };
}

export default async function AgentTokensPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const cursor = searchCursor(search.cursor);
  if (!IdSchema.safeParse(id).success) notFound();
  const { project, timeZone, page, account, expiryOptions, now } = await loadTokens(id, cursor);
  const endpoint = `${readAuthEnvironment().appOrigin}/mcp`;

  return (
    <div className="tk pg">
      <PageHead title="Settings" project={project} account={account} />
      <div className="pg-body pg-split">
        <p className="pg-lede">
          A token lets your own AI agent use this project through MCP. A token belongs to one
          project and expires after 30 days by default. The app stores only a hash of the secret.
          Project time zone: {timeZone}.
        </p>
        <div>
          <TokenList
            projectId={id}
            tokens={page.items}
            now={now}
            timeZone={timeZone}
            basePath={`/projects/${id}/settings/tokens`}
            nextCursor={page.nextCursor}
            paged={cursor !== null}
          />
          <TokenCreate projectId={id} endpoint={endpoint} expiryOptions={expiryOptions} />
        </div>
        <div className="pg-aside">
          <McpSnippet endpoint={endpoint} />
        </div>
      </div>
    </div>
  );
}
