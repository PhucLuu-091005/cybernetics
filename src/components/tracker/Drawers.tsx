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
  keysOf,
  mainState,
  milestoneStatus,
  replayOps,
  STATUS_LABEL,
  STATUS_TONE,
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
import { Icon, KindIcon } from './icons';
import { Moves } from './Pops';
import type { TrackerActions, TrackerView } from './TrackerScreen';

export type Filter = { person: string; ms: string; team: string };
export const NO_FILTER: Filter = { person: '', ms: '', team: '' };

export const matchesFilter = (f: Filter, w: TrackerState['workItems'][number]) =>
  (!f.person || w.requestedBy === f.person || w.doneBy === f.person) &&
  (!f.ms || w.milestoneId === f.ms) &&
  (!f.team || w.teamId === f.team);

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
  return (
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
  );
}

type Base = { session: Session; state: TrackerState; asOf: string; onClose: () => void };

export function WorkListDrawer({
  session,
  state,
  asOf,
  onClose,
  filter,
  onFilter,
  hiddenRows,
  onToggleRow,
  onFlash,
}: Base & {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  hiddenRows: readonly string[];
  onToggleRow: (id: string) => void;
  onFlash: (id: string) => void;
}) {
  const { dir, tz } = session;
  const select = (
    key: keyof Filter,
    label: string,
    any: string,
    options: Array<[string, string]>,
  ) => (
    <select
      aria-label={label}
      value={filter[key]}
      onChange={(event) => onFilter({ ...filter, [key]: event.target.value })}
    >
      <option value="">{any}</option>
      {options.map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );
  return (
    <Frame label="Work list" head={<h4>Work list</h4>} onClose={onClose}>
      <div className="filters">
        {select(
          'person',
          'Person',
          'Any person',
          state.people.map((p) => [p.id, p.name]),
        )}
        {select(
          'ms',
          'Milestone',
          'Any milestone',
          state.milestones.map((m) => [m.id, m.name]),
        )}
        {select(
          'team',
          'Team',
          'Any team',
          state.teams.map((t) => [t.id, t.name]),
        )}
      </div>
      {state.teams.map((team) => {
        const items = state.workItems.filter(
          (w) => w.teamId === team.id && matchesFilter(filter, w),
        );
        if (!items.length) return null;
        return (
          <section key={team.id} aria-label={team.name}>
            <div className="wl-lane">{team.name}</div>
            {items.map((w) => {
              const done = itemInfo(w, state.events).done;
              const status = itemStatus(w, state.events, asOf, tz);
              const hidden = hiddenRows.includes(w.id);
              return (
                <div className="wl-item" key={w.id}>
                  <button className="wl-open" type="button" onClick={() => onFlash(w.id)}>
                    <span
                      className="dot"
                      style={{ background: done ? 'var(--proceed)' : 'var(--route)' }}
                    />
                    <span>
                      <b>{w.title}</b>
                      <small>
                        {dir.name(w.doneBy)} · planned {formatDay(w.plannedFinish)}
                        {w.moves.length > 0 && ` · moved ${w.moves.length}×`}
                      </small>
                      <span className={`badge st-${status}`} style={{ marginTop: 3 }}>
                        {STATUS_LABEL[status]}
                      </span>
                    </span>
                  </button>
                  <button
                    className={`eyebtn${hidden ? ' off' : ''}`}
                    type="button"
                    aria-label={`${hidden ? 'Show' : 'Hide'} ${w.title}`}
                    onClick={() => onToggleRow(w.id)}
                  >
                    <Icon name={hidden ? 'eyeoff' : 'eye'} size={14} />
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
    </Frame>
  );
}

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
}: Base & { milestoneId: string; edit: boolean; actions: TrackerActions }) {
  const { dir, tz } = session;
  const m = state.milestones.find((x) => x.id === milestoneId);
  const [name, setName] = useState(m?.name ?? '');
  const [date, setDate] = useState(m?.planned ?? '');
  if (!m) return null;
  const { status, members } = milestoneStatus(m, state.workItems, state.events, asOf, tz);
  const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '';
  const unchanged = name === m.name && date === m.planned;
  const shownName = edit ? name : m.name;
  const shownDate = edit ? date : m.planned;
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
      <p className="q-label">Edit</p>
      <label className="field">
        Name
        <input
          value={shownName}
          disabled={!edit}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        Planned date
        <input
          type="date"
          value={shownDate}
          disabled={!edit}
          onChange={(event) => event.target.value && setDate(event.target.value)}
        />
      </label>
      {edit ? (
        <div className="m-foot">
          <button
            className="btn btn-ink"
            type="button"
            disabled={unchanged || !name.trim()}
            onClick={() => actions.saveMilestone(m.id, name.trim(), date)}
          >
            <Icon name="check" /> Save milestone
          </button>
        </div>
      ) : (
        <>
          <p className="tip">This view is read-only. Make the change in a change request.</p>
          <div className="m-foot">
            <button className="btn" type="button" onClick={actions.newCr}>
              <Icon name="plus" /> New change request
            </button>
          </div>
        </>
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
                onClick={() => actions.removeFromMilestone(w.id)}
              >
                <Icon name="x" size={13} /> Remove
              </button>
            )}
          </div>
        );
      })}
    </Frame>
  );
}

export function ChangesDrawer({
  session,
  cr,
  onClose,
  actions,
}: Omit<Base, 'state' | 'asOf'> & { cr: Cr; actions: TrackerActions }) {
  const { payload, dir, me, projectId } = session;
  const edit = canEditCr(cr, me);
  const clashes = isOpen(cr) ? clashesOf(cr.ops, payload.commits) : [];
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
        return (
          <div className={`chg-row${gone ? ' dropped' : ''}`} key={i}>
            <span className="pi" style={{ color: 'var(--draft)', width: 26, height: 26 }}>
              {d.icon ? <KindIcon kind={d.icon} size={13} /> : <Icon name="pencil" size={13} />}
            </span>
            <div>
              <b>{d.item}</b>: {d.change}
              <small>
                {d.before && (
                  <>
                    <span className="before">{d.before}</span> →{' '}
                  </>
                )}
                <span className="after">{d.after}</span>
              </small>
              {d.why && <small>Why: {d.why}</small>}
              <span className="chg-by">
                <Avatar id={op.by} dir={dir} sm /> {dir.name(op.by)}
              </span>
              {clash && <span className="chipx warn"> Clash with #{clash.commit.crNum}</span>}
              {gone && <span className="chipx"> Not merged</span>}
            </div>
            {edit && (
              <button
                className="x"
                type="button"
                aria-label="Remove this change"
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
          <button className="btn" type="button" disabled={!cr.ops.length} onClick={actions.undo}>
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
            disabled={!cr.ops.length}
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
