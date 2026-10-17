'use client';
import { useDismissibleDetails } from '../shell/Popover';
import { Icon } from './icons';
import type { HiddenList } from './view-state';

export type HiddenMenuProps = {
  hidden: HiddenList;
  onUnhideTeam: (teamId: string) => void;
  onUnhideItem: (workItemId: string) => void;
  onUnhideAll: () => void;
};

const FOCUSABLE = 'input, button, select, a[href], summary, [tabindex="0"]';

/** The menu goes away with the last hidden entry, so the focus moves to a control next to it. */
function neighbour(details: HTMLElement): HTMLElement | null {
  for (const step of ['previousElementSibling', 'nextElementSibling'] as const) {
    for (let el = details[step]; el; el = el[step]) {
      if (!(el instanceof HTMLElement)) continue;
      const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
      if (target) return target;
    }
  }
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function HiddenMenu({ hidden, onUnhideTeam, onUnhideItem, onUnhideAll }: HiddenMenuProps) {
  const ref = useDismissibleDetails();
  const { teams, items, count } = hidden;
  if (!count) return null;
  const panel = () => ref.current?.querySelector<HTMLElement>('.hid-pop');
  const close = () => {
    const details = ref.current;
    if (!details) return;
    details.open = false;
    details.querySelector('summary')?.focus();
  };
  // The row of the pressed button goes away, so the focus stays in the popup instead of falling to the page.
  const unhide = (run: () => void) => {
    const fallback = ref.current && neighbour(ref.current);
    run();
    requestAnimationFrame(() => {
      const pop = panel();
      if (pop) pop.focus({ preventScroll: true });
      else fallback?.focus({ preventScroll: true });
    });
  };
  return (
    <details
      ref={ref}
      className="hid-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) panel()?.focus({ preventScroll: true });
      }}
    >
      <summary className="hid-pill" aria-label={`${count} hidden. Show the list`}>
        <Icon name="eyeoff" size={13} /> {count} hidden <Icon name="chev" size={13} />
      </summary>
      <div className="hid-pop" role="dialog" aria-label="Hidden teams and work items" tabIndex={-1}>
        <div className="pop-h">
          <div>
            <b>Hidden from your graph</b>
            <small>Only you see this. Other people see every row.</small>
          </div>
          <button className="x" type="button" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        {teams.length > 0 && <p className="q-label">Teams</p>}
        {teams.length > 0 && (
          <ul className="hid-list">
            {teams.map((t) => (
              <li key={t.id}>
                <span className="tt">
                  <b>{t.name}</b>
                  <small>Team · {plural(t.items, 'work item')}</small>
                </span>
                <button
                  className="btn sm"
                  type="button"
                  aria-label={`Unhide ${t.name}`}
                  onClick={() => unhide(() => onUnhideTeam(t.id))}
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && <p className="q-label">Work items</p>}
        {items.length > 0 && (
          <ul className="hid-list">
            {items.map((w) => (
              <li key={w.id}>
                <span className="tt">
                  <b>{w.title}</b>
                  <small>{w.team}</small>
                </span>
                <button
                  className="btn sm"
                  type="button"
                  aria-label={`Unhide ${w.title}`}
                  onClick={() => unhide(() => onUnhideItem(w.id))}
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="hid-foot">
          <button className="btn sm btn-ink" type="button" onClick={() => unhide(onUnhideAll)}>
            <Icon name="eye" size={13} /> Unhide all
          </button>
        </div>
      </div>
    </details>
  );
}
