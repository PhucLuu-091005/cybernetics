'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DerivedLoop, EngineOutput } from '../../contracts/engine';
import type { GraphContext, GraphSnapshot } from '../../contracts/graph';
import type { ViewSelection } from '../../contracts/mcp';
import type { GraphSource } from '../../contracts/views';
import {
  BASE_PX_PER_DAY,
  BASE_ROW_HEIGHT,
  CARD,
  NO_OFFSETS,
  applyLayoutOffsets,
  layoutPromiseGraph,
  loopShiftRange,
  type LayoutOffsets,
} from '../../lib/graph-layout';
import type { EditTarget } from '../review/draft-edit';
import { FilterBar } from './FilterBar';
import { applyFilters, filtersToSearch, type GraphFilters } from './filters';
import type { CardInfo } from './CardNode';
import { ACT_LABEL, loopColor, partyName, shortStamp, type Directory } from './labels';
import type { IndexEntry } from './LoopIndex';
import { RecordPreview } from './RecordPreview';
import { ResizeHandle } from './ResizeHandle';
import { useStoredSize } from './stored-size';
import {
  browserStore,
  hasOffsets,
  readOffsets,
  withCardOffset,
  withOffset,
  writeOffsets,
} from './offset-store';
import type { DragChange } from './ui-context';
import { actSource } from './source-link';
import { Legend } from './Legend';
import { LoopList, withTasksUnderParents } from './LoopList';
import { LoopPanel, type LoopRelations, type RelatedLoop } from './LoopPanel';
import { MilestonePanel } from './MilestonePanel';
import { PromiseGraph } from './PromiseGraph';
import { loopKey, milestoneKey } from './ui-context';

export type GraphScreenProps = {
  projectId: string;
  title: string;
  context: GraphContext;
  engine: EngineOutput;
  pendingEvidenceCount: number;
  initialFilters: GraphFilters;
  escalation: EscalationFocus | null;
  view: ViewSelection;
  edit: EditTarget;
  snapshot: Pick<GraphSnapshot, 'acts' | 'recordDecisions'>;
  /** Source of each cited record version, keyed by version ID. */
  sources: Record<string, GraphSource>;
  /** Loops and acts a proposal changes against its base: halo on the branch, agent badge on the step. */
  changedLoopIds?: readonly string[];
  agentActIds?: readonly string[];
  heading?: string;
  headingLevel?: 1 | 2;
};
export type EscalationFocus =
  { state: 'cited'; loopIds: string[] } | { state: 'no-analysis' } | { state: 'missing' };

const dayAndTime = (stamp: string) => {
  const at = stamp.lastIndexOf(' ');
  return { day: stamp.slice(0, at), time: stamp.slice(at + 1) };
};
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable);

export function GraphScreen({
  projectId,
  title,
  context,
  engine,
  pendingEvidenceCount,
  initialFilters,
  escalation,
  view: graphView,
  edit,
  snapshot,
  sources,
  changedLoopIds,
  agentActIds,
  heading = 'Main graph',
  headingLevel = 1,
}: GraphScreenProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const escalationLoopIds = escalation?.state === 'cited' ? escalation.loopIds : null;
  const halo = useMemo(() => new Set(changedLoopIds ?? []), [changedLoopIds]);
  const agentActs = useMemo(() => new Set(agentActIds ?? []), [agentActIds]);
  const loopTargets = useMemo(
    () =>
      engine.loops
        .map((item) => ({ id: item.loop.id, title: item.loop.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [engine],
  );
  // Selection and view live outside the filter state so opening a loop never re-runs the filters or the layout.
  const [filters, setFilters] = useState<GraphFilters>({
    ...initialFilters,
    loopId: null,
    view: 'graph',
  });
  const [view, setView] = useState(initialFilters.view);
  const [loopId, setLoopId] = useState(initialFilters.loopId);
  const [query, setQuery] = useState(initialFilters.q);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [actId, setActId] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<LayoutOffsets>(NO_OFFSETS);
  // Browser storage exists only after hydration, so saved positions load in an effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffsets(readOffsets(browserStore(), projectId));
  }, [projectId]);
  const lastFocus = useRef<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useStoredSize('promise-graph:width:panel', 320, 720);
  const [preview, setPreview] = useState<{ versionId: string; quote: string | null } | null>(null);
  const viewRecord = useCallback(
    (versionId: string, quote: string | null) => setPreview({ versionId, quote }),
    [],
  );
  const closePreview = useCallback(() => setPreview(null), []);

  const directory: Directory = useMemo(
    () => ({
      people: new Map(context.people.map((item) => [item.id, item])),
      departments: new Map(context.departments.map((item) => [item.id, item])),
    }),
    [context],
  );
  const visible = useMemo(
    () => applyFilters(engine, filters, context.departments),
    [engine, filters, context.departments],
  );
  const filteredLoops = useMemo(
    () => engine.loops.filter((loop) => visible.has(loop.loop.id)),
    [engine, visible],
  );
  // "Show only" from the loop list; a promise keeps its tasks. Empty shows every filtered loop.
  const [only, setOnly] = useState<ReadonlySet<string>>(() => new Set());
  const visibleLoops = useMemo(
    () =>
      only.size
        ? filteredLoops.filter(
            (loop) =>
              only.has(loop.loop.id) ||
              (loop.loop.parentLoopId !== undefined && only.has(loop.loop.parentLoopId)),
          )
        : filteredLoops,
    [filteredLoops, only],
  );
  const toggleOnly = useCallback(
    (loopId: string) =>
      setOnly((previous) => {
        const next = new Set(previous);
        if (!next.delete(loopId)) next.add(loopId);
        return next;
      }),
    [],
  );
  const showAll = useCallback(() => setOnly(new Set()), []);
  const indexEntries: IndexEntry[] = useMemo(() => {
    const present = new Set(filteredLoops.map((loop) => loop.loop.id));
    const startOf = (loop: DerivedLoop) => loop.acts[0]?.occurredAt ?? '9999';
    const ordered = [...filteredLoops].sort(
      (a, b) => startOf(a).localeCompare(startOf(b)) || a.loop.title.localeCompare(b.loop.title),
    );
    return withTasksUnderParents(ordered).map((loop) => ({
      id: loop.loop.id,
      title: loop.loop.title,
      department:
        context.departments.find((item) => item.id === loop.loop.performerDepartmentId)?.name ??
        'Unknown',
      color: loopColor(loop),
      parentId:
        loop.loop.parentLoopId !== undefined && present.has(loop.loop.parentLoopId)
          ? loop.loop.parentLoopId
          : null,
    }));
  }, [filteredLoops, context.departments]);
  const baseLayout = useMemo(
    () =>
      layoutPromiseGraph(
        { ...engine, loops: visibleLoops },
        { context },
        { pxPerDay: BASE_PX_PER_DAY, rowHeight: BASE_ROW_HEIGHT, cards: CARD },
      ),
    [engine, visibleLoops, context],
  );
  const layout = useMemo(
    () => applyLayoutOffsets(baseLayout, offsets, BASE_ROW_HEIGHT),
    [baseLayout, offsets],
  );
  const onDrag = useCallback(
    (change: DragChange, done: boolean) => {
      const exact = (value: number) => Math.round(value * 1000) / 1000;
      setOffsets((previous) => {
        let next: LayoutOffsets;
        if (change.kind === 'cards')
          next = withCardOffset(previous, change.id, {
            dx: exact(change.dx),
            dy: exact(change.dy),
          });
        else if (change.kind === 'acts')
          next = withOffset(previous, 'acts', change.id, exact(change.fraction));
        else {
          const range = loopShiftRange(baseLayout, change.id, BASE_ROW_HEIGHT);
          const shift = range ? Math.min(range[1], Math.max(range[0], change.shift)) : change.shift;
          next = withOffset(previous, 'loops', change.id, exact(shift));
        }
        if (done) writeOffsets(browserStore(), projectId, next);
        return next;
      });
    },
    [baseLayout, projectId],
  );
  const resetLayout = useCallback(() => {
    writeOffsets(browserStore(), projectId, NO_OFFSETS);
    setOffsets(NO_OFFSETS);
  }, [projectId]);
  const cards = useMemo(() => {
    const map = new Map<string, CardInfo>();
    for (const loop of visibleLoops)
      for (const act of loop.acts) {
        const versionId = act.citation.recordVersionId;
        map.set(act.id, {
          type: act.type,
          label: ACT_LABEL[act.type],
          ...dayAndTime(shortStamp(act.occurredAt, context.timeZone)),
          person: partyName(act.actor, directory),
          quote: act.quote,
          recordVersionId: versionId,
          source: actSource(projectId, versionId, sources[versionId]),
        });
      }
    return map;
  }, [visibleLoops, context.timeZone, directory, projectId, sources]);
  const milestoneStatus = useMemo(
    () => new Map(engine.milestones.map((item) => [item.milestone.id, item.status])),
    [engine],
  );
  const selectedLoop = loopId
    ? (visibleLoops.find((loop) => loop.loop.id === loopId) ?? null)
    : null;
  const selectedMilestone = milestoneId
    ? (engine.milestones.find((item) => item.milestone.id === milestoneId) ?? null)
    : null;
  const relations: LoopRelations = useMemo(() => {
    if (!selectedLoop) return { parent: null, after: [], next: [], tasks: [] };
    const related = (id: string): RelatedLoop[] => {
      const item = engine.loops.find((loop) => loop.loop.id === id);
      return item
        ? [
            {
              id,
              title: item.loop.title,
              department:
                directory.departments.get(item.loop.performerDepartmentId)?.name ?? 'Unknown',
              performer: partyName(item.loop.performer, directory),
              state: item.state,
              color: loopColor(item),
              startedAt: item.acts[0]?.occurredAt ?? null,
              closedAt: item.state === 'closed' ? item.closedAt : null,
              waitingFor: (item.loop.afterLoopIds ?? []).flatMap((before) => {
                const other = engine.loops.find((loop) => loop.loop.id === before);
                return other && other.state !== 'closed' ? [other.loop.title] : [];
              }),
            },
          ]
        : [];
    };
    const { parentLoopId, afterLoopIds = [] } = selectedLoop.loop;
    return {
      parent: parentLoopId ? (related(parentLoopId)[0] ?? null) : null,
      after: afterLoopIds.flatMap(related),
      next: engine.loops
        .filter((loop) => loop.loop.afterLoopIds?.includes(selectedLoop.loop.id))
        .flatMap((loop) => related(loop.loop.id)),
      tasks: engine.loops
        .filter((loop) => loop.loop.parentLoopId === selectedLoop.loop.id)
        .flatMap((loop) => related(loop.loop.id)),
    };
  }, [selectedLoop, engine, directory]);
  const actIndex =
    selectedLoop && actId ? selectedLoop.acts.findIndex((act) => act.id === actId) : -1;

  // SRD 7.3: a selection keeps its loops at full opacity; an escalation focus fades the loops it does not cite.
  const faded = useMemo(() => {
    // A selected promise or task keeps its whole family at full strength: the promise and every task.
    const family = (loop: DerivedLoop) => {
      const root = loop.loop.parentLoopId ?? loop.loop.id;
      return [
        root,
        ...visibleLoops
          .filter((item) => item.loop.parentLoopId === root)
          .map((item) => item.loop.id),
      ];
    };
    const keep = selectedLoop
      ? new Set(family(selectedLoop))
      : selectedMilestone
        ? new Set(selectedMilestone.loopIds)
        : escalationLoopIds
          ? new Set(escalationLoopIds)
          : null;
    return new Set(
      keep ? visibleLoops.map((loop) => loop.loop.id).filter((id) => !keep.has(id)) : [],
    );
  }, [selectedLoop, selectedMilestone, escalationLoopIds, visibleLoops]);

  const update = useCallback(
    (next: Partial<Omit<GraphFilters, 'view' | 'loopId'>>) =>
      setFilters((previous) => ({ ...previous, ...next })),
    [],
  );
  useEffect(() => {
    const search = filtersToSearch(
      { ...filters, view, loopId },
      new URLSearchParams(window.location.search),
    ).toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}`,
    );
  }, [filters, view, loopId]);
  const onQuery = (value: string) => {
    setQuery(value);
    update({ q: value.trim().slice(0, 200) });
  };

  const focusKey = (key: string) =>
    document.querySelector<SVGElement>(`[data-nav-key="${key}"]`)?.focus({ preventScroll: true });
  const selectLoop = useCallback((id: string, nextActId?: string) => {
    lastFocus.current = loopKey(id);
    setMilestoneId(null);
    setActId(nextActId ?? null);
    setLoopId(id);
    setView('graph');
  }, []);
  const selectMilestone = useCallback((id: string) => {
    lastFocus.current = milestoneKey(id);
    setActId(null);
    setLoopId(null);
    setMilestoneId(id);
  }, []);
  const close = useCallback(() => {
    const key = lastFocus.current;
    setMilestoneId(null);
    setActId(null);
    setLoopId(null);
    if (key) requestAnimationFrame(() => focusKey(key));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (view !== 'graph' || isTyping(event.target)) return;
      const menu = event.target instanceof Element ? event.target.closest('details[open]') : null;
      if (menu) {
        if (event.key === 'Escape') {
          event.preventDefault();
          menu.removeAttribute('open');
          menu.querySelector('summary')?.focus();
        }
        return;
      }
      if (event.key === 'Escape' && (selectedLoop || selectedMilestone)) {
        event.preventDefault();
        close();
        return;
      }
      if (!selectedLoop || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
      const count = selectedLoop.acts.length;
      if (!count) return;
      event.preventDefault();
      const next =
        event.key === 'ArrowRight' ? Math.min(count - 1, actIndex + 1) : Math.max(0, actIndex - 1);
      setActId(selectedLoop.acts[next].id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedLoop, selectedMilestone, actIndex, close, view]);

  const counts = useMemo(() => {
    const broken = visibleLoops.filter((loop) =>
      loop.breakdowns.some((item) => item.severity === 'broken'),
    ).length;
    const warning = visibleLoops.filter(
      (loop) =>
        loop.breakdowns.length && !loop.breakdowns.some((item) => item.severity === 'broken'),
    ).length;
    const closed = visibleLoops.filter((loop) => loop.state === 'closed').length;
    const ended = visibleLoops.filter(
      (loop) => loop.state === 'declined' || loop.state === 'cancelled',
    ).length;
    return { broken, warning, closed, ended, open: visibleLoops.length - closed - ended };
  }, [visibleLoops]);
  const panelOpen = view === 'graph' && (selectedLoop !== null || selectedMilestone !== null);

  return (
    <section className="screen" aria-labelledby="graph-heading" style={{ paddingTop: 0 }}>
      <Heading id="graph-heading" className="sr">
        {heading}
      </Heading>
      <FilterBar
        filters={{ ...filters, view }}
        query={query}
        departments={context.departments}
        milestones={context.milestones}
        onChange={update}
        onView={setView}
        onQuery={onQuery}
      />
      <p className="coverage">
        <span>
          <b>
            {visibleLoops.length} {visibleLoops.length === 1 ? 'loop' : 'loops'}
          </b>
          : <span className="bad">✕ {counts.broken} broken</span>,{' '}
          <span className="warn">! {counts.warning} warning</span>, {counts.open} open,{' '}
          {counts.closed} closed, {counts.ended} declined or cancelled
        </span>
        {pendingEvidenceCount > 0 && (
          <span>
            {pendingEvidenceCount} {pendingEvidenceCount === 1 ? 'record waits' : 'records wait'}{' '}
            for review, so an empty warning list is not proof of health.
          </span>
        )}
        {engine.unavailableEvidenceCount > 0 && (
          <span>
            {engine.unavailableEvidenceCount}{' '}
            {engine.unavailableEvidenceCount === 1 ? 'act cites' : 'acts cite'} withdrawn evidence.
          </span>
        )}
        {escalationLoopIds && (
          <span>
            Escalation focus: {escalationLoopIds.length} cited{' '}
            {escalationLoopIds.length === 1 ? 'loop' : 'loops'} at full strength.
          </span>
        )}
        {escalation?.state === 'no-analysis' && (
          <span>Escalation focus: no analysis yet, so no loop is faded.</span>
        )}
        {escalation?.state === 'missing' && (
          <span>Escalation focus: this escalation was not found.</span>
        )}
      </p>
      {view === 'list' ? (
        <LoopList
          loops={visibleLoops}
          directory={directory}
          milestones={context.milestones}
          timeZone={context.timeZone}
          onOpen={selectLoop}
        />
      ) : (
        <>
          <div
            ref={stageRef}
            className={`stage${panelOpen ? ' open' : ''}`}
            style={panelWidth ? ({ '--panel-w': `${panelWidth}px` } as CSSProperties) : undefined}
          >
            {preview && (
              <RecordPreview
                projectId={projectId}
                versionId={preview.versionId}
                quote={preview.quote}
                onClose={closePreview}
              />
            )}
            {panelOpen && (
              <ResizeHandle
                className="panel-handle"
                label="Panel width"
                grow={-1}
                measure={() =>
                  stageRef.current?.querySelector('.drawer')?.getBoundingClientRect().width ?? 400
                }
                onResize={setPanelWidth}
              />
            )}
            <PromiseGraph
              title={title}
              context={context}
              layout={layout}
              T={engine.T}
              milestoneStatus={milestoneStatus}
              selectedLoopId={selectedLoop?.loop.id ?? null}
              selectedMilestoneId={selectedMilestone?.milestone.id ?? null}
              faded={faded}
              halo={halo}
              currentActId={actIndex >= 0 ? actId : null}
              cards={cards}
              offsets={offsets}
              onDrag={onDrag}
              onResetLayout={hasOffsets(offsets) ? resetLayout : null}
              index={{ entries: indexEntries, only, onToggleOnly: toggleOnly, onShowAll: showAll }}
              onSelectLoop={selectLoop}
              onSelectMilestone={selectMilestone}
              onViewRecord={viewRecord}
              stageRef={stageRef}
            />
            {selectedLoop && (
              <LoopPanel
                projectId={projectId}
                loop={selectedLoop}
                directory={directory}
                milestones={context.milestones}
                timeZone={context.timeZone}
                T={engine.T}
                currentActIndex={actIndex}
                pendingEvidenceCount={pendingEvidenceCount}
                view={graphView}
                edit={edit}
                loops={loopTargets}
                snapshot={snapshot}
                agentActIds={agentActs}
                relations={relations}
                onOpenLoop={selectLoop}
                onViewRecord={viewRecord}
                onClose={close}
              />
            )}
            {selectedMilestone && (
              <MilestonePanel
                milestone={selectedMilestone}
                loops={engine.loops}
                onOpenLoop={selectLoop}
                onClose={close}
              />
            )}
          </div>
          <Legend />
        </>
      )}
    </section>
  );
}
