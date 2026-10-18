'use client';
import { useEffect, useState } from 'react';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'pg-theme';

export function storedTheme(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export const THEME_LABEL: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    // Reads the theme the pre-paint script applied; the server cannot know it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);
  const choose = (value: Theme) => {
    setTheme(value);
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try {
      if (value === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, value);
    } catch {
      /* storage can be unavailable; the choice still works for this page */
    }
  };
  return [theme, choose];
}
