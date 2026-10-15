'use client';
import type { CSSProperties, PointerEvent } from 'react';

/**
 * A vertical drag handle. `grow` says which way a drag makes the box wider: 1 when the handle is on the
 * box's right edge, -1 when it is on the left edge. A double-click gives the box its default width back.
 */
export function ResizeHandle({
  label,
  measure,
  grow,
  onResize,
  className,
  style,
}: {
  label: string;
  /** The box's width when a drag starts, read from the page. */
  measure(): number;
  grow: 1 | -1;
  onResize(width: number | null, done: boolean): void;
  className?: string;
  style?: CSSProperties;
}) {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget,
      x0 = event.clientX,
      width = measure();
    handle.setPointerCapture(event.pointerId);
    const at = (clientX: number) => width + grow * (clientX - x0);
    const onMove = (move: globalThis.PointerEvent) => onResize(at(move.clientX), false);
    const onUp = (up: globalThis.PointerEvent) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      onResize(at(up.clientX), true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };
  return (
    <div
      className={`resize-handle${className ? ` ${className}` : ''}`}
      style={style}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={start}
      onDoubleClick={() => onResize(null, true)}
    />
  );
}
