'use client';
import { BreakdownTypeSchema, LoopStateSchema } from '../../contracts/engine';
import type { Department, Milestone } from '../../contracts/graph';
import type { GraphLayout } from '../../contracts/layout';
import type { GraphFilters } from './filters';
import { BREAKDOWN_LABEL, stateLabel } from './labels';

export type ZoomChoice = GraphLayout['zoomLevel'];
type Props = {
  filters: GraphFilters;
  query: string;
  departments: readonly Department[];
  milestones: readonly Milestone[];
  zoomLevel: ZoomChoice;
  onChange(next: Partial<Omit<GraphFilters, 'view' | 'loopId'>>): void;
  onView(view: GraphFilters['view']): void;
  onQuery(query: string): void;
  onZoom(level: ZoomChoice): void;
};

function Segmented<T extends string>({ label, value, options, onSelect }: { label: string; value: T | null; options: readonly (readonly [T, string])[]; onSelect(value: T): void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([option, text]) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onSelect(option)}>{text}</button>)}
    </div>
  );
}

export function FilterBar({ filters, query, departments, milestones, zoomLevel, onChange, onView, onQuery, onZoom }: Props) {
  const ordered = [...departments].sort((a, b) => a.side === b.side ? a.order - b.order : a.side === 'vendor' ? -1 : 1);
  const selected = new Set(filters.departmentIds.length ? filters.departmentIds : ordered.map(item => item.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    // An empty selection would hide every loop, so the last pressed chip stays on.
    if (next.size === 0) return;
    onChange({ departmentIds: next.size === ordered.length ? [] : ordered.filter(item => next.has(item.id)).map(item => item.id) });
  };
  return (
    <div className="filters" role="group" aria-label="Filters">
      <div className="grp"><span className="lbl" aria-hidden="true">Side</span>
        <Segmented label="Side" value={filters.side ?? 'all'} options={[['all', 'All'], ['vendor', 'Vendor'], ['client', 'Client']] as const} onSelect={value => onChange({ side: value === 'all' ? null : value })} />
      </div>
      <div className="grp" role="group" aria-label="Departments"><span className="lbl" aria-hidden="true">Departments</span>
        {ordered.map(department => <button key={department.id} type="button" className="chip toggle" aria-pressed={selected.has(department.id)} onClick={() => toggle(department.id)}>{department.name}</button>)}
      </div>
      <div className="grp"><label className="lbl" htmlFor="filter-state">State</label>
        <select id="filter-state" value={filters.state ?? ''} onChange={event => onChange({ state: LoopStateSchema.safeParse(event.target.value).data ?? null })}>
          <option value="">Any</option>
          {LoopStateSchema.options.map(state => <option key={state} value={state}>{stateLabel(state)}</option>)}
        </select>
      </div>
      <div className="grp"><label className="lbl" htmlFor="filter-breakdown">Breakdown</label>
        <select id="filter-breakdown" value={filters.breakdown ?? ''} onChange={event => onChange({ breakdown: BreakdownTypeSchema.safeParse(event.target.value).data ?? null })}>
          <option value="">Any</option>
          {BreakdownTypeSchema.options.map(type => <option key={type} value={type}>{BREAKDOWN_LABEL[type]}</option>)}
        </select>
      </div>
      <div className="grp"><label className="lbl" htmlFor="filter-milestone">Milestone</label>
        <select id="filter-milestone" value={filters.milestoneId ?? ''} onChange={event => onChange({ milestoneId: event.target.value || null })}>
          <option value="">Any</option>
          {[...milestones].sort((a, b) => a.order - b.order).map(milestone => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}
        </select>
      </div>
      <div className="grp"><input type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search titles and quotes" aria-label="Search loop titles and quotes" maxLength={200} /></div>
      <div className="grp" style={{ marginLeft: 'auto' }}>
        <Segmented label="View" value={filters.view} options={[['graph', 'Graph'], ['list', 'List']] as const} onSelect={onView} />
        {filters.view === 'graph' && <Segmented label="Zoom level" value={zoomLevel} options={[['milestones', 'Milestones'], ['branches', 'Branches'], ['detail', 'Detail']] as const} onSelect={onZoom} />}
      </div>
    </div>
  );
}
