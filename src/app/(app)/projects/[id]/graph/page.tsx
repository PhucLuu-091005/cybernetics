import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { IdSchema, type ActorContext } from '../../../../../contracts';
import { TrackerScreen } from '../../../../../components/tracker/TrackerScreen';
import { getApp } from '../../../../../server/app';
import { signedInAccount } from '../../../../../server/domain/account';
import { AppError } from '../../../../../server/errors';
import { requireActor } from '../../../../../server/http/rsc';
import { getTrackerPayload } from '../../../../../server/tracker';
import type { TrackerPayload } from '../../../../../tracker';

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

// A function imported from the client module would be a client reference here, so the page rounds the minute.
const serverMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** The layout already proved the project exists, so NOT_FOUND here means it has no tracker row. */
async function trackerPayload(
  actor: ActorContext,
  projectId: string,
  actAs: string | undefined,
): Promise<TrackerPayload | null> {
  const db = getApp().db;
  try {
    return await getTrackerPayload(db, actor, { projectId, ...(actAs ? { actAs } : {}) });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'NOT_FOUND') return null;
    // A stale act-as cookie (a removed member, a project that left demo mode) must not lock the page.
    if (actAs && (error.code === 'FORBIDDEN' || error.code === 'VALIDATION'))
      return trackerPayload(actor, projectId, undefined);
    throw error;
  }
}
