import Link from 'next/link';

export function Pager({ basePath, nextCursor, paged, noun }: { basePath: string; nextCursor: string | null; paged: boolean; noun: string }) {
  if (!nextCursor && !paged) return null;
  return (
    <nav className="row" aria-label={`${noun} pages`} style={{ fontSize: 13, padding: '6px 10px' }}>
      {paged && <Link className="lnk" href={basePath}>Newest {noun}</Link>}
      {nextCursor && <Link className="lnk" href={`${basePath}?cursor=${encodeURIComponent(nextCursor)}`}>Older {noun}</Link>}
    </nav>
  );
}
