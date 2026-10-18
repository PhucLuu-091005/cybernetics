'use client';
import './tracker.css';
import './review.css';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  collapsedTeams,
  changedTeams,
  openTeams as openTeamsPlan,
  teamsOfOps,
  descendantsOf,
  formatDay,
  formatDeadline,
  KIND_LABEL,
  layoutTracker,
  matchRows,
  NO_FILTER,
  pruneFilter,
  teamDescendants,
  toInstant,
  windowStartFor,
  type Picks,
  type RowFilter,
  type RowMatch,
  type Cr,
  type CrPermission,
  type Density,
  type TeamToggles,
  type EventKind,
  type TrackerLayout,
  type TrackerPayload,
  type TrackerState,
  can,
  mergerIds,
} from '../../tracker';
import { openedReview, reviewModel } from '../../tracker/review';
import {
  actAs,
  addToQueue,
  appendOp,
  createCr,
  crAction,
  dismissQueueEntry,
  getTracker,
  removeOp,
  type ApiResult,
  type CrAction,
  type OpInput,
  type QueueEntry,
} from './api';
import { makeDirectory } from './avatar';
import {
  byNumDesc,
  ContextBar,
  crHref,
  MainNotice,
  mainHref,
  myDrafts,
  roleIn,
  trunc,
  type Session,
  mergerNames,
} from './ContextBar';
import { CrSide, SIDE_ID, type SideTab } from './CrSide';
import {
  dayAtX,
  deadlineX,
  dropAction,
  markTarget,
  noonX,
  retarget,
  svgPoint,
  targetUnder,
  trackPointer,
  type DragSource,
  type DropTarget,
  type PointerTrack,
} from './drag';
import {
  FocusDrawer,
  HistoryDrawer,
  MilestoneDrawer,
  RequestsDrawer,
  WorkItemDrawer,
} from './Drawers';
import { Icon, KIND_COLOR, KindIcon } from './icons';
import { Modal, type ModalHandlers, type ModalState } from './Modals';
import { currentState, fits } from './pending';
import { Pop, type PopTarget } from './Pops';
import { QueuePanel, type QueueTab } from './QueuePanel';
import { Toast, type ToastState } from './Toast';
import { TopBar } from './TopBar';
import type { Account } from '../shell/AccountMenu';
import { Legend, TrackerGraph, type DatePreview, type Reveal } from './TrackerGraph';
import {
  browserStore,
  EMPTY_VIEW,
  hiddenList,
  keepFocus,
  readDensity,
  readNoticeOff,
  readTeamOpen,
  readViewState,
  revealRows,
  toggleId,
  writeDensity,
  writeNoticeOff,
  writeTeamOpen,
  writeViewState,
  type ViewState,
} from './view-state';
import { useTimeScale } from './scale';

export type TrackerView = 'main' | number;
export type DrawerMode = 'ms' | 'item' | 'crs' | 'history';
type Drawer = { mode: Exclude<DrawerMode, 'ms' | 'item'> } | { mode: 'ms' | 'item'; id: string };
export type DateTarget = { kind: 'item' | 'ms'; id: string };

export type TrackerActions = {
  newCr: () => void;
  share: () => void;
  markReady: () => void;
  editAgain: () => void;
  askToEdit: () => void;
  cancelAsk: () => void;
  handOver: (memberId: string) => void;
  grant: (memberId: string) => void;
  notNow: (memberId: string) => void;
  cancelCr: () => void;
  requestChanges: () => void;
  merge: () => void;
  undo: () => void;
  removeChange: (index: number) => void;
  addToQueue: (what: 'event' | 'item') => void;
  openQueueEvent: (id: string) => void;
  openQueueItem: (id: string) => void;
  addEvent: (workItemId: string) => void;
  markDone: (workItemId: string) => void;
  cancelItem: (workItemId: string) => void;
  moveDate: (target: DateTarget) => void;
  saveRename: (workItemId: string, title: string) => void;
  editItem: (ops: OpInput[]) => void;
  changeKind: (eventId: string) => void;
  setKind: (eventId: string, kind: EventKind, finishes?: boolean) => void;
  moveEvent: (eventId: string) => void;
  hideEvent: (eventId: string) => void;
  newMilestone: () => void;
  newTeam: () => void;
  saveMilestone: (milestoneId: string, name: string, date: string, time: string | null) => void;
  removeFromMilestone: (workItemId: string) => void;
  addToMilestone: (workItemId: string, milestoneId: string) => void;
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
  grant: noop,
  notNow: noop,
  cancelCr: noop,
  requestChanges: noop,
  merge: noop,
  undo: noop,
  removeChange: noop,
  addToQueue: noop,
  openQueueEvent: noop,
  openQueueItem: noop,
  addEvent: noop,
  markDone: noop,
  cancelItem: noop,
  moveDate: noop,
  saveRename: noop,
  editItem: noop,
  changeKind: noop,
  setKind: noop,
  moveEvent: noop,
  hideEvent: noop,
  newMilestone: noop,
  newTeam: noop,
  saveMilestone: noop,
  removeFromMilestone: noop,
  addToMilestone: noop,
};

export const POLL_MS = 5000;
// The prototype keeps a pop open for clicks in these areas; the graph closes it on its own background.
const OUTSIDE_EXEMPT =
  '.p-head, .bbar, .pop, .drawer, .p-side, .empty, .ro-note, svg.tg, .tk-modal, .tk-toast, .zoombar, .gtools';
// These layers close themselves on Esc, so the screen leaves the rest open.
const OWN_ESCAPE =
  '.tk details[open], .tk .tsearch-pop:not([hidden]), .tk .hand-menu, .tk .field-pop, .tk .view-pop';
const MINUTE = 60_000;

const samePayload = (a: TrackerPayload, b: TrackerPayload) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Main and each change request have their own page, so a view switch is a navigation. */
export function useTracker(initial: TrackerPayload, projectId: string, num: number | null) {
  const [payload, setPayloadState] = useState(initial);
  // A poll that started before a write must not overwrite the payload the write returned.
  const writes = useRef(0);
  const setPayload = useCallback((next: TrackerPayload) => {
    writes.current += 1;
    setPayloadState(next);
  }, []);
  const router = useRouter();
  const view: TrackerView = num ?? 'main';
  const setView = useCallback(
    (next: TrackerView) => {
      if (next === view) return;
      router.push(next === 'main' ? mainHref(projectId) : crHref(projectId, next));
    },
    [router, projectId, view],
  );

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
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
// Hydration renders with the server's minute, so the T line matches the server HTML; the client clock takes over after.
export const useNow = (serverNow: number) =>
  useSyncExternalStore(everyHalfMinute, minuteNow, () => serverNow);

const crByNum = (p: TrackerPayload, num: number) => p.crs.find((c) => c.num === num);
const withoutNum = (data: TrackerPayload & { num?: number }): TrackerPayload => {
  const copy = { ...data };
  delete copy.num;
  return copy;
};

type EditorAction = Exclude<CrAction, { action: 'merge' | 'request-changes' | 'close' }>;
type Decision = Extract<CrAction, { action: 'merge' | 'request-changes' | 'close' }>;
type DragView = {
  cls: string;
  items: boolean;
  ghost: ReactNode;
  x: number;
  y: number;
  lifted: string | null;
};

/** A stack draws one group for several events, so an event below the top one points at its group. */
function eventAnchor(container: HTMLElement | null, eventId: string): Element | null {
  const svg = container?.querySelector('svg.pg');
  if (!svg) return null;
  return (
    svg.querySelector(`[data-act="${eventId}"]`) ??
    Array.from(svg.querySelectorAll('[data-stack]')).find((g) =>
      (g.getAttribute('data-stack') ?? '').split(',').includes(eventId),
    ) ??
    null
  );
}

export function TrackerScreen({
  payload: initial,
  projectId,
  userId,
  account,
  serverNow,
  num = null,
}: {
  payload: TrackerPayload;
  projectId: string;
  num?: number | null;
  /** The signed-in user, so "Don't show again" on the Main notice holds for that person only. */
  userId: string;
  account: Account;
  /** The server's time rounded down to the minute, for a project without a demo clock. */
  serverNow: number;
}) {
  const { payload: latest, view, setPayload, setView } = useTracker(initial, projectId, num);
  const latestCr = num === null ? null : (latest.crs.find((c) => c.num === num) ?? null);
  const mayEdit = !!latestCr && can(latest, 'edit', latestCr);
  // A merger decides on the version they opened; a newer revision waits behind Review again.
  const [opened, setOpened] = useState<Cr | null>(latestCr);
  const frozen = useMemo(
    () => (mayEdit ? { payload: latest, changed: false } : openedReview(latest, opened)),
    [mayEdit, latest, opened],
  );
  const payload = frozen.payload;
  const { project } = payload;
  const tz = project.timeZone;
  const now = useNow(serverNow);
  const asOf = project.asOf ?? toInstant(now, tz);
  const cr = num === null ? null : (payload.crs.find((c) => c.num === num) ?? null);
  const [picks, setPicks] = useState<Picks>({});
  const model = useMemo(
    () => (num === null ? null : reviewModel(payload, num, picks)),
    [payload, num, picks],
  );
  const [graphSide, setGraphSide] = useState<'before' | 'after'>('after');
  const before = graphSide === 'before' && !!model;
  const edit = mayEdit && !before;
  const working = useMemo(() => currentState(payload, cr), [payload, cr]);
  const current = useMemo(() => {
    if (model && before) return { state: model.before };
    if (model && !mayEdit) return { state: model.after, marks: model.marks };
    return working;
  }, [model, before, mayEdit, working]);
  // A view choice like hiding: never saved, and it leaves the hidden lists alone.
  // `grab` is true only in the action that opened the focus, so a panel that comes back after
  // another drawer closes does not take the keyboard focus from the row.
  const [focus, setFocus] = useState<{ kind: 'item' | 'team'; id: string; grab: boolean } | null>(
    null,
  );
  const { state } = current;
  const focusLive =
    !!focus &&
    (focus.kind === 'item'
      ? state.workItems.some((w) => w.id === focus.id)
      : state.teams.some((t) => t.id === focus.id));
  const focused = focusLive && focus.kind === 'item' ? focus.id : null;
  const focusedTeam = focusLive && focus.kind === 'team' ? focus.id : null;
  // A focus whose work item or team is gone from this view ends, so it does not come back by itself.
  if (focus && !focusLive) setFocus(null);
  const inFocus = useMemo(
    () =>
      focused
        ? descendantsOf(state, focused)
        : focusedTeam
          ? teamDescendants(state, focusedTeam)
          : null,
    [state, focused, focusedTeam],
  );
  const me = payload.me?.id ?? null;
  const canMerge = !!me && can(payload, 'merge');
  const canCreate = !!me && can(payload, 'create');
  const mergers = useMemo(() => mergerIds(payload), [payload]);
  const dir = useMemo(
    () => makeDirectory(payload.members, state.people),
    [payload.members, state.people],
  );
  const session: Session = useMemo(
    () => ({ projectId, payload, me, canMerge, canCreate, mergers, dir, tz }),
    [projectId, payload, me, canMerge, canCreate, mergers, dir, tz],
  );
  const mergerName = mergerNames(session);

  const [hidden, setHidden] = useState<ViewState>(EMPTY_VIEW);
  useLayoutEffect(() => {
    // Storage exists only in the browser, so hydration shows every row; this runs before the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readViewState(browserStore(), projectId));
  }, [projectId]);
  const changeHidden = (next: ViewState) => {
    setHidden(next);
    writeViewState(browserStore(), projectId, next);
  };

  const [density, setDensity] = useState<Density>('compact');
  const [teamOpen, setTeamOpen] = useState<TeamToggles>(new Map());
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDensity(readDensity(browserStore(), userId));
  }, [userId]);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTeamOpen(readTeamOpen(browserStore(), projectId));
  }, [projectId]);
  const changeDensity = (next: Density) => {
    setDensity(next);
    writeDensity(browserStore(), userId, next);
  };
  const changeTeamOpen = (next: TeamToggles) => {
    setTeamOpen(next);
    writeTeamOpen(browserStore(), projectId, next);
  };

  // Null until the browser storage is read, so the server HTML and the first render agree.
  const [noticeOff, setNoticeOff] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNoticeOff(readNoticeOff(browserStore(), userId));
  }, [userId]);
  const [noticeClosed, setNoticeClosed] = useState(false);
  const [noticeView, setNoticeView] = useState<TrackerView>(view);
  if (noticeView !== view) {
    setNoticeView(view);
    setNoticeClosed(false);
  }
  const showNotice = view === 'main' && noticeOff === false && !noticeClosed;
  const [sideOpen, setSideOpen] = useState(true);
  const [sideTab, setSideTab] = useState<SideTab>(() =>
    mayEdit && !latestCr?.ops.length ? 'queue' : 'changes',
  );
  const [sel, setSel] = useState<number | null>(null);
  const [chosenFilter, setRowFilter] = useState<RowFilter>(NO_FILTER);
  // Ids from another change request view stay chosen, but only the ids of this view filter it.
  const rowFilter = useMemo(() => pruneFilter(state, chosenFilter), [state, chosenFilter]);
  const rowMatch = useMemo(
    () => matchRows(state, rowFilter, asOf, tz),
    [state, rowFilter, asOf, tz],
  );
  const [full, setFull] = useState(false);
  const leaveFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [pop, setPop] = useState<(PopTarget & { view: TrackerView }) | null>(null);
  const [inView, setInView] = useState<Reveal | null>(null);
  const { scale, onSpan, onZoom } = useTimeScale();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modal, setModal] = useState<{ key: number; state: ModalState } | null>(null);
  // A counter, so the first of two writes in flight does not clear busy for the second.
  const [writing, setWriting] = useState(0);
  const busy = writing > 0;
  const [drag, setDrag] = useState<DragView | null>(null);
  const [preview, setPreview] = useState<DatePreview | null>(null);
  const [moving, setMoving] = useState<{ eventId: string; from: string } | null>(null);
  const [popFor, setPopFor] = useState<{ kind: 'act' | 'added' | 'kind'; id: string } | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>('events');
  const root = useRef<HTMLDivElement>(null);
  const gwrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const suppress = useRef(false);
  const modalKey = useRef(0);
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  const showToast = useCallback(
    (text: string, undo?: () => void) =>
      setToast({ text, at: Date.now(), ...(undo ? { undo } : {}) }),
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);

  const openModal = (next: ModalState) => {
    modalKey.current += 1;
    setModal({ key: modalKey.current, state: next });
    setPop(null);
    if (next.mode !== 'due') setPreview(null);
  };
  const closeModal = useCallback(() => {
    setModal(null);
    setPreview(null);
  }, []);

  const shownPop = pop && pop.view === view ? pop : null;
  const closePop = useCallback(
    (focusAnchor: boolean) => {
      if (focusAnchor && pop?.anchor instanceof SVGElement && pop.anchor.isConnected)
        pop.anchor.focus();
      setPop(null);
    },
    [pop],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector(OWN_ESCAPE)) return;
      if (modal) closeModal();
      else if (moving) setMoving(null);
      else if (shownPop) closePop(true);
      else if (drawer) setDrawer(null);
      else if (focus) setFocus(null);
      else if (full) leaveFull();
    };
    // Capture runs before the view menu's own Escape handler closes it, so one Esc closes one layer.
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [modal, moving, shownPop, drawer, focus, full, closePop, closeModal, leaveFull]);
  useEffect(() => {
    // The browser leaves full screen on its own Esc too, and the board follows it.
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    if (!shownPop) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(OUTSIDE_EXEMPT)) setPop(null);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [shownPop]);

  // Search, filters and a focus open every team; a toggle made then lasts until the graph is whole again.
  const narrowed = !!rowMatch || !!focused || !!focusedTeam;
  const narrowKey = narrowed ? JSON.stringify([rowFilter, focused, focusedTeam]) : null;
  const [activeToggles, setActiveToggles] = useState<{ key: string | null; map: TeamToggles }>({
    key: null,
    map: new Map(),
  });
  if (activeToggles.key !== narrowKey) setActiveToggles({ key: narrowKey, map: new Map() });
  const changed = useMemo(() => changedTeams(state, current.marks), [state, current.marks]);
  const collapsed = useMemo(
    () =>
      collapsedTeams(state, {
        asOf,
        timeZone: tz,
        toggles: teamOpen,
        changed,
        active: narrowed,
        activeToggles: activeToggles.map,
      }),
    [state, asOf, tz, teamOpen, changed, narrowed, activeToggles.map],
  );
  const windowStart = useMemo(
    () => windowStartFor(state, project.windowStart, asOf, tz),
    [state, project.windowStart, asOf, tz],
  );
  const layout = useMemo(
    () =>
      layoutTracker(
        state,
        {
          hiddenRows: new Set(hidden.hiddenRows),
          hiddenTeams: new Set(hidden.hiddenTeams),
          asOf,
          timeZone: tz,
          ...scale,
          focus: focused,
          focusTeam: focusedTeam,
          filter: rowMatch,
          focusButtons: true,
          density,
          collapsedTeams: collapsed,
          plusButtons: edit,
          ...(windowStart ? { windowStart } : {}),
        },
        current.marks,
      ),
    [
      state,
      hidden,
      asOf,
      tz,
      scale,
      focused,
      focusedTeam,
      rowMatch,
      windowStart,
      current.marks,
      density,
      collapsed,
      edit,
    ],
  );
  // Pointer handlers outlive the render that started a drag, and a poll can land in between.
  const live = useRef<{
    payload: TrackerPayload;
    state: TrackerState;
    layout: TrackerLayout;
  }>({ payload: latest, state, layout });
  useLayoutEffect(() => {
    live.current = { payload: latest, state, layout };
  });

  // An attached event, or an event picked in the detail drawer on a hidden row, gets its pop once it renders.
  useLayoutEffect(() => {
    if (!popFor) return;
    const anchor = eventAnchor(gwrap.current, popFor.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPopFor(null);
    if (!anchor) return;
    if (popFor.kind === 'act') anchor.scrollIntoView({ block: 'nearest', inline: 'center' });
    setPop({ kind: popFor.kind, id: popFor.id, anchor, view });
  }, [popFor, payload, view]);

  const hiddenNow = useMemo(() => hiddenList(state, hidden), [state, hidden]);
  const isHidden = (workItemId: string) => {
    const w = state.workItems.find((x) => x.id === workItemId);
    return hidden.hiddenRows.includes(workItemId) || (!!w && hidden.hiddenTeams.includes(w.teamId));
  };

  const openView = (next: TrackerView) => {
    setPop(null);
    setMoving(null);
    if (drawer && (drawer.mode === 'ms' || drawer.mode === 'item')) setDrawer(null);
    setView(next);
  };
  const toggleDrawer = (mode: Exclude<DrawerMode, 'ms' | 'item'>) => {
    setPop(null);
    setDrawer((d) => (d?.mode === mode ? null : { mode }));
  };
  const teamOf = (id: string) => state.workItems.find((w) => w.id === id)?.teamId ?? null;
  const hide = (next: ViewState) => {
    setPop(null);
    changeHidden(next);
    if (focused && !keepFocus(focused, next, teamOf)) setFocus(null);
    if (focusedTeam && next.hiddenTeams.includes(focusedTeam)) setFocus(null);
  };
  const toggleRow = (id: string) =>
    hide({ ...hidden, hiddenRows: toggleId(hidden.hiddenRows, id) });
  const toggleTeam = (id: string) =>
    hide({ ...hidden, hiddenTeams: toggleId(hidden.hiddenTeams, id) });
  /** `narrowedAfter`: the graph stays narrowed after this action, so the opening is temporary. */
  const openTeams = (teams: string[], narrowedAfter = narrowed) => {
    const plan = openTeamsPlan(
      state,
      { asOf, timeZone: tz, toggles: teamOpen, changed },
      teams,
      narrowedAfter,
    );
    if (plan.toggles) changeTeamOpen(plan.toggles);
    if (plan.active.length)
      setActiveToggles((a) => ({
        ...a,
        map: new Map([...a.map, ...plan.active.map((t) => [t, true] as const)]),
      }));
  };
  const openTeamsOf = (ids: string[], narrowedAfter = narrowed) =>
    openTeams(
      ids.map(teamOf).filter((t): t is string => !!t),
      narrowedAfter,
    );
  const toggleCollapse = (teamId: string) => {
    setPop(null);
    const open = collapsed.has(teamId);
    if (narrowed) setActiveToggles((a) => ({ ...a, map: new Map([...a.map, [teamId, open]]) }));
    else changeTeamOpen(new Map([...teamOpen, [teamId, open]]));
  };
  const setAllTeams = (open: boolean) => {
    setPop(null);
    const all = new Map(state.teams.map((t) => [t.id, open] as const));
    changeTeamOpen(new Map([...teamOpen, ...all]));
    if (narrowed) setActiveToggles((a) => ({ ...a, map: all }));
  };
  const reveal = (ids: string[]) => {
    changeHidden(revealRows(hidden, ids, teamOf));
    openTeamsOf(ids);
  };
  const filteredOut = (workItemId: string, match: RowMatch | null) =>
    !!match && !match.match.has(workItemId) && !match.context.has(workItemId);
  const bringIn = (workItemId: string, match = rowMatch) => {
    const leaveFocus = !!inFocus && !inFocus.has(workItemId);
    const clearFilters = filteredOut(workItemId, match);
    const narrowedAfter = (!!match && !clearFilters) || (!!(focused || focusedTeam) && !leaveFocus);
    if (isHidden(workItemId)) changeHidden(revealRows(hidden, [workItemId], teamOf));
    openTeamsOf([workItemId], narrowedAfter);
    if (leaveFocus) setFocus(null);
    if (clearFilters) setRowFilter(NO_FILTER);
  };
  const find = (workItemId: string) =>
    setInView((r) => ({ rowId: workItemId, key: (r?.key ?? 0) + 1 }));
  const openItem = (
    workItemId: string,
    { find: scroll = true, match = rowMatch }: { find?: boolean; match?: RowMatch | null } = {},
  ) => {
    if (!state.workItems.some((w) => w.id === workItemId)) return;
    setPop(null);
    setMoving(null);
    bringIn(workItemId, match);
    if (scroll) find(workItemId);
    setDrawer({ mode: 'item', id: workItemId });
  };
  const showRow = (workItemId: string) => {
    if (!state.workItems.some((w) => w.id === workItemId)) return;
    setPop(null);
    setMoving(null);
    bringIn(workItemId);
    find(workItemId);
  };
  const toggleFocus = (workItemId: string) => {
    setPop(null);
    setMoving(null);
    if (focused === workItemId) return setFocus(null);
    if (isHidden(workItemId)) reveal([workItemId]);
    setFocus({ kind: 'item', id: workItemId, grab: true });
    // The focus panel takes the drawer's place.
    setDrawer(null);
  };
  const toggleTeamFocus = (teamId: string) => {
    setPop(null);
    setMoving(null);
    if (focusedTeam === teamId) return setFocus(null);
    setFocus({ kind: 'team', id: teamId, grab: true });
    setDrawer(null);
  };
  /** A pick clears the typed text; the other filters stay unless they would hide the picked row. */
  const pickItem = (workItemId: string) => {
    const next = { ...rowFilter, text: '' };
    const match = matchRows(state, next, asOf, tz);
    setRowFilter(next);
    openItem(workItemId, { match });
  };
  const toggleFull = () => {
    if (full) return leaveFull();
    setFull(true);
    // Without the Fullscreen API, or when the browser refuses, the board still covers the window.
    void root.current?.requestFullscreen?.().catch(() => {});
  };
  const showEvent = (eventId: string) => {
    const ev = state.events.find((e) => e.id === eventId);
    if (!ev || ev.hidden) return;
    bringIn(ev.workItemId);
    setPop(null);
    setPopFor({ kind: 'act', id: eventId });
  };

  /**
   * A 409 means someone wrote first, so the screen reads again. Only an append retries: it adds to
   * whatever is there, while every other write acted on what the person saw and must not repeat.
   */
  const write = async <T extends TrackerPayload>(
    run: (p: TrackerPayload) => Promise<ApiResult<T>>,
    { retry = false }: { retry?: boolean } = {},
  ): Promise<T | null> => {
    setWriting((n) => n + 1);
    try {
      let result = await run(live.current.payload);
      if (!result.ok && result.error.status === 409) {
        const fresh = await getTracker(projectId);
        if (fresh.ok) {
          setPayload(fresh.data);
          live.current = { ...live.current, payload: fresh.data };
          if (retry) result = await run(fresh.data);
        }
      }
      if (!result.ok) {
        showToast(result.error.message);
        return null;
      }
      const next = withoutNum(result.data);
      setPayload(next);
      live.current = { ...live.current, payload: next };
      // The person acted on the latest version, so it becomes the one they review.
      if (num !== null) setOpened(next.crs.find((c) => c.num === num) ?? null);
      return result.data;
    } finally {
      setWriting((n) => n - 1);
    }
  };
  const revisionOf = (p: TrackerPayload, num: number) => crByNum(p, num)?.revision ?? 0;
  /** `seen` sends the revision the editor sees, so ready and edit again act on the changes on screen. */
  const action = (num: number, body: EditorAction, seen = false) =>
    write((p) =>
      crAction(projectId, num, seen ? { ...body, expectedRevision: revisionOf(p, num) } : body),
    );

  const removeAt = (num: number, index: number | 'last') => {
    const ops = crByNum(live.current.payload, num)?.ops ?? [];
    if (!ops[index === 'last' ? ops.length - 1 : index]) return;
    void write((p) => removeOp(projectId, num, index, revisionOf(p, num)));
  };
  const undoLast = (num: number) => removeAt(num, 'last');

  const appendAll = async (num: number, ops: readonly OpInput[]) => {
    let last: TrackerPayload | null = null;
    for (const op of ops) {
      last = await write((p) => appendOp(projectId, num, op, revisionOf(p, num)), {
        retry: true,
      });
      if (!last) return null;
    }
    const d = last && crByNum(last, num)?.ops.at(-1)?.d;
    if (d) showToast(`${d.item}: ${d.change}.`, () => undoLast(num));
    return last;
  };

  /** Only the editor of a draft changes the graph; every other view has no way to start a change. */
  const commitOps = (ops: OpInput[], after?: { added?: string; kindPop?: string }) => {
    if (!ops.length || !cr || !edit) return;
    if (!after?.kindPop) setPop(null);
    setMoving(null);
    if (!fits(state, ops, tz)) {
      showToast('That change does not fit this graph.');
      return;
    }
    closeModal();
    openTeams(teamsOfOps(state, ops));
    void appendAll(cr.num, ops).then((p) => {
      if (p && after?.added) setPopFor({ kind: 'added', id: after.added });
      if (p && after?.kindPop) setPopFor({ kind: 'kind', id: after.kindPop });
    });
  };

  const onCreateCr = async (title: string) => {
    closeModal();
    const created = await write(() => createCr(projectId, { title }));
    if (!created) return;
    setDrawer(null);
    setView(created.num);
    showToast(`#${created.num} is open. Main stays the same until ${mergerName} merges it.`);
  };

  const onEditAgain = async () => {
    if (!cr) return;
    const num = cr.num;
    closeModal();
    if (await action(num, { action: 'unready' }, true))
      showToast(`#${num} is a draft again. Mark it as ready when you finish.`);
  };

  const onAsk = async () => {
    if (!cr) return;
    closeModal();
    if (await action(cr.num, { action: 'ask' }))
      showToast(
        `Asked ${dir.name(cr.editor)}. You can edit after ${dir.first(cr.editor)} hands over.`,
      );
  };

  const onHandOver = async (to: string) => {
    if (!cr) return;
    closeModal();
    if (await action(cr.num, { action: 'handover', to }))
      showToast(`${dir.name(to)} edits #${cr.num} now. Ask to edit when you want it back.`);
  };

  const onShare = async (memberId: string, permission: CrPermission | 'remove') => {
    if (!cr) return;
    const added = !cr.shares.some((s) => s.memberId === memberId);
    const done = await action(cr.num, { action: 'share', memberId, permission });
    if (done && added && permission !== 'remove')
      showToast(`${dir.name(memberId)} can ${permission} #${cr.num}. Send them the link.`);
  };

  /** A decision names the revision on screen, so it never acts on changes the person did not see. */
  const decide = (body: Decision) => (cr ? write(() => crAction(projectId, cr.num, body)) : null);

  const onGrant = async (memberId: string) => {
    if (!cr) return;
    if (await action(cr.num, { action: 'share', memberId, permission: 'edit' }))
      showToast(`${dir.name(memberId)} can edit #${cr.num} now.`);
  };

  const onCancelCr = async (reason: string) => {
    if (!cr) return;
    closeModal();
    if (await decide({ action: 'close', reason, expectedRevision: cr.revision }))
      showToast(`#${cr.num} is cancelled. Nothing went into Main.`);
  };

  const onRequestChanges = async (note: string) => {
    if (!cr) return;
    closeModal();
    const next = await decide({ action: 'request-changes', note, expectedRevision: cr.revision });
    if (!next) return;
    const editor = next.crs.find((c) => c.num === cr.num)?.editor ?? cr.editor;
    showToast(`#${cr.num} is a draft again. ${dir.name(editor)} sees your note.`);
  };

  const onMerge = async () => {
    if (!cr || !model?.canMerge) return;
    const merged = await decide({
      action: 'merge',
      picks: model.picks,
      expectedRevision: cr.revision,
    });
    if (!merged) return;
    setPicks({});
    showToast(`#${cr.num} is in Main now.`);
  };

  const reviewAgain = () => {
    setOpened(latestCr);
    setPicks({});
  };

  const selectChange = (index: number) => {
    setSel(index);
    setGraphSide('after');
    const change = model?.changes[index];
    if (!change) return;
    setPop(null);
    if (change.workItemId && state.workItems.some((w) => w.id === change.workItemId)) {
      bringIn(change.workItemId);
      find(change.workItemId);
    }
  };

  const onMarkReady = async () => {
    if (!cr || !edit) return;
    const num = cr.num;
    if (!(await action(num, { action: 'ready' }, true))) return;
    setDrawer(null);
    showToast(`#${num} is ready. ${mergerName} can merge it now.`, () => {
      void action(num, { action: 'unready' }, true);
    });
  };

  const onDismiss = async (queueId: string) => {
    closeModal();
    if (await write(() => dismissQueueEntry(projectId, queueId)))
      showToast('Removed from the queue.');
  };

  const onAddToQueue = async (entry: QueueEntry) => {
    closeModal();
    if (!(await write(() => addToQueue(projectId, entry)))) return;
    setQueueTab(entry.kind === 'event' ? 'events' : 'items');
    showToast('Added to the queue. Everyone in the project sees it.');
  };

  const anchorOf = (selector: string) => gwrap.current?.querySelector(`svg.pg ${selector}`) ?? null;

  const actions: TrackerActions = {
    newCr: () => openModal({ mode: 'newcr' }),
    share: () => openModal({ mode: 'share' }),
    markReady: () => void onMarkReady(),
    editAgain: () => void onEditAgain(),
    askToEdit: () => void onAsk(),
    cancelAsk: () => {
      if (cr)
        void action(cr.num, { action: 'cancel-ask' }).then((p) => p && showToast('Ask cancelled.'));
    },
    handOver: (to) => void onHandOver(to),
    grant: (who) => void onGrant(who),
    cancelCr: () => openModal({ mode: 'cancelCr' }),
    requestChanges: () => openModal({ mode: 'requestChanges' }),
    merge: () => void onMerge(),
    notNow: (who) => {
      if (cr)
        void action(cr.num, { action: 'decline', who }).then(
          (p) => p && showToast(`${dir.name(who)} sees "Not now".`),
        );
    },
    undo: () => {
      setPop(null);
      if (cr && edit && cr.ops.length) undoLast(cr.num);
    },
    removeChange: (index) => {
      if (cr && edit) removeAt(cr.num, index);
    },
    addToQueue: (what) => openModal({ mode: 'add', what }),
    openQueueEvent: (id) =>
      state.workItems.length
        ? openModal({ mode: 'attach', eventId: id })
        : openModal({ mode: 'fromEvent', eventId: id, teamId: state.teams[0]?.id ?? '' }),
    openQueueItem: (id) => openModal({ mode: 'placeItem', itemId: id }),
    addEvent: (workItemId) => openModal({ mode: 'event', workItemId }),
    markDone: (workItemId) => openModal({ mode: 'event', workItemId, done: true }),
    cancelItem: (workItemId) => openModal({ mode: 'event', workItemId, cancel: true }),
    moveDate: ({ kind, id }) => {
      const date =
        kind === 'ms'
          ? state.milestones.find((m) => m.id === id)?.planned
          : state.workItems.find((w) => w.id === id)?.plannedFinish;
      if (date) openModal({ mode: 'due', kind, id, date });
    },
    saveRename: (workItemId, title) => {
      const item = state.workItems.find((w) => w.id === workItemId);
      if (!title || !item || title === item.title) return setPop(null);
      commitOps([{ op: 'rename', a: { workItemId, title } }]);
    },
    editItem: (ops) => commitOps(ops),
    changeKind: (eventId) => {
      const anchor = anchorOf(`[data-act="${eventId}"]`) ?? pop?.anchor;
      if (anchor) setPop({ kind: 'kind', id: eventId, anchor, view });
    },
    setKind: (eventId, kind, finishes) => {
      const ev = state.events.find((e) => e.id === eventId);
      if (ev?.kind === kind && (finishes === undefined || finishes === !!ev.finishes))
        return setPop(null);
      // A kind change to Handoff leaves it open until the person ticks the box, so no item finishes by surprise.
      commitOps([{ op: 'kind', a: { eventId, kind, ...(finishes ? { finishes: true } : {}) } }], {
        ...(kind === 'handoff' ? { kindPop: eventId } : {}),
      });
    },
    moveEvent: (eventId) => {
      const ev = state.events.find((e) => e.id === eventId);
      setPop(null);
      if (ev) setMoving({ eventId, from: ev.workItemId });
    },
    hideEvent: (eventId) => commitOps([{ op: 'hide', a: { eventId } }]),
    newMilestone: () => edit && openModal({ mode: 'ms' }),
    newTeam: () => edit && openModal({ mode: 'team' }),
    saveMilestone: (milestoneId, name, date, time) => {
      const m = state.milestones.find((x) => x.id === milestoneId);
      if (!m) return;
      if (name && name !== m.name) commitOps([{ op: 'msName', a: { milestoneId, name } }]);
      if (date !== m.planned || time !== (m.plannedTime ?? null))
        openModal({ mode: 'due', kind: 'ms', id: milestoneId, date, time });
    },
    removeFromMilestone: (workItemId) => commitOps([{ op: 'msRemove', a: { workItemId } }]),
    addToMilestone: (workItemId, milestoneId) =>
      commitOps([{ op: 'msAdd', a: { workItemId, milestoneId } }]),
  };

  const handlers: ModalHandlers = {
    toast: (text) => showToast(text),
    open: openModal,
    addToQueue: (entry) => void onAddToQueue(entry),
    dismiss: (id) => void onDismiss(id),
    commit: (ops) => commitOps(ops),
    createCr: (title) => void onCreateCr(title),
    share: (memberId, permission) => void onShare(memberId, permission),
    handOver: (to) => void onHandOver(to),
    cancelCr: (reason) => void onCancelCr(reason),
    requestChanges: (note) => void onRequestChanges(note),
  };

  const onActAs = async (memberId: string) => {
    const result = await actAs(projectId, memberId);
    if (!result.ok) {
      showToast(result.error.message);
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
    const merger = !!nextMe && can(next, 'merge');
    setPayload(next);
    setPop(null);
    setMoving(null);
    closeModal();
    // A change request page stays on its change request, seen by the next person.
    if (num !== null) {
      setOpened(next.crs.find((c) => c.num === num) ?? null);
      setPicks({});
      setDrawer(null);
      return;
    }
    setDrawer(
      merger && !drafts.length && next.crs.some((c) => c.status === 'ready')
        ? { mode: 'crs' }
        : null,
    );
    setView(draft ? draft.num : 'main');
  };

  const onMoveTo = (workItemId: string | null) => {
    const mv = moving;
    setMoving(null);
    if (!mv) return;
    if (workItemId && workItemId !== mv.from)
      commitOps([{ op: 'move', a: { eventId: mv.eventId, to: workItemId } }]);
    else showToast('Move cancelled.');
  };

  const endDrag = () => {
    setDrag(null);
    if (root.current) markTarget(root.current, null, null);
  };
  // The pointerup of a drag also ends in a click; that click must not open a pop or a modal.
  const swallowClick = () => {
    suppress.current = true;
    setTimeout(() => {
      suppress.current = false;
    }, 0);
  };
  const track = (
    start: { clientX: number; clientY: number; pointerId: number },
    t: PointerTrack,
  ) => {
    // A second touch replaces the first gesture, so the first one's ghost and marks must go too.
    if (stopDrag.current) {
      stopDrag.current();
      endDrag();
    }
    stopDrag.current = trackPointer(start, { ...t, onRelease: swallowClick });
  };

  const drop = (source: DragSource, target: DropTarget | null) => {
    const done = dropAction(source, target, live.current.state);
    if (done.kind === 'op')
      commitOps([done.op], done.op.op === 'attach' ? { added: done.op.a.eventId } : undefined);
    else if (done.kind === 'fromEvent')
      openModal({ mode: 'fromEvent', eventId: done.eventId, teamId: done.teamId });
    else if (done.kind === 'dismiss') void onDismiss(done.id);
    else if (done.kind === 'hint') showToast(done.text);
  };
  // A poll during the drag can change who edits, so the drop must use this render's handlers.
  const onDrop = useRef(drop);
  useLayoutEffect(() => {
    onDrop.current = drop;
  });

  const dragItem = (
    event: ReactPointerEvent,
    source: DragSource,
    look: { cls: string; ghost: ReactNode; from: string | null },
  ) => {
    event.preventDefault();
    let target: DropTarget | null = null;
    const start = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
    track(start, {
      threshold: 6,
      axis: 'any',
      onStart: () => {
        setPop(null);
        setDrag({
          cls: look.cls,
          items: true,
          ghost: look.ghost,
          x: start.clientX,
          y: start.clientY,
          lifted: source.kind === 'event' ? source.id : null,
        });
      },
      onMove: (ev) => {
        if (ghost.current) {
          ghost.current.style.left = `${ev.clientX}px`;
          ghost.current.style.top = `${ev.clientY}px`;
        }
        if (!root.current) return;
        const { layout: L, state: s } = live.current;
        target = retarget(source, targetUnder(root.current, L, ev.clientX, ev.clientY), s);
        markTarget(root.current, target, look.from);
      },
      onDrop: () => {
        endDrag();
        onDrop.current(source, target);
      },
      onCancel: endDrag,
    });
  };

  /** Events sit at their own time, so a drag only moves an event to another work item. */
  const dragEvent = (event: ReactPointerEvent, eventId: string, from: string) => {
    const ev = state.events.find((x) => x.id === eventId);
    if (!ev) return;
    event.preventDefault();
    const start = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
    let target: DropTarget | null = null;
    track(start, {
      threshold: 6,
      axis: 'any',
      onStart: () => {
        setPop(null);
        setDrag({
          cls: 'drag-act',
          items: true,
          ghost: (
            <div className="gact">
              <KindIcon kind={ev.kind} size={15} />
            </div>
          ),
          x: start.clientX,
          y: start.clientY,
          lifted: eventId,
        });
      },
      onMove: (e) => {
        if (ghost.current) {
          ghost.current.style.left = `${e.clientX}px`;
          ghost.current.style.top = `${e.clientY}px`;
        }
        if (!root.current) return;
        target = targetUnder(root.current, live.current.layout, e.clientX, e.clientY);
        markTarget(root.current, target, from);
      },
      onDrop: () => {
        endDrag();
        onDrop.current({ kind: 'event', id: eventId, from }, target);
      },
      onCancel: endDrag,
    });
  };

  const dragDate = (event: ReactPointerEvent, kind: 'item' | 'ms', id: string, el: Element) => {
    const svg = el.closest('svg.tg');
    const item = state.workItems.find((w) => w.id === id);
    const ms = state.milestones.find((m) => m.id === id);
    const cur = kind === 'item' ? item?.plannedFinish : ms?.planned;
    if (!(svg instanceof SVGSVGElement) || !cur) return;
    event.preventDefault();
    let day = cur;
    const time = kind === 'ms' ? ms?.plannedTime : undefined;
    track(event, {
      threshold: 4,
      axis: 'x',
      onStart: () => {
        setPop(null);
        setDrag({ cls: 'drag-due', items: false, ghost: null, x: 0, y: 0, lifted: null });
      },
      onMove: (ev) => {
        const L = live.current.layout;
        const x = svgPoint(svg, ev.clientX, ev.clientY).x;
        const next = dayAtX(L, x, tz, kind === 'ms' ? (time ?? 'end') : 'noon');
        if (next === day) return;
        day = next;
        const label =
          kind === 'ms' && ms
            ? `${ms.name} · ${formatDeadline(next, time)}${next !== cur ? ` (was ${formatDeadline(cur, time)})` : ''}`
            : formatDay(next);
        setPreview({
          kind,
          id,
          x: kind === 'ms' ? deadlineX(L, next, time, tz) : noonX(L, next, tz),
          label,
        });
      },
      onDrop: () => {
        endDrag();
        if (day !== cur) openModal({ mode: 'due', kind, id, date: day });
        else setPreview(null);
      },
      onCancel: () => {
        endDrag();
        setPreview(null);
      },
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || modal) return;
    if (!edit) return;
    const t = event.target as Element;
    const act = t.closest('svg.pg') && t.closest<SVGElement>('[data-act]');
    if (act?.dataset.act && act.dataset.in)
      return dragEvent(event, act.dataset.act, act.dataset.in);
    const qe = t.closest<HTMLElement>('[data-qevent]');
    const qi = t.closest<HTMLElement>('[data-qitem]');
    const graph = t.closest('svg.tg');
    const label = graph && t.closest<SVGElement>('[data-rowlabel]');
    const ms = graph && t.closest<SVGElement>('[data-ms]');
    if (qe?.dataset.qevent) {
      const ev = state.queue.events.find((x) => x.id === qe.dataset.qevent);
      if (!ev) return;
      dragItem(
        event,
        { kind: 'queueEvent', id: ev.id },
        {
          cls: 'drag-email',
          from: null,
          ghost: (
            <div className="qc" style={{ ['--kc' as string]: KIND_COLOR[ev.kind], width: 220 }}>
              <span className="qk">
                <KindIcon kind={ev.kind} size={12} /> {KIND_LABEL[ev.kind]}
              </span>
              <div className="qt">{trunc(ev.text, 70)}</div>
            </div>
          ),
        },
      );
    } else if (qi?.dataset.qitem) {
      const it = state.queue.items.find((x) => x.id === qi.dataset.qitem);
      if (!it) return;
      dragItem(
        event,
        { kind: 'queueItem', id: it.id },
        {
          cls: 'drag-qitem',
          from: null,
          ghost: (
            <div className="grow">
              <Icon name="loop" size={12} /> {trunc(it.title, 32)}
            </div>
          ),
        },
      );
    } else if (label?.dataset.rowlabel) {
      const id = label.dataset.rowlabel;
      const item = state.workItems.find((w) => w.id === id);
      if (!item) return;
      dragItem(
        event,
        { kind: 'row', id },
        {
          cls: 'drag-row',
          from: id,
          ghost: <div className="grow">{trunc(item.title, 30)}</div>,
        },
      );
    } else if (ms?.dataset.ms) dragDate(event, 'ms', ms.dataset.ms, ms);
  };

  const base = { session, state, asOf, busy, onClose: () => setDrawer(null) };
  const rootCls = [
    'tk board',
    drag?.cls,
    drag?.items && 'dragging',
    moving && 'moving',
    full && 'fullview',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={root}
      className={rootCls}
      onPointerDown={onPointerDown}
      onClickCapture={(event) => {
        if (!suppress.current) return;
        suppress.current = false;
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <TopBar
        session={session}
        account={account}
        userId={userId}
        state={state}
        asOf={asOf}
        drawer={drawer?.mode ?? null}
        actions={actions}
        onDrawer={(mode) => mode !== 'ms' && mode !== 'item' && toggleDrawer(mode)}
        onActAs={(id) => void onActAs(id)}
        onPick={pickItem}
        filter={rowFilter}
        onFilter={setRowFilter}
      />
      <ContextBar
        session={session}
        cr={cr}
        actions={actions}
        busy={busy}
        onView={openView}
        onDrawer={toggleDrawer}
        hidden={{
          hidden: hiddenNow,
          onUnhideTeam: (id) =>
            changeHidden({ ...hidden, hiddenTeams: hidden.hiddenTeams.filter((t) => t !== id) }),
          onUnhideItem: (id) => reveal([id]),
          onUnhideAll: () => changeHidden(EMPTY_VIEW),
        }}
        {...(model
          ? {
              review: {
                canMerge: model.canMerge,
                changed: frozen.changed,
                onReviewAgain: reviewAgain,
              },
            }
          : {})}
      />
      {showNotice && (
        <MainNotice
          onClose={() => setNoticeClosed(true)}
          onNeverAgain={() => {
            setNoticeOff(true);
            writeNoticeOff(browserStore(), userId);
          }}
        />
      )}
      <div className="p-body">
        {model && sideOpen && (
          <CrSide
            session={session}
            model={model}
            edit={edit}
            tab={sideTab}
            sel={sel}
            canPick={model.cr.status === 'ready' && can(payload, 'merge') && !frozen.changed}
            busy={busy}
            actions={actions}
            queueCount={working.state.queue.events.length + working.state.queue.items.length}
            queue={
              <QueuePanel
                state={working.state}
                dir={dir}
                tz={tz}
                tab={queueTab}
                onTab={setQueueTab}
                onAdd={(tab) => actions.addToQueue(tab === 'items' ? 'item' : 'event')}
                onEvent={actions.openQueueEvent}
                onItem={actions.openQueueItem}
              />
            }
            onTab={setSideTab}
            onSelect={selectChange}
            onPick={(key, value) => setPicks((p) => ({ ...p, [key]: value }))}
            onHide={() => setSideOpen(false)}
          />
        )}
        <div className="gwrap" ref={gwrap}>
          {model && (
            <div className="gtools">
              {!sideOpen && (
                <button
                  className="btn sm"
                  type="button"
                  aria-expanded="false"
                  aria-controls={SIDE_ID}
                  title="Show the side panel"
                  onClick={() => setSideOpen(true)}
                >
                  <Icon name="sidebar" size={14} /> {mayEdit ? 'Changes and Queue' : 'Changes'}{' '}
                  <span className="cnt">{model.changes.length}</span>
                </button>
              )}
              <span className="seg" role="group" aria-label="Graph state">
                <button
                  type="button"
                  aria-pressed={graphSide === 'before'}
                  onClick={() => {
                    setPop(null);
                    setMoving(null);
                    setGraphSide('before');
                  }}
                >
                  Before
                </button>
                <button
                  type="button"
                  aria-pressed={graphSide === 'after'}
                  onClick={() => setGraphSide('after')}
                >
                  After
                </button>
              </span>
              <span className="muted small">
                {before
                  ? 'Main before this change request. Switch to After to edit.'
                  : mayEdit
                    ? 'Yellow marks show your changes. Drag from the Queue onto the graph.'
                    : 'Yellow marks show the changes.'}
              </span>
            </div>
          )}
          <div className="gcanvas" ref={canvas}>
            <div className="move-hint-slot">
              <div className="move-hint" role="status">
                {moving && 'Click the work item where this event belongs. Press Esc to cancel.'}
              </div>
            </div>
            <TrackerGraph
              layout={layout}
              edit={edit}
              focusRow={!before && sel !== null ? (model?.changes[sel]?.workItemId ?? null) : null}
              focusMs={!before && sel !== null ? (model?.changes[sel]?.milestoneId ?? null) : null}
              selectedMs={drawer?.mode === 'ms' ? drawer.id : null}
              selectedRow={drawer?.mode === 'item' ? drawer.id : null}
              flash={null}
              lifted={drag?.lifted ?? null}
              preview={preview}
              moving={!!moving}
              reveal={inView}
              onZoom={onZoom}
              onSpan={onSpan}
              opening={scale.span !== undefined && scale.dayWidth === undefined}
              onMoveTo={onMoveTo}
              onToggleRow={toggleRow}
              onToggleTeam={toggleTeam}
              onReveal={reveal}
              onFocusItem={toggleFocus}
              onFocusTeam={toggleTeamFocus}
              onHandoff={showRow}
              onRow={(id) => openItem(id, { find: false })}
              onPop={(kind, id, anchor) => setPop({ kind, id, anchor, view })}
              onMilestone={(id) => {
                setPop(null);
                setDrawer({ mode: 'ms', id });
              }}
              onAddEvent={actions.addEvent}
              onNewMilestone={actions.newMilestone}
              onNewTeam={actions.newTeam}
              onBackground={() => setPop(null)}
              full={full}
              onFull={toggleFull}
              onCollapse={toggleCollapse}
              density={density}
              onDensity={changeDensity}
              onExpandAll={() => setAllTeams(true)}
              onCollapseAll={() => setAllTeams(false)}
            />
            {edit && (
              <div className="bin" aria-hidden="true">
                <Icon name="trash" size={16} /> Drop here to hide or remove
              </div>
            )}
            {shownPop && (
              <Pop
                key={`${shownPop.kind}-${shownPop.id}`}
                target={shownPop}
                container={canvas}
                state={state}
                dir={dir}
                tz={tz}
                asOf={asOf}
                edit={edit}
                actions={actions}
                onClose={() => closePop(true)}
                // The pop sits on the row, so the row is in view already.
                onDetails={(id) => openItem(id, { find: false })}
              />
            )}
            {state.workItems.length === 0 && (
              <div className="empty">
                <h4>This project has no work yet.</h4>
                {edit ? (
                  <>
                    <ol>
                      <li>Add work items and events. They wait in the Queue on the left.</li>
                      <li>Drag a work item onto a team, then drag events onto the work item.</li>
                      <li>Mark the change request as ready, and {mergerName} merges it.</li>
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
                      <button className="btn big" type="button" onClick={actions.newTeam}>
                        <Icon name="plus" /> New team
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <ol>
                      <li>Press New change request. Main stays read-only.</li>
                      <li>
                        In the change request, add work items and events, then drag them onto the
                        graph.
                      </li>
                      <li>Mark the change request as ready, and {mergerName} merges it.</li>
                    </ol>
                    {!cr && canCreate && (
                      <div className="row-btns">
                        <button className="btn btn-ink big" type="button" onClick={actions.newCr}>
                          <Icon name="plus" /> New change request
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {drawer?.mode === 'item' && (
            <WorkItemDrawer
              key={`${view}-${drawer.id}`}
              {...base}
              itemId={drawer.id}
              edit={edit}
              hidden={isHidden(drawer.id)}
              actions={actions}
              onPick={(id) => openItem(id)}
              onEvent={showEvent}
              onMilestone={(id) => {
                setPop(null);
                setDrawer({ mode: 'ms', id });
              }}
              onToggleRow={(id) => (isHidden(id) ? reveal([id]) : toggleRow(id))}
            />
          )}
          {drawer?.mode === 'ms' && (
            <MilestoneDrawer
              key={`${view}-${drawer.id}`}
              {...base}
              milestoneId={drawer.id}
              edit={edit}
              actions={actions}
              onPick={(id) => openItem(id)}
            />
          )}
          {drawer?.mode === 'crs' && (
            <RequestsDrawer {...base} actions={actions} onView={openView} />
          )}
          {drawer?.mode === 'history' && <HistoryDrawer {...base} onView={openView} />}
          {!drawer && focus && focusLive && (
            <FocusDrawer
              key={`${focus.kind}-${focus.id}`}
              {...base}
              focus={focus}
              isHidden={isHidden}
              grab={focus?.grab ?? false}
              onGrabbed={() => setFocus((f) => f && { ...f, grab: false })}
              onClose={() => setFocus(null)}
              onFocus={toggleFocus}
              onShow={showRow}
            />
          )}
        </div>
      </div>
      <Legend />
      {modal && (
        <Modal
          key={modal.key}
          modal={modal.state}
          session={session}
          state={state}
          cr={cr}
          asOf={asOf}
          busy={busy}
          on={handlers}
          onClose={closeModal}
        />
      )}
      {drag?.ghost && (
        <div ref={ghost} className="ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          {drag.ghost}
        </div>
      )}
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
