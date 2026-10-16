import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import '../../../shell.css';
import { IdSchema } from '../../../../contracts';
import { Rail } from '../../../../components/shell/Rail';
import { parseRailState, RAIL_COOKIE } from '../../../../components/shell/rail-state';
import { getApp } from '../../../../server/app';
import { listProjects } from '../../../../server/domain/projects';
import { requireActor } from '../../../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function ProjectLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ id: string }> }>) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) notFound();
  const actor = await requireActor(`/projects/${id}/graph`);
  const db = getApp().db;
  const [projects, store] = await Promise.all([listProjects(db, actor), cookies()]);
  if (!projects.some((project) => project.id === id)) notFound();
  return (
    <div className="app">
      <Rail
        projectId={id}
        projects={projects.map(({ id, clientName, title }) => ({ id, clientName, title }))}
        initial={parseRailState(store.get(RAIL_COOKIE)?.value)}
      />
      <div className="main">{children}</div>
    </div>
  );
}
