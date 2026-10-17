import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/graph`);
  const payload = await trackerPayload(actor, id, (await cookies()).get(`pg_act_${id}`)?.value);
  if (payload === 'no-view')
    return (
      <div className="screen">
        <div className="card pad" role="status">
          <h1>You cannot see Main of this project yet.</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            The project lead decides who sees Main. The{' '}
            <Link href={`/projects/${id}/members`}>Members page</Link> names the project lead.
          </p>
        </div>
      </div>
    );
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
): Promise<TrackerPayload | 'no-view' | null> {
  const db = getApp().db;
  try {
    return await getTrackerPayload(db, actor, { projectId, ...(actAs ? { actAs } : {}) });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'NOT_FOUND') return null;
    const details = error.extras.details as { reason?: string } | undefined;
    if (error.code === 'FORBIDDEN' && details?.reason === 'no-view') return 'no-view';
    // A stale act-as cookie (a removed member, a project that left demo mode) must not lock the page.
    if (actAs && (error.code === 'FORBIDDEN' || error.code === 'VALIDATION'))
      return trackerPayload(actor, projectId, undefined);
    throw error;
  }
}
