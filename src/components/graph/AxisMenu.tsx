'use client';
import { useEffect, useRef, useState } from 'react';

const LATER = 'not implemented yet';

/** The time axis scale. Weeks and months are reserved for a later version and show as disabled. */
export function AxisMenu({ onResetWidths }: { onResetWidths: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="axis-menu-wrap">
      <button
        type="button"
        className="axis-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Time axis: days"
        onClick={() => setOpen((value) => !value)}
      >
        Days <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="canvas-menu axis-menu" role="menu" aria-label="Time axis">
          <button type="button" role="menuitemradio" aria-checked onClick={() => setOpen(false)}>
            Days
          </button>
          {['Weeks', 'Months'].map((name) => (
            <button
              key={name}
              type="button"
              role="menuitemradio"
              aria-checked={false}
              aria-disabled
              title={`${name}: ${LATER}`}
            >
              {name} <small>{LATER}</small>
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            aria-disabled={!onResetWidths}
            onClick={() => {
              if (!onResetWidths) return;
              onResetWidths();
              setOpen(false);
            }}
          >
            Reset column widths
          </button>
        </div>
      )}
    </div>
  );
}
