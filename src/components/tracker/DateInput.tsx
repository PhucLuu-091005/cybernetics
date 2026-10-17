'use client';
import { useRef, useState } from 'react';
import { formatDayYear, parseDayText } from '../../tracker';
import { Icon } from './icons';

/**
 * A day in the app's own format ("6 Oct 2026"), which the browser's date box cannot show. People
 * type it, or pick it in the browser's calendar behind the button.
 */
export function DateInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (date: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const year = Number(value.slice(0, 4)) || new Date().getFullYear();
  const shown = text ?? formatDayYear(value);
  const bad = text !== null && parseDayText(text, year) === null;
  const open = () => {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  return (
    <span className="date-in">
      <input
        type="text"
        aria-label={label}
        aria-invalid={bad || undefined}
        title={bad ? 'Write a day such as 6 Oct 2026.' : undefined}
        inputMode="text"
        autoComplete="off"
        value={shown}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseDayText(event.target.value, year);
          if (next) onChange(next);
        }}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setText(null);
        }}
      />
      <button className="ib" type="button" aria-label="Open the calendar" onClick={open}>
        <Icon name="cal" size={14} />
      </button>
      <input
        ref={picker}
        className="date-pick"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(event) => {
          if (!event.target.value) return;
          setText(null);
          onChange(event.target.value);
        }}
      />
    </span>
  );
}
