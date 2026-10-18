'use client';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { completeTimeText, parseTimeText, timeSteps } from '../../tracker';
import { FieldPop } from './FieldPop';

const STEPS = timeSteps(30);
const NO_TIME = '';

/** The step at or before a time (09:00 when empty), so the list opens where the person is. */
const stepAt = (time: string) => {
  const [hour, minute] = (time || '09:00').split(':').map(Number);
  return Math.floor((hour * 60 + minute) / 30);
};

/** Empty in an optional box means no time: the deadline is then the end of the day. */
export function TimeInput({
  value,
  onChange,
  label = 'Time (optional)',
  optional = true,
  placeholder = 'Time',
}: {
  value: string;
  onChange: (time: string) => void;
  label?: string;
  optional?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [moved, setMoved] = useState(false);
  const onFocus = useRef(value);
  const box = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const options = optional ? [NO_TIME, ...STEPS] : STEPS;
  const read = (raw: string) => (!raw.trim() ? (optional ? NO_TIME : null) : parseTimeText(raw));
  const bad = text !== null && read(text) === null;
  const indexOf = (time: string) => stepAt(time) + (optional ? 1 : 0);
  const home = active >= 0 ? active : indexOf(value);
  useLayoutEffect(() => {
    const ul = list.current;
    const li = ul?.children[home];
    if (!ul || !(li instanceof HTMLElement)) return;
    if (
      li.offsetTop < ul.scrollTop ||
      li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight
    )
      ul.scrollTop = li.offsetTop - (ul.clientHeight - li.offsetHeight) / 2;
  }, [open, home]);
  const save = (time: string) => {
    onFocus.current = time;
    if (time !== value) onChange(time);
  };
  const close = () => {
    setOpen(false);
    setMoved(false);
  };
  const commit = (raw: string) => {
    setText(null);
    const next = read(raw);
    if (next !== null) save(next);
    else if (value !== onFocus.current) onChange(onFocus.current);
  };
  const pick = (time: string) => {
    setText(null);
    close();
    save(time);
  };
  const show = () => {
    if (open) return;
    setOpen(true);
    setMoved(false);
    setActive(value || !optional ? indexOf(value) : -1);
  };
  return (
    <span ref={box} className="time-in">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-invalid={bad || undefined}
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-autocomplete="none"
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        title={bad ? 'Write a time such as 14:30.' : undefined}
        placeholder={placeholder}
        autoComplete="off"
        value={text ?? value}
        onFocus={() => {
          onFocus.current = value;
        }}
        onChange={(event) => {
          setText(event.target.value);
          setMoved(false);
          const whole = completeTimeText(event.target.value);
          if (whole !== null && whole !== value) onChange(whole);
          const typed = parseTimeText(event.target.value);
          if (typed) setActive(indexOf(typed));
        }}
        onClick={show}
        onBlur={() => {
          if (text !== null) commit(text);
          close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) return show();
            const at = active >= 0 ? active + (event.key === 'ArrowDown' ? 1 : -1) : home;
            setActive(Math.min(options.length - 1, Math.max(0, at)));
            setMoved(true);
          } else if (event.key === 'Enter') {
            if (open && moved && active >= 0) {
              event.preventDefault();
              pick(options[active]);
              return;
            }
            // A form must not submit before the typed time is saved.
            if (open || (text !== null && read(text) !== value)) event.preventDefault();
            if (text !== null) commit(text);
            close();
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      />
      {open && (
        <FieldPop anchor={box} className="time-pop" onClose={close}>
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Times">
            {options.map((time, i) => (
              <li
                key={time || 'none'}
                id={`${id}-${i}`}
                role="option"
                aria-selected={time === value}
                className={i === active ? 'act' : undefined}
                onClick={() => pick(time)}
              >
                {time || 'No time'}
              </li>
            ))}
          </ul>
        </FieldPop>
      )}
    </span>
  );
}
