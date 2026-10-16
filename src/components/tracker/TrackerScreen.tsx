'use client';
import './tracker.css';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  crState,
  layoutTracker,
  mainState,
  toInstant,
  type Cr,
  type Marks,
  type TrackerPayload,
  type TrackerState,
} from '../../tracker';
import { actAs, getTracker } from './api';
import { makeDirectory } from './avatar';
import { byNumDesc, canEditCr, ContextBar, myDrafts, roleIn, type Session } from './ContextBar';
import {
  ChangesDrawer,
  HistoryDrawer,
  matchesFilter,
  MilestoneDrawer,
  NO_FILTER,
  RequestsDrawer,
  WorkListDrawer,
  type Filter,
} from './Drawers';
import { Icon } from './icons';
import { Pop, type PopTarget } from './Pops';
import { QueuePanel } from './QueuePanel';
import { TopBar } from './TopBar';
import { Legend, TrackerGraph } from './TrackerGraph';
import {
  browserStore,
  EMPTY_VIEW,
  readViewState,
  revealRows,
  toggleId,
  writeViewState,
  type ViewState,
} from './view-state';

export type TrackerView = 'main' | number;
export type DrawerMode = 'list' | 'ms' | 'changes' | 'crs' | 'history';
type Drawer = { mode: Exclude<DrawerMode, 'ms'> } | { mode: 'ms'; id: string };
export type DateTarget = { kind: 'item' | 'ms'; id: string };

/** Edit handlers; Task 6 wires them to modals and the CR routes. */
export type TrackerActions = {
  newCr: () => void;
  share: () => void;
  markReady: () => void;
  editAgain: () => void;
  askToEdit: () => void;
  cancelAsk: () => void;
  handOver: (memberId: string) => void;
  notNow: (memberId: string) => void;
  undo: () => void;
  removeChange: (index: number) => void;
  addToQueue: (what: 'event' | 'item') => void;
  openQueueEvent: (id: string) => void;
  openQueueItem: (id: string) => void;
  addEvent: (workItemId: string) => void;
  markDone: (workItemId: string) => void;
  moveDate: (target: DateTarget) => void;
  rename: (workItemId: string) => void;
  changeKind: (eventId: string) => void;
  moveEvent: (eventId: string) => void;
  hideEvent: (eventId: string) => void;
  newMilestone: () => void;
  saveMilestone: (milestoneId: string, name: string, date: string) => void;
  removeFromMilestone: (workItemId: string) => void;
};

const noop = () => {};
export const NO_ACTIONS: TrackerActions = {
  newCr: noop,
  share: noop,
  markReady: noop,
  editAgain: noop,
  askToEdit: noop,
  cancelAsk: noop,
  handOver: noop,
  notNow: noop,
  undo: noop,
  removeChange: noop,
  addToQueue: noop,
  openQueueEvent: noop,
  openQueueItem: noop,
  addEvent: noop,
  markDone: noop,
  moveDate: noop,
  rename: noop,
  changeKind: noop,
  moveEvent: noop,
  hideEvent: noop,
  newMilestone: noop,
  saveMilestone: noop,
  removeFromMilestone: noop,
};

export const POLL_MS = 5000;
const MINUTE = 60_000;

export function parseView(raw: string | null, crs: readonly Cr[]): TrackerView {
  if (!raw || !/^\d{1,9}$/.test(raw)) return 'main';
  const num = Number(raw);
  return crs.some((c) => c.num === num) ? num : 'main';
}

const samePayload = (a: TrackerPayload, b: TrackerPayload) =>
  JSON.stringify(a) === JSON.stringify(b);

export function useTracker(initial: TrackerPayload, projectId: string) {
  const [payload, setPayloadState] = useState(initial);
  // A poll that started before a write must not overwrite the payload the write returned.
  const writes = useRef(0);
  const setPayload = useCallback((next: TrackerPayload) => {
    writes.current += 1;
    setPayloadState(next);
  }, []);
  const search = useSearchParams();
  const view = parseView(search?.get('cr') ?? null, payload.crs);
  const setView = useCallback((next: TrackerView) => {
    const url = new URL(window.location.href);
    if (next === 'main') url.searchParams.delete('cr');
    else url.searchParams.set('cr', String(next));
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(poll, POLL_MS);
    };
    async function poll() {
      if (stopped || inFlight) return;
      if (document.visibilityState !== 'visible') return;
      inFlight = true;
      const seen = writes.current;
      const result = await getTracker(projectId);
      inFlight = false;
      if (stopped) return;
      if (result.ok && seen === writes.current)
        setPayloadState((prev) => (samePayload(prev, result.data) ? prev : result.data));
      schedule();
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId]);

  return { payload, view, setPayload, setView };
}

const everyHalfMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE / 2);
  return () => clearInterval(timer);
};
// Whole minutes keep the server render and the hydrating client on the same clock.
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const useNow = () => useSyncExternalStore(everyHalfMinute, minuteNow, minuteNow);

type Current = { state: TrackerState; marks?: Marks };

function currentState(payload: TrackerPayload, cr: Cr | null): Current {
  const main = () => ({ state: mainState(payload.base, payload.queue, payload.commits) });
  if (!cr) return main();
  try {
    return crState(payload.base, payload.queue, payload.commits, cr, payload.project.timeZone);
  } catch {
    return main();
  }
}

export function TrackerScreen({
  payload: initial,
  projectId,
}: {
  payload: TrackerPayload;
  projectId: string;
}) {
  const { payload, view, setPayload, setView } = useTracker(initial, projectId);
  const actions = NO_ACTIONS;
  const { project } = payload;
  const tz = project.timeZone;
  const now = useNow();
  const asOf = project.asOf ?? toInstant(now, tz);
  const cr = view === 'main' ? null : (payload.crs.find((c) => c.num === view) ?? null);
  const current = useMemo(() => currentState(payload, cr), [payload, cr]);
  const { state } = current;
  const me = payload.me?.id ?? null;
  const isOwner = !!me && me === project.ownerMemberId;
  const dir = useMemo(
    () => makeDirectory(payload.members, state.people),
    [payload.members, state.people],
  );
  const session: Session = useMemo(
    () => ({ projectId, payload, me, isOwner, dir, tz }),
    [projectId, payload, me, isOwner, dir, tz],
  );
  const edit = !!cr && canEditCr(cr, me);

  const [hidden, setHidden] = useState<ViewState>(EMPTY_VIEW);
  useEffect(() => {
    // Storage exists only in the browser, so the first render shows every row on both sides.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readViewState(browserStore(), projectId));
  }, [projectId]);
  const changeHidden = (next: ViewState) => {
    setHidden(next);
    writeViewState(browserStore(), projectId, next);
  };

  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [pop, setPop] = useState<(PopTarget & { view: TrackerView }) | null>(null);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [flash, setFlash] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const gwrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(timer);
  }, [flash]);

  const shownPop = pop && pop.view === view ? pop : null;
  const closePop = useCallback(
    (focusAnchor: boolean) => {
      if (focusAnchor && pop?.anchor instanceof SVGElement) pop.anchor.focus();
      setPop(null);
    },
    [pop],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.tk details[open]')) return;
      if (shownPop) closePop(true);
      else if (drawer) setDrawer(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shownPop, drawer, closePop]);

  const layout = useMemo(
    () =>
      layoutTracker(
        state,
        {
          hiddenRows: new Set(hidden.hiddenRows),
          hiddenTeams: new Set(hidden.hiddenTeams),
          asOf,
          timeZone: tz,
          ...(project.windowStart ? { windowStart: project.windowStart } : {}),
        },
        current.marks,
      ),
    [state, hidden, asOf, tz, project.windowStart, current.marks],
  );
  const hiddenCount =
    hidden.hiddenRows.filter((id) => state.workItems.some((w) => w.id === id)).length +
    hidden.hiddenTeams.filter((id) => state.teams.some((t) => t.id === id)).length;
  const filtered = !!(filter.person || filter.ms || filter.team);
  const dimmed = (workItemId: string) => {
    if (!edit || !filtered) return false;
    const w = state.workItems.find((x) => x.id === workItemId);
    return !!w && !matchesFilter(filter, w);
  };

  const openView = (next: TrackerView) => {
    setPop(null);
    if (drawer?.mode === 'ms' || drawer?.mode === 'changes') setDrawer(null);
    setView(next);
  };
  const toggleDrawer = (mode: Exclude<DrawerMode, 'ms'>) => {
    setPop(null);
    setDrawer((d) => (d?.mode === mode ? null : { mode }));
  };
  const toggleRow = (id: string) => {
    setPop(null);
    changeHidden({ ...hidden, hiddenRows: toggleId(hidden.hiddenRows, id) });
  };
  const toggleTeam = (id: string) => {
    setPop(null);
    changeHidden({ ...hidden, hiddenTeams: toggleId(hidden.hiddenTeams, id) });
  };
  const reveal = (ids: string[]) =>
    changeHidden(
      revealRows(hidden, ids, (id) => state.workItems.find((w) => w.id === id)?.teamId ?? null),
    );

  const onActAs = async (memberId: string) => {
    const result = await actAs(projectId, memberId);
    if (!result.ok) {
      setToast({ text: result.error.message, at: Date.now() });
      return;
    }
    const next = result.data;
    const nextMe = next.me?.id ?? null;
    const drafts = myDrafts(next.crs, nextMe);
    const draft =
      drafts[0] ??
      next.crs
        .filter((c) => c.status === 'draft' && roleIn(c, nextMe) !== 'view')
        .sort(byNumDesc)[0];
    const owner = nextMe === next.project.ownerMemberId;
    setPayload(next);
    setPop(null);
    setDrawer(
      owner && !drafts.length && next.crs.some((c) => c.status === 'ready')
        ? { mode: 'crs' }
        : null,
    );
    setView(draft ? draft.num : 'main');
  };

  const base = { session, state, asOf, onClose: () => setDrawer(null) };
  return (
    <div className="tk">
      <TopBar
        session={session}
        view={view}
        cr={cr}
        hiddenCount={hiddenCount}
        drawer={drawer?.mode ?? null}
        actions={actions}
        onView={openView}
        onDrawer={(mode) => mode !== 'ms' && toggleDrawer(mode)}
        onShowAll={() => changeHidden(EMPTY_VIEW)}
        onActAs={(id) => void onActAs(id)}
      />
      <ContextBar
        session={session}
        cr={cr}
        actions={actions}
        onView={openView}
        onChanges={() => toggleDrawer('changes')}
        onRequests={() => toggleDrawer('crs')}
      />
      <div className="p-body">
        <QueuePanel
          state={state}
          dir={dir}
          tz={tz}
          onAdd={(tab) => actions.addToQueue(tab === 'items' ? 'item' : 'event')}
          onEvent={actions.openQueueEvent}
          onItem={actions.openQueueItem}
        />
        <div className="gwrap" ref={gwrap}>
          <div className="gscroll">
            <TrackerGraph
              layout={layout}
              edit={edit}
              selectedMs={drawer?.mode === 'ms' ? drawer.id : null}
              flash={flash}
              dimmed={dimmed}
              onToggleRow={toggleRow}
              onToggleTeam={toggleTeam}
              onReveal={reveal}
              onPop={(kind, id, anchor) => setPop({ kind, id, anchor, view })}
              onMilestone={(id) => {
                setPop(null);
                setDrawer({ mode: 'ms', id });
              }}
              onAddEvent={actions.addEvent}
              onNewMilestone={actions.newMilestone}
              onBackground={() => setPop(null)}
            />
          </div>
          {shownPop && (
            <Pop
              key={`${shownPop.kind}-${shownPop.id}`}
              target={shownPop}
              container={gwrap}
              state={state}
              dir={dir}
              tz={tz}
              asOf={asOf}
              actions={actions}
              onClose={() => closePop(true)}
              onHideRow={toggleRow}
            />
          )}
          {drawer?.mode === 'list' && (
            <WorkListDrawer
              {...base}
              filter={filter}
              onFilter={setFilter}
              hiddenRows={hidden.hiddenRows}
              onToggleRow={toggleRow}
              onFlash={setFlash}
            />
          )}
          {drawer?.mode === 'ms' && (
            <MilestoneDrawer
              key={`${view}-${drawer.id}`}
              {...base}
              milestoneId={drawer.id}
              edit={edit}
              actions={actions}
            />
          )}
          {drawer?.mode === 'changes' && cr && (
            <ChangesDrawer {...base} cr={cr} actions={actions} />
          )}
          {drawer?.mode === 'crs' && (
            <RequestsDrawer {...base} actions={actions} onView={openView} />
          )}
          {drawer?.mode === 'history' && <HistoryDrawer {...base} onView={openView} />}
          {state.workItems.length === 0 && (
            <div className="empty">
              <h4>This project has no work yet.</h4>
              <ol>
                <li>Add work items and events. They wait in the Queue on the left.</li>
                <li>Press New change request. Then drag a work item onto a team.</li>
                <li>
                  Drag events onto the work item. Mark the change request as ready, and the owner
                  merges it.
                </li>
              </ol>
              <div className="row-btns">
                <button
                  className="btn btn-ink big"
                  type="button"
                  onClick={() => actions.addToQueue('item')}
                >
                  <Icon name="plus" /> Add a work item
                </button>
                <button
                  className="btn big"
                  type="button"
                  onClick={() => actions.addToQueue('event')}
                >
                  <Icon name="plus" /> Add an event
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <Legend />
      <div className="tk-toast" role="status" aria-live="polite">
        {toast?.text}
      </div>
    </div>
  );
}
