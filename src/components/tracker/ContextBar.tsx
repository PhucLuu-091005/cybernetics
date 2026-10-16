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
  isOwner: boolean;
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
  onView: (view: TrackerView) => void;
  onChanges: () => void;
  onRequests: () => void;
};

function NewCrButton({ actions, primary }: { actions: TrackerActions; primary?: boolean }) {
  return (
    <button className={`btn${primary ? ' btn-ink' : ''}`} type="button" onClick={actions.newCr}>
      <Icon name="plus" /> New change request
    </button>
  );
}

function MainBar({ session, actions, onView, onRequests }: Omit<Props, 'cr' | 'onChanges'>) {
  const { payload, me, isOwner, dir } = session;
  const draft = myDrafts(payload.crs, me)[0];
  const ready = payload.crs.filter((c) => c.status === 'ready').length;
  return (
    <div className="bbar main" role="region" aria-label="Main">
      <span className="bt">
        <Icon name="lock" size={14} /> Main · read-only
      </span>
      <span className="muted">
        Owner: {dir.name(payload.project.ownerMemberId)}. Every change goes through a change
        request.
      </span>
      <span className="sp" />
      {asksForMe(payload.crs, me).flatMap((c) =>
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
      {isOwner && ready > 0 && (
        <button className="btn" type="button" onClick={onRequests}>
          <Icon name="pr" /> {ready} ready to merge
        </button>
      )}
      {draft && (
        <button className="btn" type="button" onClick={() => onView(draft.num)}>
          <Icon name="pr" /> Open #{draft.num} (draft)
        </button>
      )}
      <NewCrButton actions={actions} primary />
    </div>
  );
}

export function ContextBar(props: Props) {
  const { session, cr: c, actions, onChanges } = props;
  if (!c) return <MainBar {...props} />;
  const { payload, me, isOwner, dir, projectId, tz } = session;
  const owner = payload.project.ownerMemberId;
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
        <NewCrButton actions={actions} primary />
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
      c.status === 'ready' && isOwner ? (
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
        <button className="btn btn-ink" type="button" disabled={!n} onClick={actions.markReady}>
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
            <button className="btn" type="button" onClick={actions.cancelAsk}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="muted">One person edits at a time.</span>
            <button className="btn btn-ink" type="button" onClick={actions.askToEdit}>
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
        <span className="muted">Locked. Waiting for {dir.first(owner)}.</span>
        {c.editor === me && (
          <button className="btn" type="button" onClick={actions.editAgain}>
            <Icon name="pencil" /> Edit again
          </button>
        )}
        {isOwner ? review(true, true) : review(false, false)}
      </>
    );
  }
  return (
    <div className={`bbar ${tone}`} role="region" aria-label={label}>
      {head}
      <span className="chipx">{plural(n, 'change')}</span>
      {clashes > 0 && (
        <span className="chipx warn" title={`${dir.name(owner)} picks a version when merging.`}>
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
              onClick={() => actions.handOver(ask.memberId)}
            >
              Hand over
            </button>
            <button className="btn sm" type="button" onClick={() => actions.notNow(ask.memberId)}>
              Not now
            </button>
          </div>
        ))}
    </div>
  );
}
