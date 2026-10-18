'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  addDays,
  addMonths,
  formatDayYear,
  formatMonth,
  monthGrid,
  parseDayText,
} from '../../tracker';
import { browserToday, FieldPop } from './FieldPop';
import { Icon } from './icons';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const KEY_STEP: Record<string, (day: string, shift: boolean) => string> = {
  ArrowLeft: (d) => addDays(d, -1),
  ArrowRight: (d) => addDays(d, 1),
  ArrowUp: (d) => addDays(d, -7),
  ArrowDown: (d) => addDays(d, 7),
  PageUp: (d, shift) => addMonths(d, shift ? -12 : -1),
  PageDown: (d, shift) => addMonths(d, shift ? 12 : 1),
  Home: (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7)),
  End: (d) => addDays(d, 6 - ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7)),
};

function Calendar({
  value,
  today,
  optional,
  onPick,
}: {
  value: string;
  today: string;
  optional: boolean;
  onPick: (date: string) => void;
}) {
  const [active, setActive] = useState(value || today);
  const grid = useRef<HTMLTableElement>(null);
  const month = active.slice(0, 7);
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${active}"]`)?.focus();
  }, [active]);
  const onKey = (event: KeyboardEvent) => {
    const step = KEY_STEP[event.key];
    if (!step) return;
    event.preventDefault();
    setActive(step(active, event.shiftKey));
  };
  const turn = (n: number) => setActive(addMonths(active, n));
  return (
    <>
      <div className="cal-head">
        <b aria-live="polite">{formatMonth(active)}</b>
        <button
          className="fp-ib"
          type="button"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => turn(-1)}
        >
          <span className="cal-prev">
            <Icon name="chev" size={14} />
          </span>
        </button>
        <button
          className="fp-ib"
          type="button"
          aria-label="Next month"
          title="Next month"
          onClick={() => turn(1)}
        >
          <span className="cal-next">
            <Icon name="chev" size={14} />
          </span>
        </button>
      </div>
      <table
        ref={grid}
        className="cal-grid"
        role="grid"
        aria-label={formatMonth(active)}
        onKeyDown={onKey}
      >
        <thead>
          <tr>
            {WEEKDAYS.map((day, i) => (
              <th key={day} scope="col" abbr={WEEKDAY_NAMES[i]}>
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(active).map((week) => (
            <tr key={week[0]}>
              {week.map((day) => (
                <td key={day} role="gridcell" aria-selected={day === value}>
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === active ? 0 : -1}
                    aria-label={formatDayYear(day)}
                    aria-current={day === today ? 'date' : undefined}
                    className={[
                      day.slice(0, 7) !== month && 'out',
                      day === today && 'today',
                      day === value && 'on',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onPick(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fp-foot">
        <button className="fp-btn" type="button" onClick={() => onPick(today)}>
          Today
        </button>
        {optional && value && (
          <button className="fp-btn" type="button" onClick={() => onPick('')}>
            Clear
          </button>
        )}
      </div>
    </>
  );
}

/** Bad text keeps the last good day, so a half-typed day never reaches a change request. */
export function DateInput({
  value,
  label,
  onChange,
  today,
  optional = false,
  placeholder = 'Date',
}: {
  value: string;
  label: string;
  onChange: (date: string) => void;
  /** The project's today (the T line); the browser's day when absent. */
  today?: string;
  /** An optional box may be empty: empty text or Clear give "". */
  optional?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const year = Number(value.slice(0, 4)) || Number((today ?? browserToday()).slice(0, 4));
  const read = (raw: string) => (!raw.trim() ? (optional ? '' : null) : parseDayText(raw, year));
  const bad = text !== null && read(text) === null;
  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  return (
    <span
      ref={box}
      className="date-in"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !box.current?.contains(next)) setOpen(false);
      }}
    >
      <input
        type="text"
        aria-label={label}
        aria-invalid={bad || undefined}
        title={bad ? 'Write a day such as 6 Oct 2026.' : undefined}
        placeholder={placeholder}
        autoComplete="off"
        value={text ?? (value ? formatDayYear(value) : '')}
        onChange={(event) => {
          setText(event.target.value);
          const next = read(event.target.value);
          if (next !== null && next !== value) onChange(next);
        }}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setText(null);
          if (event.key === 'ArrowDown' && event.altKey) setOpen(true);
        }}
      />
      <button
        ref={button}
        className="fp-ib"
        type="button"
        aria-label="Open the calendar"
        title="Open the calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="cal" size={14} />
      </button>
      {open && (
        <FieldPop
          anchor={box}
          className="cal-pop"
          role="dialog"
          aria-label={`Pick a day: ${label}`}
          onClose={() => close(false)}
        >
          <Calendar
            value={value}
            today={today ?? browserToday()}
            optional={optional}
            onPick={(day) => {
              setText(null);
              if (day !== value) onChange(day);
              close(true);
            }}
          />
        </FieldPop>
      )}
    </span>
  );
}
