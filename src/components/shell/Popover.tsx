'use client';
import { useEffect, useRef } from 'react';

/** A `<details>` popover closes like a menu: on a pointer press outside it, and on Escape, which returns focus to its summary. */
export function useDismissibleDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) details.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const details = ref.current;
      if (event.key !== 'Escape' || !details?.open) return;
      // A dialog opened from the menu closes on its own Escape and hands focus back to the menu.
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      details.open = false;
      details.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  return ref;
}
