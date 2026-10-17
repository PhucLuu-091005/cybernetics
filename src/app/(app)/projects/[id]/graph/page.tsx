import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema } from '../../../../../contracts';
import { TrackerScreen } from '../../../../../components/tracker/TrackerScreen';
import { getApp } from '../../../../../server/app';
import { signedInAccount } from '../../../../../server/domain/account';
import { requireActor } from '../../../../../server/http/rsc';
import { NoViewNotice, serverMinute, trackerPayload } from '../tracker-load';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Graph · Promise Graph' };

export default async function GraphPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  // A change request has its own page now; links shared before still carry ?cr=.
  if (typeof search.cr === 'string' && /^\d{1,9}$/.test(search.cr))
    redirect(`/projects/${id}/changes/${search.cr}`);
  const actor = await requireActor(`/projects/${id}/graph`);
  const payload = await trackerPayload(actor, id, (await cookies()).get(`pg_act_${id}`)?.value);
  if (payload === 'no-view') return <NoViewNotice projectId={id} />;
  if (!payload)
    return (
      <div className="screen">
        <div className="card pad" role="status">
          <h1>This project has no tracker yet.</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Make a new project from the project menu to start an event tracker.
          </p>
        </div>
      </div>
    );
  return (
    <TrackerScreen
      payload={payload}
      projectId={id}
      userId={actor.userId}
      account={await signedInAccount(getApp().db, actor.userId)}
      serverNow={serverMinute()}
    />
  );
}
