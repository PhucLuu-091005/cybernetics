'use client';
import { useState, type KeyboardEvent } from 'react';
import { formatDay, formatStamp, KIND_LABEL, type TrackerState } from '../../tracker';
import { Avatar, type Directory } from './avatar';
import { trunc } from './ContextBar';
import { Icon, KIND_COLOR, KindIcon } from './icons';

export type QueueTab = 'events' | 'items';

type Props = {
  state: TrackerState;
  dir: Directory;
  tz: string;
  onAdd: (tab: QueueTab) => void;
  onEvent: (id: string) => void;
  onItem: (id: string) => void;
};

const activate = (run: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  run();
};

function AgentChip() {
  return (
    <span className="bot">
      <Icon name="bot" size={11} /> Agent
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="qempty">
      <Icon name="inbox" size={26} />
      {text}
    </div>
  );
}

export function QueuePanel({ state, dir, tz, onAdd, onEvent, onItem }: Props) {
  const [tab, setTab] = useState<QueueTab>('events');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const hit = (text: string) => !term || text.toLowerCase().includes(term);
  const { events, items } = state.queue;
  const milestone = (id: string) => state.milestones.find((m) => m.id === id)?.name ?? '';
  const workItem = (id: string) => state.workItems.find((w) => w.id === id)?.title ?? '';
  const shownEvents = events.filter((e) =>
    hit(`${e.text} ${dir.name(e.by)} ${KIND_LABEL[e.kind]}`),
  );
  const shownItems = items.filter((it) => hit(`${it.title} ${it.note} ${dir.name(it.doneBy)}`));
  const tabButton = (value: QueueTab, label: string, count: number) => (
    <button type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>
      {label} <span className="n">{count}</span>
    </button>
  );
  return (
    <aside className="p-side" aria-label="Queue">
      <div className="qtop">
        <div>
          <h4>
            <Icon name="inbox" /> Queue
          </h4>
          <p>New work waits here until someone drags it onto the graph.</p>
        </div>
        <button className="btn sm btn-ink" type="button" onClick={() => onAdd(tab)}>
          <Icon name="plus" size={13} /> Add
        </button>
      </div>
      <div className="qseg" role="group" aria-label="Show in the queue">
        {tabButton('events', 'Events', events.length)}
        {tabButton('items', 'Work items', items.length)}
      </div>
      <label className="qsearch">
        <Icon name="search" size={13} />
        <input
          type="search"
          placeholder="Search the queue"
          aria-label="Search the queue"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="qlist">
        {tab === 'events' &&
          (shownEvents.length ? (
            shownEvents.map((e) => (
              <div
                key={e.id}
                className="qc"
                style={{ ['--kc' as string]: KIND_COLOR[e.kind] }}
                role="button"
                tabIndex={0}
                aria-label={`${KIND_LABEL[e.kind]} by ${dir.name(e.by)}, ${formatStamp(e.at, tz)}: ${e.text}`}
                onClick={() => onEvent(e.id)}
                onKeyDown={activate(() => onEvent(e.id))}
              >
                <span className="grip">
                  <Icon name="grip" size={14} />
                </span>
                <span className="qk">
                  <KindIcon kind={e.kind} size={12} /> {KIND_LABEL[e.kind]}
                </span>
                <div className="qt">{e.text}</div>
                <div className="qf">
                  <Avatar id={e.by} dir={dir} sm /> <span className="who">{dir.name(e.by)}</span> ·{' '}
                  {formatStamp(e.at, tz)} {e.agent && <AgentChip />}
                </div>
              </div>
            ))
          ) : (
            <Empty text={term ? 'No event matches.' : 'No events wait. Press Add.'} />
          ))}
        {tab === 'items' &&
          (shownItems.length ? (
            shownItems.map((it) => (
              <div
                key={it.id}
                className="qc"
                style={{ ['--kc' as string]: 'var(--ink-2)' }}
                role="button"
                tabIndex={0}
                aria-label={`Work item ${it.title}, done by ${dir.name(it.doneBy)}, planned finish ${formatDay(it.plannedFinish)}`}
                onClick={() => onItem(it.id)}
                onKeyDown={activate(() => onItem(it.id))}
              >
                <span className="grip">
                  <Icon name="grip" size={14} />
                </span>
                <span className="qk">
                  <Icon name="loop" size={12} /> Work item
                </span>
                <div className="qt">
                  <b>{it.title}</b>
                  {it.note}
                </div>
                <div className="qf">
                  <Avatar id={it.doneBy} dir={dir} sm />{' '}
                  <span className="who">{dir.name(it.doneBy)}</span> ·{' '}
                  <Icon name="flag" size={10} /> {formatDay(it.plannedFinish)}
                  {it.milestoneId && (
                    <>
                      {' '}
                      · <Icon name="diamond" size={10} /> {milestone(it.milestoneId)}
                    </>
                  )}
                  {it.after && <> · after {trunc(workItem(it.after), 18)}</>}{' '}
                  {it.agent && <AgentChip />}
                </div>
              </div>
            ))
          ) : (
            <Empty text={term ? 'No work item matches.' : 'No work items wait. Press Add.'} />
          ))}
      </div>
    </aside>
  );
}
