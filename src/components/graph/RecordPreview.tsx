'use client';
import { useEffect, useState } from 'react';
import type { RecordChunk } from '../../contracts/records';
import { SOURCE_APP_NAME, linkablePermalink, sourceApp } from '../../lib/source-app';

type Loaded = {
  title: string;
  header: string;
  text: string;
  sourceLabel: string;
  link: { href: string; app: string } | null;
  withdrawn: boolean;
};
// A record body is at most 64 KiB, so nine chunks of 8,000 code units always reach the end.
const MAX_CHUNKS = 9;

async function loadRecord(projectId: string, versionId: string, signal: AbortSignal) {
  let cursor: string | null = null,
    text = '',
    first: RecordChunk | null = null;
  for (let page = 0; page < MAX_CHUNKS; page++) {
    const query: string = cursor ? `?${new URLSearchParams({ cursor })}` : '';
    const response = await fetch(
      `/api/v1/projects/${projectId}/record-versions/${versionId}${query}`,
      { signal, headers: { Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(String(response.status));
    const chunk = (await response.json()) as RecordChunk;
    first ??= chunk;
    text += chunk.text;
    cursor = chunk.nextCursor;
    if (!cursor) break;
  }
  const { metadata } = first!;
  const href = linkablePermalink(metadata.source, metadata.permalink);
  return {
    title: metadata.title,
    header: first!.header,
    text,
    sourceLabel: metadata.sourceLabel,
    link: href
      ? { href, app: SOURCE_APP_NAME[sourceApp(metadata.source, metadata.permalink)] }
      : null,
    withdrawn: first!.withdrawn,
  } satisfies Loaded;
}

/**
 * The cited record inside the graph stage, so reading it never leaves the page or full screen.
 * The quote is marked where it first appears in the text.
 */
export function RecordPreview({
  projectId,
  versionId,
  quote,
  onClose,
}: {
  projectId: string;
  versionId: string;
  quote: string | null;
  onClose(): void;
}) {
  const [record, setRecord] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    loadRecord(projectId, versionId, controller.signal)
      .then(setRecord)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [projectId, versionId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const at = record && quote ? record.text.indexOf(quote) : -1;
  return (
    <div className="record-preview-backdrop" onClick={onClose}>
      <section
        className="record-preview"
        role="dialog"
        aria-modal="true"
        aria-label="Record"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{record?.title ?? 'Record'}</h2>
          <button
            type="button"
            className="btn btn-quiet"
            aria-label="Close record"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {failed && <p className="bad">The record could not load. Try again in a minute.</p>}
        {!record && !failed && <p className="faint">Loading the record…</p>}
        {record && (
          <>
            <pre className="record-header">{record.header}</pre>
            {record.withdrawn ? (
              <p className="faint">This record was withdrawn; its text is no longer shown.</p>
            ) : (
              <div className="record-text">
                {at < 0 ? (
                  record.text
                ) : (
                  <>
                    {record.text.slice(0, at)}
                    <mark>{quote}</mark>
                    {record.text.slice(at + quote!.length)}
                  </>
                )}
              </div>
            )}
            <footer>
              <span className="faint">{record.sourceLabel}</span>
              {record.link && (
                <a href={record.link.href} target="_blank" rel="noopener noreferrer">
                  Open in {record.link.app} ↗
                </a>
              )}
              <a href={`/projects/${projectId}/records/${versionId}`}>Open the full record page</a>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
