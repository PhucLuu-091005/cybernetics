'use client';
import type { RowFilter, TrackerState } from '../../tracker';
import { AccountMenu, type Account } from '../shell/AccountMenu';
import { can } from './can';
import type { Session } from './ContextBar';
import { HiddenMenu, type HiddenMenuProps } from './HiddenMenu';
import { Icon } from './icons';
import { WorkSearch } from './Search';
import type { DrawerMode, TrackerActions } from './TrackerScreen';

type Props = HiddenMenuProps & {
  session: Session;
  /** The signed-in person, for the menu when they act as no member. */
  account: Account;
  userId: string;
  state: TrackerState;
  asOf: string;
  drawer: DrawerMode | null;
  actions: TrackerActions;
  onDrawer: (mode: DrawerMode) => void;
  onActAs: (memberId: string) => void;
  onPick: (workItemId: string) => void;
  filter: RowFilter;
  onFilter: (filter: RowFilter) => void;
};

export function TopBar(props: Props) {
  const { session, state, asOf, drawer, actions, onDrawer, onActAs, onPick } = props;
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
      <WorkSearch
        state={state}
        asOf={asOf}
        tz={tz}
        filter={props.filter}
        onFilter={props.onFilter}
        onPick={onPick}
      />
      <HiddenMenu
        hidden={props.hidden}
        onUnhideTeam={props.onUnhideTeam}
        onUnhideItem={props.onUnhideItem}
        onUnhideAll={props.onUnhideAll}
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
        aria-label={ready > 0 ? `Change requests, ${ready} ready to merge` : undefined}
        onClick={() => onDrawer('crs')}
      >
        <Icon name="pr" /> Change requests
        {ready > 0 && (
          <span className="nbadge" aria-hidden="true">
            {ready}
          </span>
        )}
      </button>
      {can(payload, 'create') && (
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
              .filter((m) => m.active && (m.userId === null || m.userId === props.userId))
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
