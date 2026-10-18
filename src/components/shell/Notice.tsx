import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';

/**
 * The one look of a page that only says something: Page not found, an error, no projects, no access.
 * Plain text on the page, no card; `page` centres it on the whole screen, else it sits in the frame.
 */
export function Notice({
  title,
  children,
  actions,
  page = false,
  role,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  page?: boolean;
  role?: 'alert' | 'status';
}) {
  return (
    <main className={`notice${page ? ' notice-page' : ''}`}>
      <div className="notice-in" role={role}>
        {page && (
          <div className="notice-brand">
            <BrandMark size={22} />
            <b>Promise Graph</b>
          </div>
        )}
        <h1>{title}</h1>
        {children && <div className="notice-text">{children}</div>}
        {actions && <div className="notice-acts">{actions}</div>}
      </div>
    </main>
  );
}
