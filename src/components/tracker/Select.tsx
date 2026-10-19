'use client';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { FieldPop } from './FieldPop';
import { activeOnOpen, moveActive, typeahead } from './select-keys';
import { Icon } from './icons';
import './fields.css';

/** `hint` is quiet text after the label, such as a role; it is a description, not part of the name. */
export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  before?: ReactNode;
  disabled?: boolean;
};

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
  const typed = useRef({ text: '', at: 0 });
  const show = () => {
    setOpen(true);
    setActive(activeOnOpen(options, value));
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
  // Letters typed within a second read as one word, as in a native select.
  const find = (key: string) => {
    const now = Date.now();
    const text = now - typed.current.at < 1000 ? typed.current.text + key : key;
    typed.current = { text, at: now };
    const from = open ? active : activeOnOpen(options, value);
    const at = typeahead(options, from, text);
    if (!open) setOpen(true);
    setActive(at);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return show();
      setActive(moveActive(options, active, event.key));
    } else if (['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      if (!open) return;
      event.preventDefault();
      setActive(moveActive(options, active, event.key));
    } else if (event.key === ' ' && typed.current.text && Date.now() - typed.current.at < 1000) {
      event.preventDefault();
      find(' ');
    } else if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      find(event.key);
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
        <span className="sel-val">
          {current?.label ?? ''}
          {current?.hint && (
            <small className="sel-hint" aria-hidden="true">
              {current.hint}
            </small>
          )}
        </span>
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
                aria-describedby={option.hint ? `${id}-${i}-hint` : undefined}
                onClick={() => pick(option)}
              >
                {option.before}
                {option.label}
                {option.hint && (
                  <small id={`${id}-${i}-hint`} className="sel-hint" aria-hidden="true">
                    {option.hint}
                  </small>
                )}
              </li>
            ))}
          </ul>
        </FieldPop>
      )}
    </span>
  );
}
