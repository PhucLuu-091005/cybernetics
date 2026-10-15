'use client';
import { useMemo, useState } from 'react';
import { foldForSearch } from '../../lib/search';

export type IndexEntry = {
  id: string;
  title: string;
  department: string;
  color: string;
  /** The promise this task belongs to, when that promise is in the list too. */
  parentId: string | null;
};

const FocusIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
  </svg>
);

/**
 * Every loop the filters let through. A title jumps the canvas to its loop; the focus button shows only
 * the chosen loops (a promise keeps its tasks) until "Show all". The search narrows this list only.
 */
export function LoopIndex({
  entries,
  only,
  activeId,
  onJump,
  onToggleOnly,
  onShowAll,
  onClose,
}: {
  entries: readonly IndexEntry[];
  only: ReadonlySet<string>;
  activeId: string | null;
  onJump(loopId: string): void;
  onToggleOnly(loopId: string): void;
  onShowAll(): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  // A matching task keeps its promise above it, dimmed, so the list still reads as the graph does.
  const rows = useMemo(() => {
    const wanted = foldForSearch(query.trim());
    if (!wanted) return entries.map((entry) => ({ entry, context: false }));
    const matches = new Set(
      entries
        .filter((entry) =>
          [entry.title, entry.department].some((text) => foldForSearch(text).includes(wanted)),
        )
        .map((entry) => entry.id),
    );
    const parents = new Set(
      entries.flatMap((entry) =>
        matches.has(entry.id) && entry.parentId !== null && !matches.has(entry.parentId)
          ? [entry.parentId]
          : [],
      ),
    );
    return entries.flatMap((entry) =>
      matches.has(entry.id) || parents.has(entry.id)
        ? [{ entry, context: !matches.has(entry.id) }]
        : [],
    );
  }, [entries, query]);
  const matched = rows.filter((row) => !row.context).length;
  return (
    <aside className="loop-index" aria-label="Loop list">
      <header>
        <b>Loops</b>
        <span className="faint" aria-live="polite">
          {query.trim() ? `${matched} of ${entries.length}` : entries.length}
        </span>
        {only.size > 0 && (
          <button type="button" className="link" onClick={onShowAll}>
            Show all
          </button>
        )}
        <button
          type="button"
          className="close"
          aria-label="Close loop list"
          title="Close loop list"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className="loop-index-search">
        <input
          type="search"
          value={query}
          placeholder="Search loops"
          aria-label="Search loops"
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              setQuery('');
            }
          }}
        />
      </div>
      {rows.length === 0 && <p className="loop-index-empty">No loop matches “{query.trim()}”.</p>}
      <ul>
        {rows.map(({ entry, context }) => {
          const hidden =
            only.size > 0 &&
            !only.has(entry.id) &&
            !(entry.parentId !== null && only.has(entry.parentId));
          return (
            <li
              key={entry.id}
              className={`${entry.parentId !== null ? 'task' : ''}${hidden ? ' hidden' : ''}${context ? ' context' : ''}`}
              aria-current={activeId === entry.id ? 'true' : undefined}
            >
              <span className="dot" style={{ background: entry.color }} aria-hidden="true" />
              <button
                type="button"
                className="title"
                title={entry.title}
                onClick={() => onJump(entry.id)}
              >
                <span>{entry.title}</span>
                <small>{entry.department}</small>
              </button>
              <button
                type="button"
                className="only"
                aria-pressed={only.has(entry.id)}
                aria-label={`Show only ${entry.title}`}
                title="Show only this loop on the graph"
                onClick={() => onToggleOnly(entry.id)}
              >
                <FocusIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
