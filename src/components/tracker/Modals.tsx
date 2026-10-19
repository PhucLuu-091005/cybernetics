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
  can,
  addDays,
  dayOf,
  formatDeadline,
  formatStamp,
  itemInfo,
  KIND_GROUPS,
  KIND_LABEL,
  kindText,
  pickable,
  toInstant,
  wallTimeInstant,
  defaultWho,
  eventDefaultAt,
  type Cr,
  type Member,
  type CrPermission,
  type EventKind,
  type Person,
  type TrackerState,
  TEXT_MAX,
} from '../../tracker';
import type { OpInput, QueueEntry } from './api';
import { Avatar } from './avatar';
import { mergerNames, trunc, type Session } from './ContextBar';
import { Checkbox } from './Checkbox';
import { Select } from './Select';
import { Icon, KindIcon } from './icons';
import { newTeamOp } from './team';
import { DateInput } from './DateInput';
import { DateTimeInput } from './DateTimeInput';
import { TimeInput } from './TimeInput';
import { TextCount } from './TextCount';

export type ModalState =
  | { mode: 'add'; what: 'event' | 'item' }
  | { mode: 'attach'; eventId: string }
  | { mode: 'placeItem'; itemId: string }
  | { mode: 'event'; workItemId: string; done?: boolean; cancel?: boolean }
  | { mode: 'fromEvent'; eventId: string; teamId: string }
  | { mode: 'ms' }
  | { mode: 'team' }
  /** Absent `time` keeps the current time of the milestone or the planned finish. */
  | { mode: 'due'; kind: 'item' | 'ms'; id: string; date: string; time?: string | null }
  | { mode: 'newcr' }
  | { mode: 'share' }
  | { mode: 'cancelCr' }
  | { mode: 'requestChanges' };

export type ModalHandlers = {
  toast: (text: string) => void;
  open: (modal: ModalState) => void;
  addToQueue: (entry: QueueEntry) => void;
  dismiss: (queueId: string) => void;
  commit: (ops: OpInput[]) => void;
  createCr: (title: string) => void;
  share: (memberId: string, permission: CrPermission | 'remove') => void;
  handOver: (memberId: string) => void;
  cancelCr: (reason: string) => void;
  requestChanges: (note: string) => void;
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

const newId = () => crypto.randomUUID();

/** A `datetime-local` value is wall time in the project time zone. */
export const localInput = (instant: string, tz: string) =>
  toInstant(Date.parse(instant), tz).slice(0, 16);
export function fromLocalInput(value: string, tz: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  return match ? wallTimeInstant(match[1], match[2], tz) : null;
}
const defaultWhen = (session: Session) =>
  localInput(eventDefaultAt(session.payload.project.asOf, Date.now(), session.tz), session.tz);
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
  cancelLabel = 'Cancel',
  onCancel,
  onCreate,
}: {
  label: string;
  icon?: 'plus' | 'cal';
  busy: boolean;
  disabled?: boolean;
  extra?: ReactNode;
  cancelLabel?: string;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="m-foot">
      <button className="btn big" type="button" onClick={onCancel}>
        {cancelLabel}
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
    <div className="kind-groups" role="group" aria-label="Kind">
      {KIND_GROUPS.map((group) => (
        <div key={group.label} className="kind-group" role="group" aria-label={group.label}>
          <span className="kg-label" aria-hidden="true">
            {group.label}
          </span>
          <div className="kinds">
            {group.kinds.map((k) => (
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
        </div>
      ))}
    </div>
  );
}

export function FinishesCheck({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox className="check" checked={checked} disabled={disabled} onChange={onChange}>
      This finishes the work item
    </Checkbox>
  );
}

function EventText({
  kind,
  value,
  placeholder,
  onChange,
}: {
  kind: EventKind;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const cancel = kind === 'cancelled';
  return (
    <label className="field">
      {cancel ? 'Why is it cancelled? (required)' : 'What happened?'}
      <textarea
        value={value}
        required={cancel}
        maxLength={TEXT_MAX.body}
        placeholder={cancel ? 'For example: The client keeps the free text field.' : placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <TextCount value={value} max={TEXT_MAX.body} />
    </label>
  );
}

const finishFields = (kind: EventKind, finishes: boolean) =>
  kind === 'handoff' && finishes ? { finishes: true } : {};

function PeopleSelect({
  label,
  people,
  value,
  onChange,
}: {
  label: string;
  people: readonly Person[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={onChange}
      options={people.map((p) => ({ value: p.id, label: p.name }))}
    />
  );
}

function ItemSelect({
  label,
  state,
  value,
  none,
  onChange,
}: {
  label: string;
  state: TrackerState;
  value: string;
  none?: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={onChange}
      options={[
        ...(none !== undefined ? [{ value: '', label: none }] : []),
        ...state.workItems.map((w) => ({ value: w.id, label: trunc(w.title, 44) })),
      ]}
    />
  );
}

const blankText = (kind: EventKind) =>
  kind === 'cancelled' ? 'Write why the work item is cancelled.' : 'Write what happened first.';

const personOr = (people: readonly Person[], id: string | null | undefined) =>
  id && people.some((p) => p.id === id) ? id : (people[0]?.id ?? '');

function Gone({ onClose }: { onClose: () => void }) {
  useEffect(() => onClose(), [onClose]);
  return null;
}

function EventQuote({
  text,
  kind,
  finishes,
  by,
  at,
  session,
}: {
  text: string;
  kind: EventKind;
  finishes?: boolean;
  by: string;
  at: string;
  session: Session;
}) {
  return (
    <blockquote>
      <b>{kindText({ kind, finishes })}</b> · {session.dir.name(by)} · {formatStamp(at, session.tz)}
      <br />
      {text}
    </blockquote>
  );
}

function AddModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'add'>) {
  const tz = session.tz;
  const people = pickable(state.people, session.payload.members);
  const me = personOr(people, session.me);
  const [what, setWhat] = useState(modal.what);
  const [kind, setKind] = useState<EventKind>('message');
  const [finishes, setFinishes] = useState(true);
  const [text, setText] = useState('');
  const [by, setBy] = useState(me);
  const [when, setWhen] = useState(() => defaultWhen(session));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [doneBy, setDoneBy] = useState(me);
  const [requestedBy, setRequestedBy] = useState(me);
  const [after, setAfter] = useState('');
  const [planned, setPlanned] = useState(weekAfter(asOf, tz));
  const [plannedTime, setPlannedTime] = useState('');
  const create = () => {
    if (what === 'event') {
      const at = fromLocalInput(when, tz);
      if (!text.trim() || !at) return on.toast(blankText(kind));
      return on.addToQueue({
        kind: 'event',
        fields: { kind, at, by, text: text.trim(), ...finishFields(kind, finishes) },
      });
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
        ...(plannedTime ? { plannedFinishTime: plannedTime } : {}),
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
          <div className="field">
            Kind
            <KindGrid value={kind} onPick={setKind} />
          </div>
          {kind === 'handoff' && <FinishesCheck checked={finishes} onChange={setFinishes} />}
          <EventText
            kind={kind}
            value={text}
            placeholder="For example: Lan sent the list of tax ID formats to Quang."
            onChange={setText}
          />
          <div className="grid2">
            <label className="field">
              Who
              <PeopleSelect label="Who" people={people} value={by} onChange={setBy} />
            </label>
            <div className="field">
              When
              <DateTimeInput label="When" value={when} today={dayOf(asOf, tz)} onChange={setWhen} />
            </div>
          </div>
          <Foot label="Add event" busy={busy} onCancel={onClose} onCreate={create} />
        </>
      ) : (
        <>
          <label className="field">
            Name
            <input
              value={title}
              maxLength={TEXT_MAX.title}
              placeholder="For example: PG-205 Tax ID error messages"
              onChange={(event) => setTitle(event.target.value)}
            />
            <TextCount value={title} max={TEXT_MAX.title} />
          </label>
          <label className="field">
            Note
            <input
              value={note}
              maxLength={TEXT_MAX.note}
              placeholder="One line about the work"
              onChange={(event) => setNote(event.target.value)}
            />
            <TextCount value={note} max={TEXT_MAX.note} />
          </label>
          <div className="grid2">
            <label className="field">
              Done by
              <PeopleSelect label="Done by" people={people} value={doneBy} onChange={setDoneBy} />
            </label>
            <label className="field">
              For (requested by)
              <PeopleSelect
                label="For (requested by)"
                people={people}
                value={requestedBy}
                onChange={setRequestedBy}
              />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              Leads from
              <ItemSelect
                label="Leads from"
                state={state}
                value={after}
                none="Nothing"
                onChange={setAfter}
              />
            </label>
            <label className="field">
              Planned finish
              <DateInput
                label="Planned finish"
                today={dayOf(asOf, tz)}
                value={planned}
                onChange={setPlanned}
              />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              Time (optional)
              <TimeInput value={plannedTime} onChange={setPlannedTime} />
            </label>
            <p className="tip">Without a time, the planned finish is the end of the day.</p>
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
          <ItemSelect label="Work item" state={state} value={workItemId} onChange={setWorkItemId} />
        </label>
      )}
      {/* The click way to drop the event on a team: it starts a new work item there. */}
      <p className="q-label">Or start a new work item from it</p>
      <div className="share-add">
        <Select
          label="Team"
          value={teamId}
          onChange={setTeamId}
          options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
        />
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

function PlaceModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'placeItem'>) {
  const item = state.queue.items.find((x) => x.id === modal.itemId);
  const [teamId, setTeamId] = useState(state.teams[0]?.id ?? '');
  const [ms, setMs] = useState(item?.milestoneId ?? '');
  const [planned, setPlanned] = useState(item?.plannedFinish ?? '');
  const [plannedTime, setPlannedTime] = useState(item?.plannedFinishTime ?? '');
  if (!item) return <Gone onClose={onClose} />;
  const create = () => {
    const ops: OpInput[] = [];
    if (ms && ms !== item.milestoneId)
      ops.push({ op: 'qms', a: { itemId: item.id, milestoneId: ms } });
    const moved = planned !== item.plannedFinish || plannedTime !== (item.plannedFinishTime ?? '');
    ops.push({
      op: 'place',
      a: {
        itemId: item.id,
        teamId,
        ...(moved ? { plannedFinish: planned } : {}),
        ...(moved && plannedTime ? { plannedFinishTime: plannedTime } : {}),
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
          <Select
            label="Team"
            value={teamId}
            onChange={setTeamId}
            options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
          />
        </label>
        <label className="field">
          Milestone
          <Select
            label="Milestone"
            value={ms}
            onChange={setMs}
            options={[
              { value: '', label: 'No milestone' },
              ...state.milestones.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </label>
        <label className="field">
          Planned finish
          <DateInput
            label="Planned finish"
            today={dayOf(asOf, session.tz)}
            value={planned}
            onChange={setPlanned}
          />
        </label>
        <label className="field">
          Time (optional)
          <TimeInput value={plannedTime} onChange={setPlannedTime} />
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
  const people = pickable(state.people, session.payload.members);
  const start = state.workItems.find((w) => w.id === modal.workItemId);
  const [workItemId, setWorkItemId] = useState(modal.workItemId);
  const [kind, setKind] = useState<EventKind>(
    modal.cancel ? 'cancelled' : modal.done ? 'done' : 'message',
  );
  const [finishes, setFinishes] = useState(true);
  const [text, setText] = useState(modal.done ? 'Done.' : '');
  const [picked, setBy] = useState<string | null>(null);
  const [when, setWhen] = useState(() => defaultWhen(session));
  if (!start) return <Gone onClose={onClose} />;
  const item = state.workItems.find((w) => w.id === workItemId) ?? start;
  const by =
    picked ??
    personOr(
      people,
      defaultWho(
        item,
        kind,
        session.me,
        people.map((p) => p.id),
      ),
    );
  const create = () => {
    const at = fromLocalInput(when, tz);
    if (!text.trim() || !at) return on.toast(blankText(kind));
    on.commit([
      {
        op: 'addEvent',
        a: {
          workItemId,
          ev: { id: newId(), kind, at, by, text: text.trim(), ...finishFields(kind, finishes) },
        },
      },
    ]);
  };
  return (
    <ModalFrame title={modal.cancel ? 'Cancel this work item' : 'Add an event'} onClose={onClose}>
      <label className="field">
        Work item
        <ItemSelect label="Work item" state={state} value={workItemId} onChange={setWorkItemId} />
      </label>
      <div className="field">
        Kind
        <KindGrid value={kind} onPick={setKind} />
      </div>
      {kind === 'handoff' && <FinishesCheck checked={finishes} onChange={setFinishes} />}
      <EventText kind={kind} value={text} onChange={setText} />
      <div className="grid2">
        <label className="field">
          Who
          <PeopleSelect label="Who" people={people} value={by} onChange={setBy} />
        </label>
        <div className="field">
          When
          <DateTimeInput label="When" value={when} today={dayOf(asOf, tz)} onChange={setWhen} />
        </div>
      </div>
      <Foot
        label={modal.cancel && kind === 'cancelled' ? 'Cancel work item' : 'Add event'}
        cancelLabel={modal.cancel ? 'Back' : 'Cancel'}
        busy={busy}
        onCancel={onClose}
        onCreate={create}
      />
    </ModalFrame>
  );
}

function FromEventModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'fromEvent'>) {
  const tz = session.tz;
  const people = pickable(state.people, session.payload.members);
  const ev = state.queue.events.find((e) => e.id === modal.eventId);
  const lead = state.teams.find((t) => t.id === modal.teamId)?.leadId;
  const [teamId, setTeamId] = useState(modal.teamId);
  const [title, setTitle] = useState(ev ? trunc(ev.text, 50) : '');
  const [doneBy, setDoneBy] = useState(personOr(people, lead ?? session.me));
  const [requestedBy, setRequestedBy] = useState(personOr(people, ev?.by));
  const [after, setAfter] = useState('');
  const [planned, setPlanned] = useState(weekAfter(asOf, tz));
  const [plannedTime, setPlannedTime] = useState('');
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
          ...(plannedTime ? { plannedFinishTime: plannedTime } : {}),
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
          <input
            value={title}
            maxLength={TEXT_MAX.title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <TextCount value={title} max={TEXT_MAX.title} />
        </label>
        <label className="field">
          Team
          <Select
            label="Team"
            value={teamId}
            onChange={setTeamId}
            options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
          />
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          Done by
          <PeopleSelect label="Done by" people={people} value={doneBy} onChange={setDoneBy} />
        </label>
        <label className="field">
          For (requested by)
          <PeopleSelect
            label="For (requested by)"
            people={people}
            value={requestedBy}
            onChange={setRequestedBy}
          />
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          Leads from
          <ItemSelect
            label="Leads from"
            state={state}
            value={after}
            none="Nothing"
            onChange={setAfter}
          />
        </label>
        <label className="field">
          Planned finish
          <DateInput
            label="Planned finish"
            today={dayOf(asOf, tz)}
            value={planned}
            onChange={setPlanned}
          />
        </label>
      </div>
      <div className="grid2">
        <label className="field">
          Time (optional)
          <TimeInput value={plannedTime} onChange={setPlannedTime} />
        </label>
        <p className="tip">Without a time, the planned finish is the end of the day.</p>
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
            maxLength={TEXT_MAX.title}
            placeholder="For example: CRS section live"
            onChange={(event) => setName(event.target.value)}
          />
          <TextCount value={name} max={TEXT_MAX.title} />
        </label>
        <label className="field">
          Planned date
          <DateInput
            label="Planned date"
            today={dayOf(asOf, session.tz)}
            value={planned}
            onChange={setPlanned}
          />
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
            <Checkbox
              key={w.id}
              className={`pcard${checked ? ' on' : ''}`}
              checked={checked}
              onChange={(on) => toggle(w.id, on)}
            >
              {w.title}
            </Checkbox>
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
  const create = () => {
    const made = newTeamOp(state, { id: newId(), name });
    if (made.ok) on.commit([made.op]);
    else on.toast(made.message);
  };
  return (
    <ModalFrame title="New team" onClose={onClose}>
      <label className="field">
        Name
        <input
          value={name}
          maxLength={TEXT_MAX.title}
          placeholder="For example: Design"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && create()}
        />
        <TextCount value={name} max={TEXT_MAX.title} />
      </label>
      <p className="tip">
        The team gets its own lane. After the merge, the project lead picks its lead and people on
        the Members page.
      </p>
      <Foot label="Add team" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

function DueModal({ modal, session, state, asOf, busy, on, onClose }: PropsOf<'due'>) {
  const isMs = modal.kind === 'ms';
  const ms = isMs ? state.milestones.find((m) => m.id === modal.id) : undefined;
  const item = isMs ? undefined : state.workItems.find((w) => w.id === modal.id);
  const [date, setDate] = useState(modal.date);
  const [time, setTime] = useState(
    modal.time === undefined
      ? ((ms ? ms.plannedTime : item?.plannedFinishTime) ?? '')
      : (modal.time ?? ''),
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
          cur: formatDeadline(item.plannedFinish, item.plannedFinishTime),
          first: formatDeadline(item.firstPlannedFinish, item.firstPlannedFinishTime),
          same: date === item.plannedFinish && time === (item.plannedFinishTime ?? ''),
        }
      : null;
  if (!target) return <Gone onClose={onClose} />;
  const create = () => {
    if (!why.trim()) return on.toast('Write why the date moves.');
    if (target.same) return on.toast('Pick a new date or time.');
    const move = {
      date,
      ...(time ? { time } : {}),
      why: why.trim(),
      by: session.me ?? 'nobody',
      at: toInstant(Date.now(), session.tz),
    };
    on.commit([
      isMs
        ? { op: 'msDate', a: { milestoneId: modal.id, ...move } }
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
          <DateInput
            label="New date"
            today={dayOf(asOf, session.tz)}
            value={date}
            onChange={setDate}
          />
        </label>
        <label className="field">
          Time (optional)
          <TimeInput value={time} onChange={setTime} />
        </label>
      </div>
      <label className="field">
        Why does the date move? (required)
        <textarea
          value={why}
          required
          maxLength={TEXT_MAX.why}
          placeholder="For example: Lan sends the country list on 10 October, so the field ships on 14 October."
          onChange={(event) => setWhy(event.target.value)}
        />
        <TextCount value={why} max={TEXT_MAX.why} />
      </label>
      <p className="tip">
        Everyone sees this reason in the history of this {isMs ? 'milestone' : 'work item'}, and the
        person who merges sees it in the review.
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
  const { dir, me } = session;
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
          maxLength={TEXT_MAX.title}
          placeholder="For example: Root cause report for Sarah"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && create()}
        />
        <TextCount value={title} max={TEXT_MAX.title} />
      </label>
      <p className="tip">
        It starts from the latest Main. Only you can edit it until you share it. When you finish,
        mark it as ready, and {mergerNames(session)} merges it into Main.
      </p>
      <Foot label="Create" busy={busy} onCancel={onClose} onCreate={create} />
    </ModalFrame>
  );
}

export const shareLink = (origin: string, projectId: string, num: number) =>
  `${origin}/projects/${projectId}/changes/${num}`;

function NoteModal({
  title,
  label,
  placeholder,
  tip,
  action,
  keep,
  danger,
  busy,
  onClose,
  onSend,
}: {
  title: string;
  label: string;
  placeholder: string;
  tip: string;
  action: string;
  keep: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const value = text.trim();
  return (
    <ModalFrame title={title} onClose={onClose}>
      <label className="field">
        {label}
        <textarea
          value={text}
          maxLength={TEXT_MAX.why}
          required
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
        />
        <TextCount value={text} max={TEXT_MAX.why} />
      </label>
      <p className="tip">{tip}</p>
      <div className="m-foot">
        <button className="btn big" type="button" onClick={onClose}>
          {keep}
        </button>
        <button
          className={`btn big ${danger ? 'btn-stop' : 'btn-ink'}`}
          type="button"
          disabled={busy || !value}
          onClick={() => onSend(value)}
        >
          {action}
        </button>
      </div>
    </ModalFrame>
  );
}

function CancelCrModal({ cr, busy, on, onClose }: PropsOf<'cancelCr'>) {
  if (!cr) return <Gone onClose={onClose} />;
  return (
    <NoteModal
      title={`Cancel #${cr.num}?`}
      label="Reason"
      placeholder="For example: Main has these dates already."
      tip="Nothing from it goes into Main. Everyone sees the reason in its header and in History."
      action="Cancel change request"
      keep="Keep it"
      danger
      busy={busy}
      onClose={onClose}
      onSend={on.cancelCr}
    />
  );
}

function RequestChangesModal({ cr, session, busy, on, onClose }: PropsOf<'requestChanges'>) {
  if (!cr) return <Gone onClose={onClose} />;
  return (
    <NoteModal
      title={`Request changes on #${cr.num}`}
      label="What should change?"
      placeholder="For example: add the date Daniel promised for the report."
      tip={`#${cr.num} goes back to draft, and ${session.dir.name(cr.editor)} sees your note in its header.`}
      action="Send back to draft"
      keep="Cancel"
      busy={busy}
      onClose={onClose}
      onSend={on.requestChanges}
    />
  );
}

export const shareCandidates = (members: readonly Member[], cr: Cr) =>
  members.filter(
    (m) =>
      m.active &&
      m.id !== cr.author &&
      m.id !== cr.editor &&
      !cr.shares.some((s) => s.memberId === m.id),
  );

function ShareModal({ session, cr, busy, on, onClose }: PropsOf<'share'>) {
  const { dir, payload, projectId } = session;
  const [who, setWho] = useState('');
  const [perm, setPerm] = useState<CrPermission>('edit');
  const linkRef = useRef<HTMLInputElement>(null);
  if (!cr) return <Gone onClose={onClose} />;
  const link = shareLink(window.location.origin, projectId, cr.num);
  const others = shareCandidates(payload.members, cr);
  const pick = who && others.some((m) => m.id === who) ? who : (others[0]?.id ?? '');
  const creates = (id: string) => {
    const member = payload.members.find((m) => m.id === id);
    return !!member && can({ ...payload, me: member }, 'create');
  };
  const access: CrPermission = perm === 'edit' && creates(pick) ? 'edit' : 'view';
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
            <Select
              label={`Access for ${dir.name(s.memberId)}`}
              value={s.permission}
              disabled={busy}
              onChange={(next) => on.share(s.memberId, next as CrPermission | 'remove')}
              options={[
                ...(s.permission === 'edit' || creates(s.memberId)
                  ? [{ value: 'edit', label: 'Can edit' }]
                  : []),
                { value: 'view', label: 'Can view' },
                { value: 'remove', label: 'Remove' },
              ]}
            />
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
            <Select
              label="Person"
              className="grow"
              value={pick}
              onChange={setWho}
              options={others.map((m) => ({ value: m.id, label: m.name }))}
            />
            <Select
              label="Access"
              value={access}
              onChange={(next) => setPerm(next as CrPermission)}
              options={[
                ...(creates(pick) ? [{ value: 'edit', label: 'Can edit' }] : []),
                { value: 'view', label: 'Can view' },
              ]}
            />
            <button
              className="btn btn-ink"
              type="button"
              disabled={busy || !pick}
              onClick={() => on.share(pick, access)}
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
    case 'cancelCr':
      return <CancelCrModal {...props} modal={modal} />;
    case 'requestChanges':
      return <RequestChangesModal {...props} modal={modal} />;
  }
}
