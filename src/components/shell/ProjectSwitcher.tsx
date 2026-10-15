import Link from 'next/link';
import { RailIcon } from './icons';

export type RailProject = { id: string; clientName: string; title: string };

export function ProjectSwitcher({
  current,
  projects,
}: {
  current: RailProject;
  projects: RailProject[];
}) {
  return (
    <details className="proj-switch">
      <summary
        aria-label={`Project: ${current.clientName}. Switch project`}
        title={current.clientName}
      >
        <span className="proj-avatar" aria-hidden="true">
          {current.clientName.slice(0, 1).toUpperCase()}
        </span>
        <span className="rail-label proj-names">
          <b>{current.clientName}</b>
          <small>{current.title}</small>
        </span>
        <span className="rail-label proj-caret">
          <RailIcon name="chevron" />
        </span>
      </summary>
      <ul className="proj-menu" aria-label="Projects">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}/graph`}
              aria-current={project.id === current.id ? 'true' : undefined}
            >
              <b>{project.clientName}</b>
              <small>{project.title}</small>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
