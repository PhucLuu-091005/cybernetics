'use client';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  dayOf,
  focusTree,
  formatDay,
  formatDeadline,
  formatStamp,
  FINISHES_NOTE,
  isFinishingHandoff,
  itemInfo,
  itemStatus,
  KIND_LABEL,
  kindWithArticle,
  lateBy,
  mainState,
  milestoneStatus,
  replayOps,
  startHint,
  STATUS_LABEL,
  STATUS_TONE,
  teamFocusTree,
  timeSpent,
  toInstant,
  type Commit,
  type Cr,
  type DateMove,
  type FocusNode,
  type TrackerState,
} from '../../tracker';
import type { OpInput } from './api';
import { Avatar, Avatars, type Directory } from './avatar';
import {
  byNumDesc,
  mergerNames,
  clashCount,
  editorsOf,
  isOpen,
  plural,
  closeReason,
  StatusChip,
  trunc,
  type Session,
} from './ContextBar';
import { Icon, KIND_COLOR, KindIcon } from './icons';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';
import { Moves } from './Pops';
import type { TrackerActions, TrackerView } from './TrackerScreen';

function Frame({
  label,
  head,
  icon,
  takeFocus = true,
  onClose,
  children,
}: {
  label: string;
  head: ReactNode;
  icon?: ReactNode;
  takeFocus?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const grab = useRef(takeFocus);
  useLayoutEffect(() => {
    const drawer = ref.current;
    const opener = document.activeElement;
    if (grab.current) drawer?.focus({ preventScroll: true });
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

export function MilestoneDrawer({
  session,
  state,
  asOf,
  onClose,
  milestoneId,
  edit,
  actions,
  busy = false,
  onPick,
}: Base & {
  milestoneId: string;
  edit: boolean;
  actions: TrackerActions;
  /** A member name opens that work item and brings its row into view. */
  onPick?: (workItemId: string) => void;
}) {
  const { dir, tz } = session;
  const m = state.milestones.find((x) => x.id === milestoneId);
  // Null until the editor types, so a hand-over or a poll shows the current milestone, not a stale copy.
  const [draft, setDraft] = useState<{ name: string; date: string; time: string } | null>(null);
  const [adding, setAdding] = useState('');
  if (!m) return null;
  const { status, members } = milestoneStatus(m, state.workItems, state.events, asOf, tz);
  const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '';
  const name = edit && draft ? draft.name : m.name;
  const date = edit && draft ? draft.date : m.planned;
  const time = edit && draft ? draft.time : (m.plannedTime ?? '');
  const unchanged = name === m.name && date === m.planned && time === (m.plannedTime ?? '');
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
            <small style={{ display: 'inline', color: 'var(--danger-ink)' }}>
              {' '}
              {lateBy(m, asOf, tz)}
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
              onChange={(event) => setDraft({ name: event.target.value, date, time })}
            />
          </label>
          <label className="field">
            Planned date
            <DateInput
              label="Planned date"
              today={dayOf(asOf, tz)}
              value={date}
              onChange={(next) => setDraft({ name, date: next, time })}
            />
          </label>
          <label className="field">
            Time (optional)
            <TimeInput value={time} onChange={(next) => setDraft({ name, date, time: next })} />
          </label>
          <div className="m-foot">
            <button
              className="btn btn-ink"
              type="button"
              disabled={unchanged || !name.trim() || busy}
              onClick={() => actions.saveMilestone(m.id, name.trim(), date, time || null)}
            >
              <Icon name="check" /> Save milestone
            </button>
          </div>
        </>
      ) : (
        <dl className="facts">
          <dt>Planned date</dt>
          <dd>{formatDeadline(m.planned, m.plannedTime)}</dd>
        </dl>
      )}
      <Moves
        moves={m.moves}
        first={formatDeadline(m.firstPlanned, m.firstPlannedTime)}
        dir={dir}
        tz={tz}
      />
      <p className="q-label">Work items in this milestone ({members.length})</p>
      {members.map((w) => {
        const { finishedAt, cancelled } = itemInfo(w, state.events);
        return (
          <div className="mem" key={w.id}>
            <div>
              {onPick ? (
                <button className="lnk mem-title" type="button" onClick={() => onPick(w.id)}>
                  {w.title}
                </button>
              ) : (
                <b>{w.title}</b>
              )}
              <small>
                {finishedAt
                  ? `${cancelled ? 'Cancelled' : 'Done'} ${formatDay(dayOf(finishedAt, tz))}`
                  : 'Not finished'}{' '}
                · {team(w.teamId)}
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

type Dates = { date: string; time: string; why: string };

// The server stamps the move again with its own clock; this only fills the op.
const nowIn = (tz: string) => toInstant(Date.now(), tz);

function MoveHistory({
  moves,
  first,
  dir,
  tz,
}: {
  moves: readonly DateMove[];
  first: string;
  dir: Directory;
  tz: string;
}) {
  // A button, not <details>: an open <details> keeps Esc for itself, and Esc must close the panel.
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!moves.length)
    return (
      <div className="wi-never">
        <span>Date moves</span>
        <span>The date never moved.</span>
      </div>
    );
  return (
    <div className={`wi-moves${open ? ' open' : ''}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="k">Date moves</span>
        <span>
          First planned {first} · moved {moves.length}×
        </span>
        <Icon name="chev" size={13} />
      </button>
      {open && (
        <ol id={listId}>
          {[...moves].reverse().map((mv, i) => (
            <li key={`${mv.at}-${i}`}>
              <Avatar id={mv.by} dir={dir} sm />
              <b>
                {formatDeadline(mv.from, mv.fromTime)} → {formatDeadline(mv.to, mv.toTime)}
              </b>
              <span>{mv.why}</span>
              <small>
                {dir.name(mv.by)} · {formatStamp(mv.at, tz)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Who({ id, dir }: { id: string; dir: Directory }) {
  return (
    <span className="who">
      <Avatar id={id} dir={dir} sm /> {dir.name(id)}
    </span>
  );
}

/**
 * The detail panel of a work item. With `edit` the same rows turn into controls, and each change is
 * one change request op through `actions.editItem`, so a host page needs only the actions.
 */
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
  // Null until the editor types, so a hand-over or a poll shows the current values, not a stale copy.
  const [title, setTitle] = useState<string | null>(null);
  const [dates, setDates] = useState<Dates | null>(null);
  const [adding, setAdding] = useState('');
  if (!item) return null;
  const info = itemInfo(item, state.events, asOf);
  const status = itemStatus(item, state.events, asOf, tz);
  const hint = startHint(item, state.events);
  const late = status === 'late';
  const lateText = late
    ? lateBy({ planned: item.plannedFinish, plannedTime: item.plannedFinishTime }, asOf, tz)
    : null;
  const team = state.teams.find((t) => t.id === item.teamId)?.name ?? '';
  const ms = state.milestones.find((m) => m.id === item.milestoneId);
  const msStat = ms ? milestoneStatus(ms, state.workItems, state.events, asOf, tz).status : null;
  const parent = state.workItems.find((w) => w.id === item.parentId);
  const sources = item.after.flatMap((id) => state.workItems.filter((w) => w.id === id));
  const receivers = state.workItems.filter((w) => w.id !== item.id && w.after.includes(item.id));
  const others = state.workItems.filter((w) => w.id !== item.id);
  const events = state.events
    .filter((e) => e.workItemId === item.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const spent = timeSpent(info.start, info.end);
  const link = (w: { id: string; title: string }) => (
    <button key={w.id} className="lnk" type="button" onClick={() => onPick(w.id)}>
      {w.title}
    </button>
  );
  const change = (op: OpInput) => actions.editItem([op]);
  const name = title ?? item.title;
  const renamed = name.trim() !== '' && name.trim() !== item.title;
  const rename = () => {
    setTitle(null);
    if (renamed) change({ op: 'rename', a: { workItemId: item.id, title: name.trim() } });
  };
  const plan = dates ?? { date: item.plannedFinish, time: item.plannedFinishTime ?? '', why: '' };
  const moved = plan.date !== item.plannedFinish || plan.time !== (item.plannedFinishTime ?? '');
  const moveDate = () => {
    if (!plan.why.trim() || !moved) return;
    setDates(null);
    change({
      op: 'due',
      a: {
        workItemId: item.id,
        date: plan.date,
        ...(plan.time ? { time: plan.time } : {}),
        why: plan.why.trim(),
        by: session.me ?? 'nobody',
        at: nowIn(tz),
      },
    });
  };
  const people = (value: string, label: string, onPick: (id: string) => void) => (
    <span className="wi-pick">
      <Avatar id={value} dir={dir} sm />
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(e) => onPick(e.target.value)}
      >
        {state.people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </span>
  );
  const finish = formatDeadline(item.plannedFinish, item.plannedFinishTime);
  return (
    <Frame
      label={item.title}
      icon={
        <span
          className="pi"
          style={{
            color: info.cancelled
              ? 'var(--isolated)'
              : info.done
                ? 'var(--proceed)'
                : 'var(--route)',
          }}
        >
          <Icon name="loop" size={15} />
        </span>
      }
      head={
        <>
          {edit ? (
            <input
              className="wi-title"
              aria-label="Name"
              value={name}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                rename();
              }}
            />
          ) : (
            <h4>{item.title}</h4>
          )}
          <small>{team}</small>
        </>
      }
      onClose={onClose}
    >
      {edit && title !== null && (
        <div className="wi-inline">
          <button className="btn sm" type="button" onClick={() => setTitle(null)}>
            Cancel
          </button>
          <button
            className="btn sm btn-ink"
            type="button"
            disabled={!renamed || busy}
            onClick={rename}
          >
            <Icon name="check" size={13} /> Save name
          </button>
        </div>
      )}
      <div className="wi-top">
        <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
        {lateText && <span className="late-by">{lateText}</span>}
        <span className="sp" />
        <button
          className="btn sm btn-quiet"
          type="button"
          aria-pressed={hidden}
          onClick={() => onToggleRow(item.id)}
        >
          <Icon name={hidden ? 'eyeoff' : 'eye'} size={13} />{' '}
          {hidden ? 'Show on the graph' : 'Hide from the graph'}
        </button>
      </div>
      {hint && (
        <p className="wi-hint" role="note" aria-label="Start of the work item">
          <Icon name="info" size={14} />
          <span>
            This work item starts with {kindWithArticle(hint)}. Add the event that started it, such
            as a Message, an Idea or a Task.
          </span>
        </p>
      )}
      {edit && !info.done && (
        <div className="row-btns wi-acts">
          <button
            className="btn sm btn-ink"
            type="button"
            onClick={() => actions.addEvent(item.id)}
          >
            <Icon name="plus" size={13} /> Add an event
          </button>
          <button className="btn sm" type="button" onClick={() => actions.markDone(item.id)}>
            <KindIcon kind="done" size={13} /> Mark done
          </button>
          <button className="btn sm" type="button" onClick={() => actions.cancelItem(item.id)}>
            <KindIcon kind="cancelled" size={13} /> Cancel work item
          </button>
        </div>
      )}
      <dl className="facts wi-facts">
        <dt>Team</dt>
        <dd>
          {edit ? (
            <select
              aria-label="Team"
              value={item.teamId}
              disabled={busy}
              onChange={(e) =>
                change({ op: 'team', a: { workItemId: item.id, teamId: e.target.value } })
              }
            >
              {state.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            team
          )}
        </dd>
        <dt>Done by</dt>
        <dd>
          {edit ? (
            people(item.doneBy, 'Done by', (personId) =>
              change({ op: 'doneBy', a: { workItemId: item.id, personId } }),
            )
          ) : (
            <Who id={item.doneBy} dir={dir} />
          )}
        </dd>
        <dt>Requested by</dt>
        <dd>
          {edit ? (
            people(item.requestedBy, 'Requested by', (personId) =>
              change({ op: 'requestedBy', a: { workItemId: item.id, personId } }),
            )
          ) : (
            <Who id={item.requestedBy} dir={dir} />
          )}
        </dd>
        <span className="gap" role="presentation" />
        <dt>Milestone</dt>
        <dd>
          {edit ? (
            <select
              aria-label="Milestone"
              value={item.milestoneId ?? ''}
              disabled={busy}
              onChange={(e) =>
                change(
                  e.target.value
                    ? { op: 'msAdd', a: { workItemId: item.id, milestoneId: e.target.value } }
                    : { op: 'msRemove', a: { workItemId: item.id } },
                )
              }
            >
              <option value="">None</option>
              {state.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {formatDeadline(m.planned, m.plannedTime)}
                </option>
              ))}
            </select>
          ) : ms && msStat ? (
            <>
              <button className="lnk" type="button" onClick={() => onMilestone(ms.id)}>
                {ms.name}
              </button>{' '}
              · {formatDeadline(ms.planned, ms.plannedTime)}{' '}
              <span className={`badge st-${msStat}`}>{STATUS_LABEL[msStat]}</span>
            </>
          ) : (
            'None'
          )}
        </dd>
        <dt>Started</dt>
        <dd>{info.start ? formatStamp(info.start, tz) : 'Not started'}</dd>
        <dt>Planned finish</dt>
        <dd className={late && !edit ? 'late' : undefined}>
          {edit ? (
            <div className="wi-when">
              <span className="wi-date">
                <DateInput
                  label="Planned finish"
                  today={dayOf(asOf, tz)}
                  value={plan.date}
                  onChange={(date) => setDates({ ...plan, date })}
                />
                <TimeInput value={plan.time} onChange={(time) => setDates({ ...plan, time })} />
              </span>
              {late && !moved && <span className="late-by">{lateText}</span>}
              {moved && (
                <div className="wi-why">
                  <label className="field">
                    Why does the date move? (required)
                    <textarea
                      value={plan.why}
                      required
                      placeholder="For example: Lan sends the country list on 10 October."
                      onChange={(e) => setDates({ ...plan, why: e.target.value })}
                    />
                  </label>
                  <div className="wi-inline">
                    <button className="btn sm" type="button" onClick={() => setDates(null)}>
                      Cancel
                    </button>
                    <button
                      className="btn sm btn-ink"
                      type="button"
                      disabled={!plan.why.trim() || busy}
                      onClick={moveDate}
                    >
                      <Icon name="cal" size={13} /> Move the date
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {finish}
              {lateText && ` · ${lateText}`}
            </>
          )}
        </dd>
        <dt>Finished</dt>
        <dd>{info.finishedAt ? formatStamp(info.finishedAt, tz) : 'Not yet'}</dd>
        <dt>Time spent</dt>
        <dd>{spent ?? 'Not started'}</dd>
        {(edit || parent || sources.length > 0 || receivers.length > 0) && (
          <span className="gap" role="presentation" />
        )}
        {(edit || parent) && (
          <>
            <dt>Parent</dt>
            <dd>
              {edit ? (
                <select
                  aria-label="Parent"
                  value={item.parentId ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    change({
                      op: 'parent',
                      a: { workItemId: item.id, parentId: e.target.value || null },
                    })
                  }
                >
                  <option value="">None</option>
                  {others.map((w) => (
                    <option key={w.id} value={w.id}>
                      {trunc(w.title, 44)}
                    </option>
                  ))}
                </select>
              ) : (
                parent && link(parent)
              )}
            </dd>
          </>
        )}
        {(edit || sources.length > 0) && (
          <>
            <dt>Leads from</dt>
            <dd className="links">
              {sources.map((w) =>
                edit ? (
                  <span key={w.id} className="wi-chip">
                    {link(w)}
                    <button
                      className="x"
                      type="button"
                      aria-label={`Remove ${w.title} from Leads from`}
                      disabled={busy}
                      onClick={() =>
                        change({
                          op: 'after',
                          a: { workItemId: item.id, after: item.after.filter((id) => id !== w.id) },
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  link(w)
                ),
              )}
              {edit && (
                <select
                  aria-label="Add to Leads from"
                  value={adding}
                  disabled={busy}
                  onChange={(e) => {
                    setAdding('');
                    if (e.target.value)
                      change({
                        op: 'after',
                        a: { workItemId: item.id, after: [...item.after, e.target.value] },
                      });
                  }}
                >
                  <option value="">{sources.length ? 'Add another…' : 'Nothing · add…'}</option>
                  {others
                    .filter((w) => !item.after.includes(w.id))
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {trunc(w.title, 44)}
                      </option>
                    ))}
                </select>
              )}
            </dd>
          </>
        )}
        {receivers.length > 0 && (
          <>
            <dt>Leads to</dt>
            <dd className="links">{receivers.map(link)}</dd>
          </>
        )}
      </dl>
      <MoveHistory
        moves={item.moves}
        first={formatDeadline(item.firstPlannedFinish, item.firstPlannedFinishTime)}
        dir={dir}
        tz={tz}
      />
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
                  {isFinishingHandoff(ev) && ` · ${FINISHES_NOTE}`}
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

export function FocusDrawer({
  session,
  state,
  asOf,
  onClose,
  focus,
  isHidden,
  grab,
  onGrabbed,
  onFocus,
  onShow,
}: Base & {
  focus: { kind: 'item' | 'team'; id: string };
  isHidden: (workItemId: string) => boolean;
  grab: boolean;
  onGrabbed: () => void;
  onFocus: (workItemId: string) => void;
  onShow: (workItemId: string) => void;
}) {
  const tree = useMemo(
    () => (focus.kind === 'item' ? focusTree(state, focus.id) : null),
    [state, focus.kind, focus.id],
  );
  const teamTree = useMemo(
    () => (focus.kind === 'team' ? teamFocusTree(state, focus.id) : null),
    [state, focus.kind, focus.id],
  );
  useEffect(() => {
    if (grab) onGrabbed();
  }, [grab, onGrabbed]);
  if (!tree && !teamTree) return null;
  const { tz } = session;
  const team = (id: string) => state.teams.find((t) => t.id === id)?.name ?? '';
  const size = (n: FocusNode): number => n.children.reduce((sum, c) => sum + size(c), 1);
  const node = (n: FocusNode, root = false): ReactNode => {
    const w = state.workItems.find((x) => x.id === n.id)!;
    const status = itemStatus(w, state.events, asOf, tz);
    return (
      <li key={n.id}>
        <button
          className={`ft-node${root ? ' on' : ''}`}
          type="button"
          aria-current={root ? 'true' : undefined}
          onClick={() => onShow(n.id)}
        >
          <span className="tt">
            <b>{n.title}</b>
            <small>
              {team(n.teamId)}
              {isHidden(n.id) && <span className="chipx"> hidden</span>}
            </small>
          </span>
          <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
        </button>
        {n.children.length > 0 && <ul>{n.children.map((c) => node(c))}</ul>}
      </li>
    );
  };
  const count = tree ? size(tree.root) : teamTree!.roots.reduce((sum, r) => sum + size(r), 0);
  return (
    <Frame
      label={`Focus on ${tree ? tree.root.title : teamTree!.team.name}`}
      takeFocus={grab}
      icon={
        <span className="pi" style={{ color: 'var(--ink)' }}>
          <Icon name="focus" size={15} />
        </span>
      }
      head={
        <>
          <h4>Focus</h4>
          <small>{plural(count, 'work item')} · only on your screen</small>
        </>
      }
      onClose={onClose}
    >
      <div className="wi-top">
        <button className="btn sm btn-ink" type="button" onClick={onClose}>
          <Icon name="x" size={13} /> Leave focus
        </button>
        <span className="tip">Esc also leaves focus.</span>
      </div>
      {tree?.parent && (
        <>
          <p className="q-label">Parent</p>
          <button
            className="ft-node up"
            type="button"
            title="Focus on the parent instead"
            onClick={() => onFocus(tree.parent!.id)}
          >
            <Icon name="cornerUp" size={13} />
            <span className="tt">
              <b>{tree.parent.title}</b>
              <small>{team(tree.parent.teamId)} · focus on it instead</small>
            </span>
          </button>
        </>
      )}
      {tree && (
        <>
          <p className="q-label">Focused work</p>
          <ul className="ft">{node(tree.root, true)}</ul>
        </>
      )}
      {teamTree && (
        <>
          <p className="q-label">Team</p>
          <p className="ft-team">
            <b>{teamTree.team.name}</b>
            <small>Its work items and the work that comes from them</small>
          </p>
          {teamTree.roots.length ? (
            <ul className="ft">{teamTree.roots.map((r) => node(r))}</ul>
          ) : (
            <p className="tip">This team has no work items yet.</p>
          )}
        </>
      )}
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
  const { payload, dir, canMerge, tz } = session;
  return (
    <Frame
      label="Change requests"
      head={
        <>
          <h4>Change requests</h4>
          <small>
            {canMerge
              ? 'You can merge. Review and merge the ready ones.'
              : `${mergerNames(session)} merges the ready ones into Main.`}
          </small>
        </>
      }
      onClose={onClose}
    >
      {session.canCreate && (
        <div className="m-foot" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
          <button className="btn btn-ink" type="button" onClick={actions.newCr}>
            <Icon name="plus" /> New change request
          </button>
        </div>
      )}
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
              const mergeIt = status === 'ready' && canMerge;
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
                    <button
                      className={`btn sm${mergeIt ? ' btn-ink' : ''}`}
                      type="button"
                      onClick={() => onView(c.num)}
                    >
                      {mergeIt ? (
                        <>
                          <Icon name="merge" size={13} /> Review and merge
                        </>
                      ) : (
                        'Open'
                      )}
                    </button>
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
  const { payload, dir, tz } = session;
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
          <small>Each step is a change request merged into Main, newest first.</small>
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
                  <button className="btn sm" type="button" onClick={() => onView(commit.crNum)}>
                    Open #{commit.crNum}
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
          <p className="q-label">Cancelled ({closed.length})</p>
          {closed.map((c) => {
            const reason = closeReason(c);
            return (
              <div className="grow-item" key={c.num}>
                <Avatar id={c.author} dir={dir} sm />
                <div>
                  <b>
                    #{c.num} {c.title}
                  </b>
                  <small>
                    Cancelled by {dir.name(c.closedBy ?? '')}
                    {c.closedAt && `, ${formatStamp(c.closedAt, tz)}`}
                  </small>
                  {reason && <span className="grow-note multi">Reason: {reason}</span>}
                </div>
                <button className="btn sm" type="button" onClick={() => onView(c.num)}>
                  Open
                </button>
              </div>
            );
          })}
        </>
      )}
    </Frame>
  );
}
