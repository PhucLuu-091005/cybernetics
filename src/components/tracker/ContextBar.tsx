'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  clashesOf,
  formatStamp,
  type Commit,
  type Cr,
  type CrPermission,
  type CrStatus,
  type TrackerPayload,
} from '../../tracker';
import { Avatar, Avatars, type Directory } from './avatar';
import { Icon } from './icons';
import type { TrackerActions, TrackerView } from './TrackerScreen';

export type Session = {
  projectId: string;
  payload: TrackerPayload;
  me: string | null;
  canMerge: boolean;
  canCreate: boolean;
  /** The members who may merge, the project lead first. */
  mergers: string[];
  dir: Directory;
  tz: string;
};

export const CR_STATUS: Record<CrStatus, { label: string; tone: '' | 'route' | 'ok' }> = {
  draft: { label: 'Draft', tone: '' },
  ready: { label: 'Ready to merge', tone: 'route' },
  merged: { label: 'Merged', tone: 'ok' },
  closed: { label: 'Closed', tone: '' },
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const isOpen = (c: Cr) => c.status === 'draft' || c.status === 'ready';
export const byNumDesc = (a: Cr, b: Cr) => b.num - a.num;
export const mergerNames = (session: Pick<Session, 'mergers' | 'dir'>, first = false) =>
  session.mergers.map(first ? session.dir.first : session.dir.name).join(' or ') ||
  'the project lead';

export function roleIn(c: Cr, memberId: string | null): 'author' | CrPermission {
  if (!memberId) return 'view';
  if (c.author === memberId) return 'author';
  return c.shares.find((s) => s.memberId === memberId)?.permission ?? 'view';
}
// Share gives the right to edit; only the current editor may change the change request.
export const canEditCr = (c: Cr, memberId: string | null) =>
  c.status === 'draft' && !!memberId && c.editor === memberId;
export const editorsOf = (c: Cr) => [
  c.author,
  ...c.shares.filter((s) => s.permission === 'edit').map((s) => s.memberId),
];
export const clashCount = (c: Cr, commits: readonly Commit[]) =>
  isOpen(c) ? clashesOf(c.ops, commits).length : 0;
export const myDrafts = (crs: readonly Cr[], me: string | null) =>
  crs.filter((c) => canEditCr(c, me)).sort(byNumDesc);
export const asksForMe = (crs: readonly Cr[], me: string | null) =>
  crs.filter((c) => isOpen(c) && !!me && c.editor === me && c.asks.length > 0);
export const reviewHref = (projectId: string, num: number, tab?: 'changes' | 'graph' | 'talk') =>
  `/projects/${projectId}/changes/${num}${tab ? `?tab=${tab}` : ''}`;

export function StatusChip({ cr }: { cr: Cr }) {
  const { label, tone } = CR_STATUS[cr.status];
  return <span className={`chipx${tone ? ` ${tone}` : ''}`}>{label}</span>;
}

type Props = {
  session: Session;
  cr: Cr | null;
  actions: TrackerActions;
  busy?: boolean;
  onView: (view: TrackerView) => void;
  onChanges: () => void;
};

function NewCrButton({
  session,
  actions,
  primary,
}: {
  session: Session;
  actions: TrackerActions;
  primary?: boolean;
}) {
  if (!session.canCreate) return null;
  return (
    <button className={`btn${primary ? ' btn-ink' : ''}`} type="button" onClick={actions.newCr}>
      <Icon name="plus" /> New change request
    </button>
  );
}

/** On Main the top bar holds the change request buttons, so this row shows only when something waits for you. */
function MainBar({ session, onView }: Pick<Props, 'session' | 'onView'>) {
  const { payload, me, dir } = session;
  const draft = myDrafts(payload.crs, me)[0];
  const asks = asksForMe(payload.crs, me);
  if (!draft && !asks.length) return null;
  return (
    <div className="bbar main" role="region" aria-label="Main">
      {asks.flatMap((c) =>
        c.asks.map((ask) => (
          <button
            key={`${c.num}-${ask.memberId}`}
            className="btn"
            type="button"
            onClick={() => onView(c.num)}
          >
            <Avatar id={ask.memberId} dir={dir} sm /> {dir.first(ask.memberId)} asks to edit #
            {c.num}
          </button>
        )),
      )}
      {draft && (
        <button className="btn" type="button" onClick={() => onView(draft.num)}>
          <Icon name="pr" /> Open #{draft.num} (draft)
        </button>
      )}
    </div>
  );
}

export function ContextBar(props: Props) {
  const { session, cr: c, actions, onChanges, busy = false } = props;
  if (!c) return <MainBar {...props} />;
  const { payload, me, canMerge, dir, projectId, tz } = session;
  const n = c.ops.length;
  const head = (
    <>
      <span className="bt">
        <Icon name="pr" size={14} /> #{c.num} {c.title}
      </span>
      <StatusChip cr={c} />
      <Avatars ids={editorsOf(c)} dir={dir} />
      {c.status === 'draft' && (
        <span className="chipx pen">
          <Icon name="pencil" size={11} />{' '}
          {c.editor === me ? 'You are editing' : `${dir.first(c.editor)} is editing`}
        </span>
      )}
    </>
  );
  const label = `Change request #${c.num}`;
  if (!isOpen(c)) {
    return (
      <div className="bbar main" role="region" aria-label={label}>
        {head}
        <span className="muted">
          {c.status === 'merged'
            ? `Merged into Main by ${dir.name(c.mergedBy ?? '')}, ${c.mergedAt ? formatStamp(c.mergedAt, tz) : ''}. Read-only history.`
            : `Closed by ${dir.name(c.closedBy ?? '')}. Nothing went into Main.`}
        </span>
        <span className="sp" />
        <Link className="btn" href={reviewHref(projectId, c.num)}>
          See what changed
        </Link>
        <NewCrButton session={session} actions={actions} primary />
      </div>
    );
  }
  const role = roleIn(c, me);
  const clashes = clashCount(c, payload.commits);
  const last = [...c.comments].reverse().find((x) => x.kind === 'changes' || x.kind === 'ready');
  const sentBack = c.status === 'draft' && last?.kind === 'changes';
  const review = (primary: boolean, merge: boolean) => (
    <Link className={`btn${primary ? ' btn-ink' : ''}`} href={reviewHref(projectId, c.num)}>
      {merge ? (
        <>
          <Icon name="merge" /> Review and merge
        </>
      ) : (
        'Review'
      )}
    </Link>
  );
  let tone: 'main' | 'mine' | 'other';
  let buttons: ReactNode;
  if (role === 'view') {
    tone = 'main';
    buttons =
      c.status === 'ready' && canMerge ? (
        review(true, true)
      ) : (
        <>
          <span className="muted">View only. Ask {dir.first(c.author)} for edit access.</span>
          {review(false, false)}
        </>
      );
  } else if (c.status === 'draft' && c.editor === me) {
    tone = 'mine';
    buttons = (
      <>
        <button className="btn" type="button" onClick={actions.share}>
          <Icon name="share" /> Share
        </button>
        <button className={`btn${n ? ' btn-draft' : ''}`} type="button" onClick={onChanges}>
          Changes <span className="cnt">{n}</span>
        </button>
        <button
          className="btn btn-ink"
          type="button"
          disabled={!n || busy}
          onClick={actions.markReady}
        >
          <Icon name="check" /> Mark as ready
        </button>
      </>
    );
  } else if (c.status === 'draft') {
    tone = 'other';
    const asked = c.asks.some((a) => a.memberId === me);
    buttons = (
      <>
        {asked ? (
          <>
            <span className="chipx">Waiting for {dir.first(c.editor)}</span>
            <button className="btn" type="button" disabled={busy} onClick={actions.cancelAsk}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="muted">One person edits at a time.</span>
            <button
              className="btn btn-ink"
              type="button"
              disabled={busy}
              onClick={actions.askToEdit}
            >
              <Icon name="pencil" /> Ask to edit
            </button>
          </>
        )}
        {review(false, false)}
      </>
    );
  } else {
    tone = 'other';
    buttons = (
      <>
        <span className="muted">Locked. Waiting for {mergerNames(session, true)}.</span>
        {c.editor === me && (
          <button className="btn" type="button" disabled={busy} onClick={actions.editAgain}>
            <Icon name="pencil" /> Edit again
          </button>
        )}
        {canMerge ? review(true, true) : review(false, false)}
      </>
    );
  }
  return (
    <div className={`bbar ${tone}`} role="region" aria-label={label}>
      {head}
      <span className="chipx">{plural(n, 'change')}</span>
      {clashes > 0 && (
        <span
          className="chipx warn"
          title={`${mergerNames(session)} picks a version when merging.`}
        >
          {plural(clashes, 'clash')} with Main
        </span>
      )}
      {sentBack && last && (
        <>
          <span className="chipx warn">{dir.name(last.memberId)} asked for changes</span>
          <Link className="lnk" href={reviewHref(projectId, c.num, 'talk')}>
            Read
          </Link>
        </>
      )}
      <span className="sp" />
      {buttons}
      {c.editor === me &&
        c.asks.map((ask) => (
          <div className="ask-row" key={ask.memberId} role="status">
            <Avatar id={ask.memberId} dir={dir} sm />
            <span>
              <b>{dir.name(ask.memberId)}</b> asks to edit #{c.num}.
            </span>
            <button
              className="btn sm btn-ink"
              type="button"
              disabled={busy}
              onClick={() => actions.handOver(ask.memberId)}
            >
              Hand over
            </button>
            <button
              className="btn sm"
              type="button"
              disabled={busy}
              onClick={() => actions.notNow(ask.memberId)}
            >
              Not now
            </button>
          </div>
        ))}
    </div>
  );
}

export function MainNotice({
  onClose,
  onNeverAgain,
}: {
  onClose: () => void;
  onNeverAgain: () => void;
}) {
  return (
    <div className="ro-note" role="note" aria-label="Main is read-only">
      <Icon name="lock" size={15} />
      <p>Main is read-only. To change it, create a change request.</p>
      <span className="ro-acts">
        <button className="lnk" type="button" onClick={onNeverAgain}>
          Don&apos;t show again
        </button>
      </span>
      <button className="x" type="button" aria-label="Close the notice" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
