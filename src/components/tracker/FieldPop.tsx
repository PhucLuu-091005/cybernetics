'use client';
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import './fields.css';

const GAP = 4;
const EDGE = 8;

function place(pop: HTMLElement, anchor: HTMLElement, matchWidth: boolean) {
  const a = anchor.getBoundingClientRect();
  if (matchWidth) pop.style.minWidth = `${a.width}px`;
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const room = document.documentElement.clientWidth;
  const below = a.bottom + GAP;
  const above = a.top - GAP - height;
  const top = below + height <= window.innerHeight - EDGE || above < EDGE ? below : above;
  pop.style.top = `${Math.max(EDGE, top)}px`;
  pop.style.left = `${Math.max(EDGE, Math.min(a.left, room - width - EDGE))}px`;
}

/**
 * The popover of a date or time box. It lives in the top layer, so a modal, a drawer or a dialog
 * that scrolls never clips it, yet it stays inside the field in the DOM for focus and labels.
 */
export function FieldPop({
  anchor,
  onClose,
  className,
  children,
  matchWidth = false,
  ...aria
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  className: string;
  children: ReactNode;
  /** A list pop is at least as wide as its box. */
  matchWidth?: boolean;
  id?: string;
  role?: string;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const pop = ref.current;
    const box = anchor.current;
    if (!pop || !box) return;
    pop.showPopover?.();
    const follow = () => place(pop, box, matchWidth);
    follow();
    const outside = (event: PointerEvent) => {
      if (!box.contains(event.target as Node)) close.current();
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [anchor, matchWidth]);
  return (
    <div
      ref={ref}
      popover="manual"
      className={`field-pop ${className}`}
      {...aria}
      // Keeps the focus in the box, and stops the wrapping <label> from passing the click on.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

export const browserToday = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
