import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '../../../../../../components/tracker/tracker.css';
import { IdSchema } from '../../../../../../contracts';
import { shortDay } from '../../../../../../components/settings/dates';
import { McpSnippet } from '../../../../../../components/settings/McpSnippet';
import { TokenCreate } from '../../../../../../components/settings/TokenCreate';
import { TokenList } from '../../../../../../components/settings/TokenList';
import { PageHead } from '../../../../../../components/shell/PageHead';
import { getApp, listAgentTokens } from '../../../../../../server/app';
import { tokenCreator } from '../../../../../../server/domain/account';
import { readAuthEnvironment } from '../../../../../../server/env';
import { getProject } from '../../../../../../server/domain/projects';
import {
  notFoundOn,
  notFoundOnCursor,
  pageOnScreen,
  requireActor,
  searchCursor,
} from '../../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Settings · Promise Graph' };
const DAY = 86_400_000;

/** The request time belongs to the data load: token expiry and the expiry choices are read at the same instant. */
async function loadTokens(projectId: string, cursor: string | null) {
  const actor = await requireActor(`/projects/${projectId}/settings/tokens`);
  const db = getApp().db;
  const [{ project, timeZone }, page, seen] = await Promise.all([
    notFoundOn(getProject(db, actor, { projectId })),
    notFoundOnCursor(listAgentTokens(actor, { projectId, cursor }), cursor),
    pageOnScreen(actor, projectId),
  ]);
  const { account } = seen;
  const creator = await tokenCreator(db, actor, projectId, seen.actAs);
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
    creator,
    actingAs: seen.seeded ? account.name : undefined,
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
  const { project, timeZone, page, account, creator, actingAs, expiryOptions, now } =
    await loadTokens(id, cursor);
  const endpoint = `${readAuthEnvironment().appOrigin}/mcp`;

  return (
    <div className="tk pg">
      <PageHead title="Settings" project={project} account={account} />
      <div className="pg-body pg-split">
        <div className="pg-main">
          <section className="pg-sec" aria-labelledby="project-facts">
            <h2 id="project-facts">Project</h2>
            <dl className="pg-facts">
              <dt>Name</dt>
              <dd>{project.title}</dd>
              <dt>Client</dt>
              <dd>{project.clientName}</dd>
              <dt>Time zone</dt>
              <dd>
                {timeZone}
                <small>Dates and times of the project use it.</small>
              </dd>
            </dl>
          </section>
          <TokenList
            api={`/api/v1/projects/${id}/agent-tokens`}
            tokens={page.items}
            now={now}
            timeZone={timeZone}
            basePath={`/projects/${id}/settings/tokens`}
            nextCursor={page.nextCursor}
            paged={cursor !== null}
          />
          <TokenCreate
            api={`/api/v1/projects/${id}/agent-tokens`}
            endpoint={endpoint}
            expiryOptions={expiryOptions}
            creator={creator}
            actingAs={actingAs}
          />
        </div>
        <aside className="pg-aside">
          <McpSnippet endpoint={endpoint} />
        </aside>
      </div>
    </div>
  );
}
