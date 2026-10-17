'use client';
import { useId } from 'react';
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
  const signOut = async () => {
    await fetch('/api/auth/session', { method: 'DELETE' });
    // A full reload drops every cached page; the server then sends the signed-out person to sign in.
    window.location.reload();
  };
  return (
    <details ref={ref} className="acct me">
      <summary aria-label={`${name}: theme and sign out`} title={name}>
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
        <button className="acct-item" type="button" onClick={() => void signOut()}>
          <RailIcon name="signOut" /> Sign out
        </button>
      </div>
    </details>
  );
}
