'use client';
import { useId } from 'react';
import { useDemoMode } from './demo-mode';
import { RailIcon } from './icons';
import { useDismissibleDetails } from './Popover';
import { THEME_LABEL, THEMES, useTheme } from './theme';

export type Account = { name: string; detail?: string; color?: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function AccountMenu({ name, detail, color }: Account) {
  const ref = useDismissibleDetails();
  const [theme, setTheme] = useTheme();
  const themeLabel = useId();
  const demo = useDemoMode();
  const signOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    // A full load drops every cached page, and replace keeps Back off the signed-in page. Plain /signin,
    // so the next person who signs in does not land on this page.
    window.location.replace('/signin');
  };
  return (
    <details ref={ref} className="acct me">
      <summary aria-label={`${name}: theme and ${demo ? 'start over' : 'sign out'}`} title={name}>
        <span className="acct-av" style={color ? { background: color } : undefined}>
          {initials(name)}
        </span>
        <span className="acct-names">
          <b>{name}</b>
          {detail && <small>{detail}</small>}
        </span>
        <RailIcon name="chevron" />
      </summary>
      <div className="acct-pop">
        <p className="acct-who">
          {name}
          {detail && <small>{detail}</small>}
        </p>
        {demo && <p className="acct-note">Your own demo copy. Nobody else sees your changes.</p>}
        <hr />
        <p className="acct-label" id={themeLabel}>
          Theme
        </p>
        <div className="acct-seg" role="radiogroup" aria-labelledby={themeLabel}>
          {THEMES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
            >
              {THEME_LABEL[value]}
            </button>
          ))}
        </div>
        <hr />
        {demo ? (
          // A form post, so the new cookie and the fresh sandbox arrive in one full page load.
          <form action="/api/auth/demo" method="post">
            <button className="acct-item" type="submit">
              <RailIcon name="restart" /> Start over
            </button>
          </form>
        ) : (
          <button className="acct-item" type="button" onClick={() => void signOut()}>
            <RailIcon name="signOut" /> Sign out
          </button>
        )}
      </div>
    </details>
  );
}
