'use client';
import { useEffect, useState } from 'react';

const THEMES = ['system', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    // Reads the theme the pre-paint script applied; the server cannot know it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);
  const next = () => {
    const value = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    setTheme(value);
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try {
      if (value === 'system') localStorage.removeItem('pg-theme');
      else localStorage.setItem('pg-theme', value);
    } catch {
      /* storage can be unavailable; the toggle still works for this page */
    }
  };
  return (
    <button
      className="btn"
      type="button"
      onClick={next}
      aria-label={`Colour theme: ${theme}. Switch theme`}
    >
      Theme: {theme}
    </button>
  );
}
