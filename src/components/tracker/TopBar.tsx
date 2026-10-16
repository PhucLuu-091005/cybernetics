'use client';
import type { Cr } from '../../tracker';
import { useDismissibleDetails } from '../shell/Popover';
import { Avatar } from './avatar';
import {
  asksForMe,
  byNumDesc,
  CR_STATUS,
  isOpen,
  myDrafts,
  trunc,
  type Session,
} from './ContextBar';
import { Icon } from './icons';
import type { DrawerMode, TrackerActions, TrackerView } from './TrackerScreen';

type Props = {
  session: Session;
  view: TrackerView;
  cr: Cr | null;
  hiddenCount: number;
  drawer: DrawerMode | null;
  actions: TrackerActions;
  onView: (view: TrackerView) => void;
  onDrawer: (mode: DrawerMode) => void;
  onShowAll: () => void;
  onActAs: (memberId: string) => void;
};

function ViewMenu({ session, view, cr, actions, onView, onDrawer }: Props) {
  const ref = useDismissibleDetails();
  const { payload, me, dir } = session;
  const close = () => ref.current?.removeAttribute('open');
  const pick = (next: TrackerView) => {
    close();
    onView(next);
  };
  const open = payload.crs.filter(isOpen).sort(byNumDesc);
  const owner = payload.project.ownerMemberId;
  return (
    <details ref={ref} className="gpick">
      <summary
        className="graph-btn"
        aria-label={`View: ${cr ? `#${cr.num} ${cr.title}` : 'Main'}. Switch view`}
      >
        <span className="gdot" style={{ background: cr ? dir.color(cr.author) : 'var(--ink)' }} />
        <span>{cr ? `#${cr.num} ${trunc(cr.title, 22)}` : 'Main'}</span>
        {!cr && <span className="chipx">read-only</span>}
        <Icon name="chev" size={14} />
      </summary>
      <div className="gmenu">
        <button type="button" className={view === 'main' ? 'on' : ''} onClick={() => pick('main')}>
          <span className="gdot" style={{ background: 'var(--ink)' }} />
          <span>
            Main<small>Read-only · owner {dir.name(owner)}</small>
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
        <button
          type="button"
          onClick={() => {
            close();
            actions.newCr();
          }}
        >
          <Icon name="plus" /> New change request
        </button>
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

export function TopBar(props: Props) {
  const { session, hiddenCount, drawer, onDrawer, onShowAll, onActAs } = props;
  const { payload, me, isOwner, dir } = session;
  const waiting =
    (isOwner
      ? payload.crs.filter((c) => c.status === 'ready').length
      : myDrafts(payload.crs, me).length) +
    asksForMe(payload.crs, me).reduce((n, c) => n + c.asks.length, 0);
  return (
    <header className="p-head">
      <h1 className="sr">
        {payload.project.clientName}, {payload.project.title}
      </h1>
      <ViewMenu {...props} />
      <span className="sp" />
      {hiddenCount > 0 && (
        <span className="hid-pill">
          <Icon name="eyeoff" size={13} /> {hiddenCount} hidden{' '}
          <button className="btn sm" type="button" onClick={onShowAll}>
            Show all
          </button>
        </span>
      )}
      <button
        className="btn"
        type="button"
        aria-expanded={drawer === 'list'}
        onClick={() => onDrawer('list')}
      >
        <Icon name="list" /> Work list
      </button>
      <button
        className="btn"
        type="button"
        aria-expanded={drawer === 'history'}
        onClick={() => onDrawer('history')}
      >
        <Icon name="history" /> History
      </button>
      <button
        className={`btn js-req${isOwner && waiting > 0 ? ' btn-ink' : ''}`}
        type="button"
        aria-expanded={drawer === 'crs'}
        aria-label={`Change requests, ${waiting} waiting for you`}
        onClick={() => onDrawer('crs')}
      >
        <Icon name="pr" /> <span className="lbl">Change requests</span>{' '}
        <span className="cnt">{waiting}</span>
      </button>
      {payload.project.demo && (
        <label className="demo">
          Demo
          <select
            aria-label="Demo: act as"
            value={me ?? ''}
            onChange={(event) => onActAs(event.target.value)}
          >
            {!me && <option value="">Nobody</option>}
            {payload.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {me && (
        <span className="me">
          <Avatar id={me} dir={dir} />
          <span>
            <b>{dir.name(me)}</b>
            <small>{dir.role(me)}</small>
          </span>
        </span>
      )}
    </header>
  );
}
