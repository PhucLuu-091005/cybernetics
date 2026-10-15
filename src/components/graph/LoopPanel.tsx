'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ActTypeSchema,
  type ActType,
  type Annotation,
  type DerivedAct,
  type DerivedLoop,
  type GraphOperation,
  type GraphSnapshot,
  type LoopAct,
  type LoopState,
  type Milestone,
  type ViewSelection,
} from '../../contracts';
import { activePermalink } from '../inbox/links';
import { SOURCE_APP_NAME, sourceApp } from '../../lib/source-app';
import { NoteText } from '../notes/NoteText';
import { ConflictBanner } from '../review/ConflictBanner';
import { useDraftEdit, type EditTarget } from '../review/draft-edit';
import { changeActType, hideAct, moveAct, setLoopMilestone, toAct } from '../review/operations';
import { Glyph } from './Glyph';
import {
  ACT_LABEL,
  BREAKDOWN_LABEL,
  STATE_COLOR,
  loopColor,
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
  notes: readonly Annotation[];
  /** Act ID to the ID of the loop that holds it in this view; a cite to an absent step shows grey. */
  actLoop: ReadonlyMap<string, string>;
  onCite(loopId: string, actId: string): void;
  /** Acts added or changed by an agent-authored proposal; only a proposal view can derive this. */
  agentActIds: ReadonlySet<string>;
  /** The promise a task belongs to, the tasks that hand off to it, and a promise's own tasks. */
  relations: LoopRelations;
  onOpenLoop(loopId: string): void;
  onViewRecord(recordVersionId: string, quote: string | null): void;
  onClose(): void;
};
export type RelatedLoop = {
  id: string;
  title: string;
  department: string;
  performer: string;
  state: LoopState | null;
  color: string;
  startedAt: string | null;
  closedAt: string | null;
  /** Titles of the loops it waits for that are not closed yet. */
  waitingFor: string[];
};
/** Like the parent, sub-issues and blocked-by / blocks relations of a ticket tracker. */
export type LoopRelations = {
  parent: RelatedLoop | null;
  /** Tasks that must close before this one starts. */
  after: RelatedLoop[];
  /** Tasks that wait for this one. */
  next: RelatedLoop[];
  tasks: RelatedLoop[];
};
type RelationStep = {
  at: string | null;
  kind: 'split' | 'after' | 'handoff' | 'return';
  text: string;
  ids: RelatedLoop[];
};

const list = (items: RelatedLoop[]) => items.map((item) => item.title).join(', ');

/** Where this loop meets its parent, tasks and handoffs, placed among its steps by time. */
function relationSteps(loop: DerivedLoop, relations: LoopRelations): RelationStep[] {
  const { parent, after, next, tasks } = relations;
  const steps: RelationStep[] = [];
  if (tasks.length) {
    const starts = tasks.flatMap((task) => (task.startedAt ? [task.startedAt] : [])).sort();
    const departments = [...new Set(tasks.map((task) => task.department))].join(', ');
    steps.push({
      at: starts[0] ?? null,
      kind: 'split',
      text: `Split into ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} for ${departments}`,
      ids: tasks,
    });
  }
  if (after.length) {
    const waiting = after.filter((item) => item.state !== 'closed');
    steps.push(
      loop.acts.length
        ? {
            at: loop.acts[0].occurredAt,
            kind: 'after',
            text: `Handed over from ${list(after)}`,
            ids: after,
          }
        : {
            at: null,
            kind: 'after',
            text: waiting.length ? `Waiting for ${list(waiting)}` : `Ready: ${list(after)} done`,
            ids: waiting.length ? waiting : after,
          },
    );
  }
  if (next.length)
    steps.push(
      loop.state === 'closed'
        ? { at: loop.closedAt, kind: 'handoff', text: `Handed off to ${list(next)}`, ids: next }
        : { at: null, kind: 'handoff', text: `Hands off to ${list(next)} when done`, ids: next },
    );
  else if (parent && loop.state === 'closed')
    steps.push({
      at: loop.closedAt,
      kind: 'return',
      text: `Returned to ${parent.title}`,
      ids: [parent],
    });
  return steps;
}

const RELATION_ICON: Record<RelationStep['kind'], string[]> = {
  split: ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3', 'm15 9 6-6'],
  after: ['m9 18 6-6-6-6'],
  handoff: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  return: ['M6 21V9a9 9 0 0 0 9 9', 'M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
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
type EvidenceRead = { acts: ReadonlyMap<string, Evidence> | null; rateLimited: boolean };
function useEvidence(
  projectId: string,
  loopId: string,
  T: string,
  view: ViewSelection,
): EvidenceRead {
  const [evidence, setEvidence] = useState<(EvidenceRead & { key: string }) | null>(null);
  const query = new URLSearchParams({ T, ...viewQuery(view) }).toString();
  const key = `${loopId}@${query}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/projects/${projectId}/loops/${loopId}?${query}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (response.status === 429) setEvidence({ key, acts: null, rateLimited: true });
        return response.ok ? (response.json() as Promise<{ loop: { acts: LoopAct[] } }>) : null;
      })
      .then((result) => {
        if (result)
          setEvidence({
            key,
            acts: new Map(result.loop.acts.map((act) => [act.id, act])),
            rateLimited: false,
          });
      })
      .catch(() => {
        /* the panel keeps the bare quote when the loop read fails */
      });
    return () => controller.abort();
  }, [projectId, loopId, query, key]);
  return evidence?.key === key ? evidence : { acts: null, rateLimited: false };
}
function sourceName(evidence: Evidence): string | null {
  const app = sourceApp(evidence.source, evidence.permalink);
  return app === 'agent' || app === 'paste' ? null : SOURCE_APP_NAME[app];
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
        Apply to change set
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
  notes,
  actLoop,
  onCite,
  agentActIds,
  relations,
  onOpenLoop,
  onViewRecord,
  onClose,
}: Props) {
  const { acts: evidence, rateLimited } = useEvidence(projectId, loop.loop.id, T, view);
  const steps = relationSteps(loop, relations);
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
  const tone = loopColor(loop);
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
        {notes.length > 0 && (
          <section className="panel-notes" aria-label="Loop notes">
            <small>Notes</small>
            {notes.map((note) => (
              <NoteText key={note.id} note={note} actLoop={actLoop} onCite={onCite} />
            ))}
          </section>
        )}
        <LoopWork relations={relations} onOpenLoop={onOpenLoop} />
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
                ? 'This change set is closed, so it cannot change.'
                : onMain
                  ? 'The approved graph is read-only. A change here starts a change set first.'
                  : 'Changes go into this change set.'}
            </span>
          </dd>
        </dl>
        {edit.failure && (
          <ConflictBanner
            title={
              edit.failure.status === 409
                ? 'Conflict: the change set or the records changed since this view loaded.'
                : 'The edit was not saved.'
            }
            error={edit.failure}
            message={
              edit.failure.status === 409
                ? 'Nothing changed. Reload to see the latest change set, then edit again.'
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
          {rateLimited && (
            <p role="status" className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
              Too many requests — try again in a minute.
            </p>
          )}
          {loop.acts.length === 0 ? (
            <>
              <p className="faint" style={{ fontSize: 13 }}>
                No acts yet at the evaluation time.
              </p>
              {steps.length > 0 && (
                <ol className="steps" aria-label="Steps">
                  {steps.map((step) => (
                    <RelationRow key={step.kind} step={step} onOpenLoop={onOpenLoop} />
                  ))}
                </ol>
              )}
            </>
          ) : (
            <ol className="steps" aria-label="Steps">
              {loop.acts.map((act, index) => {
                const before = steps.filter(
                  (step) =>
                    step.at !== null &&
                    Date.parse(step.at) < Date.parse(act.occurredAt) &&
                    (index === 0 ||
                      Date.parse(step.at) >= Date.parse(loop.acts[index - 1].occurredAt)),
                );
                const detail = evidence?.get(act.id),
                  name = detail ? sourceName(detail) : null,
                  link = detail ? activePermalink(detail) : null;
                return [
                  ...before.map((step) => (
                    <RelationRow
                      key={`${step.kind}-${act.id}`}
                      step={step}
                      onOpenLoop={onOpenLoop}
                    />
                  )),
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
                              ? 'This change set is closed.'
                              : act.quote === null
                                ? 'Unavailable evidence: edit this act in a change set.'
                                : onMain
                                  ? 'The approved graph is read-only. An edit starts a change set first.'
                                  : 'Edits go into this change set.'}
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
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          {name ? `Open in ${name}` : 'Open source'}
                        </a>
                      ) : detail?.permalink ? (
                        <span className="faint" style={{ overflowWrap: 'anywhere' }}>
                          {detail.permalink}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onViewRecord(act.citation.recordVersionId, act.quote)}
                      >
                        View record
                      </button>
                      {detail && <span className="faint">{detail.sourceLabel}</span>}
                    </div>
                  </li>,
                ];
              })}
              {steps
                .filter(
                  (step) =>
                    step.at === null ||
                    Date.parse(step.at) >= Date.parse(loop.acts.at(-1)!.occurredAt),
                )
                .map((step) => (
                  <RelationRow key={`${step.kind}-end`} step={step} onOpenLoop={onOpenLoop} />
                ))}
            </ol>
          )}
        </div>
        {pendingEvidenceCount > 0 && (
          <Link
            className="btn"
            href={`/projects/${projectId}/review?tab=records`}
            style={{ alignSelf: 'flex-start' }}
          >
            {pendingEvidenceCount} new {pendingEvidenceCount === 1 ? 'record' : 'records'} to review
          </Link>
        )}
      </div>
    </aside>
  );
}

function RelationRow({ step, onOpenLoop }: { step: RelationStep; onOpenLoop(id: string): void }) {
  return (
    <li className={`step relation ${step.kind}`}>
      <span className="g" aria-hidden="true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {RELATION_ICON[step.kind].map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
      <div className="step-h">
        <span>{step.text}</span>
      </div>
      <div className="relation-links">
        {step.ids.map((item) => (
          <button
            key={item.id}
            type="button"
            className="rel-chip"
            onClick={() => onOpenLoop(item.id)}
          >
            <StatusIcon loop={item} />
            {item.title}
          </button>
        ))}
      </div>
    </li>
  );
}

/** A ticket-tracker status circle: dashed with no acts, empty when asked, half when promised, full with a tick when closed. */
function StatusIcon({ loop }: { loop: RelatedLoop }) {
  const { state, color } = loop;
  const ended = state === 'declined' || state === 'cancelled';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="status-icon">
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill={state === 'closed' ? color : 'none'}
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={state === null ? '2 2' : undefined}
      />
      {(state === 'promised' || state === 'change_pending' || state === 'delivered') && (
        <path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z" fill={color} />
      )}
      {state === 'closed' && (
        <path d="M4.5 7.2 6.3 9 9.6 5.4" fill="none" stroke="var(--surface)" strokeWidth="1.6" />
      )}
      {ended && <path d="M3.5 10.5 10.5 3.5" stroke={color} strokeWidth="1.5" />}
    </svg>
  );
}

function SubIssue({ loop, onOpenLoop }: { loop: RelatedLoop; onOpenLoop(id: string): void }) {
  return (
    <li>
      <button type="button" className="sub" onClick={() => onOpenLoop(loop.id)}>
        <StatusIcon loop={loop} />
        <span className="t">{loop.title}</span>
        {loop.waitingFor.length > 0 && (
          <span className="blocked" title={`Waiting for ${loop.waitingFor.join(', ')}`}>
            blocked
          </span>
        )}
        <span className="meta">{loop.department}</span>
      </button>
    </li>
  );
}

function LoopWork({
  relations,
  onOpenLoop,
}: {
  relations: LoopRelations;
  onOpenLoop(id: string): void;
}) {
  const { parent, after, next, tasks } = relations;
  if (!parent && !after.length && !next.length && !tasks.length) return null;
  const done = tasks.filter((task) => task.state === 'closed').length;
  return (
    <section className="work" aria-label="Tasks and handoffs">
      {parent && (
        <p className="parent-crumb">
          <small>Part of</small>
          <button type="button" className="sub" onClick={() => onOpenLoop(parent.id)}>
            <StatusIcon loop={parent} />
            <span className="t">{parent.title}</span>
          </button>
        </p>
      )}
      {tasks.length > 0 && (
        <div className="subissues">
          <h3>
            Sub-issues
            <span
              className="progress"
              role="progressbar"
              aria-label="Sub-issues done"
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={done}
            >
              <span style={{ width: `${(done / tasks.length) * 100}%` }} />
            </span>
            <span className="faint">
              {done} of {tasks.length} done
            </span>
          </h3>
          <ul>
            {tasks.map((task) => (
              <SubIssue key={task.id} loop={task} onOpenLoop={onOpenLoop} />
            ))}
          </ul>
        </div>
      )}
      {after.length > 0 && (
        <div className="relations">
          <small>Blocked by</small>
          <ul>
            {after.map((item) => (
              <SubIssue key={item.id} loop={item} onOpenLoop={onOpenLoop} />
            ))}
          </ul>
        </div>
      )}
      {next.length > 0 && (
        <div className="relations">
          <small>Blocks</small>
          <ul>
            {next.map((item) => (
              <SubIssue key={item.id} loop={item} onOpenLoop={onOpenLoop} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
