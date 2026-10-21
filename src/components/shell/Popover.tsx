'use client';
import { useEffect, useRef, type ReactNode } from 'react';

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

export function Popover({
  className,
  summary,
  summaryClassName,
  children,
}: {
  className: string;
  summary: ReactNode;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const ref = useDismissibleDetails();
  return (
    <details ref={ref} className={className}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}
