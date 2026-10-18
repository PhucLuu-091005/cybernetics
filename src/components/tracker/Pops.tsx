'use client';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  formatDeadline,
  formatStamp,
  KIND_LABEL,
  type DateMove,
  type TrackerState,
} from '../../tracker';
import type { Directory } from './avatar';
import { Icon, KIND_COLOR, KindIcon, type IconName } from './icons';
import { FinishesCheck, KindGrid } from './Modals';
import type { PopKind } from './TrackerGraph';
import type { TrackerActions } from './TrackerScreen';

export type PopTarget = {
  kind: PopKind | 'kind' | 'added';
  id: string;
  anchor: Element;
};

type Common = {
  state: TrackerState;
  dir: Directory;
  tz: string;
  asOf: string;
  /** Only a draft that the acting member edits shows the actions that change the graph. */
  edit?: boolean;
  actions: TrackerActions;
  onClose: () => void;
  onDetails: (workItemId: string) => void;
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
        First planned {first} · moved {moves.length}×
      </p>
      <ol className="moves">
        {[...moves].reverse().map((mv, i) => (
          <li key={`${mv.at}-${i}`}>
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
    // An open drawer covers the right of the graph, so the pop stays left of it when it fits there.
    const drawer = box
      .closest('.gwrap')
      ?.querySelector(':scope > .drawer-slot > .drawer')
      ?.getBoundingClientRect();
    const room = drawer ? drawer.left - w.left : w.width;
    const right = room >= pop.offsetWidth + 16 ? room : w.width;
    // A zoomed row reaches past the visible graph, so the pop centres on the part in view.
    const l = Math.max(r.left, w.left);
    const rr = Math.min(r.right, w.left + right);
    const left = Math.max(
      8,
      Math.min(l - w.left + (rr - l) / 2 - pop.offsetWidth / 2, right - pop.offsetWidth - 8),
    );
    let top = r.bottom - w.top + 8;
    if (top + pop.offsetHeight > box.clientHeight - 8)
      top = Math.max(8, r.top - w.top - pop.offsetHeight - 8);
    // The container can scroll, and an absolute child sits in its scrolled content.
    pop.style.left = `${left + box.scrollLeft}px`;
    pop.style.top = `${top + box.scrollTop}px`;
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
      {item && (
        <div className="pop-btns">
          <Btn icon="loop" label="View in work item" onClick={() => c.onDetails(item.id)} />
        </div>
      )}
      {c.edit && (
        <>
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
            Tip: drag an event onto another work item, or to the bin to hide it.
          </p>
        </>
      )}
    </PopFrame>
  );
}

function StackPop({
  target,
  container,
  ...c
}: Common & { target: PopTarget; container: RefObject<HTMLDivElement | null> }) {
  const [picked, setPicked] = useState<string | null>(null);
  const ids = target.id.split(',');
  const list = ids.flatMap((id) => c.state.events.filter((e) => e.id === id));
  if (picked)
    return <ActPop target={{ ...target, kind: 'act', id: picked }} container={container} {...c} />;
  if (!list.length) return null;
  const item = c.state.workItems.find((w) => w.id === list[0].workItemId);
  return (
    <PopFrame
      target={target}
      container={container}
      label={`${list.length} events on ${item?.title ?? 'this work item'}`}
      icon={ring('var(--route)', <KindIcon kind={list[list.length - 1].kind} size={15} />)}
      head={
        <>
          <b>{list.length} events here</b>
          <small>{item?.title}</small>
        </>
      }
      onClose={c.onClose}
    >
      <ul className="stack-list">
        {list.map((ev) => {
          const what = `${KIND_LABEL[ev.kind]} by ${c.dir.name(ev.by)}`;
          return (
            <li key={ev.id}>
              <button className="stack-ev" type="button" onClick={() => setPicked(ev.id)}>
                <span className="sk" style={{ color: KIND_COLOR[ev.kind] }}>
                  <KindIcon kind={ev.kind} size={13} />
                </span>
                <span className="st">
                  <b>{what}</b>
                  <small>{formatStamp(ev.at, c.tz)}</small>
                  <span>{ev.text}</span>
                </span>
              </button>
              {c.edit && (
                <span className="stack-acts">
                  <button
                    className="ib"
                    type="button"
                    aria-label={`Change kind: ${what}`}
                    title="Change kind"
                    onClick={() => c.actions.changeKind(ev.id)}
                  >
                    <Icon name="tag" size={14} />
                  </button>
                  <button
                    className="ib"
                    type="button"
                    aria-label={`Move to another work item: ${what}`}
                    title="Move to another work item"
                    onClick={() => c.actions.moveEvent(ev.id)}
                  >
                    <Icon name="move" size={14} />
                  </button>
                  <button
                    className="ib danger"
                    type="button"
                    aria-label={`Hide this event: ${what}`}
                    title="Hide this event"
                    onClick={() => c.actions.hideEvent(ev.id)}
                  >
                    <Icon name="eyeoff" size={14} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
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
      {ev.kind === 'handoff' && (
        <FinishesCheck
          checked={!!ev.finishes}
          onChange={(finishes) => c.actions.setKind(ev.id, 'handoff', finishes)}
        />
      )}
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
      icon={ring('var(--ink)', <KindIcon kind={ev.kind} size={15} />)}
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
    case 'stack':
      return <StackPop {...props} />;
    case 'kind':
      return <KindPop {...props} />;
    case 'added':
      return <AddedPop {...props} />;
  }
}
