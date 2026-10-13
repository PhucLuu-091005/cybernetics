import Link from 'next/link';
import { BrandMark } from '../components/shell/BrandMark';

export default function NotFound() {
  return (
    <main className="signin" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 560 }}>
      <div className="card pad stack">
        <div className="brand" style={{ padding: 0 }}><BrandMark /><b>Promise Graph</b></div>
        <h1>Page not found</h1>
        <p className="muted">This page does not exist, or it belongs to a project you cannot open.</p>
        <Link className="btn btn-ink" href="/" style={{ alignSelf: 'flex-start' }}>Go to your projects</Link>
      </div>
    </main>
  );
}
