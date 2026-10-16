'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { itemStatus, searchWorkItems, STATUS_LABEL, type TrackerState } from '../../tracker';
import { Icon } from './icons';

const LIMIT = 8;

type Props = {
  state: TrackerState;
  asOf: string;
  tz: string;
  onPick: (workItemId: string) => void;
};

export function WorkSearch({ state, asOf, tz, onPick }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = useMemo(() => searchWorkItems(state, query), [state, query]);
  const hits = all.slice(0, LIMIT);
  const shown = open && query.trim() !== '';
  const index = Math.min(active, Math.max(0, hits.length - 1));
  const team = (teamId: string) => state.teams.find((t) => t.id === teamId)?.name ?? '';

  const pick = (workItemId: string) => {
    setQuery('');
    setOpen(false);
    setActive(0);
    onPick(workItemId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!hits.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(shown ? (index + step + hits.length) % hits.length : 0);
      setOpen(true);
    } else if (event.key === 'Enter' && shown && hits[index]) {
      event.preventDefault();
      pick(hits[index].id);
    } else if (event.key === 'Escape' && shown) {
      setOpen(false);
    }
  };

  return (
    <div className="tsearch">
      <Icon name="search" size={14} />
      <input
        role="combobox"
        aria-label="Search work items"
        placeholder="Search work items"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown && hits.length ? `${id}-${index}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <div className="tsearch-pop" hidden={!shown}>
        <ul role="listbox" id={`${id}-list`} aria-label="Work items">
          {shown &&
            hits.map((w, i) => {
              const status = itemStatus(w, state.events, asOf, tz);
              return (
                <li
                  key={w.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  className={i === index ? 'on' : undefined}
                  // The input keeps the focus, so its blur does not close the list before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(w.id)}
                >
                  <span className="tt">
                    <b>{w.title}</b>
                    <small>{team(w.teamId)}</small>
                  </span>
                  <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
                </li>
              );
            })}
        </ul>
        {shown && !hits.length && <p className="none">No work item matches.</p>}
        {shown && all.length > LIMIT && (
          <p className="none">
            {LIMIT} of {all.length} shown. Type more to narrow.
          </p>
        )}
      </div>
      <span className="sr" role="status">
        {shown ? `${all.length} ${all.length === 1 ? 'work item' : 'work items'} found` : ''}
      </span>
    </div>
  );
}
