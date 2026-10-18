import { redirect } from 'next/navigation';
import { Notice } from '../../components/shell/Notice';
import { getApp } from '../../server/app';
import { listProjects } from '../../server/domain/projects';
import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const actor = await requireActor('/');
  const [first] = await listProjects(getApp().db, actor);
  if (first) redirect(`/projects/${first.id}/graph`);
  return (
    <Notice page title="No projects yet">
      You have no projects. A first sign-in creates the Larkspur sandbox; ask the owner of a project
      to invite your email.
    </Notice>
  );
}
