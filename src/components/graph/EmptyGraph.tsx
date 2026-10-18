import Link from 'next/link';

export function EmptyGraph({ projectId }: { projectId: string }) {
  const base = `/projects/${projectId}`;
  return (
    <div className="graph-empty">
      <h2>This project has no work yet.</h2>
      <p>
        Add records in <Link href={`${base}/review`}>Review</Link>, or connect an agent in{' '}
        <Link href={`${base}/settings/tokens`}>Settings</Link>.
      </p>
    </div>
  );
}
