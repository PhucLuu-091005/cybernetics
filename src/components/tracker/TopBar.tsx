'use client';
import type { Cr, RowFilter, TrackerState } from '../../tracker';
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
import { HiddenMenu, type HiddenMenuProps } from './HiddenMenu';
import { Icon } from './icons';
import { WorkSearch } from './Search';
import type { DrawerMode, TrackerActions, TrackerView } from './TrackerScreen';

type Props = HiddenMenuProps & {
  session: Session;
  view: TrackerView;
  cr: Cr | null;
  state: TrackerState;
  asOf: string;
  drawer: DrawerMode | null;
  actions: TrackerActions;
  onView: (view: TrackerView) => void;
  onDrawer: (mode: DrawerMode) => void;
  onActAs: (memberId: string) => void;
  onPick: (workItemId: string) => void;
  filter: RowFilter;
  onFilter: (filter: RowFilter) => void;
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
  const { session, state, asOf, drawer, onDrawer, onActAs, onPick, filter, onFilter } = props;
  const { payload, me, isOwner, dir, tz } = session;
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
      <HiddenMenu
        hidden={props.hidden}
        onUnhideTeam={props.onUnhideTeam}
        onUnhideItem={props.onUnhideItem}
        onUnhideAll={props.onUnhideAll}
      />
      <WorkSearch
        state={state}
        asOf={asOf}
        tz={tz}
        filter={filter}
        onFilter={onFilter}
        onPick={onPick}
      />
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
      {payload.project.demo && me && (
        <label className="demo">
          Demo
          <select
            aria-label="Demo: act as"
            value={me}
            onChange={(event) => onActAs(event.target.value)}
          >
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
