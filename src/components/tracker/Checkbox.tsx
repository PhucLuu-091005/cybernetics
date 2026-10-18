'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';
import './fields.css';

/**
 * The one checkbox of the app. The native input stays for keyboard, labels and tests; the drawn box
 * on top follows the tokens in both themes.
 */
export function Checkbox({
  checked,
  mixed = false,
  disabled,
  onChange,
  children,
  className,
  ...aria
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  const box = (
    <span className="cbx">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        {...aria}
      />
      {mixed ? (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      ) : (
        <Icon name="check" size={12} />
      )}
    </span>
  );
  if (children === undefined) return box;
  return (
    <label className={`cbx-row${className ? ` ${className}` : ''}`}>
      {box}
      {children}
    </label>
  );
}
