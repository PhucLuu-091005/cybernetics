import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { IdSchema, type ActorContext } from '../../../../../contracts';
import { MembersScreen } from '../../../../../components/members/MembersScreen';
import { getApp } from '../../../../../server/app';
import { projectAccount } from '../../../../../server/domain/account';
import { getProject } from '../../../../../server/domain/projects';
import { AppError } from '../../../../../server/errors';
import { notFoundOn, requireActor } from '../../../../../server/http/rsc';
import { listProjectMembers, type MembersPayload } from '../../../../../server/tracker';
import { Notice } from '../../../../../components/shell/Notice';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Members · Promise Graph' };

/** The layout already proved the project exists, so NOT_FOUND here means it has no tracker row. */
async function members(
  actor: ActorContext,
  projectId: string,
  actAs: string | undefined,
): Promise<MembersPayload | null> {
  try {
    return await listProjectMembers(getApp().db, actor, {
      projectId,
      ...(actAs ? { actAs } : {}),
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'NOT_FOUND') return null;
    // A stale act-as cookie (a removed member, a project that left demo mode) must not lock the page.
    if (actAs && (error.code === 'FORBIDDEN' || error.code === 'VALIDATION'))
      return members(actor, projectId, undefined);
    throw error;
  }
}

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/members`);
  const actAs = (await cookies()).get(`pg_act_${id}`)?.value;
  const db = getApp().db;
  const [{ project }, list, account] = await Promise.all([
    notFoundOn(getProject(db, actor, { projectId: id })),
    members(actor, id, actAs),
    projectAccount(db, actor, id, actAs),
  ]);
  if (!list) return <Notice role="status" title="This project has no tracker yet." />;
  return (
    <MembersScreen
      projectId={id}
      project={{ title: project.title, clientName: project.clientName }}
      account={account}
      initial={list}
    />
  );
}
