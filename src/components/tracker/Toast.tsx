'use client';
import { useEffect } from 'react';
import { Icon } from './icons';

export type ToastState = { text: string; at: number; undo?: () => void };

export const TOAST_MS = 4500;

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  return (
    <div className="tk-toast" role="status" aria-live="polite">
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
        </>
      )}
    </div>
  );
}
