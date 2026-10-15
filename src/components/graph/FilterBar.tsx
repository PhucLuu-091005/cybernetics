'use client';
import { BreakdownTypeSchema, LoopStateSchema } from '../../contracts/engine';
import type { Department, Milestone } from '../../contracts/graph';
import type { GraphFilters } from './filters';
import { useDismissibleDetails } from '../shell/Popover';
import { BREAKDOWN_LABEL, stateLabel } from './labels';

type Props = {
  filters: GraphFilters;
  query: string;
  departments: readonly Department[];
  milestones: readonly Milestone[];
  onChange(next: Partial<Omit<GraphFilters, 'view' | 'loopId'>>): void;
  onView(view: GraphFilters['view']): void;
  onQuery(query: string): void;
};

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T | null;
  options: readonly (readonly [T, string])[];
  onSelect(value: T): void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onSelect(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({
  filters,
  query,
  departments,
  milestones,
  onChange,
  onView,
  onQuery,
}: Props) {
  const filterPop = useDismissibleDetails();
  const ordered = [...departments].sort((a, b) =>
    a.side === b.side ? a.order - b.order : a.side === 'vendor' ? -1 : 1,
  );
  const selected = new Set(
    filters.departmentIds.length ? filters.departmentIds : ordered.map((item) => item.id),
  );
  const activeCount =
    (filters.side ? 1 : 0) +
    (filters.departmentIds.length > 0 ? 1 : 0) +
    (filters.state ? 1 : 0) +
    (filters.breakdown ? 1 : 0) +
    (filters.milestoneId ? 1 : 0);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // An empty selection would hide every loop, so the last pressed chip stays on.
    if (next.size === 0) return;
    onChange({
      departmentIds:
        next.size === ordered.length
          ? []
          : ordered.filter((item) => next.has(item.id)).map((item) => item.id),
    });
  };
  return (
    <div className="filters" role="group" aria-label="Filters">
      <div className="grp">
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search titles and quotes"
          aria-label="Search loop titles and quotes"
          maxLength={200}
        />
      </div>
      <button
        type="button"
        className="problems-toggle"
        aria-pressed={filters.problems}
        onClick={() => onChange({ problems: !filters.problems })}
      >
        <Icon>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </Icon>
        Problems only
      </button>
      <details ref={filterPop} className="filter-pop">
        <summary className="btn">
          <Icon>
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </Icon>
          Filter{activeCount > 0 ? ` (${activeCount})` : ''}
        </summary>
        <div className="filter-body">
          <div className="grp">
            <span className="lbl" aria-hidden="true">
              Side
            </span>
            <Segmented
              label="Side"
              value={filters.side ?? 'all'}
              options={
                [
                  ['all', 'All'],
                  ['vendor', 'Vendor'],
                  ['client', 'Client'],
                ] as const
              }
              onSelect={(value) => onChange({ side: value === 'all' ? null : value })}
            />
          </div>
          <div className="grp" role="group" aria-label="Departments">
            <span className="lbl" aria-hidden="true">
              Departments
            </span>
            {ordered.map((department) => (
              <button
                key={department.id}
                type="button"
                className="chip toggle"
                aria-pressed={selected.has(department.id)}
                onClick={() => toggle(department.id)}
              >
                {department.name}
              </button>
            ))}
          </div>
          <div className="grp">
            <label className="lbl" htmlFor="filter-state">
              State
            </label>
            <select
              id="filter-state"
              value={filters.state ?? ''}
              onChange={(event) =>
                onChange({ state: LoopStateSchema.safeParse(event.target.value).data ?? null })
              }
            >
              <option value="">Any</option>
              {LoopStateSchema.options.map((state) => (
                <option key={state} value={state}>
                  {stateLabel(state)}
                </option>
              ))}
            </select>
          </div>
          <div className="grp">
            <label className="lbl" htmlFor="filter-breakdown">
              Problem type
            </label>
            <select
              id="filter-breakdown"
              value={filters.breakdown ?? ''}
              onChange={(event) =>
                onChange({
                  breakdown: BreakdownTypeSchema.safeParse(event.target.value).data ?? null,
                })
              }
            >
              <option value="">Any</option>
              {BreakdownTypeSchema.options.map((type) => (
                <option key={type} value={type}>
                  {BREAKDOWN_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="grp">
            <label className="lbl" htmlFor="filter-milestone">
              Milestone
            </label>
            <select
              id="filter-milestone"
              value={filters.milestoneId ?? ''}
              onChange={(event) => onChange({ milestoneId: event.target.value || null })}
            >
              <option value="">Any</option>
              {[...milestones]
                .sort((a, b) => a.order - b.order)
                .map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() =>
              onChange({
                side: null,
                departmentIds: [],
                state: null,
                breakdown: null,
                milestoneId: null,
                problems: false,
              })
            }
          >
            Clear
          </button>
        </div>
      </details>
      <div className="grp" style={{ marginLeft: 'auto' }}>
        <Segmented
          label="View"
          value={filters.view}
          options={
            [
              ['graph', 'Graph'],
              ['list', 'List'],
            ] as const
          }
          onSelect={onView}
        />
      </div>
    </div>
  );
}
