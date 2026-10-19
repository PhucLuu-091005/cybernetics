import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '../../../../../components/tracker/tracker.css';
import { IdSchema } from '../../../../../contracts';
import { shortDay } from '../../../../../components/settings/dates';
import { McpSnippet } from '../../../../../components/settings/McpSnippet';
import { PhotoSection } from '../../../../../components/settings/PhotoSection';
import { TokenCreate } from '../../../../../components/settings/TokenCreate';
import { TokenList } from '../../../../../components/settings/TokenList';
import { PageHead } from '../../../../../components/shell/PageHead';
import { getApp, listUserKeys } from '../../../../../server/app';
import { photosOn } from '../../../../../server/avatars/config';
import { personalCreator } from '../../../../../server/domain/account';
import { getProject } from '../../../../../server/domain/projects';
import { readAuthEnvironment } from '../../../../../server/env';
import {
  notFoundOn,
  notFoundOnCursor,
  pageOnScreen,
  requireActor,
  searchCursor,
} from '../../../../../server/http/rsc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Profile · Promise Graph' };
const DAY = 86_400_000;
const KEYS = '/api/v1/me/keys';

async function loadProfile(projectId: string, cursor: string | null) {
  const actor = await requireActor(`/projects/${projectId}/profile`);
  const db = getApp().db;
  const [{ timeZone }, page, seen, creator] = await Promise.all([
    notFoundOn(getProject(db, actor, { projectId })),
    notFoundOnCursor(listUserKeys(actor, { cursor }), cursor),
    pageOnScreen(actor, projectId),
    personalCreator(db, actor),
  ]);
  const { account } = seen;
  // The face of the person on screen, as every avatar shows them; the grey of avatar.tsx without a member.
  const face = {
    name: account.name,
    color: account.color ?? '#737373',
    photo: account.photo ?? null,
  };
  const now = Date.now();
  const expiryOptions = [30, 7].map((days) => ({
    days,
    label: `In ${days} days (${shortDay(new Date(now + days * DAY).toISOString(), timeZone, true)})`,
  }));
  return {
    timeZone,
    page,
    account,
    face,
    actingAs: seen.seeded ? account.name : undefined,
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
  const { timeZone, page, account, face, actingAs, creator, expiryOptions, now } =
    await loadProfile(id, cursor);
  const endpoint = `${readAuthEnvironment().appOrigin}/mcp`;
  return (
    <div className="tk pg">
      <PageHead title="Profile" account={account} />
      <div className="pg-body pg-split">
        <div className="pg-main">
          {photosOn() && (
            <PhotoSection {...face} api={`/api/v1/me/avatar?project=${id}`} actingAs={actingAs} />
          )}
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
          <McpSnippet endpoint={endpoint} kind="personal" />
        </aside>
      </div>
    </div>
  );
}
