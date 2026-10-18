'use client';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FieldPop } from './FieldPop';
import { Icon } from './icons';
import './fields.css';

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** The one select of the app: a button and a list in the same pop as the date and time boxes. */
export function Select({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
  title,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((option) => option.value === value);
  useLayoutEffect(() => {
    const li = list.current?.children[active];
    if (li instanceof HTMLElement) li.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  const show = () => {
    setOpen(true);
    setActive(Math.max(0, options.indexOf(current!)));
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };
  const step = (from: number, by: number) => {
    for (let at = from + by; at >= 0 && at < options.length; at += by)
      if (!options[at].disabled) return at;
    return from;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return show();
      setActive(step(active, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === 'Home' ? step(-1, 1) : step(options.length, -1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) pick(options[active]);
      else show();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  return (
    <span ref={box} className={`sel-in${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        role="combobox"
        className="sel-btn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        onBlur={close}
      >
        <span className="sel-val">{current?.label ?? ''}</span>
        <Icon name="chev" size={14} />
      </button>
      {open && (
        <FieldPop anchor={box} className="sel-pop" onClose={close} matchWidth>
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label}>
            {options.map((option, i) => (
              <li
                key={option.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={i === active ? 'act' : undefined}
                onClick={() => pick(option)}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </FieldPop>
      )}
    </span>
  );
}
