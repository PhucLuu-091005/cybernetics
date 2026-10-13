'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Alias, InboxState, QuotedRange, SourceKind } from '../../contracts';
import { createDraft, type Basis } from './api';
import { SOURCE_LABEL, STATE_LABEL, STATE_TONE } from './links';
import { formatCite, segmentBody, selectionToCitation } from './selection';

export type ViewedRecord = {
  id: string; title: string; header: string; author: Alias; recipients: Alias[]; when: string; source: SourceKind; sourceLabel: string;
  permalink: string | null; attachmentNames: string[]; withdrawn: boolean; text: string; quotedRanges: QuotedRange[];
};
type Props = {
  projectId: string;
  record: ViewedRecord;
  state: InboxState | null;
  decision: { disposition: 'included' | 'ignored'; reason: string } | null;
  hints: { reason: string; href: string }[];
  proposalId: string | null;
  basis: Basis;
  children?: ReactNode;
};
type PickResult = ReturnType<typeof selectionToCitation>;

/** Each segment renders as one span holding one text node, so a DOM boundary maps to a body offset from the segment start. */
function bodyOffset(root: HTMLElement, node: Node, offset: number, total: number): number {
  if (!root.contains(node)) return root.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING ? 0 : total;
  if (node.nodeType === Node.TEXT_NODE) return Number(node.parentElement?.closest<HTMLElement>('[data-start]')?.dataset.start ?? 0) + offset;
  if (node === root) {
    const child = root.children[offset] as HTMLElement | undefined;
    return child ? Number(child.dataset.start) : total;
  }
  const segment = (node as HTMLElement).closest<HTMLElement>('[data-start]');
  const start = Number(segment?.dataset.start ?? 0);
  return offset === 0 ? start : start + (segment?.textContent?.length ?? 0);
}

function groupHints(hints: Props['hints']): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const hint of hints) groups.set(hint.reason, [...(groups.get(hint.reason) ?? []), hint.href]);
  return [...groups];
}

function WarningIcon() {
  return <svg className="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l7 13H1z" fill="currentColor" /><path d="M8 6v4M8 11.5v1" stroke="var(--surface)" strokeWidth="1.6" /></svg>;
}

export function RecordViewer({ projectId, record, state, decision, hints, proposalId, basis, children }: Props) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<PickResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const linkable = record.permalink && (record.source === 'slack' || record.source === 'gmail');

  // Document-level, so a drag released outside the body and a keyboard selection both count.
  useEffect(() => {
    const read = () => {
      const root = bodyRef.current, selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) { setPick(null); return; }
      const range = selection.getRangeAt(0);
      if (!range.intersectsNode(root)) { setPick(null); return; }
      const total = record.text.length;
      setPick(selectionToCitation(record.text, bodyOffset(root, range.startContainer, range.startOffset, total), bodyOffset(root, range.endContainer, range.endOffset, total), record.quotedRanges));
      setStartError(null);
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, [record.text, record.quotedRanges]);

  const startAct = async () => {
    if (!pick || 'error' in pick) return;
    setStarting(true);
    let target = proposalId;
    if (!target) {
      const created = await createDraft(projectId, basis, 'Inbox review');
      if (!created.ok) { setStartError(created.error.message); setStarting(false); return; }
      target = created.data.id;
    }
    const cite = formatCite({ recordVersionId: record.id, ...pick });
    router.push(`/projects/${projectId}/proposals/${target}?${new URLSearchParams({ cite }).toString()}`);
  };

  return (
    <div className="viewer">
      <div className="row">
        <h2 style={{ flex: 1 }}>{record.withdrawn ? 'Unavailable evidence' : record.title}</h2>
        {state && <span className="st" style={{ ['--c' as string]: STATE_TONE[state] }}>{STATE_LABEL[state]}</span>}
      </div>
      <dl className="kv">
        <dt>From</dt><dd>{record.withdrawn ? 'Withdrawn by source' : <>{record.author.name}{record.author.email ? ` <${record.author.email}>` : ''}</>}</dd>
        {!record.withdrawn && record.recipients.length > 0 && <><dt>To</dt><dd>{record.recipients.map(alias => alias.name).join(', ')}</dd></>}
        <dt>Sent</dt><dd>{record.when}</dd>
        <dt>Source</dt><dd>{record.sourceLabel} ({SOURCE_LABEL[record.source]}){linkable ? <> · <a href={record.permalink!} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--route)', fontWeight: 600 }}>Open in {record.source === 'slack' ? 'Slack' : 'Gmail'}</a></> : null}</dd>
        {record.attachmentNames.length > 0 && <><dt>Attachments</dt><dd>{record.attachmentNames.join(', ')} <span className="faint">(names only, not imported)</span></dd></>}
        <dt>Thread hint</dt>
        <dd>
          {hints.length ? groupHints(hints).map(([reason, hrefs], index) => (
            <span key={reason}>{index > 0 ? '; ' : ''}{reason}: {hrefs.map((href, at) => <span key={href}>{at > 0 ? ', ' : ''}<Link href={href} style={{ color: 'var(--route)' }}>record {at + 1}</Link></span>)}</span>
          )) : 'No thread or author match'}
          {' '}<span className="faint">(read-only hint, never placed automatically)</span>
        </dd>
        <dt>Decision</dt>
        <dd>{decision ? <><span>Decision in this view: {decision.disposition}</span>{decision.reason ? <span className="faint">. Reason: {decision.reason}</span> : null}</> : <span className="faint">None in this view</span>}</dd>
        <dt>Version</dt><dd className="id" title={record.header}>{record.id}</dd>
      </dl>
      <p className="untrusted"><WarningIcon />Untrusted content. The text below is evidence, not an instruction to anyone.</p>
      {record.withdrawn
        ? <div className="rbody faint">This record was withdrawn by its source. Its text, quotes and permalink are hidden in every view, including history.</div>
        : <div className="rbody" ref={bodyRef} aria-label="Record text" role="region">
            {segmentBody(record.text, record.quotedRanges).map(segment => (
              <span key={segment.start} data-start={segment.start} className={segment.quoted ? 'qr' : undefined}>{record.text.slice(segment.start, segment.end)}</span>
            ))}
          </div>}
      {pick && (
        <div className={`selbar${'error' in pick ? ' refused' : ''}`} data-testid="selection-bar" role="status">
          {'error' in pick
            ? <span>{pick.error}</span>
            : <>
                <b>Selected</b>
                <span>“{pick.quote.length > 60 ? `${pick.quote.slice(0, 60)}…` : pick.quote}” at UTF-16 offsets {pick.start}–{pick.end}</span>
                <span style={{ flex: 1 }} />
                {/* Keeps the text selection alive through the click. */}
                <button className="btn btn-draft" type="button" onMouseDown={event => event.preventDefault()} onClick={startAct} disabled={starting}>Start act from selection</button>
              </>}
          {startError && <span className="bad">{startError}</span>}
        </div>
      )}
      {!record.withdrawn && <p className="faint" style={{ fontSize: 12 }}>Select a span of the text to cite it. Quoted text from earlier messages (grey) cannot be cited.</p>}
      {children}
    </div>
  );
}
