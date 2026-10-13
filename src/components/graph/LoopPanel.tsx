'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { DerivedLoop } from '../../contracts/engine';
import type { LoopAct } from '../../contracts/mcp';
import type { Milestone } from '../../contracts/graph';
import { Glyph } from './Glyph';
import { ACT_LABEL, BREAKDOWN_LABEL, STATE_COLOR, TONE_COLOR, dueLabel, partyDetail, partyName, shortStamp, stateLabel, type Directory } from './labels';

type Props = {
  projectId: string;
  loop: DerivedLoop;
  directory: Directory;
  milestones: readonly Milestone[];
  timeZone: string;
  T: string;
  currentActIndex: number;
  pendingEvidenceCount: number;
  onClose(): void;
};
const EDIT_HINT = 'Create a proposal to edit';
type Evidence = Pick<LoopAct, 'context' | 'permalink' | 'source' | 'sourceLabel'>;

/** The graph view carries quotes only; the loop read adds surrounding text and permalinks for the open loop. */
function useEvidence(projectId: string, loopId: string, T: string): ReadonlyMap<string, Evidence> | null {
  const [evidence, setEvidence] = useState<{ key: string; acts: ReadonlyMap<string, Evidence> } | null>(null);
  const key = `${loopId}@${T}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/projects/${projectId}/loops/${loopId}?${new URLSearchParams({ T })}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(response => response.ok ? response.json() as Promise<{ loop: { acts: LoopAct[] } }> : null)
      .then(result => { if (result) setEvidence({ key, acts: new Map(result.loop.acts.map(act => [act.id, act])) }); })
      .catch(() => { /* the panel keeps the bare quote when the loop read fails */ });
    return () => controller.abort();
  }, [projectId, loopId, T, key]);
  return evidence?.key === key ? evidence.acts : null;
}
function sourceName(evidence: Evidence): string | null {
  if (evidence.source === 'slack' || evidence.sourceLabel.startsWith('#')) return 'Slack';
  if (evidence.source === 'gmail' || evidence.sourceLabel.startsWith('gmail:')) return 'Gmail';
  return null;
}

function loopTone(loop: DerivedLoop): string {
  if (loop.breakdowns.some(item => item.severity === 'broken')) return TONE_COLOR.red;
  if (loop.breakdowns.length || loop.dueSoon) return TONE_COLOR.amber;
  return loop.state === 'closed' ? TONE_COLOR.green : loop.state === 'declined' || loop.state === 'cancelled' ? TONE_COLOR.gray : TONE_COLOR.blue;
}

export function LoopPanel({ projectId, loop, directory, milestones, timeZone, T, currentActIndex, pendingEvidenceCount, onClose }: Props) {
  const evidence = useEvidence(projectId, loop.loop.id, T);
  const body = useRef<HTMLDivElement>(null), current = useRef<HTMLLIElement>(null);
  // Scrolls the panel body only; scrollIntoView would also scroll the page.
  useEffect(() => {
    const box = body.current?.getBoundingClientRect(), item = current.current?.getBoundingClientRect();
    if (!box || !item || !body.current) return;
    if (item.top < box.top) body.current.scrollTop += item.top - box.top - 8;
    else if (item.bottom > box.bottom) body.current.scrollTop += item.bottom - box.bottom + 8;
  }, [currentActIndex]);
  const tone = loopTone(loop);
  const milestone = milestones.find(item => item.id === loop.loop.milestoneId);
  const changed = loop.due !== null && JSON.stringify(loop.due) !== JSON.stringify(loop.originalDue);
  return (
    <aside className="drawer" role="complementary" aria-label="Loop panel">
      <div className="drawer-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginBottom: 6 }}>{loop.loop.title}</h2>
          <div className="row">
            <span className="st" style={{ '--c': loop.state ? STATE_COLOR[loop.state] : 'var(--isolated)' } as React.CSSProperties}>{stateLabel(loop.state)}</span>
            {loop.breakdowns.map(item => <span key={item.type} className={`bd ${item.severity}`} title={item.sentence}>{item.severity === 'broken' ? '✕' : '!'} {BREAKDOWN_LABEL[item.type]}</span>)}
            {loop.dueSoon && <span className="bd warning">! Due soon</span>}
          </div>
        </div>
        <button className="btn btn-quiet" type="button" onClick={onClose} aria-label="Close loop panel">✕</button>
      </div>
      <div className="drawer-b" ref={body}>
        {loop.breakdowns.length > 0 && (
          <div className="bdlist">
            {loop.breakdowns.map(item => (
              <div key={item.type} className={`bdrow ${item.severity}`}>
                <b style={{ fontSize: 12 }}>{item.severity === 'broken' ? '✕ Broken' : '! Warning'}: {BREAKDOWN_LABEL[item.type]}</b>
                <p>{item.sentence}</p>
              </div>
            ))}
          </div>
        )}
        <div className="parties">
          <div className="party"><small>Customer</small><b>{partyName(loop.loop.customer, directory)}</b><br /><span className="faint">{partyDetail(loop.loop.customer, directory)}</span></div>
          <div className="party"><small>Performer</small><b>{partyName(loop.loop.performer, directory)}</b><br /><span className="faint">{partyDetail(loop.loop.performer, directory)}</span></div>
        </div>
        <dl className="kv">
          <dt>Original due</dt><dd>{dueLabel(loop.originalDue)}</dd>
          <dt>Current due</dt><dd>{dueLabel(loop.due)}{changed && <span className="faint"> (changed)</span>}</dd>
          <dt>Milestone</dt>
          <dd>
            <select disabled aria-label="Milestone" value={milestone?.id ?? ''}><option value={milestone?.id ?? ''}>{milestone?.name ?? 'None'}</option></select>
            {' '}<span className="faint" style={{ fontSize: 12 }}>Main is read-only. Create a proposal to change it.</span>
          </dd>
        </dl>
        <div>
          <h3 style={{ marginBottom: 8 }}>Steps</h3>
          {loop.acts.length === 0 ? <p className="faint" style={{ fontSize: 13 }}>No acts yet at the evaluation time.</p> : (
            <ol className="steps" aria-label="Steps">
              {loop.acts.map((act, index) => {
                const detail = evidence?.get(act.id), name = detail ? sourceName(detail) : null;
                return (
                <li key={act.id} ref={index === currentActIndex ? current : undefined} className="step" aria-current={index === currentActIndex ? 'step' : undefined}>
                  <span className="g"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><Glyph type={act.type} x={11} y={11} color={tone} /></svg></span>
                  <div className="step-h">
                    <b>{ACT_LABEL[act.type]}</b>
                    <span>{partyName(act.actor, directory)}</span>
                    <span className="faint">{shortStamp(act.occurredAt, timeZone)}</span>
                    {act.hedged && <span className="chip" style={{ borderStyle: 'dashed' }}>hedged</span>}
                    {act.due && <span className="chip">due {dueLabel(act.due)}</span>}
                    {act.flags.includes('out_of_order') && <span className="chip">out of order</span>}
                    <details className="menu">
                      <summary aria-label="Act actions">⋯</summary>
                      <ul>
                        <li className="hint">Main is read-only. Edits open a proposal.</li>
                        {['Change type', 'Move to another loop', 'Hide this act'].map(label => <li key={label}><button type="button" disabled title={EDIT_HINT}>{label}</button></li>)}
                      </ul>
                    </details>
                  </div>
                  {act.quote === null
                    ? <div className="q"><span className="badge b-stale">Unavailable evidence</span> <span className="faint" style={{ fontSize: 12 }}>The source withdrew this record. Its text stays hidden in every view.</span></div>
                    : <div className="q quote" data-testid="quote-context">{detail?.context?.before}<mark data-testid="verified-quote">{act.quote}</mark>{detail?.context?.after}</div>}
                  <div className="links">
                    {detail?.permalink?.startsWith('https://') && <a href={detail.permalink} target="_blank" rel="noopener noreferrer">{name ? `Open in ${name}` : 'Open source'}</a>}
                    <Link href={`/projects/${projectId}/records/${act.citation.recordVersionId}`}>View record</Link>
                    {detail && <span className="faint">{detail.sourceLabel}</span>}
                  </div>
                </li>
                );
              })}
            </ol>
          )}
        </div>
        {pendingEvidenceCount > 0 && <Link className="btn" href={`/projects/${projectId}/inbox`} style={{ alignSelf: 'flex-start' }}>Inbox: {pendingEvidenceCount} unreviewed {pendingEvidenceCount === 1 ? 'record' : 'records'}</Link>}
      </div>
    </aside>
  );
}
