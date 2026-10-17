import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { IdSchema, type ActorContext } from '../../../../../../contracts';
import { TrackerScreen } from '../../../../../../components/tracker/TrackerScreen';
import { getApp } from '../../../../../../server/app';
import { signedInAccount } from '../../../../../../server/domain/account';
import { AppError } from '../../../../../../server/errors';
import { requireActor } from '../../../../../../server/http/rsc';
import { getTrackerPayload } from '../../../../../../server/tracker';
import type { TrackerPayload } from '../../../../../../tracker';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Change request · Promise Graph' };

/** The one place to see, edit, review and merge a change request; old `?tab=` links land here too. */
export default async function ChangeRequestPage({
  params,
}: {
  params: Promise<{ id: string; num: string }>;
}) {
  const { id, num } = await params;
  if (!IdSchema.safeParse(id).success || !/^\d{1,9}$/.test(num)) notFound();
  const actor = await requireActor(`/projects/${id}/changes/${num}`);
  const payload = await trackerPayload(actor, id, (await cookies()).get(`pg_act_${id}`)?.value);
  if (!payload)
    return (
      <div className="screen">
        <div className="card pad" role="status">
          <h1>This project has no tracker yet.</h1>
        </div>
      </div>
    );
  if (!payload.crs.some((cr) => cr.num === Number(num))) notFound();
  return (
    <TrackerScreen
      key={num}
      payload={payload}
      projectId={id}
      num={Number(num)}
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
  try {
    return await getTrackerPayload(getApp().db, actor, {
      projectId,
      ...(actAs ? { actAs } : {}),
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'NOT_FOUND') return null;
    // A stale act-as cookie (a removed member, a project that left demo mode) must not lock the page.
    if (actAs && (error.code === 'FORBIDDEN' || error.code === 'VALIDATION'))
      return trackerPayload(actor, projectId, undefined);
    throw error;
  }
}
