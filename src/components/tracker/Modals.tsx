'use client';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  addDays,
  dayOf,
  EVENT_KINDS,
  formatDay,
  formatDeadline,
  formatStamp,
  itemInfo,
  KIND_LABEL,
  toInstant,
  wallTimeInstant,
  type Cr,
  type CrPermission,
  type EventKind,
  type TrackerState,
} from '../../tracker';
import type { OpInput, QueueEntry } from './api';
import { Avatar } from './avatar';
import { trunc, type Session } from './ContextBar';
import { Icon, KindIcon } from './icons';
import { newTeamOp } from './team';
import { TimeInput } from './TimeInput';

export type ModalState =
  | { mode: 'add'; what: 'event' | 'item' }
  | { mode: 'attach'; eventId: string }
  | { mode: 'placeItem'; itemId: string }
  | { mode: 'event'; workItemId: string; done?: boolean }
  | { mode: 'fromEvent'; eventId: string; teamId: string }
  | { mode: 'ms' }
  | { mode: 'team' }
  /** `time` only for a milestone; absent keeps its current time. */
  | { mode: 'due'; kind: 'item' | 'ms'; id: string; date: string; time?: string | null }
  | { mode: 'newcr' }
  | { mode: 'share' };

export type ModalHandlers = {
  toast: (text: string) => void;
  open: (modal: ModalState) => void;
  addToQueue: (entry: QueueEntry) => void;
  dismiss: (queueId: string) => void;
  commit: (ops: OpInput[]) => void;
  createCr: (title: string) => void;
  share: (memberId: string, permission: CrPermission | 'remove') => void;
  handOver: (memberId: string) => void;
};

type Props = {
  modal: ModalState;
  session: Session;
  state: TrackerState;
  cr: Cr | null;
  asOf: string;
  busy: boolean;
  on: ModalHandlers;
  onClose: () => void;
};
type PropsOf<M extends ModalState['mode']> = Omit<Props, 'modal'> & {
  modal: Extract<ModalState, { mode: M }>;
};

const HOUR = 3_600_000;
const newId = () => crypto.randomUUID();

/** A `datetime-local` value is wall time in the project time zone. */
export const localInput = (instant: string, tz: string) =>
  toInstant(Date.parse(instant), tz).slice(0, 16);
export function fromLocalInput(value: string, tz: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  return match ? wallTimeInstant(match[1], match[2], tz) : null;
}
const hourBefore = (asOf: string, tz: string) => toInstant(Date.parse(asOf) - HOUR, tz);
const weekAfter = (asOf: string, tz: string) => addDays(dayOf(asOf, tz), 7);

export function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const card = ref.current;
    const opener = document.activeElement;
    const first = card?.querySelector<HTMLElement>(
      'input:not([type=checkbox]):not([readonly]), textarea',
    );
    (first ?? card)?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      // Hand focus back only when it would otherwise be lost; a click on another control keeps its focus.
      const lost = !now || now === document.body || !!card?.contains(now);
      const focusable = opener instanceof HTMLElement || opener instanceof SVGElement;
      if (lost && focusable && opener.isConnected) opener.focus();
    };
  }, []);
  const trap = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !ref.current) return;
    const items = Array.from(
      ref.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === ref.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="tk-modal" onKeyDown={trap}>
      <div
        ref={ref}
        className="m-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <div className="m-top">
          <b id={id}>{title}</b>
          <button className="x" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Foot({
  label,
  icon = 'plus',
  busy,
  disabled,
  extra,
  onCancel,
  onCreate,
}: {
  label: string;
  icon?: 'plus' | 'cal';
  busy: boolean;
  disabled?: boolean;
  extra?: ReactNode;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="m-foot">
      <button className="btn big" type="button" onClick={onCancel}>
        Cancel
      </button>
      {extra}
      <button
        className="btn btn-ink big"
        type="button"
        disabled={busy || disabled}
        onClick={onCreate}
      >
        <Icon name={icon} /> {label}
      </button>
    </div>
  );
}

export function KindGrid({ value, onPick }: { value: EventKind; onPick: (k: EventKind) => void }) {
  return (
    <div className="kinds" role="group" aria-label="Kind">
      {EVENT_KINDS.map((k) => (
        <button
          key={k}
          className={`kind${k === value ? ' on' : ''}`}
          type="button"
          aria-pressed={k === value}
          onClick={() => onPick(k)}
        >
          <KindIcon kind={k} size={18} />
          <span>{KIND_LABEL[k]}</span>
        </button>
      ))}
    </div>
  );
}

function PeopleSelect({
  state,
  value,
  onChange,
}: {
  state: TrackerState;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {state.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function ItemSelect({
  state,
  value,
  none,
  onChange,
}: {
  state: TrackerState;
  value: string;
  none?: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {none !== undefined && <option value="">{none}</option>}
      {state.workItems.map((w) => (
        <option key={w.id} value={w.id}>
          {trunc(w.title, 44)}
        </option>
      ))}
    </select>
  );
}

// An empty value means the person cleared the field; the last date stays, so every op gets a date.
function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      required
      value={value}
      onChange={(event) => event.target.value && onChange(event.target.value)}
    />
  );
}

const personOr = (state: TrackerState, id: string | null | undefined) =>
  id && state.people.some((p) => p.id === id) ? id : (state.people[0]?.id ?? '');

function Gone({ onClose }: { onClose: () => void }) {
  useEffect(() => onClose(), [onClose]);
  return null;
}

function EventQuote({
  text,
  kind,
  by,
  at,
  session,
}: {
  text: string;
  kind: EventKind;
  by: string;
  at: string;
  session: Session;
}) {
  return (
    <blockquote>
      <b>{KIND_LABEL[kind]}</b> · {session.dir.name(by)} · {formatStamp(at, session.tz)}
      <br />
      {text}
    </blockquote>
  );
}

function AddModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'add'>) {
  const tz = session.tz;
  const me = personOr(state, session.me);
  const [what, setWhat] = useState(modal.what);
  const [kind, setKind] = useState<EventKind>('message');
  const [text, setText] = useState('');
  const [by, setBy] = useState(me);
  const [when, setWhen] = useState(localInput(hourBefore(asOf, tz), tz));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [doneBy, setDoneBy] = useState(me);
  const [requestedBy, setRequestedBy] = useState(me);
  const [after, setAfter] = useState('');
  const [planned, setPlanned] = useState(weekAfter(asOf, tz));
  const create = () => {
    if (what === 'event') {
      const at = fromLocalInput(when, tz);
      if (!text.trim() || !at) return on.toast('Write what happened first.');
      return on.addToQueue({ kind: 'event', fields: { kind, at, by, text: text.trim() } });
    }
    if (!title.trim()) return on.toast('Give the work item a name.');
    on.addToQueue({
      kind: 'item',
      fields: {
        title: title.trim(),
        note: note.trim(),
        doneBy,
        requestedBy,
        milestoneId: null,
        after: after || null,
        plannedFinish: planned,
      },
    });
  };
  const seg = (value: 'event' | 'item', label: string) => (
    <button
      type="button"
      className={what === value ? 'on' : ''}
      aria-pressed={what === value}
      onClick={() => setWhat(value)}
    >
      {label}
    </button>
  );
  return (
    <ModalFrame title="Add to the queue" onClose={onClose}>
      <span className="srcs" role="group" aria-label="What to add">
        {seg('event', 'Event')}
        {seg('item', 'Work item')}
      </span>
      {what === 'event' ? (
        <>
          <p className="q-label">Kind</p>
          <KindGrid value={kind} onPick={setKind} />
          <label className="field">
            What happened?
            <textarea
              value={text}
              placeholder="For example: Lan sent the list of tax ID formats to Quang."
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="grid2">
            <label className="field">
              Who
              <PeopleSelect state={state} value={by} onChange={setBy} />
            </label>
            <label className="field">
              When
              <input
                type="datetime-local"
                value={when}
                onChange={(event) => event.target.value && setWhen(event.target.value)}
              />
            </label>
          </div>
          <Foot label="Add event" busy={busy} onCancel={onClose} onCreate={create} />
        </>
      ) : (
        <>
          <label className="field">
            Name
            <input
              value={title}
              placeholder="For example: PG-205 Tax ID error messages"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="field">
            Note
            <input
              value={note}
              placeholder="One line about the work"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="grid2">
            <label className="field">
              Done by
              <PeopleSelect state={state} value={doneBy} onChange={setDoneBy} />
            </label>
            <label className="field">
              For (requested by)
              <PeopleSelect state={state} value={requestedBy} onChange={setRequestedBy} />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              Leads from
              <ItemSelect state={state} value={after} none="Nothing" onChange={setAfter} />
            </label>
            <label className="field">
              Planned finish
              <DateInput value={planned} onChange={setPlanned} />
            </label>
          </div>
          <p className="tip">The work item waits in the Queue. Drag it onto a team to place it.</p>
          <Foot label="Add work item" busy={busy} onCancel={onClose} onCreate={create} />
        </>
      )}
    </ModalFrame>
  );
}

function RemoveFromQueue({ id, busy, on }: { id: string; busy: boolean; on: ModalHandlers }) {
  return (
    <button
      className="btn big btn-danger"
      type="button"
      disabled={busy}
      onClick={() => on.dismiss(id)}
    >
      <Icon name="trash" /> Remove from queue
    </button>
  );
}

function AttachModal({ modal, session, state, busy, on, onClose }: PropsOf<'attach'>) {
  const ev = state.queue.events.find((e) => e.id === modal.eventId);
  const open = state.workItems.find((w) => !itemInfo(w, state.events).done);
  const [workItemId, setWorkItemId] = useState(open?.id ?? state.workItems[0]?.id ?? '');
  const [teamId, setTeamId] = useState(state.teams[0]?.id ?? '');
  if (!ev) return <Gone onClose={onClose} />;
  return (
    <ModalFrame title="Add this event to a work item" onClose={onClose}>
      <EventQuote {...ev} session={session} />
      {state.workItems.length > 0 && (
        <label className="field">
          Work item
          <ItemSelect state={state} value={workItemId} onChange={setWorkItemId} />
        </label>
      )}
      {/* The click way to drop the event on a team: it starts a new work item there. */}
      <p className="q-label">Or start a new work item from it</p>
      <div className="share-add">
        <select
          aria-label="Team"
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
        >
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          type="button"
          disabled={!teamId}
          onClick={() => on.open({ mode: 'fromEvent', eventId: ev.id, teamId })}
        >
          <Icon name="plus" /> New work item
        </button>
      </div>
      <Foot
        label="Add to work item"
        busy={busy}
        disabled={!workItemId}
        extra={<RemoveFromQueue id={ev.id} busy={busy} on={on} />}
        onCancel={onClose}
        onCreate={() => on.commit([{ op: 'attach', a: { eventId: ev.id, workItemId } }])}
      />
    </ModalFrame>
  );
}

function PlaceModal({ modal, state, busy, on, onClose }: PropsOf<'placeItem'>) {
  const item = state.queue.items.find((x) => x.id === modal.itemId);
  const [teamId, setTeamId] = useState(state.teams[0]?.id ?? '');
  const [ms, setMs] = useState(item?.milestoneId ?? '');
  const [planned, setPlanned] = useState(item?.plannedFinish ?? '');
  if (!item) return <Gone onClose={onClose} />;
  const create = () => {
    const ops: OpInput[] = [];
    if (ms && ms !== item.milestoneId)
      ops.push({ op: 'qms', a: { itemId: item.id, milestoneId: ms } });
    ops.push({
      op: 'place',
      a: {
        itemId: item.id,
        teamId,
        ...(planned !== item.plannedFinish ? { plannedFinish: planned } : {}),
      },
    });
    on.commit(ops);
  };
  return (
    <ModalFrame title="Place this work item" onClose={onClose}>
      <blockquote>
        <b>{item.title}</b>
        <br />
        {item.note}
      </blockquote>
      <div className="grid2">
        <label className="field">
          Team
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {state.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Milestone
          <select value={ms} onChange={(event) => setMs(event.target.value)}>
            <option value="">No milestone</option>
            {state.milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Planned finish
          <DateInput value={planned} onChange={setPlanned} />
        </label>
      </div>
      <Foot
        label="Place work item"
        busy={busy}
        disabled={!teamId}
        extra={<RemoveFromQueue id={item.id} busy={busy} on={on} />}
        onCancel={onClose}
        onCreate={create}
      />
    </ModalFrame>
  );
}

function EventModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'event'>) {
  const tz = session.tz;
  const start = state.workItems.find((w) => w.id === modal.workItemId);
  const [workItemId, setWorkItemId] = useState(modal.workItemId);
  const [kind, setKind] = useState<EventKind>(modal.done ? 'done' : 'message');
  const [text, setText] = useState(modal.done ? 'Done.' : '');
  const [by, setBy] = useState(personOr(state, start?.requestedBy));
  const [when, setWhen] = useState(localInput(hourBefore(asOf, tz), tz));
  if (!start) return <Gone onClose={onClose} />;
  const create = () => {
    const at = fromLocalInput(when, tz);
    if (!text.trim() || !at) return on.toast('Write what happened first.');
    on.commit([
      {
        op: 'addEvent',
        a: { workItemId, ev: { id: newId(), kind, at, by, text: text.trim() } },
      },
    ]);
  };
  return (
    <ModalFrame title="Add an event" onClose={onClose}>
      <label className="field">
        Work item
        <ItemSelect state={state} value={workItemId} onChange={setWorkItemId} />
      </label>
      <p className="q-label">Kind</p>
      <KindGrid value={kind} onPick={setKind} />
      <label className="field">
        What happened?
        <textarea value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          Who
          <PeopleSelect state={state} value={by} onChange={setBy} />
        </label>
        <label className="field">
          When
          <input
            type="datetime-local"
            value={when}
            onChange={(event) => event.target.value && setWhen(event.target.value)}
          />
        </label>
      </div>
      <Foot label="Add event" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

function FromEventModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'fromEvent'>) {
  const tz = session.tz;
  const ev = state.queue.events.find((e) => e.id === modal.eventId);
  const lead = state.teams.find((t) => t.id === modal.teamId)?.leadId;
  const [teamId, setTeamId] = useState(modal.teamId);
  const [title, setTitle] = useState(ev ? trunc(ev.text, 50) : '');
  const [doneBy, setDoneBy] = useState(personOr(state, lead ?? session.me));
  const [requestedBy, setRequestedBy] = useState(personOr(state, ev?.by));
  const [after, setAfter] = useState('');
  const [planned, setPlanned] = useState(weekAfter(asOf, tz));
  const team = state.teams.find((t) => t.id === teamId);
  if (!ev || !team) return <Gone onClose={onClose} />;
  const create = () => {
    if (!title.trim()) return on.toast('Give the work item a name.');
    on.commit([
      {
        op: 'fromEvent',
        a: {
          id: newId(),
          eventId: ev.id,
          teamId,
          title: title.trim(),
          doneBy,
          requestedBy,
          after: after || null,
          plannedFinish: planned,
        },
      },
    ]);
  };
  return (
    <ModalFrame title={`New work item in ${team.name}`} onClose={onClose}>
      <EventQuote {...ev} session={session} />
      <div className="grid2">
        <label className="field">
          Name
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          Team
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            {state.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          Done by
          <PeopleSelect state={state} value={doneBy} onChange={setDoneBy} />
        </label>
        <label className="field">
          For (requested by)
          <PeopleSelect state={state} value={requestedBy} onChange={setRequestedBy} />
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          Leads from
          <ItemSelect state={state} value={after} none="Nothing" onChange={setAfter} />
        </label>
        <label className="field">
          Planned finish
          <DateInput value={planned} onChange={setPlanned} />
        </label>
      </div>
      <Foot label="Create work item" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

function MilestoneModal({ session, state, asOf, busy, on, onClose }: PropsOf<'ms'>) {
  const [name, setName] = useState('');
  const [planned, setPlanned] = useState(weekAfter(asOf, session.tz));
  const [time, setTime] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const toggle = (id: string, checked: boolean) =>
    setMembers((list) => (checked ? [...list, id] : list.filter((x) => x !== id)));
  const create = () => {
    if (!name.trim()) return on.toast('Give the milestone a name.');
    on.commit([
      {
        op: 'newMs',
        a: { id: newId(), name: name.trim(), planned, ...(time ? { time } : {}), members },
      },
    ]);
  };
  return (
    <ModalFrame title="New milestone" onClose={onClose}>
      <div className="grid2">
        <label className="field">
          Name
          <input
            value={name}
            placeholder="For example: CRS section live"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Planned date
          <DateInput value={planned} onChange={setPlanned} />
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          Time (optional)
          <TimeInput value={time} onChange={setTime} />
        </label>
        <p className="tip">Without a time, the deadline is the end of the day.</p>
      </div>
      <p className="q-label">Work items in it</p>
      <div className="pick">
        {state.workItems.map((w) => {
          const checked = members.includes(w.id);
          return (
            <label key={w.id} className={`pcard${checked ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => toggle(w.id, event.target.checked)}
              />{' '}
              {w.title}
            </label>
          );
        })}
        {!state.workItems.length && <p className="tip">No work item yet.</p>}
      </div>
      <Foot label="Create milestone" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

function TeamModal({ state, busy, on, onClose }: PropsOf<'team'>) {
  const [name, setName] = useState('');
  const [leadId, setLeadId] = useState('');
  const create = () => {
    const made = newTeamOp(state, { id: newId(), name, leadId });
    if (made.ok) on.commit([made.op]);
    else on.toast(made.message);
  };
  return (
    <ModalFrame title="New team" onClose={onClose}>
      <div className="grid2">
        <label className="field">
          Name
          <input
            value={name}
            maxLength={200}
            placeholder="For example: Design"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && create()}
          />
        </label>
        <label className="field">
          Lead (optional)
          <select value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            <option value="">No lead</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tip">
        The team gets its own lane. Its lead is the first choice for Done by on new work items.
      </p>
      <Foot label="Add team" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

function DueModal({ modal, session, state, busy, on, onClose }: PropsOf<'due'>) {
  const isMs = modal.kind === 'ms';
  const ms = isMs ? state.milestones.find((m) => m.id === modal.id) : undefined;
  const item = isMs ? undefined : state.workItems.find((w) => w.id === modal.id);
  const [date, setDate] = useState(modal.date);
  const [time, setTime] = useState(
    modal.time === undefined ? (ms?.plannedTime ?? '') : (modal.time ?? ''),
  );
  const [why, setWhy] = useState('');
  const target = ms
    ? {
        name: ms.name,
        cur: formatDeadline(ms.planned, ms.plannedTime),
        first: formatDeadline(ms.firstPlanned, ms.firstPlannedTime),
        same: date === ms.planned && time === (ms.plannedTime ?? ''),
      }
    : item
      ? {
          name: item.title,
          cur: formatDay(item.plannedFinish),
          first: formatDay(item.firstPlannedFinish),
          same: date === item.plannedFinish,
        }
      : null;
  if (!target) return <Gone onClose={onClose} />;
  const create = () => {
    if (!why.trim()) return on.toast('Write why the date moves.');
    if (target.same) return on.toast(isMs ? 'Pick a new date or time.' : 'Pick a new date.');
    const move = {
      date,
      why: why.trim(),
      by: session.me ?? 'nobody',
      at: toInstant(Date.now(), session.tz),
    };
    on.commit([
      isMs
        ? { op: 'msDate', a: { milestoneId: modal.id, ...move, ...(time ? { time } : {}) } }
        : { op: 'due', a: { workItemId: modal.id, ...move } },
    ]);
  };
  return (
    <ModalFrame
      title={isMs ? 'Move the milestone date' : 'Move the planned finish'}
      onClose={onClose}
    >
      <blockquote>
        <b>{target.name}</b>
        <br />
        Planned {target.cur}
        {target.first !== target.cur && ` · first planned ${target.first}`}
      </blockquote>
      <div className="grid2">
        <label className="field">
          New date
          <DateInput value={date} onChange={setDate} />
        </label>
        {isMs ? (
          <label className="field">
            Time (optional)
            <TimeInput value={time} onChange={setTime} />
          </label>
        ) : (
          <span />
        )}
      </div>
      <label className="field">
        Why does the date move? (required)
        <textarea
          value={why}
          required
          placeholder="For example: Lan sends the country list on 10 October, so the field ships on 14 October."
          onChange={(event) => setWhy(event.target.value)}
        />
      </label>
      <p className="tip">
        Everyone sees this reason in the history of this {isMs ? 'milestone' : 'work item'}, and the
        owner of Main sees it in the review.
      </p>
      <Foot
        label="Move the date"
        icon="cal"
        busy={busy}
        disabled={!why.trim()}
        onCancel={onClose}
        onCreate={create}
      />
    </ModalFrame>
  );
}

function NewCrModal({ session, busy, on, onClose }: PropsOf<'newcr'>) {
  const { dir, me, payload } = session;
  const [title, setTitle] = useState(() => `${(me ? dir.name(me) : 'My').split(' ')[0]}'s changes`);
  const create = () => {
    if (!title.trim()) return on.toast('Give the change request a name.');
    on.createCr(title.trim());
  };
  return (
    <ModalFrame title="New change request" onClose={onClose}>
      <label className="field">
        Name
        <input
          value={title}
          placeholder="For example: Root cause report for Sarah"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && create()}
        />
      </label>
      <p className="tip">
        It starts from the latest Main. Only you can edit it until you share it. When you finish,
        mark it as ready, and {dir.name(payload.project.ownerMemberId)} merges it into Main.
      </p>
      <Foot label="Create" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

export const shareLink = (origin: string, projectId: string, num: number) =>
  `${origin}/projects/${projectId}/graph?cr=${num}`;

function ShareModal({ session, cr, busy, on, onClose }: PropsOf<'share'>) {
  const { dir, payload, projectId } = session;
  const [who, setWho] = useState('');
  const [perm, setPerm] = useState<CrPermission>('edit');
  const linkRef = useRef<HTMLInputElement>(null);
  if (!cr) return <Gone onClose={onClose} />;
  const link = shareLink(window.location.origin, projectId, cr.num);
  const others = payload.members.filter(
    (m) => m.active && m.id !== cr.author && !cr.shares.some((s) => s.memberId === m.id),
  );
  const pick = who && others.some((m) => m.id === who) ? who : (others[0]?.id ?? '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      on.toast('Link copied.');
    } catch {
      linkRef.current?.select();
      on.toast('Copy the link from the box.');
    }
  };
  const hand = (id: string) =>
    id === cr.editor ? (
      <span className="chipx pen">Editing now</span>
    ) : (
      <button className="btn sm" type="button" disabled={busy} onClick={() => on.handOver(id)}>
        Hand over
      </button>
    );
  return (
    <ModalFrame title={`Share #${cr.num}`} onClose={onClose}>
      <div className="share-link">
        <Icon name="link" size={15} />
        <input ref={linkRef} readOnly value={link} aria-label="Link" />
        <button className="btn" type="button" onClick={() => void copy()}>
          Copy link
        </button>
      </div>
      <p className="q-label">People with access</p>
      <p className="tip" style={{ marginTop: -2 }}>
        Can edit gives the right to edit. One person edits at a time: the others ask, and the person
        who edits now hands over.
      </p>
      <div className="share-row">
        <Avatar id={cr.author} dir={dir} />
        <div>
          <b>{dir.name(cr.author)}</b>
          <small>{dir.role(cr.author)} · author</small>
        </div>
        {hand(cr.author)}
      </div>
      {cr.shares.map((s) => (
        <div className="share-row" key={s.memberId}>
          <Avatar id={s.memberId} dir={dir} />
          <div>
            <b>{dir.name(s.memberId)}</b>
            <small>{dir.role(s.memberId)}</small>
          </div>
          {s.permission === 'edit' && hand(s.memberId)}
          {s.memberId !== cr.editor && (
            <select
              aria-label={`Access for ${dir.name(s.memberId)}`}
              value={s.permission}
              disabled={busy}
              onChange={(event) =>
                on.share(s.memberId, event.target.value as CrPermission | 'remove')
              }
            >
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
              <option value="remove">Remove</option>
            </select>
          )}
        </div>
      ))}
      <div className="share-row">
        <span className="av all" aria-hidden="true">
          <KindIcon kind="meeting" size={16} />
        </span>
        <div>
          <b>Everyone in {payload.project.title}</b>
          <small>Anyone in the project with the link</small>
        </div>
        <span className="muted small">Can view</span>
      </div>
      {others.length > 0 && (
        <>
          <p className="q-label">Add a person</p>
          <div className="share-add">
            <select
              aria-label="Person"
              value={pick}
              onChange={(event) => setWho(event.target.value)}
            >
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Access"
              value={perm}
              onChange={(event) => setPerm(event.target.value as CrPermission)}
            >
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
            </select>
            <button
              className="btn btn-ink"
              type="button"
              disabled={busy || !pick}
              onClick={() => on.share(pick, perm)}
            >
              Add
            </button>
          </div>
        </>
      )}
      <div className="m-foot">
        <button className="btn big" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </ModalFrame>
  );
}

export function Modal(props: Props) {
  const { modal } = props;
  switch (modal.mode) {
    case 'add':
      return <AddModal {...props} modal={modal} />;
    case 'attach':
      return <AttachModal {...props} modal={modal} />;
    case 'placeItem':
      return <PlaceModal {...props} modal={modal} />;
    case 'event':
      return <EventModal {...props} modal={modal} />;
    case 'fromEvent':
      return <FromEventModal {...props} modal={modal} />;
    case 'ms':
      return <MilestoneModal {...props} modal={modal} />;
    case 'team':
      return <TeamModal {...props} modal={modal} />;
    case 'due':
      return <DueModal {...props} modal={modal} />;
    case 'newcr':
      return <NewCrModal {...props} modal={modal} />;
    case 'share':
      return <ShareModal {...props} modal={modal} />;
  }
}
