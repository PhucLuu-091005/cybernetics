'use client';
import './tracker.css';
import './review.css';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  diffLines,
  formatStamp,
  KIND_LABEL,
  layoutTracker,
  onlyMainNote,
  toInstant,
  type Cr,
  type CrCommentKind,
  type Picks,
  type TrackerPayload,
} from '../../tracker';
import {
  openedReview,
  reviewModel,
  SKIP_REASON,
  type ReviewChange,
  type ReviewModel,
} from '../../tracker/review';
import { crAction, getTracker, type CrAction } from './api';
import { Avatar, Avatars, makeDirectory, type Directory } from './avatar';
import { editorsOf, isOpen, plural, StatusChip, trunc } from './ContextBar';
import { HiddenMenu } from './HiddenMenu';
import { Icon, KindIcon } from './icons';
import { TrackerGraph, type Reveal } from './TrackerGraph';
import { useNow, useTracker } from './TrackerScreen';
import {
  browserStore,
  EMPTY_VIEW,
  readViewState,
  hiddenList,
  revealRows,
  toggleId,
  writeViewState,
  type ViewState,
} from './view-state';
import { useTimeScale } from './scale';

export type ReviewTab = 'changes' | 'graph' | 'talk';
const TABS: ReviewTab[] = ['changes', 'graph', 'talk'];

const TLK: Record<CrCommentKind, string> = {
  created: 'created this change request',
  ready: 'marked it as ready',
  unready: 'moved it back to draft',
  changes: 'asked for changes',
  comment: 'commented',
  resolved: 'resolved clashes with Main',
  merged: 'merged it into Main',
  closed: 'closed it without merging',
  shared: 'changed who has access',
  ask: 'asked to edit',
  handover: 'handed over editing',
  decline: 'said not now',
};

const noop = () => {};

type Ctx = { dir: Directory; tz: string; cr: Cr };

function ChangeIcon({ change, size }: { change: ReviewChange; size: number }) {
  return change.d.icon ? (
    <KindIcon kind={change.d.icon} size={size} />
  ) : (
    <Icon name="pencil" size={size} />
  );
}

function headline(cr: Cr, n: number, dir: Directory, tz: string): string {
  switch (cr.status) {
    case 'draft':
      return `has ${plural(n, 'change')}. ${dir.name(cr.editor)} is editing it now.`;
    case 'ready':
      return `asks to merge ${plural(n, 'change')} into Main.`;
    case 'merged':
      return `made ${plural(n, 'change')}. ${dir.name(cr.mergedBy ?? '')} merged ${n === 1 ? 'it' : 'them'} into Main${cr.mergedAt ? ` on ${formatStamp(cr.mergedAt, tz)}` : ''}.`;
    case 'closed':
      return `made ${plural(cr.ops.length, 'change')}. ${dir.name(cr.closedBy ?? '')} closed it without merging.`;
  }
}

function CommentBox({
  label,
  className,
  sm,
  busy,
  disabled,
  onSend,
}: {
  label: string;
  className?: string;
  sm?: boolean;
  busy: boolean;
  disabled?: boolean;
  onSend: (body: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (await onSend(body)) setText('');
  };
  return (
    <form className={`cmt-in${className ? ` ${className}` : ''}`} onSubmit={submit}>
      <input
        value={text}
        placeholder={label}
        aria-label={label}
        maxLength={4000}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      <button className={`btn${sm ? ' sm' : ''}`} type="submit" disabled={busy || disabled}>
        Comment
      </button>
    </form>
  );
}

function ChangeList({
  model,
  sel,
  viewed,
  checks,
  onSelect,
}: {
  model: ReviewModel;
  sel: number;
  viewed: readonly number[];
  checks: boolean;
  onSelect: (index: number) => void;
}) {
  const n = model.changes.length;
  const seen = viewed.filter((i) => i < n).length;
  return (
    <aside className="pr-list" aria-label="Changes">
      {checks && isOpen(model.cr) ? (
        <div className="pr-prog">
          {seen} of {n} viewed
          <div className="bar">
            <i style={{ width: `${n ? (100 * seen) / n : 0}%` }} />
          </div>
        </div>
      ) : (
        <div className="pr-prog">Pick a change to find it on the graph.</div>
      )}
      {model.changes.map((change, i) => (
        <button
          key={i}
          className={`pr-item${sel === i ? ' on' : ''}`}
          type="button"
          aria-current={sel === i ? 'true' : undefined}
          onClick={() => onSelect(i)}
        >
          <ChangeIcon change={change} size={14} />
          <span>
            <b>{trunc(change.d.item, 34)}</b>
            <small>
              {change.skipped ? 'no longer applies' : change.d.change}
              {change.title && change.title !== change.d.item && ` · ${trunc(change.title, 26)}`}
              {change.clash && ' · clash'}
            </small>
          </span>
          {viewed.includes(i) && (
            <span className="vw" aria-label="Viewed">
              <Icon name="check" size={14} />
            </span>
          )}
        </button>
      ))}
      {n === 0 && <p className="tip">No change to review.</p>}
    </aside>
  );
}

function DiffCard({
  ctx,
  change,
  index,
  on,
  viewed,
  canComment,
  frozen,
  busy,
  onFind,
  onViewed,
  onComment,
}: {
  ctx: Ctx;
  change: ReviewChange;
  index: number;
  on: boolean;
  viewed: boolean;
  canComment: boolean;
  frozen: boolean;
  busy: boolean;
  onFind: () => void;
  onViewed: (checked: boolean) => void;
  onComment: (body: string, opIndex: number) => Promise<boolean>;
}) {
  const { dir, tz, cr } = ctx;
  const { op, d, event, clash, title, opIndex, skipReason } = change;
  const whyBy = 'by' in op.a && typeof op.a.by === 'string' ? op.a.by : op.by;
  const comments =
    opIndex === null
      ? []
      : cr.comments.filter((m) => m.kind === 'comment' && m.opIndex === opIndex);
  const commentHere = canComment && opIndex !== null;
  return (
    <article
      className={`dcard${on ? ' on' : ''}${skipReason ? ' skipped' : ''}`}
      id={`dc${index}`}
      aria-label={skipReason ? `${d.item}, no longer applies` : d.item}
    >
      <header>
        <ChangeIcon change={change} size={15} />
        <b>{d.item}</b>
        <span className="chipx">{skipReason ? 'No longer applies' : d.change}</span>
        {clash && <span className="chipx warn">Clash with #{clash.commit.crNum}</span>}
        {title && title !== d.item && <span className="muted">· {title}</span>}
        {op.by && (
          <span className="chg-by">
            <Avatar id={op.by} dir={dir} sm /> {dir.name(op.by)}
          </span>
        )}
        <span className="sp" />
        <button className="lnk" type="button" onClick={onFind}>
          Show on graph
        </button>
        {isOpen(cr) && (
          <label>
            <input type="checkbox" checked={viewed} onChange={(e) => onViewed(e.target.checked)} />{' '}
            Viewed
          </label>
        )}
      </header>
      {skipReason ? (
        <>
          {diffLines(op).map(([kind, text], j) => (
            <div key={j} className="dline gone">
              <span className="sr">{kind === 'del' ? 'Before: ' : 'Planned: '}</span>
              {text}
            </div>
          ))}
          <p className="skip-why">{SKIP_REASON[skipReason]}</p>
        </>
      ) : (
        diffLines({ op: op.op, d }).map(([kind, text], j) => (
          <div key={j} className={`dline ${kind}`}>
            <span className="sr">{kind === 'del' ? 'Before: ' : 'After: '}</span>
            {text}
          </div>
        ))
      )}
      {event && (
        <blockquote className="dquote">
          <b>{KIND_LABEL[event.kind]}</b> · {dir.name(event.by)} · {formatStamp(event.at, tz)}
          <br />
          {event.text}
        </blockquote>
      )}
      {d.why && (
        <blockquote className="dquote">
          <b>Why it moves</b> · {dir.name(whyBy)}
          <br />
          {d.why}
        </blockquote>
      )}
      {(comments.length > 0 || commentHere) && (
        <div className="dfoot">
          {comments.map((m) => (
            <div className="cmt" key={m.id}>
              <Avatar id={m.memberId} dir={dir} sm />
              <div>
                <b>{dir.name(m.memberId)}</b> <small>commented</small>
                <br />
                <span className="multi">{m.body}</span>
              </div>
            </div>
          ))}
          {commentHere && (
            <CommentBox
              label="Comment on this change"
              sm
              busy={busy}
              disabled={frozen}
              onSend={(body) => onComment(body, opIndex)}
            />
          )}
        </div>
      )}
    </article>
  );
}

function ClashBox({
  ctx,
  model,
  ownerName,
  canPick,
  picks,
  onPick,
}: {
  ctx: Ctx;
  model: ReviewModel;
  ownerName: string;
  canPick: boolean;
  picks: Picks;
  onPick: (key: string, side: 'main' | 'cr') => void;
}) {
  const { dir, cr } = ctx;
  const n = model.clashes.length;
  return (
    <div className="res-box" role="region" aria-label="Clashes with Main">
      <h5>
        <KindIcon kind="issue" size={15} /> {plural(n, 'clash')} with Main
      </h5>
      <p className="small muted" style={{ margin: 0 }}>
        {canPick
          ? 'Main changed the same spot after this change request started. Pick the version to keep. The change request records your pick.'
          : `Main changed the same spot after this change request started. ${ownerName} picks a version when merging.`}
      </p>
      {model.clashes.map((clash, i) => {
        const side = (value: 'main' | 'cr', label: string, text: string) => {
          const on = picks[clash.key] === value;
          const blocked = value === 'cr' && !clash.crApplies;
          const body = (
            <>
              <small>{label}</small>
              {canPick && (
                <input
                  type="radio"
                  name={`rp${i}`}
                  value={value}
                  checked={on}
                  disabled={blocked}
                  aria-describedby={blocked ? `rp${i}-note` : undefined}
                  onChange={() => onPick(clash.key, value)}
                />
              )}
              {text}
              {blocked && (
                <span className="side-note" id={`rp${i}-note`}>
                  {onlyMainNote(clash.key)}
                </span>
              )}
            </>
          );
          const cls = `side${on ? ' on' : ''}${blocked ? ' off' : ''}`;
          return canPick ? (
            <label className={cls}>{body}</label>
          ) : (
            <div className={cls}>{body}</div>
          );
        };
        return (
          <div className="conf" key={`${clash.key}-${clash.index}`}>
            <h5>{clash.label}</h5>
            <div
              className="sides"
              role={canPick ? 'radiogroup' : undefined}
              aria-label={canPick ? clash.label : undefined}
            >
              {side(
                'main',
                `Main now · from #${clash.commit.crNum} by ${dir.name(clash.fromAuthor ?? clash.commit.mergedBy)}`,
                clash.mainVal,
              )}
              {side(
                'cr',
                `This change request · by ${dir.name(clash.x.by || cr.author)}`,
                clash.crVal,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewScreen({
  payload: initial,
  projectId,
  num,
  initialTab,
  serverNow,
}: {
  payload: TrackerPayload;
  projectId: string;
  num: number;
  initialTab: ReviewTab;
  serverNow: number;
}) {
  const router = useRouter();
  const { payload: live, setPayload } = useTracker(initial, projectId);
  const [opened, setOpened] = useState<Cr | null>(
    () => initial.crs.find((c) => c.num === num) ?? null,
  );
  const { payload, changed } = useMemo(() => openedReview(live, opened), [live, opened]);
  const { project } = payload;
  const tz = project.timeZone;
  const now = useNow(serverNow);
  const asOf = project.asOf ?? toInstant(now, tz);

  const [tab, setTabState] = useState<ReviewTab>(initialTab);
  const [sel, setSel] = useState(0);
  const [view, setView] = useState<'before' | 'after'>('after');
  const { scale, onSpan, onZoom } = useTimeScale();
  const [viewed, setViewed] = useState<number[]>([]);
  const [picks, setPicks] = useState<Picks>({});
  const [asking, setAsking] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [note, setNote] = useState('');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const [hidden, setHidden] = useState<ViewState>(EMPTY_VIEW);
  const [inView, setInView] = useState<Reveal | null>(null);

  const model = useMemo(() => reviewModel(payload, num, picks), [payload, num, picks]);
  const people = model?.after.people;
  const dir = useMemo(
    () => makeDirectory(payload.members, people ?? []),
    [payload.members, people],
  );

  useEffect(() => {
    // Storage exists only in the browser, so the first render shows every row on both sides.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(readViewState(browserStore(), projectId));
  }, [projectId]);
  useEffect(() => {
    if (asking) noteRef.current?.focus();
  }, [asking]);
  useEffect(() => {
    // Cancel takes the focus, so Enter right after the first press does not close the change request.
    if (confirmClose) keepRef.current?.focus();
  }, [confirmClose]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const graphState = model ? (view === 'before' ? model.before : model.after) : null;
  const layout = useMemo(
    () =>
      graphState && model
        ? layoutTracker(
            graphState,
            {
              hiddenRows: new Set(hidden.hiddenRows),
              hiddenTeams: new Set(hidden.hiddenTeams),
              asOf,
              timeZone: tz,
              ...scale,
              offsets: live.offsets,
              ...(project.windowStart ? { windowStart: project.windowStart } : {}),
            },
            view === 'after' ? model.marks : undefined,
          )
        : null,
    [graphState, model, view, hidden, asOf, tz, scale, live.offsets, project.windowStart],
  );

  const graphHref = `/projects/${projectId}/graph?cr=${num}`;
  if (!model) {
    return (
      <div className="tk rv-page">
        <div className="rv">
          <p role="status">#{num} does not exist in this project.</p>
          <Link className="btn big" href={`/projects/${projectId}/graph`}>
            Back to the graph
          </Link>
        </div>
      </div>
    );
  }

  const { cr, changes, clashes } = model;
  const ctx: Ctx = { dir, tz, cr };
  const n = changes.length;
  const open = isOpen(cr);
  const canPick = cr.status === 'ready' && model.owner;
  const canComment = open && !!payload.me;
  const ownerName = dir.name(project.ownerMemberId);
  const eds = editorsOf(cr).filter((id) => id !== cr.author);
  const say = (text: string) => setToast({ text, at: Date.now() });
  const changeHidden = (next: ViewState) => {
    setHidden(next);
    writeViewState(browserStore(), projectId, next);
  };
  const teamOf = (id: string) => graphState?.workItems.find((w) => w.id === id)?.teamId ?? null;

  const setTab = (next: ReviewTab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`rv-tab-${next}`)?.focus();
  };
  const select = (index: number) => {
    setSel(index);
    if (tab === 'changes')
      document.getElementById(`dc${index}`)?.scrollIntoView({ block: 'nearest' });
  };
  const find = (index: number) => {
    setSel(index);
    setView('after');
    setTab('graph');
  };

  const act = async (body: CrAction): Promise<TrackerPayload | null> => {
    setBusy(true);
    const result = await crAction(projectId, num, body);
    setBusy(false);
    if (result.ok) {
      setPayload(result.data);
      // Only the owner's own decision moves the review to the revision it made.
      if (body.expectedRevision !== undefined)
        setOpened(result.data.crs.find((c) => c.num === num) ?? null);
      return result.data;
    }
    // A stale review must show what changed before the owner tries again.
    const fresh = result.error.status === 409 ? await getTracker(projectId) : null;
    if (fresh?.ok) setPayload(fresh.data);
    const moved =
      fresh?.ok && fresh.data.crs.find((c) => c.num === num)?.revision !== opened?.revision;
    say(moved ? `#${num} changed since you opened it. Press Review again.` : result.error.message);
    return null;
  };
  const merge = async () => {
    if (!model.canMerge) return;
    if (await act({ action: 'merge', picks: model.picks, expectedRevision: cr.revision }))
      router.push(graphHref);
  };
  const close = async () => {
    if (await act({ action: 'close', expectedRevision: cr.revision })) router.push(graphHref);
  };
  const sendBack = async () => {
    const text = note.trim();
    if (!text) return say('Write what should change.');
    const next = await act({
      action: 'request-changes',
      note: text,
      expectedRevision: cr.revision,
    });
    if (!next) return;
    setAsking(false);
    setNote('');
    const editor = next.crs.find((c) => c.num === num)?.editor ?? cr.editor;
    say(`#${num} is a draft again. ${dir.name(editor)} sees your note.`);
  };
  const comment = async (body: string, opIndex: number | null) =>
    !!(await act({ action: 'comment', body, opIndex }));
  const reviewAgain = () => {
    setOpened(live.crs.find((c) => c.num === num) ?? null);
    setViewed([]);
    setPicks({});
  };

  let buttons: ReactNode = (
    <Link className="btn big" href={graphHref}>
      Back to the graph
    </Link>
  );
  if (canPick)
    buttons = (
      <>
        <button
          className="btn btn-danger big"
          type="button"
          aria-expanded={confirmClose}
          aria-controls="rv-close"
          disabled={busy}
          onClick={() => {
            setAsking(false);
            setConfirmClose(true);
          }}
        >
          Close without merging
        </button>
        <button
          className="btn big"
          type="button"
          aria-expanded={asking}
          aria-controls="rv-ask"
          onClick={() => {
            setConfirmClose(false);
            setAsking((a) => !a);
          }}
        >
          <Icon name="pencil" /> Request changes
        </button>
        <button
          className="btn btn-ink big"
          type="button"
          disabled={!model.canMerge || busy}
          onClick={merge}
        >
          <Icon name="merge" /> Merge into Main
        </button>
      </>
    );

  const picked = changes[sel] ?? null;
  const focusRow = view === 'after' && picked ? picked.workItemId : null;
  const focusMs = view === 'after' && picked ? picked.milestoneId : null;
  const list = (checks: boolean) => (
    <ChangeList model={model} sel={sel} viewed={viewed} checks={checks} onSelect={select} />
  );
  const tabButton = (id: ReviewTab, label: string, count?: number) => (
    <button
      id={`rv-tab-${id}`}
      type="button"
      role="tab"
      aria-selected={tab === id}
      aria-controls="rv-panel"
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
    >
      {label}
      {count !== undefined && <span className="n">{count}</span>}
    </button>
  );

  return (
    <div className="tk rv-page">
      <div className="rv">
        <div className="cs-crumb">
          <Link className="lnk" href={graphHref}>
            ← Back
          </Link>{' '}
          · Change requests · #{cr.num}
        </div>
        <div className="cs-head">
          <div>
            <h1>
              #{cr.num} {cr.title} <StatusChip cr={cr} />
            </h1>
            <div className="cs-meta">
              <Avatar id={cr.author} dir={dir} sm />
              <span>
                <b>{dir.name(cr.author)}</b> {headline(cr, n, dir, tz)}
              </span>
              {eds.length > 0 && (
                <>
                  <span className="muted">With</span>
                  <Avatars ids={eds} dir={dir} />
                </>
              )}
              {open &&
                (clashes.length ? (
                  <span className="chipx warn">{plural(clashes.length, 'clash')} with Main</span>
                ) : (
                  <span className="chipx ok">No clashes</span>
                ))}
            </div>
          </div>
          <div className="cs-btns">{buttons}</div>
        </div>
        {changed && (
          <div className="callout warn" role="status">
            <span>This change request changed since you opened it.</span>
            <button className="btn btn-ink" type="button" onClick={reviewAgain}>
              Review again
            </button>
          </div>
        )}
        {cr.status === 'draft' && (
          <div className="callout small">
            This is a draft. Its editors can still change it. Main changes only after {ownerName}{' '}
            merges it.
          </div>
        )}
        {open && clashes.length > 0 && (
          <ClashBox
            ctx={ctx}
            model={model}
            ownerName={ownerName}
            canPick={canPick}
            picks={model.picks}
            onPick={(key, side) => setPicks((p) => ({ ...p, [key]: side }))}
          />
        )}
        {cr.status === 'merged' && cr.resolutions.length > 0 && (
          <div className="res-box ok" role="region" aria-label="Resolved before merge">
            <h5>
              <Icon name="check" size={15} /> Resolved before merge
            </h5>
            {cr.resolutions.map((x, i) => {
              const main = x.chose === 'main';
              return (
                <div className="res-item" key={i}>
                  <b>{x.label}</b>
                  <span>
                    {dir.name(x.by)} kept{' '}
                    {main ? `Main's version from #${x.from}` : 'this change request'}: &quot;
                    {main ? x.mainVal : x.crVal}&quot;
                  </span>
                  <span className="muted small">
                    Not kept: &quot;{main ? x.crVal : x.mainVal}&quot;
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {confirmClose && canPick && (
          <div className="ask-box" id="rv-close" role="group" aria-label="Close without merging">
            <b>Close #{cr.num} without merging?</b>
            <div className="row-btns">
              <button className="btn btn-danger" type="button" disabled={busy} onClick={close}>
                Close
              </button>
              <button
                ref={keepRef}
                className="btn"
                type="button"
                onClick={() => setConfirmClose(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {asking && canPick && (
          <div className="ask-box" id="rv-ask">
            <label htmlFor="rv-note">
              <b>What should change?</b>
            </label>
            <textarea
              ref={noteRef}
              id="rv-note"
              value={note}
              maxLength={4000}
              placeholder="For example: add the date Daniel promised for the report."
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="row-btns">
              <button className="btn" type="button" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button className="btn btn-ink" type="button" disabled={busy} onClick={sendBack}>
                Send back to draft
              </button>
            </div>
          </div>
        )}
        <div className="pr-tabs" role="tablist" aria-label="Review" onKeyDown={onTabKey}>
          {tabButton('changes', 'Changes', n)}
          {tabButton('graph', 'On the graph')}
          {tabButton('talk', 'Conversation', cr.comments.length)}
        </div>
        <div id="rv-panel" role="tabpanel" aria-labelledby={`rv-tab-${tab}`}>
          {tab === 'changes' && (
            <div className="pr-grid">
              {list(true)}
              <div className="pr-main">
                {changes.map((change, i) => (
                  <DiffCard
                    key={`${i}-${change.opIndex}`}
                    ctx={ctx}
                    change={change}
                    index={i}
                    on={sel === i}
                    viewed={viewed.includes(i)}
                    canComment={canComment}
                    frozen={changed}
                    busy={busy}
                    onFind={() => find(i)}
                    onViewed={(checked) =>
                      setViewed((v) =>
                        checked ? [...new Set([...v, i])] : v.filter((x) => x !== i),
                      )
                    }
                    onComment={comment}
                  />
                ))}
                {model.dropped.map((x, i) => (
                  <article className="dcard dropped" key={i} aria-label={`${x.label}, not merged`}>
                    <header>
                      <Icon name="x" size={15} />
                      <b>{x.label}</b>
                      <span className="chipx">Not merged</span>
                    </header>
                    <div className="dline add">{x.crVal}</div>
                    <div className="dfoot small">
                      {dir.name(x.by)} kept Main&apos;s version from #{x.from}: &quot;{x.mainVal}
                      &quot;
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          {tab === 'graph' && layout && (
            <>
              <div className="pr-gtools">
                <span className="seg" role="group" aria-label="Graph state">
                  <button
                    type="button"
                    aria-pressed={view === 'before'}
                    onClick={() => setView('before')}
                  >
                    Before
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === 'after'}
                    onClick={() => setView('after')}
                  >
                    After
                  </button>
                </span>
                <span className="muted small">
                  {view === 'after'
                    ? 'Yellow marks show the changes. The shaded row is the change you picked.'
                    : 'Main before this change request.'}
                </span>
                {graphState && (
                  <HiddenMenu
                    hidden={hiddenList(graphState, hidden)}
                    onUnhideTeam={(id) =>
                      changeHidden({
                        ...hidden,
                        hiddenTeams: hidden.hiddenTeams.filter((t) => t !== id),
                      })
                    }
                    onUnhideItem={(id) => changeHidden(revealRows(hidden, [id], teamOf))}
                    onUnhideAll={() => changeHidden(EMPTY_VIEW)}
                  />
                )}
              </div>
              <div className="pr-grid">
                {list(false)}
                <div className="box">
                  <TrackerGraph
                    layout={layout}
                    edit={false}
                    selectedMs={null}
                    flash={null}
                    focusRow={focusRow}
                    focusMs={focusMs}
                    onToggleRow={(id) =>
                      changeHidden({ ...hidden, hiddenRows: toggleId(hidden.hiddenRows, id) })
                    }
                    onToggleTeam={(id) =>
                      changeHidden({ ...hidden, hiddenTeams: toggleId(hidden.hiddenTeams, id) })
                    }
                    onReveal={(ids) => changeHidden(revealRows(hidden, ids, teamOf))}
                    reveal={inView}
                    onHandoff={(id) => {
                      changeHidden(revealRows(hidden, [id], teamOf));
                      setInView((r) => ({ rowId: id, key: (r?.key ?? 0) + 1 }));
                    }}
                    onPop={noop}
                    onAddEvent={noop}
                    onNewMilestone={noop}
                    onNewTeam={noop}
                    onBackground={noop}
                    onZoom={onZoom}
                    onSpan={onSpan}
                  />
                </div>
              </div>
            </>
          )}
          {tab === 'talk' && (
            <>
              <ol className="tl">
                {cr.comments.map((m) => (
                  <li key={m.id}>
                    <Avatar id={m.memberId} dir={dir} />
                    <div
                      className={`bub${m.kind === 'changes' || m.kind === 'resolved' ? ' changes' : m.kind === 'merged' ? ' ok' : ''}`}
                    >
                      <b>{dir.name(m.memberId)}</b>{' '}
                      <small className="muted">
                        {m.kind === 'comment' && m.opIndex !== null
                          ? 'commented on a change'
                          : (TLK[m.kind] ?? 'commented')}{' '}
                        · {formatStamp(m.createdAt, tz)}
                      </small>
                      {m.body && (
                        <>
                          <br />
                          <span className="multi">{m.body}</span>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {canComment && (
                <CommentBox
                  label="Write a comment"
                  className="talk-in"
                  busy={busy}
                  onSend={(body) => comment(body, null)}
                />
              )}
            </>
          )}
        </div>
      </div>
      <div className="tk-toast" role="status" aria-live="polite">
        {toast?.text}
      </div>
    </div>
  );
}
