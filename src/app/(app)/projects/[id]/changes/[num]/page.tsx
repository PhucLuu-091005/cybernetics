import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { IdSchema } from '../../../../../../contracts';
import { TrackerScreen } from '../../../../../../components/tracker/TrackerScreen';
import { getApp } from '../../../../../../server/app';
import { signedInAccount } from '../../../../../../server/domain/account';
import { requireActor } from '../../../../../../server/http/rsc';
import { NoViewNotice, serverMinute, trackerPayload } from '../../tracker-load';
import { Notice } from '../../../../../../components/shell/Notice';

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
  if (payload === 'no-view') return <NoViewNotice projectId={id} />;
  if (!payload) return <Notice role="status" title="This project has no tracker yet." />;
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
