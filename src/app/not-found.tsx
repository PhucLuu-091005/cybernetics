import Link from 'next/link';
import { Notice } from '../components/shell/Notice';

export default function NotFound() {
  return (
    <Notice
      page
      title="Page not found"
      actions={
        <Link className="btn btn-ink" href="/">
          Go to your projects
        </Link>
      }
    >
      This page does not exist, or it belongs to a project you cannot open.
    </Notice>
  );
}
