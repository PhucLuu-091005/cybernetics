'use client';
import './tracker.css';
import { useSearchParams } from 'next/navigation';
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
  crState,
  formatDay,
  KIND_LABEL,
  layoutTracker,
  mainState,
  replayOps,
  toInstant,
  type Cr,
  type CrPermission,
  type EventKind,
  type Marks,
  type Op,
  type TrackerLayout,
  type TrackerPayload,
  type TrackerState,
} from '../../tracker';
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
  canEditCr,
  ContextBar,
  myDrafts,
  roleIn,
  trunc,
  type Session,
} from './ContextBar';
import {
  dayAtX,
  dropAction,
  markTarget,
  noonX,
  retarget,
  svgPoint,
  targetUnder,
  trackPointer,
  type DragSource,
  type DropTarget,
} from './drag';
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
import { Icon, KIND_COLOR, KindIcon } from './icons';
import { Modal, type ModalHandlers, type ModalState } from './Modals';
import { Pop, type PopTarget } from './Pops';
import { QueuePanel, type QueueTab } from './QueuePanel';
import { Toast, type ToastState } from './Toast';
import { TopBar } from './TopBar';
import { Legend, TrackerGraph, type DatePreview } from './TrackerGraph';
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
  saveRename: (workItemId: string, title: string) => void;
  changeKind: (eventId: string) => void;
  setKind: (eventId: string, kind: EventKind) => void;
  moveEvent: (eventId: string) => void;
  hideEvent: (eventId: string) => void;
  newMilestone: () => void;
  saveMilestone: (milestoneId: string, name: string, date: string) => void;
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
  saveRename: noop,
  changeKind: noop,
  setKind: noop,
  moveEvent: noop,
  hideEvent: noop,
  newMilestone: noop,
  saveMilestone: noop,
  removeFromMilestone: noop,
  addToMilestone: noop,
};

export const POLL_MS = 5000;
// The prototype keeps a pop open for clicks in these areas; the graph closes it on its own background.
const OUTSIDE_EXEMPT =
  '.p-head, .bbar, .pop, .drawer, .p-side, .empty, svg.pg, .tk-modal, .tk-toast';
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
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
// Hydration renders with the server's minute, so the T line matches the server HTML; the client clock takes over after.
export const useNow = (serverNow: number) =>
  useSyncExternalStore(everyHalfMinute, minuteNow, () => serverNow);

type Current = { state: TrackerState; marks?: Marks };

function currentState(payload: TrackerPayload, cr: Cr | null): Current {
  const main = () => ({ state: mainState(payload.base, payload.queue, payload.commits) });
  if (!cr) return main();
  // crState throws for a merged CR whose commit is not in this payload; show Main instead of a crash.
  if (cr.status === 'merged' && !payload.commits.some((c) => c.rev === cr.mergedRev)) return main();
  return crState(payload.base, payload.queue, payload.commits, cr, payload.project.timeZone);
}

const crByNum = (p: TrackerPayload, num: number) => p.crs.find((c) => c.num === num);
const withoutNum = (data: TrackerPayload & { num?: number }): TrackerPayload => {
  const copy = { ...data };
  delete copy.num;
  return copy;
};

/** An op that no longer fits the view the editor sees would come back as a 400; check it here first. */
function fits(state: TrackerState, ops: readonly OpInput[], tz: string) {
  const replay = replayOps(
    state,
    ops.map((op) => ({ ...op, rev: 0, by: 'me' }) as Op),
    tz,
  );
  return replay.entries.every((e) => !e.skipped);
}

type EditorAction = Exclude<CrAction, { action: 'merge' | 'request-changes' | 'close' }>;
type DragView = {
  cls: string;
  items: boolean;
  ghost: ReactNode;
  x: number;
  y: number;
  lifted: string | null;
};

export function TrackerScreen({
  payload: initial,
  projectId,
  serverNow,
}: {
  payload: TrackerPayload;
  projectId: string;
  /** The server's time rounded down to the minute, for a project without a demo clock. */
  serverNow: number;
}) {
  const { payload, view, setPayload, setView } = useTracker(initial, projectId);
  const { project } = payload;
  const tz = project.timeZone;
  const now = useNow(serverNow);
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
  const ownerName = dir.name(project.ownerMemberId);

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

  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [pop, setPop] = useState<(PopTarget & { view: TrackerView }) | null>(null);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [flash, setFlash] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [modal, setModal] = useState<{ key: number; state: ModalState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [preview, setPreview] = useState<DatePreview | null>(null);
  const [moving, setMoving] = useState<{ eventId: string; from: string } | null>(null);
  const [addedPop, setAddedPop] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>('events');
  const root = useRef<HTMLDivElement>(null);
  const gwrap = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const suppress = useRef(false);
  const modalKey = useRef(0);

  const showToast = useCallback(
    (text: string, undo?: () => void) =>
      setToast({ text, at: Date.now(), ...(undo ? { undo } : {}) }),
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(timer);
  }, [flash]);

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
      if (document.querySelector('.tk details[open]')) return;
      if (modal) closeModal();
      else if (moving) setMoving(null);
      else if (shownPop) closePop(true);
      else if (drawer) setDrawer(null);
    };
    // Capture runs before the view menu's own Escape handler closes it, so one Esc closes one layer.
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [modal, moving, shownPop, drawer, closePop, closeModal]);
  useEffect(() => {
    if (!shownPop) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(OUTSIDE_EXEMPT)) setPop(null);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [shownPop]);

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
  // Pointer handlers outlive the render that started a drag, and a poll can land in between.
  const live = useRef<{ payload: TrackerPayload; state: TrackerState; layout: TrackerLayout }>({
    payload,
    state,
    layout,
  });
  useLayoutEffect(() => {
    live.current = { payload, state, layout };
  });

  // An attached event gets its pop only after the payload with it has rendered.
  useLayoutEffect(() => {
    if (!addedPop) return;
    const anchor = gwrap.current?.querySelector(`svg.pg [data-act="${addedPop}"]`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAddedPop(null);
    if (anchor) setPop({ kind: 'added', id: addedPop, anchor, view });
  }, [addedPop, payload, view]);

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
    setMoving(null);
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

  // A 409 means someone wrote first: read once and retry once before the toast.
  const write = async <T extends TrackerPayload>(
    run: (p: TrackerPayload) => Promise<ApiResult<T>>,
  ): Promise<T | null> => {
    setBusy(true);
    try {
      let result = await run(live.current.payload);
      if (!result.ok && result.error.status === 409) {
        const fresh = await getTracker(projectId);
        if (fresh.ok) {
          setPayload(fresh.data);
          live.current = { ...live.current, payload: fresh.data };
          result = await run(fresh.data);
        }
      }
      if (!result.ok) {
        showToast(result.error.message);
        return null;
      }
      const next = withoutNum(result.data);
      setPayload(next);
      live.current = { ...live.current, payload: next };
      return result.data;
    } finally {
      setBusy(false);
    }
  };
  const revisionOf = (p: TrackerPayload, num: number) => crByNum(p, num)?.revision ?? 0;
  /** `seen` sends the revision the editor sees, so ready and edit again act on the changes on screen. */
  const action = (num: number, body: EditorAction, seen = false) =>
    write((p) =>
      crAction(projectId, num, seen ? { ...body, expectedRevision: revisionOf(p, num) } : body),
    );

  const undoLast = (num: number) =>
    void write((p) => removeOp(projectId, num, 'last', revisionOf(p, num)));

  const appendAll = async (num: number, ops: readonly OpInput[]) => {
    let last: TrackerPayload | null = null;
    for (const op of ops) {
      last = await write((p) => appendOp(projectId, num, op, revisionOf(p, num)));
      if (!last) return null;
    }
    const d = last && crByNum(last, num)?.ops.at(-1)?.d;
    if (d) showToast(`${d.item}: ${d.change}.`, () => undoLast(num));
    return last;
  };

  /** Spec 2.11: a change on a view the person cannot edit waits in "read-only" until they pick a CR. */
  const commitOps = (ops: OpInput[], after?: { added?: string }) => {
    if (!ops.length) return;
    setPop(null);
    setMoving(null);
    if (cr && edit) {
      if (!fits(state, ops, tz)) {
        showToast('That change does not fit this graph.');
        return;
      }
      closeModal();
      void appendAll(cr.num, ops).then((p) => {
        if (p && after?.added) setAddedPop(after.added);
      });
      return;
    }
    const earlier = modal?.state.mode === 'readonly' ? modal.state.pending : [];
    openModal({ mode: 'readonly', pending: [...earlier, ...ops] });
  };

  const onCreateCr = async (title: string, pending: OpInput[]) => {
    closeModal();
    const created = await write(() =>
      createCr(projectId, { title, ...(pending.length ? { ops: pending } : {}) }),
    );
    if (!created) return;
    setDrawer(null);
    setView(created.num);
    if (pending.length)
      showToast(
        `#${created.num} is open with your change. Main stays the same until ${ownerName} merges it.`,
        () => undoLast(created.num),
      );
    else showToast(`#${created.num} is open. Main stays the same until ${ownerName} merges it.`);
  };

  const onAddToCr = (num: number, pending: OpInput[]) => {
    closeModal();
    setView(num);
    void appendAll(num, pending);
  };

  const onEditAgain = async (pending: OpInput[]) => {
    if (!cr) return;
    const num = cr.num;
    closeModal();
    const done = await action(num, { action: 'unready' }, true);
    if (!done) return;
    if (pending.length) await appendAll(num, pending);
    else showToast(`#${num} is a draft again. Mark it as ready when you finish.`);
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

  const onMarkReady = async () => {
    if (!cr || !edit) return;
    const num = cr.num;
    if (!(await action(num, { action: 'ready' }, true))) return;
    setDrawer(null);
    showToast(`#${num} is ready. ${ownerName} can merge it now.`, () => {
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
    newCr: () => openModal({ mode: 'newcr', pending: [] }),
    share: () => openModal({ mode: 'share' }),
    markReady: () => void onMarkReady(),
    editAgain: () => void onEditAgain([]),
    askToEdit: () => void onAsk(),
    cancelAsk: () => {
      if (cr)
        void action(cr.num, { action: 'cancel-ask' }).then((p) => p && showToast('Ask cancelled.'));
    },
    handOver: (to) => void onHandOver(to),
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
      if (cr && edit) void write((p) => removeOp(projectId, cr.num, index, revisionOf(p, cr.num)));
    },
    addToQueue: (what) => openModal({ mode: 'add', what }),
    openQueueEvent: (id) =>
      state.workItems.length
        ? openModal({ mode: 'attach', eventId: id })
        : openModal({ mode: 'fromEvent', eventId: id, teamId: state.teams[0]?.id ?? '' }),
    openQueueItem: (id) => openModal({ mode: 'placeItem', itemId: id }),
    addEvent: (workItemId) => openModal({ mode: 'event', workItemId }),
    markDone: (workItemId) => openModal({ mode: 'event', workItemId, done: true }),
    moveDate: ({ kind, id }) => {
      const date =
        kind === 'ms'
          ? state.milestones.find((m) => m.id === id)?.planned
          : state.workItems.find((w) => w.id === id)?.plannedFinish;
      if (date) openModal({ mode: 'due', kind, id, date });
    },
    rename: (workItemId) => {
      const anchor = anchorOf(`[data-loop="${workItemId}"]`) ?? pop?.anchor;
      if (anchor) setPop({ kind: 'rename', id: workItemId, anchor, view });
    },
    saveRename: (workItemId, title) => {
      const item = state.workItems.find((w) => w.id === workItemId);
      if (!title || !item || title === item.title) return setPop(null);
      commitOps([{ op: 'rename', a: { workItemId, title } }]);
    },
    changeKind: (eventId) => {
      const anchor = anchorOf(`[data-act="${eventId}"]`) ?? pop?.anchor;
      if (anchor) setPop({ kind: 'kind', id: eventId, anchor, view });
    },
    setKind: (eventId, kind) => {
      if (state.events.find((e) => e.id === eventId)?.kind === kind) return setPop(null);
      commitOps([{ op: 'kind', a: { eventId, kind } }]);
    },
    moveEvent: (eventId) => {
      const ev = state.events.find((e) => e.id === eventId);
      setPop(null);
      if (ev) setMoving({ eventId, from: ev.workItemId });
    },
    hideEvent: (eventId) => commitOps([{ op: 'hide', a: { eventId } }]),
    newMilestone: () =>
      edit ? openModal({ mode: 'ms' }) : openModal({ mode: 'readonly', pending: [] }),
    saveMilestone: (milestoneId, name, date) => {
      const m = state.milestones.find((x) => x.id === milestoneId);
      if (!m) return;
      if (name && name !== m.name) commitOps([{ op: 'msName', a: { milestoneId, name } }]);
      if (date !== m.planned) openModal({ mode: 'due', kind: 'ms', id: milestoneId, date });
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
    createCr: (title, pending) => void onCreateCr(title, pending),
    addToCr: onAddToCr,
    askToEdit: () => void onAsk(),
    editAgain: (pending) => void onEditAgain(pending),
    share: (memberId, permission) => void onShare(memberId, permission),
    handOver: (to) => void onHandOver(to),
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
    const owner = nextMe === next.project.ownerMemberId;
    setPayload(next);
    setPop(null);
    setMoving(null);
    closeModal();
    setDrawer(
      owner && !drafts.length && next.crs.some((c) => c.status === 'ready')
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
    // The pointerup of a drag also ends in a click; that click must not open a pop or a modal.
    suppress.current = true;
    setTimeout(() => {
      suppress.current = false;
    }, 0);
  };

  const onDrop = (source: DragSource, target: DropTarget | null, dx: number) => {
    const done = dropAction(source, target, live.current.state, dx);
    if (done.kind === 'op')
      commitOps([done.op], done.op.op === 'attach' ? { added: done.op.a.eventId } : undefined);
    else if (done.kind === 'fromEvent')
      openModal({ mode: 'fromEvent', eventId: done.eventId, teamId: done.teamId });
    else if (done.kind === 'dismiss') void onDismiss(done.id);
    else if (done.kind === 'hint') showToast(done.text);
  };

  const dragItem = (
    event: ReactPointerEvent,
    source: DragSource,
    look: { cls: string; ghost: ReactNode; from: string | null },
  ) => {
    event.preventDefault();
    let target: DropTarget | null = null;
    const start = { clientX: event.clientX, clientY: event.clientY };
    trackPointer(start, {
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
      onDrop: (_ev, dx) => {
        endDrag();
        onDrop(source, target, dx);
      },
      onCancel: endDrag,
    });
  };

  const dragDate = (event: ReactPointerEvent, kind: 'item' | 'ms', id: string, el: Element) => {
    const svg = el.closest('svg.pg');
    const item = state.workItems.find((w) => w.id === id);
    const ms = state.milestones.find((m) => m.id === id);
    const cur = kind === 'item' ? item?.plannedFinish : ms?.planned;
    if (!(svg instanceof SVGSVGElement) || !cur) return;
    event.preventDefault();
    let day = cur;
    trackPointer(event, {
      threshold: 4,
      axis: 'x',
      onStart: () => {
        setPop(null);
        setDrag({ cls: 'drag-due', items: false, ghost: null, x: 0, y: 0, lifted: null });
      },
      onMove: (ev) => {
        const L = live.current.layout;
        const next = dayAtX(L, svgPoint(svg, ev.clientX, ev.clientY).x, tz);
        if (next === day) return;
        day = next;
        const label =
          kind === 'ms' && ms
            ? `${ms.name} · ${formatDay(next)}${next !== cur ? ` (was ${formatDay(cur)})` : ''}`
            : undefined;
        setPreview({ kind, id, x: noonX(L, next, tz), ...(label ? { label } : {}) });
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
    const t = event.target as Element;
    const qe = t.closest<HTMLElement>('[data-qevent]');
    const qi = t.closest<HTMLElement>('[data-qitem]');
    const graph = t.closest('svg.pg');
    const act = graph && t.closest<SVGElement>('[data-act]');
    const label = graph && t.closest<SVGElement>('[data-rowlabel]');
    const due = graph && t.closest<SVGElement>('[data-due]');
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
    } else if (act?.dataset.act && act.dataset.in) {
      const ev = state.events.find((x) => x.id === act.dataset.act);
      if (!ev) return;
      dragItem(
        event,
        { kind: 'event', id: ev.id, from: act.dataset.in },
        {
          cls: 'drag-act',
          from: act.dataset.in,
          ghost: (
            <div className="gact">
              <KindIcon kind={ev.kind} size={15} />
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
    } else if (due?.dataset.due) dragDate(event, 'item', due.dataset.due, due);
    else if (ms?.dataset.ms) dragDate(event, 'ms', ms.dataset.ms, ms);
  };

  const base = { session, state, asOf, onClose: () => setDrawer(null) };
  const rootCls = ['tk', drag?.cls, drag?.items && 'dragging', moving && 'moving']
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
          tab={queueTab}
          onTab={setQueueTab}
          onAdd={(tab) => actions.addToQueue(tab === 'items' ? 'item' : 'event')}
          onEvent={actions.openQueueEvent}
          onItem={actions.openQueueItem}
        />
        <div className="gwrap" ref={gwrap}>
          <div className="move-hint-slot">
            <div className="move-hint" role="status">
              {moving && 'Click the work item where this event belongs. Press Esc to cancel.'}
            </div>
          </div>
          <div className="gscroll">
            <TrackerGraph
              layout={layout}
              edit={edit}
              selectedMs={drawer?.mode === 'ms' ? drawer.id : null}
              flash={flash}
              dimmed={dimmed}
              lifted={drag?.lifted ?? null}
              preview={preview}
              moving={!!moving}
              onMoveTo={onMoveTo}
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
          <div className="bin" aria-hidden="true">
            <Icon name="trash" size={16} /> Drop here to hide or remove
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
