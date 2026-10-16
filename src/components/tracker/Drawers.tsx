'use client';
import Link from 'next/link';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  clashesOf,
  dayOf,
  formatDay,
  formatStamp,
  itemInfo,
  itemStatus,
  KIND_LABEL,
  keysOf,
  mainState,
  milestoneStatus,
  replayOps,
  reviewModel,
  SKIP_REASON,
  STATUS_LABEL,
  STATUS_TONE,
  timeSpent,
  type Commit,
  type Cr,
  type TrackerState,
} from '../../tracker';
import { Avatar, Avatars } from './avatar';
import {
  byNumDesc,
  canEditCr,
  clashCount,
  editorsOf,
  isOpen,
  plural,
  reviewHref,
  StatusChip,
  trunc,
  type Session,
} from './ContextBar';
import { Icon, KIND_COLOR, KindIcon } from './icons';
import { Moves } from './Pops';
import type { TrackerActions, TrackerView } from './TrackerScreen';

function Frame({
  label,
  head,
  icon,
  onClose,
  children,
}: {
  label: string;
  head: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const drawer = ref.current;
    const opener = document.activeElement;
    drawer?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      // Hand focus back only when it would otherwise be lost; a click on another control keeps its focus.
      const lost = !now || now === document.body || !!drawer?.contains(now);
      const focusable = opener instanceof HTMLElement || opener instanceof SVGElement;
      if (lost && focusable && opener.isConnected) opener.focus();
    };
  }, []);
  // The slot spans the graph and the drawer sticks inside it, so a long page never scrolls the drawer away.
  return (
    <div className="drawer-slot">
      <aside ref={ref} className="drawer" aria-label={label} tabIndex={-1}>
        <div className="pop-h">
          {icon}
          <div>{head}</div>
          <button className="x" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

type Base = {
  session: Session;
  state: TrackerState;
  asOf: string;
  onClose: () => void;
  busy?: boolean;
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function MilestoneDrawer({
  session,
  state,
  asOf,
  onClose,
  milestoneId,
  edit,
  actions,
  busy = false,
}: Base & { milestoneId: string; edit: boolean; actions: TrackerActions }) {
  const { dir, tz } = session;
  const m = state.milestones.find((x) => x.id === milestoneId);
  // Null until the editor types, so a hand-over or a poll shows the current milestone, not a stale copy.
  const [draft, setDraft] = useState<{ name: string; date: string } | null>(null);
  const [adding, setAdding] = useState('');
  if (!m) return null;
  const { status, members } = milestoneStatus(m, state.workItems, state.events, asOf, tz);
  const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '';
  const name = edit && draft ? draft.name : m.name;
  const date = edit && draft ? draft.date : m.planned;
  const unchanged = name === m.name && date === m.planned;
  const outside = state.workItems.filter((w) => w.milestoneId !== m.id);
  const pick = adding && outside.some((w) => w.id === adding) ? adding : (outside[0]?.id ?? '');
  return (
    <Frame
      label={m.name}
      icon={
        <span className="pi" style={{ color: `var(--${STATUS_TONE[status]})` }}>
          <Icon name="diamond" size={15} />
        </span>
      }
      head={
        <>
          <h4>{m.name}</h4>
          <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
          {status === 'late' && (
            <small style={{ display: 'inline', color: 'var(--danger)' }}>
              {' '}
              late {daysBetween(m.planned, dayOf(asOf, tz))} days
            </small>
          )}
        </>
      }
      onClose={onClose}
    >
      {edit ? (
        <>
          <p className="q-label">Edit</p>
          <label className="field">
            Name
            <input
              value={name}
              onChange={(event) => setDraft({ name: event.target.value, date })}
            />
          </label>
          <label className="field">
            Planned date
            <input
              type="date"
              value={date}
              onChange={(event) =>
                event.target.value && setDraft({ name, date: event.target.value })
              }
            />
          </label>
          <div className="m-foot">
            <button
              className="btn btn-ink"
              type="button"
              disabled={unchanged || !name.trim() || busy}
              onClick={() => actions.saveMilestone(m.id, name.trim(), date)}
            >
              <Icon name="check" /> Save milestone
            </button>
          </div>
        </>
      ) : (
        <dl className="facts">
          <dt>Planned date</dt>
          <dd>{formatDay(m.planned)}</dd>
        </dl>
      )}
      <Moves moves={m.moves} first={m.firstPlanned} dir={dir} tz={tz} />
      <p className="q-label">Work items in this milestone ({members.length})</p>
      {members.map((w) => {
        const finishedAt = itemInfo(w, state.events).finishedAt;
        return (
          <div className="mem" key={w.id}>
            <div>
              <b>{w.title}</b>
              <small>
                {finishedAt ? `Done ${formatDay(dayOf(finishedAt, tz))}` : 'Open'} ·{' '}
                {team(w.teamId)}
              </small>
            </div>
            {edit && (
              <button
                className="btn sm btn-danger"
                type="button"
                disabled={busy}
                onClick={() => actions.removeFromMilestone(w.id)}
              >
                <Icon name="x" size={13} /> Remove
              </button>
            )}
          </div>
        );
      })}
      {edit && outside.length > 0 && (
        <div className="share-add">
          <select
            aria-label="Work item to add"
            value={pick}
            onChange={(event) => setAdding(event.target.value)}
          >
            {outside.map((w) => (
              <option key={w.id} value={w.id}>
                {trunc(w.title, 44)}
              </option>
            ))}
          </select>
          <button
            className="btn"
            type="button"
            disabled={!pick || busy}
            onClick={() => actions.addToMilestone(pick, m.id)}
          >
            <Icon name="plus" /> Add
          </button>
        </div>
      )}
    </Frame>
  );
}

export function WorkItemDrawer({
  session,
  state,
  asOf,
  onClose,
  itemId,
  edit,
  hidden,
  actions,
  busy = false,
  onPick,
  onEvent,
  onMilestone,
  onToggleRow,
}: Base & {
  itemId: string;
  edit: boolean;
  hidden: boolean;
  actions: TrackerActions;
  onPick: (workItemId: string) => void;
  onEvent: (eventId: string) => void;
  onMilestone: (milestoneId: string) => void;
  onToggleRow: (workItemId: string) => void;
}) {
  const { dir, tz } = session;
  const item = state.workItems.find((w) => w.id === itemId);
  const [title, setTitle] = useState<string | null>(null);
  if (!item) return null;
  const info = itemInfo(item, state.events, asOf);
  const status = itemStatus(item, state.events, asOf, tz);
  const team = state.teams.find((t) => t.id === item.teamId)?.name ?? '';
  const ms = state.milestones.find((m) => m.id === item.milestoneId);
  const msStat = ms ? milestoneStatus(ms, state.workItems, state.events, asOf, tz).status : null;
  const parent = state.workItems.find((w) => w.id === item.parentId);
  const sources = item.after.flatMap((id) => state.workItems.filter((w) => w.id === id));
  const events = state.events
    .filter((e) => e.workItemId === item.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const spent = timeSpent(info.start, info.end);
  const link = (w: { id: string; title: string }) => (
    <button key={w.id} className="lnk" type="button" onClick={() => onPick(w.id)}>
      {w.title}
    </button>
  );
  const rename = () => {
    const next = title?.trim() ?? '';
    setTitle(null);
    if (next) actions.saveRename(item.id, next);
  };
  return (
    <Frame
      label={item.title}
      icon={
        <span className="pi" style={{ color: info.done ? 'var(--proceed)' : 'var(--route)' }}>
          <Icon name="loop" size={15} />
        </span>
      }
      head={
        <>
          <h4>{item.title}</h4>
          <small>{team}</small>
        </>
      }
      onClose={onClose}
    >
      <div className="wi-top">
        <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
        <button
          className={`btn sm${hidden ? ' btn-draft' : ''}`}
          type="button"
          aria-pressed={hidden}
          onClick={() => onToggleRow(item.id)}
        >
          <Icon name={hidden ? 'eyeoff' : 'eye'} size={13} />{' '}
          {hidden ? 'Show on the graph' : 'Hide from the graph'}
        </button>
      </div>
      {edit && title !== null ? (
        <div className="wi-rename">
          <label className="field">
            New name
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                rename();
              }}
            />
          </label>
          <div className="m-foot">
            <button className="btn" type="button" onClick={() => setTitle(null)}>
              Cancel
            </button>
            <button
              className="btn btn-ink"
              type="button"
              disabled={!title.trim() || title.trim() === item.title || busy}
              onClick={rename}
            >
              <Icon name="check" /> Save name
            </button>
          </div>
        </div>
      ) : (
        edit && (
          <div className="row-btns wi-acts">
            {!info.done && (
              <button
                className="btn sm btn-ink"
                type="button"
                onClick={() => actions.addEvent(item.id)}
              >
                <Icon name="plus" size={13} /> Add an event
              </button>
            )}
            <button
              className="btn sm"
              type="button"
              onClick={() => actions.moveDate({ kind: 'item', id: item.id })}
            >
              <Icon name="cal" size={13} /> Move the date
            </button>
            <button className="btn sm" type="button" onClick={() => setTitle(item.title)}>
              <Icon name="pencil" size={13} /> Rename
            </button>
          </div>
        )
      )}
      <dl className="facts">
        <dt>Team</dt>
        <dd>{team}</dd>
        <dt>Done by</dt>
        <dd>{dir.name(item.doneBy)}</dd>
        <dt>Requested by</dt>
        <dd>{dir.name(item.requestedBy)}</dd>
        <dt>Milestone</dt>
        <dd>
          {ms && msStat ? (
            <>
              <button className="lnk" type="button" onClick={() => onMilestone(ms.id)}>
                {ms.name}
              </button>{' '}
              · {formatDay(ms.planned)}{' '}
              <span className={`badge st-${msStat}`}>{STATUS_LABEL[msStat]}</span>
            </>
          ) : (
            'None'
          )}
        </dd>
        <dt>Planned finish</dt>
        <dd>{formatDay(item.plannedFinish)}</dd>
        <dt>Started</dt>
        <dd>{info.start ? formatStamp(info.start, tz) : 'Not started'}</dd>
        <dt>Finished</dt>
        <dd>{info.finishedAt ? formatStamp(info.finishedAt, tz) : 'Open'}</dd>
        <dt>Time spent</dt>
        <dd>{spent ?? 'Not started'}</dd>
        {parent && (
          <>
            <dt>Parent</dt>
            <dd>{link(parent)}</dd>
          </>
        )}
        {sources.length > 0 && (
          <>
            <dt>Leads from</dt>
            <dd className="links">{sources.map(link)}</dd>
          </>
        )}
      </dl>
      <Moves moves={item.moves} first={item.firstPlannedFinish} dir={dir} tz={tz} />
      <p className="q-label">Events ({events.length})</p>
      {!events.length && <p className="tip">No events yet.</p>}
      <ul className="ev-list">
        {events.map((ev) => {
          const body = (
            <>
              <span className="sk" style={{ color: KIND_COLOR[ev.kind] }}>
                <KindIcon kind={ev.kind} size={13} />
              </span>
              <span className="st">
                <b>
                  {KIND_LABEL[ev.kind]} by {dir.name(ev.by)}
                </b>
                <small>
                  {formatStamp(ev.at, tz)}
                  {ev.hidden && <span className="chipx"> hidden</span>}
                </small>
                <span>{ev.text}</span>
              </span>
            </>
          );
          return (
            <li key={ev.id}>
              {ev.hidden ? (
                <div className="stack-ev off">{body}</div>
              ) : (
                <button className="stack-ev" type="button" onClick={() => onEvent(ev.id)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

export function ChangesDrawer({
  session,
  cr,
  onClose,
  actions,
  busy = false,
}: Omit<Base, 'state' | 'asOf'> & { cr: Cr; actions: TrackerActions }) {
  const { payload, dir, me, projectId } = session;
  const edit = canEditCr(cr, me);
  const clashes = isOpen(cr) ? clashesOf(cr.ops, payload.commits) : [];
  const model = useMemo(() => reviewModel(payload, cr.num), [payload, cr.num]);
  const dropped = (keys: string[]) =>
    cr.status === 'merged' &&
    cr.resolutions.some((x) => x.chose === 'main' && keys.includes(x.key));
  return (
    <Frame
      label={`Changes in #${cr.num}`}
      head={
        <>
          <h4>Changes in #{cr.num}</h4>
          <small>{cr.title}</small>
        </>
      }
      onClose={onClose}
    >
      {!cr.ops.length && (
        <p className="tip">
          No changes yet. Drag an event or a work item from the Queue onto the graph.
        </p>
      )}
      {cr.ops.map((op, i) => {
        const d = op.d ?? { item: op.op, change: 'changed', before: '', after: '' };
        const clash = clashes.find((k) => k.index === i);
        const gone = dropped(keysOf(op));
        const skip = model?.changes.find((c) => c.opIndex === i)?.skipReason ?? null;
        return (
          <div className={`chg-row${gone ? ' dropped' : ''}${skip ? ' skipped' : ''}`} key={i}>
            <span className="pi" style={{ color: 'var(--draft)', width: 26, height: 26 }}>
              {d.icon ? <KindIcon kind={d.icon} size={13} /> : <Icon name="pencil" size={13} />}
            </span>
            <div>
              <b>{d.item}</b>: {d.change}
              {skip ? (
                <small>{SKIP_REASON[skip]}</small>
              ) : (
                <small>
                  {d.before && (
                    <>
                      <span className="before">{d.before}</span> →{' '}
                    </>
                  )}
                  <span className="after">{d.after}</span>
                </small>
              )}
              {d.why && <small>Why: {d.why}</small>}
              <span className="chg-by">
                <Avatar id={op.by} dir={dir} sm /> {dir.name(op.by)}
              </span>
              {clash && <span className="chipx warn"> Clash with #{clash.commit.crNum}</span>}
              {gone && <span className="chipx"> Not merged</span>}
              {skip && <span className="chipx"> No longer applies</span>}
            </div>
            {edit && (
              <button
                className="x"
                type="button"
                aria-label="Remove this change"
                disabled={busy}
                onClick={() => actions.removeChange(i)}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <div className="drawer-foot">
        {edit && (
          <button
            className="btn"
            type="button"
            disabled={!cr.ops.length || busy}
            onClick={actions.undo}
          >
            <Icon name="undo" /> Undo
          </button>
        )}
        <Link className="btn" href={reviewHref(projectId, cr.num)}>
          Open review
        </Link>
        {edit && (
          <button
            className="btn btn-ink"
            type="button"
            disabled={!cr.ops.length || busy}
            onClick={actions.markReady}
          >
            <Icon name="check" /> Mark as ready
          </button>
        )}
      </div>
    </Frame>
  );
}

const GROUPS: Array<[Cr['status'], string]> = [
  ['ready', 'Ready to merge'],
  ['draft', 'Drafts'],
  ['merged', 'Merged'],
  ['closed', 'Closed'],
];

export function RequestsDrawer({
  session,
  onClose,
  actions,
  onView,
}: Omit<Base, 'state' | 'asOf'> & {
  actions: TrackerActions;
  onView: (view: TrackerView) => void;
}) {
  const { payload, dir, isOwner, projectId, tz } = session;
  return (
    <Frame
      label="Change requests"
      head={
        <>
          <h4>Change requests</h4>
          <small>
            {isOwner
              ? 'You own Main. Review and merge the ready ones.'
              : `${dir.name(payload.project.ownerMemberId)} merges the ready ones into Main.`}
          </small>
        </>
      }
      onClose={onClose}
    >
      <div className="m-foot" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
        <button className="btn btn-ink" type="button" onClick={actions.newCr}>
          <Icon name="plus" /> New change request
        </button>
      </div>
      {GROUPS.map(([status, label]) => {
        const crs = payload.crs.filter((c) => c.status === status).sort(byNumDesc);
        if (!crs.length) return null;
        return (
          <section key={status} aria-label={label}>
            <p className="q-label">
              {label} ({crs.length})
            </p>
            {crs.map((c) => {
              const clashes = clashCount(c, payload.commits);
              const mergeIt = status === 'ready' && isOwner;
              return (
                <div className={`req${isOpen(c) ? '' : ' done'}`} key={c.num}>
                  <header>
                    <b>
                      #{c.num} {c.title}
                    </b>
                    <StatusChip cr={c} />
                  </header>
                  <div className="cr-meta">
                    <Avatars ids={editorsOf(c)} dir={dir} />
                    <small>
                      {dir.name(c.author)} · {plural(c.ops.length, 'change')}
                      {c.status === 'merged' &&
                        c.mergedAt &&
                        ` · merged ${formatStamp(c.mergedAt, tz)}`}
                    </small>
                    {clashes > 0 && <span className="chipx warn">{plural(clashes, 'clash')}</span>}
                  </div>
                  <div className="row-btns">
                    <button className="btn sm" type="button" onClick={() => onView(c.num)}>
                      Open
                    </button>
                    <Link
                      className={`btn sm${mergeIt ? ' btn-ink' : ''}`}
                      href={reviewHref(projectId, c.num)}
                    >
                      {mergeIt ? (
                        <>
                          <Icon name="merge" size={13} /> Review and merge
                        </>
                      ) : (
                        'Review'
                      )}
                    </Link>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </Frame>
  );
}

function commitLines(session: Session, commit: Commit) {
  const { payload, tz } = session;
  const before = mainState(payload.base, payload.queue, payload.commits, commit.rev - 1);
  return replayOps(before, commit.ops, tz).entries;
}

export function HistoryDrawer({
  session,
  onClose,
  onView,
}: Omit<Base, 'state' | 'asOf'> & { onView: (view: TrackerView) => void }) {
  const { payload, dir, projectId, tz } = session;
  const commits = useMemo(
    () => [...payload.commits].sort((a, b) => b.rev - a.rev),
    [payload.commits],
  );
  const latest = commits[0]?.rev;
  const lines = useMemo(
    () => new Map(commits.map((c) => [c.rev, commitLines(session, c)])),
    [commits, session],
  );
  const crOf = (commit: Commit) => payload.crs.find((c) => c.id === commit.crId);
  const closed = payload.crs.filter((c) => c.status === 'closed');
  return (
    <Frame
      label="Main history"
      head={
        <>
          <h4>Main history</h4>
          <small>
            Each step is a change request that {dir.name(payload.project.ownerMemberId)} merged into
            Main.
          </small>
        </>
      }
      onClose={onClose}
    >
      <ol className="hist">
        {commits.map((commit) => {
          const cr = crOf(commit);
          const n = commit.resolutions.length;
          return (
            <li key={commit.rev}>
              <span className="hdot" />
              <div className="hcard">
                <header>
                  <b>
                    #{commit.crNum} {cr?.title}
                  </b>
                  {commit.rev === latest && <span className="chipx ok">Latest</span>}
                </header>
                <div className="hm">
                  {cr && <Avatar id={cr.author} dir={dir} sm />} by {cr ? dir.name(cr.author) : ''}{' '}
                  · merged by {dir.name(commit.mergedBy)} · {formatStamp(commit.mergedAt, tz)}
                </div>
                <ul>
                  {(lines.get(commit.rev) ?? []).map((e) => (
                    <li key={e.i}>
                      {e.item}: {e.change}
                      {e.after && ` → ${trunc(e.after, 40)}`}
                    </li>
                  ))}
                </ul>
                {n > 0 && (
                  <div className="resolved">
                    <Icon name="check" size={13} />
                    <span>
                      {plural(n, 'clash')} resolved:{' '}
                      {commit.resolutions
                        .map(
                          (x) =>
                            `${x.label}, kept ${x.chose === 'main' ? `Main from #${x.from}` : 'this change request'}`,
                        )
                        .join('; ')}
                    </span>
                  </div>
                )}
                <div className="row-btns">
                  <Link className="btn sm" href={reviewHref(projectId, commit.crNum)}>
                    See changes
                  </Link>
                  <button className="btn sm" type="button" onClick={() => onView(commit.crNum)}>
                    Open graph
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        <li>
          <span className="hdot" />
          <div className="hcard">
            <b>Start</b>
            <div className="hm">The project graph before any change request.</div>
          </div>
        </li>
      </ol>
      {closed.length > 0 && (
        <>
          <p className="q-label">Closed without merging ({closed.length})</p>
          {closed.map((c) => (
            <div className="grow-item" key={c.num}>
              <Avatar id={c.author} dir={dir} sm />
              <div>
                <b>
                  #{c.num} {c.title}
                </b>
                <small>Closed by {dir.name(c.closedBy ?? '')}</small>
              </div>
              <Link className="btn sm" href={reviewHref(projectId, c.num)}>
                Review
              </Link>
            </div>
          ))}
        </>
      )}
    </Frame>
  );
}
