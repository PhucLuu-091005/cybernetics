import { redirect } from 'next/navigation';
import { getApp } from '../../server/app';
import { listProjects } from '../../server/domain/projects';
import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const actor = await requireActor('/');
  const [first] = await listProjects(getApp().db, actor);
  if (first) redirect(`/projects/${first.id}/graph`);
  return (
    <section className="screen">
      <h1>No projects yet</h1>
      <p className="muted" style={{ marginTop: 8 }}>Your workspace has no projects. A first sign-in creates the Larkspur sandbox; ask a workspace owner to add you to a project.</p>
    </section>
  );
}
