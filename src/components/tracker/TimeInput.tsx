'use client';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { parseTimeText, timeSteps } from '../../tracker';
import { FieldPop } from './FieldPop';

const STEPS = timeSteps(30);
const NO_TIME = '';

/** The step at or before a time, so the list opens where the person is. */
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
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const options = optional ? [NO_TIME, ...STEPS] : STEPS;
  const open = active !== null;
  const read = (raw: string) => (!raw.trim() ? (optional ? NO_TIME : null) : parseTimeText(raw));
  const bad = text !== null && read(text) === null;
  const indexOf = (time: string) => (optional && !time ? 0 : stepAt(time) + (optional ? 1 : 0));
  useLayoutEffect(() => {
    const ul = list.current;
    const li = active === null ? null : ul?.children[active];
    if (!ul || !(li instanceof HTMLElement)) return;
    if (
      li.offsetTop < ul.scrollTop ||
      li.offsetTop + li.offsetHeight > ul.scrollTop + ul.clientHeight
    )
      ul.scrollTop = li.offsetTop - (ul.clientHeight - li.offsetHeight) / 2;
  }, [active]);
  const pick = (time: string) => {
    setText(null);
    setActive(null);
    if (time !== value) onChange(time);
  };
  const move = (by: number) =>
    setActive((at) =>
      at === null ? indexOf(value) : Math.min(options.length - 1, Math.max(0, at + by)),
    );
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
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        title={bad ? 'Write a time such as 14:30.' : undefined}
        placeholder={placeholder}
        autoComplete="off"
        value={text ?? value}
        onChange={(event) => {
          setText(event.target.value);
          const next = read(event.target.value);
          if (next === null) return;
          if (next !== value) onChange(next);
          if (open) setActive(indexOf(next));
        }}
        onClick={() => setActive((at) => (at === null ? indexOf(value) : null))}
        onBlur={() => {
          setText(null);
          setActive(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'Enter') {
            if (open) {
              event.preventDefault();
              pick(options[active]);
            } else setText(null);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setActive(null);
          }
        }}
      />
      {open && (
        <FieldPop anchor={box} className="time-pop" onClose={() => setActive(null)}>
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label}>
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
