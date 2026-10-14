'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ActTypeSchema,
  type ActType,
  type DerivedAct,
  type DerivedLoop,
  type GraphOperation,
  type GraphSnapshot,
  type LoopAct,
  type Milestone,
  type ViewSelection,
} from '../../contracts';
import { ConflictBanner } from '../review/ConflictBanner';
import { useDraftEdit, type EditTarget } from '../review/draft-edit';
import { changeActType, hideAct, moveAct, setLoopMilestone, toAct } from '../review/operations';
import { Glyph } from './Glyph';
import {
  ACT_LABEL,
  BREAKDOWN_LABEL,
  STATE_COLOR,
  TONE_COLOR,
  dueLabel,
  partyDetail,
  partyName,
  shortStamp,
  stateLabel,
  type Directory,
} from './labels';

type Props = {
  projectId: string;
  loop: DerivedLoop;
  directory: Directory;
  milestones: readonly Milestone[];
  timeZone: string;
  T: string;
  currentActIndex: number;
  pendingEvidenceCount: number;
  view: ViewSelection;
  edit: EditTarget;
  loops: readonly { id: string; title: string }[];
  snapshot: Pick<GraphSnapshot, 'acts' | 'recordDecisions'>;
  /** Acts added or changed by an agent-authored proposal; only a proposal view can derive this. */
  agentActIds: ReadonlySet<string>;
  onClose(): void;
};
type Evidence = Pick<LoopAct, 'context' | 'permalink' | 'source' | 'sourceLabel'>;
type StepEdit = { actId: string; action: 'type' | 'move' | 'hide' };
const viewQuery = (view: ViewSelection): Record<string, string> =>
  view.kind === 'proposal'
    ? { proposalId: view.proposalId, proposalRevision: String(view.proposalRevision) }
    : view.kind === 'commit'
      ? { commitId: view.commitId }
      : {};

/** The graph view carries quotes only; the loop read adds surrounding text and permalinks for the open loop. */
function useEvidence(
  projectId: string,
  loopId: string,
  T: string,
  view: ViewSelection,
): ReadonlyMap<string, Evidence> | null {
  const [evidence, setEvidence] = useState<{
    key: string;
    acts: ReadonlyMap<string, Evidence>;
  } | null>(null);
  const query = new URLSearchParams({ T, ...viewQuery(view) }).toString();
  const key = `${loopId}@${query}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/projects/${projectId}/loops/${loopId}?${query}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ loop: { acts: LoopAct[] } }>) : null,
      )
      .then((result) => {
        if (result)
          setEvidence({ key, acts: new Map(result.loop.acts.map((act) => [act.id, act])) });
      })
      .catch(() => {
        /* the panel keeps the bare quote when the loop read fails */
      });
    return () => controller.abort();
  }, [projectId, loopId, query, key]);
  return evidence?.key === key ? evidence.acts : null;
}
function sourceName(evidence: Evidence): string | null {
  if (evidence.source === 'slack' || evidence.sourceLabel.startsWith('#')) return 'Slack';
  if (evidence.source === 'gmail' || evidence.sourceLabel.startsWith('gmail:')) return 'Gmail';
  return null;
}

function loopTone(loop: DerivedLoop): string {
  if (loop.breakdowns.some((item) => item.severity === 'broken')) return TONE_COLOR.red;
  if (loop.breakdowns.length || loop.dueSoon) return TONE_COLOR.amber;
  return loop.state === 'closed'
    ? TONE_COLOR.green
    : loop.state === 'declined' || loop.state === 'cancelled'
      ? TONE_COLOR.gray
      : TONE_COLOR.blue;
}

function StepEditor({
  edit,
  act,
  loops,
  currentLoopId,
  busy,
  onApply,
  onCancel,
}: {
  edit: StepEdit;
  act: DerivedAct;
  loops: Props['loops'];
  currentLoopId: string;
  busy: boolean;
  onApply(action: StepEdit['action'], value: string): void;
  onCancel(): void;
}) {
  const [type, setType] = useState<ActType>(act.type);
  const [target, setTarget] = useState(loops.find((item) => item.id !== currentLoopId)?.id ?? '');
  const value = edit.action === 'type' ? type : edit.action === 'move' ? target : '';
  return (
    <div className="stepedit">
      {edit.action === 'type' && (
        <select
          aria-label="New act type"
          value={type}
          onChange={(event) => setType(ActTypeSchema.parse(event.target.value))}
        >
          {ActTypeSchema.options.map((option) => (
            <option key={option} value={option}>
              {ACT_LABEL[option]}
            </option>
          ))}
        </select>
      )}
      {edit.action === 'move' && (
        <select
          aria-label="Target loop"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {loops
            .filter((item) => item.id !== currentLoopId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          <option value="">No loop</option>
        </select>
      )}
      {edit.action === 'hide' && (
        <span className="faint" style={{ fontSize: 12 }}>
          The act leaves the graph. If no other visible act cites its record, the record returns to
          pending review.
        </span>
      )}
      <button
        className="btn btn-draft"
        type="button"
        disabled={busy || (edit.action === 'type' && type === act.type)}
        onClick={() => onApply(edit.action, value)}
      >
        Apply to draft
      </button>
      <button className="btn btn-quiet" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function LoopPanel({
  projectId,
  loop,
  directory,
  milestones,
  timeZone,
  T,
  currentActIndex,
  pendingEvidenceCount,
  view,
  edit: target,
  loops,
  snapshot,
  agentActIds,
  onClose,
}: Props) {
  const evidence = useEvidence(projectId, loop.loop.id, T, view);
  const edit = useDraftEdit(projectId, target);
  const [stepEdit, setStepEdit] = useState<StepEdit | null>(null);
  const onMain = target.kind === 'main';
  const title = `Edit ${loop.loop.title}`;
  const applyStep = async (act: DerivedAct, action: StepEdit['action'], value: string) => {
    if (act.quote === null) return;
    const base = toAct(act);
    const operations: GraphOperation[] =
      action === 'type'
        ? changeActType(base, act.quote, ActTypeSchema.parse(value))
        : action === 'move'
          ? moveAct(base, act.quote, value || null)
          : hideAct(base, act.quote, snapshot);
    if (await edit.apply(operations, title)) setStepEdit(null);
  };
  const openStep = (event: MouseEvent<HTMLButtonElement>, next: StepEdit) => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    setStepEdit(next);
  };
  const body = useRef<HTMLDivElement>(null),
    current = useRef<HTMLLIElement>(null);
  // Scrolls the panel body only; scrollIntoView would also scroll the page.
  useEffect(() => {
    const box = body.current?.getBoundingClientRect(),
      item = current.current?.getBoundingClientRect();
    if (!box || !item || !body.current) return;
    if (item.top < box.top) body.current.scrollTop += item.top - box.top - 8;
    else if (item.bottom > box.bottom) body.current.scrollTop += item.bottom - box.bottom + 8;
  }, [currentActIndex]);
  const tone = loopTone(loop);
  const milestone = milestones.find((item) => item.id === loop.loop.milestoneId);
  const changed =
    loop.due !== null && JSON.stringify(loop.due) !== JSON.stringify(loop.originalDue);
  return (
    <aside className="drawer" role="complementary" aria-label="Loop panel">
      <div className="drawer-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ marginBottom: 6 }}>{loop.loop.title}</h2>
          <div className="row">
            <span
              className="st"
              style={
                {
                  '--c': loop.state ? STATE_COLOR[loop.state] : 'var(--isolated)',
                } as React.CSSProperties
              }
            >
              {stateLabel(loop.state)}
            </span>
            {loop.breakdowns.map((item) => (
              <span key={item.type} className={`bd ${item.severity}`} title={item.sentence}>
                {item.severity === 'broken' ? '✕' : '!'} {BREAKDOWN_LABEL[item.type]}
              </span>
            ))}
            {loop.dueSoon && <span className="bd warning">! Due soon</span>}
          </div>
        </div>
        <button
          className="btn btn-quiet"
          type="button"
          onClick={onClose}
          aria-label="Close loop panel"
        >
          ✕
        </button>
      </div>
      <div className="drawer-b" ref={body}>
        {loop.breakdowns.length > 0 && (
          <div className="bdlist">
            {loop.breakdowns.map((item) => (
              <div key={item.type} className={`bdrow ${item.severity}`}>
                <b style={{ fontSize: 12 }}>
                  {item.severity === 'broken' ? '✕ Broken' : '! Warning'}:{' '}
                  {BREAKDOWN_LABEL[item.type]}
                </b>
                <p>{item.sentence}</p>
              </div>
            ))}
          </div>
        )}
        <div className="parties">
          <div className="party">
            <small>Customer</small>
            <b>{partyName(loop.loop.customer, directory)}</b>
            <br />
            <span className="faint">{partyDetail(loop.loop.customer, directory)}</span>
          </div>
          <div className="party">
            <small>Performer</small>
            <b>{partyName(loop.loop.performer, directory)}</b>
            <br />
            <span className="faint">{partyDetail(loop.loop.performer, directory)}</span>
          </div>
        </div>
        <dl className="kv">
          <dt>Original due</dt>
          <dd>{dueLabel(loop.originalDue)}</dd>
          <dt>Current due</dt>
          <dd>
            {dueLabel(loop.due)}
            {changed && <span className="faint"> (changed)</span>}
          </dd>
          <dt>Milestone</dt>
          <dd>
            <select
              aria-label="Milestone"
              value={milestone?.id ?? ''}
              disabled={!edit.editable || edit.busy}
              onChange={(event) => {
                void edit.apply(setLoopMilestone(loop.loop, event.target.value || null), title);
              }}
            >
              <option value="">None</option>
              {milestones.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>{' '}
            <span className="faint" style={{ fontSize: 12 }}>
              {!edit.editable
                ? 'This proposal is not a draft, so it cannot change.'
                : onMain
                  ? 'Main is read-only. A change here creates a proposal from main first.'
                  : 'Changes go into this draft.'}
            </span>
          </dd>
        </dl>
        {edit.failure && (
          <ConflictBanner
            title={
              edit.failure.status === 409
                ? 'Conflict: the draft or the evidence changed since this view loaded.'
                : 'The edit was not saved.'
            }
            error={edit.failure}
            message={
              edit.failure.status === 409
                ? 'Nothing changed. Reload to see the current revision, then edit again.'
                : undefined
            }
            actions={
              edit.failure.status === 409 ? (
                <button className="btn" type="button" onClick={edit.reload}>
                  Reload
                </button>
              ) : undefined
            }
          />
        )}
        <div>
          <h3 style={{ marginBottom: 8 }}>Steps</h3>
          {loop.acts.length === 0 ? (
            <p className="faint" style={{ fontSize: 13 }}>
              No acts yet at the evaluation time.
            </p>
          ) : (
            <ol className="steps" aria-label="Steps">
              {loop.acts.map((act, index) => {
                const detail = evidence?.get(act.id),
                  name = detail ? sourceName(detail) : null;
                return (
                  <li
                    key={act.id}
                    ref={index === currentActIndex ? current : undefined}
                    className="step"
                    aria-current={index === currentActIndex ? 'step' : undefined}
                  >
                    <span className="g">
                      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                        <Glyph type={act.type} x={11} y={11} color={tone} />
                      </svg>
                    </span>
                    <div className="step-h">
                      <b>{ACT_LABEL[act.type]}</b>
                      <span>{partyName(act.actor, directory)}</span>
                      <span className="faint">{shortStamp(act.occurredAt, timeZone)}</span>
                      {act.hedged && (
                        <span className="chip" style={{ borderStyle: 'dashed' }}>
                          hedged
                        </span>
                      )}
                      {act.due && <span className="chip">due {dueLabel(act.due)}</span>}
                      {act.flags.includes('out_of_order') && (
                        <span className="chip">out of order</span>
                      )}
                      {agentActIds.has(act.id) && (
                        <span className="badge b-agent">agent proposed</span>
                      )}
                      <details className="menu">
                        <summary aria-label="Act actions">⋯</summary>
                        <ul>
                          <li className="hint">
                            {!edit.editable
                              ? 'This proposal is not a draft.'
                              : act.quote === null
                                ? 'Unavailable evidence: edit this act in a proposal from the inbox.'
                                : onMain
                                  ? 'Main is read-only. An edit creates a proposal first.'
                                  : 'Edits go into this draft.'}
                          </li>
                          {(
                            [
                              ['type', 'Change type'],
                              ['move', 'Move to another loop'],
                              ['hide', 'Hide this act'],
                            ] as const
                          ).map(([action, label]) => (
                            <li key={action}>
                              <button
                                type="button"
                                disabled={!edit.editable || act.quote === null || edit.busy}
                                onClick={(event) => openStep(event, { actId: act.id, action })}
                              >
                                {label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    {stepEdit?.actId === act.id && (
                      <StepEditor
                        edit={stepEdit}
                        act={act}
                        loops={loops}
                        currentLoopId={loop.loop.id}
                        busy={edit.busy}
                        onApply={(action, value) => {
                          void applyStep(act, action, value);
                        }}
                        onCancel={() => setStepEdit(null)}
                      />
                    )}
                    {act.quote === null ? (
                      <div className="q">
                        <span className="badge b-stale">Unavailable evidence</span>{' '}
                        <span className="faint" style={{ fontSize: 12 }}>
                          The source withdrew this record. Its text stays hidden in every view.
                        </span>
                      </div>
                    ) : (
                      <div className="q quote" data-testid="quote-context">
                        {detail?.context?.before}
                        <mark data-testid="verified-quote">{act.quote}</mark>
                        {detail?.context?.after}
                      </div>
                    )}
                    <div className="links">
                      {detail?.permalink?.startsWith('https://') && (
                        <a href={detail.permalink} target="_blank" rel="noopener noreferrer">
                          {name ? `Open in ${name}` : 'Open source'}
                        </a>
                      )}
                      <Link href={`/projects/${projectId}/records/${act.citation.recordVersionId}`}>
                        View record
                      </Link>
                      {detail && <span className="faint">{detail.sourceLabel}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {pendingEvidenceCount > 0 && (
          <Link
            className="btn"
            href={`/projects/${projectId}/inbox`}
            style={{ alignSelf: 'flex-start' }}
          >
            Inbox: {pendingEvidenceCount} unreviewed{' '}
            {pendingEvidenceCount === 1 ? 'record' : 'records'}
          </Link>
        )}
      </div>
    </aside>
  );
}
