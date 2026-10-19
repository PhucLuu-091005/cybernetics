import { AccountMenu, type Account } from './AccountMenu';

export function PageHead({
  title,
  project,
  account,
}: {
  title: string;
  project?: { title: string };
  account: Account;
}) {
  return (
    <header className="p-head pg-head">
      <h1>{title}</h1>
      {project && (
        <span className="pg-proj" title={project.title}>
          {project.title}
        </span>
      )}
      <span className="sp" />
      <AccountMenu {...account} />
    </header>
  );
}
