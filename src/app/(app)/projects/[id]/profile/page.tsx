import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import '../../../../../components/tracker/tracker.css';
import { IdSchema } from '../../../../../contracts';
import { shortDay } from '../../../../../components/settings/dates';
import { McpSnippet } from '../../../../../components/settings/McpSnippet';
import { TokenCreate } from '../../../../../components/settings/TokenCreate';
import { TokenList } from '../../../../../components/settings/TokenList';
import { PageHead } from '../../../../../components/shell/PageHead';
import { getApp, listUserKeys } from '../../../../../server/app';
import { personalCreator, projectAccount } from '../../../../../server/domain/account';
import { getProject } from '../../../../../server/domain/projects';
import { readAuthEnvironment } from '../../../../../server/env';
import {
  notFoundOn,
  notFoundOnCursor,
  requireActor,
  searchCursor,
} from '../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Profile · Promise Graph' };
const DAY = 86_400_000;
const KEYS = '/api/v1/me/keys';

async function loadProfile(projectId: string, cursor: string | null) {
  const actor = await requireActor(`/projects/${projectId}/profile`);
  const actAs = (await cookies()).get(`pg_act_${projectId}`)?.value;
  const db = getApp().db;
  const [{ project, timeZone }, page, account, creator] = await Promise.all([
    notFoundOn(getProject(db, actor, { projectId })),
    notFoundOnCursor(listUserKeys(actor, { cursor }), cursor),
    projectAccount(db, actor, projectId, actAs),
    personalCreator(db, actor),
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
    creator,
    expiryOptions,
    now: new Date(now).toISOString(),
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const cursor = searchCursor(search.cursor);
  if (!IdSchema.safeParse(id).success) notFound();
  const { project, timeZone, page, account, creator, expiryOptions, now } = await loadProfile(
    id,
    cursor,
  );
  const endpoint = `${readAuthEnvironment().appOrigin}/mcp`;
  return (
    <div className="tk pg">
      <PageHead title="Profile" project={project} account={account} />
      <div className="pg-body pg-split">
        <div className="pg-main">
          <TokenList
            kind="personal"
            api={KEYS}
            tokens={page.items}
            now={now}
            timeZone={timeZone}
            basePath={`/projects/${id}/profile`}
            nextCursor={page.nextCursor}
            paged={cursor !== null}
          />
          <TokenCreate
            kind="personal"
            api={KEYS}
            endpoint={endpoint}
            expiryOptions={expiryOptions}
            creator={creator}
          />
        </div>
        <aside className="pg-aside">
          <McpSnippet endpoint={endpoint} />
        </aside>
      </div>
    </div>
  );
}
