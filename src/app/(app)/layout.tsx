import { BrandMark } from '../../components/shell/BrandMark';
import { RailNav } from '../../components/shell/RailNav';
import { SignOutButton } from '../../components/shell/SignOutButton';
import { ThemeToggle } from '../../components/shell/ThemeToggle';
import { getApp } from '../../server/app';
import { listProjects } from '../../server/domain/projects';
import { requireActor } from '../../server/http/rsc';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const actor = await requireActor('/');
  const projects = await listProjects(getApp().db, actor);
  return (
    <div className="app">
      <div className="rail">
        <div className="brand">
          <BrandMark />
          <b>Promise Graph</b>
        </div>
        <RailNav
          projects={projects.map((project) => ({ id: project.id, clientName: project.clientName }))}
        />
        <div className="rail-foot">
          <ThemeToggle />
          <SignOutButton />
          <span className="faint">
            The app never calls an AI model. Nothing changes the graph until a person merges it.
          </span>
        </div>
      </div>
      <div className="main">{children}</div>
    </div>
  );
}
