import { AccountMenu, type Account } from './AccountMenu';

/** The top bar of a project page that is not the graph: the page name, the project, and the account menu. */
export function PageHead({
  title,
  project,
  account,
}: {
  title: string;
  project: { title: string; clientName: string };
  account: Account;
}) {
  return (
    <header className="p-head pg-head">
      <h1>{title}</h1>
      <span className="pg-proj">
        {project.clientName} · {project.title}
      </span>
      <span className="sp" />
      <AccountMenu {...account} />
    </header>
  );
}
