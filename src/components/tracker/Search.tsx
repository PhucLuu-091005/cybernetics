'use client';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  filterCount,
  isFiltering,
  itemStatus,
  matchRows,
  NO_FILTER,
  NO_MILESTONE,
  searchWorkItems,
  STATUS_LABEL,
  type RowFilter,
  type Status,
  type TrackerState,
} from '../../tracker';
import { useDismissibleDetails } from '../shell/Popover';
import { Icon } from './icons';

const LIMIT = 8;
const STATUSES = Object.keys(STATUS_LABEL) as Status[];

type Props = {
  state: TrackerState;
  asOf: string;
  tz: string;
  /** The typed text is part of the filter, so the graph follows it while the list shows. */
  filter: RowFilter;
  onFilter: (filter: RowFilter) => void;
  onPick: (workItemId: string) => void;
};

type ListKey = 'statuses' | 'teams' | 'milestones' | 'people';

function FilterGroup({
  legend,
  options,
  chosen,
  onToggle,
}: {
  legend: string;
  options: Array<{ value: string; label: ReactNode }>;
  chosen: readonly string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="fgroup">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="fchip">
          <input
            type="checkbox"
            checked={chosen.includes(o.value)}
            onChange={() => onToggle(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Filters({ state, asOf, tz, filter, onFilter }: Omit<Props, 'onPick'>) {
  const ref = useDismissibleDetails();
  const count = filterCount(filter);
  const shown = useMemo(() => {
    const match = matchRows(state, filter, asOf, tz);
    return match ? match.match.size : state.workItems.length;
  }, [state, filter, asOf, tz]);
  const toggle = (key: ListKey) => (value: string) => {
    const list = filter[key] as string[];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    onFilter({ ...filter, [key]: next });
  };
  return (
    <details ref={ref} className="tfilter">
      <summary
        className={`tfilter-btn${count ? ' on' : ''}`}
        aria-label={count ? `Filters, ${count} on` : 'Filters'}
        title="Filter the graph"
      >
        <Icon name="filter" size={14} />
        {count > 0 && <span className="cnt">{count}</span>}
      </summary>
      <div className="tfilter-pop" role="group" aria-label="Filter the graph">
        <FilterGroup
          legend="Status"
          options={STATUSES.map((s) => ({
            value: s,
            label: (
              <>
                <i className={`fdot st-${s}`} />
                {STATUS_LABEL[s]}
              </>
            ),
          }))}
          chosen={filter.statuses}
          onToggle={toggle('statuses')}
        />
        <FilterGroup
          legend="Team"
          options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
          chosen={filter.teams}
          onToggle={toggle('teams')}
        />
        <FilterGroup
          legend="Milestone"
          options={[
            ...state.milestones.map((m) => ({ value: m.id, label: m.name })),
            { value: NO_MILESTONE, label: 'No milestone' },
          ]}
          chosen={filter.milestones}
          onToggle={toggle('milestones')}
        />
        <FilterGroup
          legend="Person (done by or requested by)"
          options={state.people.map((p) => ({ value: p.id, label: p.name }))}
          chosen={filter.people}
          onToggle={toggle('people')}
        />
        <div className="tfilter-foot">
          <span role="status">
            {isFiltering(filter)
              ? `${shown} of ${state.workItems.length} work items match`
              : 'Every work item shows'}
          </span>
          <button
            className="btn sm"
            type="button"
            disabled={!count}
            onClick={() => onFilter({ ...NO_FILTER, text: filter.text })}
          >
            Clear filters
          </button>
        </div>
      </div>
    </details>
  );
}

export function WorkSearch({ state, asOf, tz, filter, onFilter, onPick }: Props) {
  const id = useId();
  const query = filter.text;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = useMemo(() => searchWorkItems(state, query), [state, query]);
  const hits = all.slice(0, LIMIT);
  const shown = open && query.trim() !== '';
  const index = Math.min(active, Math.max(0, hits.length - 1));
  const team = (teamId: string) => state.teams.find((t) => t.id === teamId)?.name ?? '';

  const pick = (workItemId: string) => {
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
          onFilter({ ...filter, text: event.target.value });
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <Filters state={state} asOf={asOf} tz={tz} filter={filter} onFilter={onFilter} />
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
