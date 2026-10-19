'use client';
import { useEffect } from 'react';
import { Icon } from './icons';

export type ToastState = {
  text: string;
  at: number;
  undo?: () => void;
  refresh?: () => void;
  error?: true;
};

const TOAST_MS = 4500;

/** While `paused` the toast is out of sight but still announced, and its time starts again after. */
export function Toast({
  toast,
  onClose,
  paused = false,
}: {
  toast: ToastState | null;
  onClose: () => void;
  paused?: boolean;
}) {
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, onClose, paused]);
  return (
    <div className="tk-toast" role="status" aria-live="polite" data-paused={paused || undefined}>
      {toast && (
        <>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                onClose();
              }}
            >
              <Icon name="undo" size={14} /> Undo
            </button>
          )}
          {toast.refresh && (
            <button
              type="button"
              onClick={() => {
                toast.refresh?.();
                onClose();
              }}
            >
              Refresh
            </button>
          )}
        </>
      )}
    </div>
  );
}
