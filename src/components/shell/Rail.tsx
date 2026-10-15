'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useHydrated } from '../review/hydrated';
import { RailIcon, type RailIconName } from './icons';
import { ProjectSwitcher, type RailProject } from './ProjectSwitcher';
import { railCookie, type RailState } from './rail-state';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';

type Props = { projectId: string; projects: RailProject[]; waiting: number; initial: RailState };

export function Rail({ projectId, projects, waiting, initial }: Props) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [state, setState] = useState<RailState>(initial);
  const folded = state === 'collapsed';
  const current = projects.find((project) => project.id === projectId)!;
  const base = `/projects/${projectId}`;
  const toggle = () => {
    const next: RailState = folded ? 'open' : 'collapsed';
    setState(next);
    document.cookie = railCookie(next);
  };
  const item = (path: string, icon: RailIconName, label: string, count = 0) => {
    const href = `${base}/${path}`;
    const active = pathname === href || pathname.startsWith(`${href}/`);
    const name = count > 0 ? `${label}, ${count} waiting` : label;
    return (
      <Link
        className="rail-item"
        href={href}
        aria-current={active ? 'page' : undefined}
        aria-label={name}
        data-label={name}
        data-dot={count > 0 ? '' : undefined}
      >
        <RailIcon name={icon} />
        <span className="rail-label">{label}</span>
        {count > 0 && <span className="rail-count rail-label">{count}</span>}
      </Link>
    );
  };
  return (
    <div className="rail" data-state={state}>
      <ProjectSwitcher current={current} projects={projects} />
      <nav className="rail-nav" aria-label="Project">
        {item('graph', 'graph', 'Graph')}
        {item('review', 'review', 'Review', waiting)}
      </nav>
      <div className="rail-foot">
        <p className="rail-note rail-label">
          Nothing changes the graph until a person approves it.
        </p>
        {item('settings/tokens', 'settings', 'Settings')}
        <ThemeToggle />
        <SignOutButton />
        <button
          className="rail-item rail-fold"
          type="button"
          disabled={!hydrated}
          onClick={toggle}
          aria-expanded={!folded}
          aria-label={folded ? 'Expand sidebar' : 'Collapse sidebar'}
          data-label={folded ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <RailIcon name="panel" />
          <span className="rail-label">Collapse sidebar</span>
        </button>
      </div>
    </div>
  );
}
