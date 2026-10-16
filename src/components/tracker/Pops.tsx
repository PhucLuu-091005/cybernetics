'use client';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  formatDay,
  formatStamp,
  itemInfo,
  itemStatus,
  KIND_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type DateMove,
  type TrackerState,
} from '../../tracker';
import type { Directory } from './avatar';
import { Icon, KindIcon, type IconName } from './icons';
import { KindGrid } from './Modals';
import type { PopKind } from './TrackerGraph';
import type { TrackerActions } from './TrackerScreen';

export type PopTarget = {
  kind: PopKind | 'kind' | 'rename' | 'added';
  id: string;
  anchor: Element;
};

type Common = {
  state: TrackerState;
  dir: Directory;
  tz: string;
  asOf: string;
  actions: TrackerActions;
  onClose: () => void;
  onHideRow: (workItemId: string) => void;
};

export function Moves({
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
  if (!moves.length) return <p className="tip">The date never moved.</p>;
  return (
    <>
      <p className="q-label">
        First planned {formatDay(first)} · moved {moves.length}×
      </p>
      <ol className="moves">
        {[...moves].reverse().map((mv, i) => (
          <li key={`${mv.at}-${i}`}>
            <b>
              {formatDay(mv.from)} → {formatDay(mv.to)}
            </b>
            <span>{mv.why}</span>
            <small>
              {dir.name(mv.by)} · {formatStamp(mv.at, tz)}
            </small>
          </li>
        ))}
      </ol>
    </>
  );
}

function PopFrame({
  target,
  container,
  label,
  icon,
  head,
  focusSelf = true,
  onClose,
  children,
}: {
  target: PopTarget;
  container: RefObject<HTMLDivElement | null>;
  label: string;
  icon: ReactNode;
  head: ReactNode;
  focusSelf?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pop = ref.current;
    const box = container.current;
    if (!pop || !box) return;
    const r = target.anchor.getBoundingClientRect();
    const w = box.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(r.left - w.left + r.width / 2 - pop.offsetWidth / 2, w.width - pop.offsetWidth - 8),
    );
    let top = r.bottom - w.top + 8;
    if (top + pop.offsetHeight > w.height - 8)
      top = Math.max(8, r.top - w.top - pop.offsetHeight - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = 'visible';
    if (focusSelf) pop.focus({ preventScroll: true });
  }, [target, container, focusSelf]);
  return (
    <div
      ref={ref}
      className="pop"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{ visibility: 'hidden' }}
    >
      <div className="pop-h">
        {icon}
        <div>{head}</div>
        <button className="x" type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

function Btn({
  icon,
  kind,
  label,
  tone,
  onClick,
}: {
  icon?: IconName;
  kind?: 'done';
  label: string;
  tone?: 'ink' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      className={`btn${tone === 'ink' ? ' btn-ink' : tone === 'danger' ? ' btn-danger' : ''}`}
      type="button"
      onClick={onClick}
    >
      {kind ? <KindIcon kind={kind} /> : icon ? <Icon name={icon} /> : null} {label}
    </button>
  );
}

const ring = (color: string, children: ReactNode) => (
  <span className="pi" style={{ color }}>
    {children}
  </span>
);

function ActPop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const ev = c.state.events.find((e) => e.id === target.id);
  if (!ev) return null;
  const item = c.state.workItems.find((w) => w.id === ev.workItemId);
  const stamp = formatStamp(ev.at, c.tz);
  return (
    <PopFrame
      target={target}
      container={container}
      label={`${KIND_LABEL[ev.kind]} by ${c.dir.name(ev.by)}`}
      icon={ring('var(--route)', <KindIcon kind={ev.kind} size={15} />)}
      head={
        <>
          <b>{KIND_LABEL[ev.kind]}</b> by {c.dir.name(ev.by)}
          <small>
            {stamp} · {item?.title}
          </small>
        </>
      }
      onClose={c.onClose}
    >
      <blockquote>{ev.text}</blockquote>
      <div className="pop-btns">
        <Btn icon="tag" label="Change kind" onClick={() => c.actions.changeKind(ev.id)} />
        <Btn
          icon="move"
          label="Move to another work item"
          onClick={() => c.actions.moveEvent(ev.id)}
        />
        <Btn
          icon="eyeoff"
          label="Hide this event"
          tone="danger"
          onClick={() => c.actions.hideEvent(ev.id)}
        />
      </div>
      <p className="tip">
        Tip: drag an event up or down to another work item. Drag it to the bin to hide it.
      </p>
    </PopFrame>
  );
}

function LoopPop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const item = c.state.workItems.find((w) => w.id === target.id);
  if (!item) return null;
  const info = itemInfo(item, c.state.events);
  const status = itemStatus(item, c.state.events, c.asOf, c.tz);
  const team = c.state.teams.find((t) => t.id === item.teamId)?.name ?? '';
  const milestone = c.state.milestones.find((m) => m.id === item.milestoneId);
  const after = item.after
    .map((id) => c.state.workItems.find((w) => w.id === id)?.title ?? '')
    .join(', ');
  return (
    <PopFrame
      target={target}
      container={container}
      label={item.title}
      icon={ring(info.done ? 'var(--proceed)' : 'var(--route)', <Icon name="loop" size={15} />)}
      head={
        <>
          <b>{item.title}</b>
          <small>
            {team} · done by {c.dir.name(item.doneBy)} · for {c.dir.name(item.requestedBy)}
          </small>
          <small>
            Planned finish {formatDay(item.plannedFinish)} · {STATUS_LABEL[status]}
            {item.moves.length > 0 && ` · moved ${item.moves.length}×`}
          </small>
          <small>
            {milestone ? `Milestone: ${milestone.name}` : 'No milestone'}
            {item.after.length > 0 && ` · after ${after}`}
          </small>
        </>
      }
      onClose={c.onClose}
    >
      <div className="pop-btns">
        {!info.done && (
          <>
            <Btn
              icon="plus"
              label="Add an event"
              tone="ink"
              onClick={() => c.actions.addEvent(item.id)}
            />
            <Btn kind="done" label="Mark done" onClick={() => c.actions.markDone(item.id)} />
          </>
        )}
        <Btn
          icon="cal"
          label="Move the date"
          onClick={() => c.actions.moveDate({ kind: 'item', id: item.id })}
        />
        <Btn icon="pencil" label="Rename" onClick={() => c.actions.rename(item.id)} />
        <Btn icon="eyeoff" label="Hide from the graph" onClick={() => c.onHideRow(item.id)} />
      </div>
    </PopFrame>
  );
}

function DuePop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const item = c.state.workItems.find((w) => w.id === target.id);
  if (!item) return null;
  const status = itemStatus(item, c.state.events, c.asOf, c.tz);
  const day = formatDay(item.plannedFinish);
  return (
    <PopFrame
      target={target}
      container={container}
      label={`Planned finish ${day}`}
      icon={ring(`var(--${STATUS_TONE[status]})`, <Icon name="flag" size={15} />)}
      head={
        <>
          <b>Planned finish · {day}</b>
          <small>{item.title}</small>
        </>
      }
      onClose={c.onClose}
    >
      <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
      <Moves moves={item.moves} first={item.firstPlannedFinish} dir={c.dir} tz={c.tz} />
      <div className="pop-btns" style={{ marginTop: 10 }}>
        <Btn
          icon="cal"
          label="Move the date"
          tone="ink"
          onClick={() => c.actions.moveDate({ kind: 'item', id: item.id })}
        />
      </div>
      <p className="tip">Tip: drag the date mark left or right. The app asks why.</p>
    </PopFrame>
  );
}

function KindPop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const ev = c.state.events.find((e) => e.id === target.id);
  if (!ev) return null;
  return (
    <PopFrame
      target={target}
      container={container}
      label="What kind of event is it?"
      icon={null}
      head={<b>What kind of event is it?</b>}
      onClose={c.onClose}
    >
      <KindGrid value={ev.kind} onPick={(kind) => c.actions.setKind(ev.id, kind)} />
    </PopFrame>
  );
}

function RenamePop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const item = c.state.workItems.find((w) => w.id === target.id);
  const [title, setTitle] = useState(item?.title ?? '');
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  if (!item) return null;
  const save = () => c.actions.saveRename(item.id, title.trim());
  return (
    <PopFrame
      target={target}
      container={container}
      label="New name"
      icon={null}
      head={<b>New name</b>}
      focusSelf={false}
      onClose={c.onClose}
    >
      <input
        ref={input}
        className="sel"
        aria-label="Work item name"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          save();
        }}
      />
      <div className="m-foot">
        <Btn icon="check" label="Save name" tone="ink" onClick={save} />
      </div>
    </PopFrame>
  );
}

function AddedPop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const ev = c.state.events.find((e) => e.id === target.id);
  if (!ev) return null;
  const item = c.state.workItems.find((w) => w.id === ev.workItemId);
  return (
    <PopFrame
      target={target}
      container={container}
      label={`Added a ${KIND_LABEL[ev.kind]}`}
      icon={ring('var(--draft)', <KindIcon kind={ev.kind} size={15} />)}
      head={
        <>
          <b>Added a {KIND_LABEL[ev.kind]}</b> by {c.dir.name(ev.by)}
          <small>
            {formatStamp(ev.at, c.tz)} · {item?.title}
          </small>
        </>
      }
      onClose={c.onClose}
    >
      <div className="pop-btns">
        <Btn
          icon="tag"
          label="Another kind? Change it"
          onClick={() => c.actions.changeKind(ev.id)}
        />
        <Btn icon="undo" label="Undo" onClick={c.actions.undo} />
      </div>
    </PopFrame>
  );
}

export function Pop(
  props: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> },
) {
  switch (props.target.kind) {
    case 'act':
      return <ActPop {...props} />;
    case 'due':
      return <DuePop {...props} />;
    case 'kind':
      return <KindPop {...props} />;
    case 'rename':
      return <RenamePop {...props} />;
    case 'added':
      return <AddedPop {...props} />;
    default:
      return <LoopPop {...props} />;
  }
}
