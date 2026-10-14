'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { EngineOutput } from '../../contracts/engine';
import type { GraphContext } from '../../contracts/graph';
import type { ActGlyph, GraphLayout } from '../../contracts/layout';
import { createTimeScale, layoutPromiseGraph } from '../../lib/graph-layout';
import { FilterBar, type ZoomChoice } from './FilterBar';
import { applyFilters, filtersToSearch, type GraphFilters } from './filters';
import { ACT_LABEL, partyName, shortStamp, type Directory } from './labels';
import { Legend } from './Legend';
import { LoopList } from './LoopList';
import { LoopPanel } from './LoopPanel';
import { MilestonePanel } from './MilestonePanel';
import { GRAPH_LEFT, GRAPH_RIGHT, PromiseGraph } from './PromiseGraph';
import { loopKey, milestoneKey } from './ui-context';

export type GraphScreenProps = {
  projectId: string;
  title: string;
  clientName: string;
  context: GraphContext;
  engine: EngineOutput;
  pendingEvidenceCount: number;
  initialFilters: GraphFilters;
  escalation: EscalationFocus | null;
};
export type EscalationFocus =
  { state: 'cited'; loopIds: string[] } | { state: 'no-analysis' } | { state: 'missing' };

const ZOOM_PX: Record<Exclude<ZoomChoice, 'branches'>, number> = { milestones: 4, detail: 44 };
const zoomLevelOf = (pxPerDay: number): GraphLayout['zoomLevel'] =>
  pxPerDay < 6 ? 'milestones' : pxPerDay > 40 ? 'detail' : 'branches';
type Tip = { x: number; y: number; glyph: ActGlyph };
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable);

export function GraphScreen({
  projectId,
  title,
  clientName,
  context,
  engine,
  pendingEvidenceCount,
  initialFilters,
  escalation,
}: GraphScreenProps) {
  const escalationLoopIds = escalation?.state === 'cited' ? escalation.loopIds : null;
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
  const [width, setWidth] = useState<number | null>(null);
  const [pxPerDay, setPxPerDay] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const lastFocus = useRef<string | null>(null);

  const days = useMemo(() => createTimeScale(context, 1).dateEndX(context.windowEnd), [context]);
  const fit = useCallback(
    (available: number) => Math.min(40, Math.max(6, (available - GRAPH_LEFT - GRAPH_RIGHT) / days)),
    [days],
  );
  const onWidth = useCallback(
    (next: number) => {
      setWidth(next);
      // SRD 7.2: the default view fits the project window to the screen width, once.
      setPxPerDay((previous) => previous ?? fit(next));
    },
    [fit],
  );
  const scalePx = pxPerDay ?? 9;

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
  const visibleLoops = useMemo(
    () => engine.loops.filter((loop) => visible.has(loop.loop.id)),
    [engine, visible],
  );
  const layout = useMemo(
    () =>
      layoutPromiseGraph({ ...engine, loops: visibleLoops }, { context }, { pxPerDay: scalePx }),
    [engine, visibleLoops, context, scalePx],
  );
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
  const actIndex =
    selectedLoop && actId ? selectedLoop.acts.findIndex((act) => act.id === actId) : -1;

  // SRD 7.3: a selection keeps its loops at full opacity; an escalation focus fades the loops it does not cite.
  const faded = useMemo(() => {
    const keep = selectedLoop
      ? new Set([selectedLoop.loop.id])
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

  const onZoomChoice = (level: ZoomChoice) =>
    setPxPerDay(level === 'branches' ? fit(width ?? 1000) : ZOOM_PX[level]);
  const onHoverAct = useCallback(
    (glyph: ActGlyph | null, event?: MouseEvent) =>
      setTip(glyph && event ? { glyph, x: event.clientX, y: event.clientY } : null),
    [],
  );
  const hoveredAct = tip
    ? engine.loops
        .find((loop) => loop.loop.id === tip.glyph.loopId)
        ?.acts.find((act) => act.id === tip.glyph.id)
    : undefined;

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
  const revealX = selectedLoop
    ? (layout.branches.find((branch) => branch.loopId === selectedLoop.loop.id)?.xStart ?? null)
    : null;
  const panelOpen = view === 'graph' && (selectedLoop !== null || selectedMilestone !== null);

  return (
    <section className="screen" aria-labelledby="graph-heading" style={{ paddingTop: 0 }}>
      <h1 id="graph-heading" className="sr">
        Main graph
      </h1>
      <FilterBar
        filters={{ ...filters, view }}
        query={query}
        departments={context.departments}
        milestones={context.milestones}
        zoomLevel={zoomLevelOf(scalePx)}
        onChange={update}
        onView={setView}
        onQuery={onQuery}
        onZoom={onZoomChoice}
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
          <div className={`stage${panelOpen ? ' open' : ''}`}>
            <PromiseGraph
              title={title}
              clientName={clientName}
              context={context}
              layout={layout}
              pxPerDay={scalePx}
              T={engine.T}
              milestoneStatus={milestoneStatus}
              selectedLoopId={selectedLoop?.loop.id ?? null}
              selectedMilestoneId={selectedMilestone?.milestone.id ?? null}
              faded={faded}
              currentActId={actIndex >= 0 ? actId : null}
              revealX={revealX}
              onSelectLoop={selectLoop}
              onSelectMilestone={selectMilestone}
              onHoverAct={onHoverAct}
              onWidth={onWidth}
              onZoom={setPxPerDay}
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
      {tip && hoveredAct && (
        <div
          className="tip"
          role="tooltip"
          style={{
            left: Math.min(
              tip.x + 14,
              (typeof window === 'undefined' ? 1200 : window.innerWidth) - 310,
            ),
            top: tip.y + 14,
          }}
        >
          <b>{ACT_LABEL[hoveredAct.type]}</b>, {partyName(hoveredAct.actor, directory)}
          <br />
          {shortStamp(hoveredAct.occurredAt, context.timeZone)} {context.timeZone}
          {hoveredAct.quote === null ? (
            <q>Unavailable evidence</q>
          ) : (
            <q>{hoveredAct.quote.slice(0, 140)}</q>
          )}
        </div>
      )}
    </section>
  );
}
