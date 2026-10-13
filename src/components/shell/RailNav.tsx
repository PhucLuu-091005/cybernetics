'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type RailProject = { id: string; clientName: string };
const SECTIONS = [['graph', 'Graph'], ['inbox', 'Inbox'], ['proposals', 'Proposals'], ['history', 'History'], ['escalations', 'Escalations'], ['settings/tokens', 'Agent tokens']] as const;

export function RailNav({ projects }: { projects: RailProject[] }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Project">
      {projects.map(project => (
        <div key={project.id} className="contents">
          <span className="group">{project.clientName}</span>
          {SECTIONS.map(([path, label]) => {
            const href = `/projects/${project.id}/${path}`;
            return <Link key={path} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined}>{label}</Link>;
          })}
        </div>
      ))}
    </nav>
  );
}
