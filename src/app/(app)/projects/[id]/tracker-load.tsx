import Link from 'next/link';
import { Notice } from '../../../../components/shell/Notice';
import type { ActorContext } from '../../../../contracts';
import { getApp } from '../../../../server/app';
import { AppError } from '../../../../server/errors';
import { getTrackerPayload } from '../../../../server/tracker';
import type { TrackerPayload } from '../../../../tracker';

// A function imported from the client module would be a client reference here, so the page rounds the minute.
export const serverMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** The layout already proved the project exists, so NOT_FOUND here means it has no tracker row. */
export async function trackerPayload(
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

export function NoViewNotice({ projectId }: { projectId: string }) {
  return (
    <Notice role="status" title="You cannot see Main of this project yet.">
      The project lead decides who sees Main. The{' '}
      <Link href={`/projects/${projectId}/members`}>Members page</Link> names the project lead.
    </Notice>
  );
}
