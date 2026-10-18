'use client';
import { useLayoutEffect } from 'react';
import { storedTheme, THEME_KEY } from './theme';

const SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * The script sets the stored theme before the first paint. React never runs a script that it renders
 * on the client, and it warns about one, so the client copy is inert text. A client render of the
 * root (the dev remount, a missing page) resets <html>, so the layout effect sets the theme again.
 */
export function ThemeScript() {
  useLayoutEffect(() => {
    const theme = storedTheme();
    if (theme) document.documentElement.dataset.theme = theme;
  }, []);
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
