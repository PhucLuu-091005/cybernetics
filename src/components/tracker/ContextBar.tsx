'use client';
import type { ReactNode } from 'react';
import {
  can,
  clashesOf,
  formatStamp,
  type Commit,
  type Cr,
  type CrPermission,
  type CrStatus,
  type TrackerPayload,
} from '../../tracker';
import { useDismissibleDetails } from '../shell/Popover';
import { Avatar, Avatars, type Directory } from './avatar';
import { HiddenMenu, type HiddenMenuProps } from './HiddenMenu';
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
  onDrawer: (mode: 'crs') => void;
  review?: {
    canMerge: boolean;
    changed: boolean;
    onReviewAgain: () => void;
    applying: number;
    inMain: boolean;
  };
  /** Without it, the bar has no hidden badge. */
  hidden?: HiddenMenuProps;
};

export const crHref = (projectId: string, num: number) => `/projects/${projectId}/changes/${num}`;
export const mainHref = (projectId: string) => `/projects/${projectId}/graph`;

/** The last cancel note, kept as the body of the `closed` comment. */
export const closeReason = (c: Cr) =>
  [...c.comments].reverse().find((m) => m.kind === 'closed')?.body ?? null;

function ViewMenu({ session, cr, actions, onView, onDrawer }: Props) {
  const ref = useDismissibleDetails();
  const { payload, me, dir } = session;
  const close = () => ref.current?.removeAttribute('open');
  const pick = (next: TrackerView) => {
    close();
    onView(next);
  };
  const open = payload.crs.filter(isOpen).sort(byNumDesc);
  const lead = payload.project.leadMemberId;
  const view: TrackerView = cr ? cr.num : 'main';
  return (
    <details ref={ref} className="gpick">
      <summary
        className="vsel"
        aria-label={`View: ${cr ? `#${cr.num} ${cr.title}` : `Main, read-only, project lead ${dir.name(lead)}`}. Switch view`}
      >
        <Icon name={cr ? 'pr' : 'lock'} size={15} />
        <span className="vtitle">{cr ? `#${cr.num} ${cr.title}` : 'Main'}</span>
        <Icon name="chev" size={14} />
      </summary>
      <div className="gmenu">
        <button type="button" className={view === 'main' ? 'on' : ''} onClick={() => pick('main')}>
          <Icon name="lock" size={15} />
          <span>
            Main<small>Read-only · project lead {dir.name(lead)}</small>
          </span>
        </button>
        {open.length > 0 && <hr />}
        {open.map((c) => (
          <button
            key={c.num}
            type="button"
            className={view === c.num ? 'on' : ''}
            onClick={() => pick(c.num)}
          >
            <Avatar id={c.author} dir={dir} sm />
            <span>
              #{c.num} {trunc(c.title, 30)}
              <small>
                {CR_STATUS[c.status].label} · {dir.name(c.author)}
                {c.status === 'draft' &&
                  (c.editor === me ? ' · you are editing' : ` · ${dir.first(c.editor)} is editing`)}
                {c.asks.length > 0 &&
                  c.editor === me &&
                  ` · ${dir.first(c.asks[0].memberId)} asks to edit`}
              </small>
            </span>
          </button>
        ))}
        <hr />
        {can(payload, 'create') && (
          <button
            type="button"
            onClick={() => {
              close();
              actions.newCr();
            }}
          >
            <Icon name="plus" /> New change request
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            close();
            onDrawer('crs');
          }}
        >
          <Icon name="list" /> All change requests
        </button>
      </div>
    </details>
  );
}

function MainBar(props: Props) {
  const { session, onView } = props;
  const { payload, me, dir } = session;
  const lead = payload.project.leadMemberId;
  const asks = asksForMe(payload.crs, me);
  return (
    <div className="bbar main" role="region" aria-label="Main">
      <ViewMenu {...props} />
      <span className="chipx">read-only</span>
      <span className="gowner">
        <Avatar id={lead} dir={dir} sm />
        <span>Lead: {dir.name(lead)}</span>
      </span>
      <span className="sp" />
      {asks.flatMap((c) =>
        c.asks.map((ask) => (
          <button
            key={`${c.num}-${ask.memberId}`}
            className="btn"
            type="button"
            onClick={() => onView(c.num)}
          >
            <Avatar id={ask.memberId} dir={dir} sm /> {dir.first(ask.memberId)}{' '}
            {roleIn(c, ask.memberId) === 'view' ? 'asks for access to' : 'asks to edit'} #{c.num}
          </button>
        )),
      )}
      {props.hidden && <HiddenMenu {...props.hidden} />}
    </div>
  );
}

function AskRow({
  c,
  memberId,
  session,
  actions,
  busy,
}: {
  c: Cr;
  memberId: string;
  session: Session;
  actions: TrackerActions;
  busy: boolean;
}) {
  const { dir } = session;
  const access = roleIn(c, memberId) === 'view';
  return (
    <div className="ask-row" role="status">
      <Avatar id={memberId} dir={dir} sm />
      <span>
        <b>{dir.name(memberId)}</b>{' '}
        {access ? `asks for edit access to #${c.num}.` : `asks to edit #${c.num}.`}
      </span>
      <button
        className="btn sm btn-ink"
        type="button"
        disabled={busy}
        onClick={() => (access ? actions.grant(memberId) : actions.handOver(memberId))}
      >
        {access ? 'Grant Can edit' : 'Hand over'}
      </button>
      <button
        className="btn sm"
        type="button"
        disabled={busy}
        onClick={() => actions.notNow(memberId)}
      >
        Not now
      </button>
    </div>
  );
}

export function ContextBar(props: Props) {
  const { session, cr: c, actions, busy = false, review } = props;
  const hiddenBadge = !!props.hidden?.hidden.count && <HiddenMenu {...props.hidden} />;
  if (!c) return <MainBar {...props} />;
  const { payload, me, dir, tz } = session;
  const n = review?.applying ?? c.ops.length;
  const open = isOpen(c);
  const label = `Change request #${c.num}`;
  const head = (
    <>
      <ViewMenu {...props} />
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
  if (!open) {
    const reason = closeReason(c);
    return (
      <div className="bbar main" role="region" aria-label={label}>
        {head}
        <span className="muted">
          {c.status === 'merged'
            ? `Merged into Main by ${dir.name(c.mergedBy ?? '')}${c.mergedAt ? `, ${formatStamp(c.mergedAt, tz)}` : ''}. Read-only history.`
            : `Cancelled by ${dir.name(c.closedBy ?? '')}${c.closedAt ? `, ${formatStamp(c.closedAt, tz)}` : ''}. Nothing went into Main.`}
        </span>
        {hiddenBadge && <span className="sp" />}
        {hiddenBadge}
        {c.status === 'closed' && reason && (
          <p className="bnote">
            <b>Reason:</b> <span className="multi">{reason}</span>
          </p>
        )}
      </div>
    );
  }
  const role = roleIn(c, me);
  const editor = !!me && c.editor === me;
  const merger = can(payload, 'merge');
  const asked = !!me && c.asks.some((a) => a.memberId === me);
  const clashes = clashCount(c, payload.commits);
  const last = [...c.comments].reverse().find((x) => x.kind === 'changes' || x.kind === 'ready');
  const sentBack = c.status === 'draft' && last?.kind === 'changes' ? last : null;
  const cancel = can(payload, 'cancel', c) && (
    <button className="btn" type="button" disabled={busy} onClick={actions.cancelCr}>
      Cancel change request
    </button>
  );
  const share = can(payload, 'share', c) && (
    <button className="btn" type="button" onClick={actions.share}>
      <Icon name="share" /> Share
    </button>
  );
  let tone: 'main' | 'mine' | 'other' = 'other';
  let buttons: ReactNode = null;
  if (c.status === 'draft' && editor) {
    tone = 'mine';
    buttons = (
      <>
        {review?.inMain && <span className="muted">Every change is already in Main.</span>}
        {share}
        {cancel}
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
  } else if (c.status === 'ready') {
    tone = merger ? 'main' : 'other';
    buttons = (
      <>
        {!merger && (
          <span className="muted">Locked. Waiting for {mergerNames(session, true)}.</span>
        )}
        {share}
        {editor && (
          <button className="btn" type="button" disabled={busy} onClick={actions.editAgain}>
            <Icon name="pencil" /> Edit again
          </button>
        )}
        {cancel}
        {merger && (
          <>
            <button
              className="btn"
              type="button"
              disabled={busy || review?.changed}
              onClick={actions.requestChanges}
            >
              <Icon name="pencil" /> Request changes
            </button>
            <button
              className="btn btn-ink"
              type="button"
              disabled={!review?.canMerge || review.changed || busy}
              title={review?.canMerge ? undefined : 'Pick a version for each clash first.'}
              onClick={actions.merge}
            >
              <Icon name="merge" /> Merge into Main
            </button>
          </>
        )}
      </>
    );
  } else if (!me) {
    tone = 'main';
    buttons = <span className="muted">View only.</span>;
  } else if (asked) {
    buttons = (
      <>
        <span className="chipx">Waiting for {dir.first(c.editor)}</span>
        <button className="btn" type="button" disabled={busy} onClick={actions.cancelAsk}>
          Cancel
        </button>
        {cancel}
      </>
    );
  } else if (!can(payload, 'ask', c)) {
    tone = 'main';
    buttons = (
      <>
        <span className="muted">View only.</span>
        {cancel}
      </>
    );
  } else if (role === 'view') {
    tone = 'main';
    buttons = (
      <>
        <span className="muted">View only.</span>
        {cancel}
        <button className="btn btn-ink" type="button" disabled={busy} onClick={actions.askToEdit}>
          <Icon name="pencil" /> Ask for edit access
        </button>
      </>
    );
  } else {
    buttons = (
      <>
        <span className="muted">One person edits at a time.</span>
        {cancel}
        <button className="btn btn-ink" type="button" disabled={busy} onClick={actions.askToEdit}>
          <Icon name="pencil" /> Ask to edit
        </button>
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
      <span className="sp" />
      {buttons}
      {hiddenBadge}
      {review?.changed && (
        <div className="ask-row" role="status">
          <span>This change request changed since you opened it.</span>
          <button className="btn sm btn-ink" type="button" onClick={review.onReviewAgain}>
            Review again
          </button>
        </div>
      )}
      {sentBack && (
        <p className="bnote">
          <b>{dir.name(sentBack.memberId)} asked for changes:</b>{' '}
          <span className="multi">{sentBack.body}</span>
        </p>
      )}
      {editor &&
        c.asks.map((ask) => (
          <AskRow
            key={ask.memberId}
            c={c}
            memberId={ask.memberId}
            session={session}
            actions={actions}
            busy={busy}
          />
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
