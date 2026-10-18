import { redirect } from 'next/navigation';
import { BrandMark } from '../../components/shell/BrandMark';
import { getApp } from '../../server/app';
import { listProjects } from '../../server/domain/projects';
import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const actor = await requireActor('/');
  const [first] = await listProjects(getApp().db, actor);
  if (first) redirect(`/projects/${first.id}/graph`);
  return (
    <main className="signin" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 560 }}>
      <section className="card pad stack">
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <b>Promise Graph</b>
        </div>
        <h1>No projects yet</h1>
        <p className="muted">
          You have no projects. A first sign-in creates the Larkspur sandbox; ask the owner of a
          project to invite your email.
        </p>
      </section>
    </main>
  );
}
