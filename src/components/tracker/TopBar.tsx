'use client';
import type { Cr, RowFilter, TrackerState } from '../../tracker';
import { AccountMenu, type Account } from '../shell/AccountMenu';
import { useDismissibleDetails } from '../shell/Popover';
import { Avatar } from './avatar';
import { byNumDesc, CR_STATUS, isOpen, trunc, type Session } from './ContextBar';
import { HiddenMenu, type HiddenMenuProps } from './HiddenMenu';
import { Icon } from './icons';
import { WorkSearch } from './Search';
import type { DrawerMode, TrackerActions, TrackerView } from './TrackerScreen';

type Props = HiddenMenuProps & {
  session: Session;
  /** The signed-in person, for the menu when they act as no member. */
  account: Account;
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
        aria-label={`View: ${cr ? `#${cr.num} ${cr.title}` : `Main, read-only, owner ${dir.name(owner)}`}. Switch view`}
      >
        <span className="gdot" style={{ background: cr ? dir.color(cr.author) : 'var(--ink)' }} />
        <span>{cr ? `#${cr.num} ${trunc(cr.title, 22)}` : 'Main'}</span>
        {!cr && (
          <>
            <span className="chipx">read-only</span>
            <span className="gowner">
              <Avatar id={owner} dir={dir} sm />
              <span>Owner: {dir.name(owner)}</span>
            </span>
          </>
        )}
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
  const { session, cr, state, asOf, drawer, actions, onDrawer, onActAs, onPick } = props;
  const { payload, me, dir, tz } = session;
  const ready = payload.crs.filter((c) => c.status === 'ready').length;
  const account: Account = me
    ? { name: dir.name(me), detail: dir.role(me) || undefined, color: dir.color(me) }
    : { ...props.account, detail: 'Can view' };
  return (
    <header className="p-head">
      <h1 className="sr">
        {payload.project.clientName}, {payload.project.title}
      </h1>
      <ViewMenu {...props} />
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
        filter={props.filter}
        onFilter={props.onFilter}
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
        className="btn crs-btn"
        type="button"
        aria-expanded={drawer === 'crs'}
        title="All change requests"
        onClick={() => onDrawer('crs')}
      >
        <Icon name="pr" /> {ready > 0 ? `${ready} ready to merge` : 'Change requests'}
      </button>
      {!cr && (
        <button className="btn btn-ink" type="button" onClick={actions.newCr}>
          <Icon name="plus" /> New change request
        </button>
      )}
      {payload.canActAs && me && (
        <label className="demo">
          <span className="demo-word">Demo</span>
          <select
            title="Demo: work as another member"
            aria-label="Demo: act as"
            value={me}
            onChange={(event) => onActAs(event.target.value)}
          >
            {payload.members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <AccountMenu {...account} />
    </header>
  );
}
