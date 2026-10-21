import { AccountMenu, type Account } from './AccountMenu';

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
