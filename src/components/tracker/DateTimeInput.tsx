'use client';
import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';

/** `value` keeps the `datetime-local` shape ("2026-10-09T17:00"), wall time in the project zone. */
export function DateTimeInput({
  value,
  label,
  today,
  onChange,
}: {
  value: string;
  label: string;
  today?: string;
  onChange: (value: string) => void;
}) {
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  return (
    <span className="dt-in" role="group" aria-label={label}>
      <DateInput
        label="Date"
        value={date}
        today={today}
        onChange={(next) => onChange(`${next}T${time}`)}
      />
      <TimeInput
        label="Time"
        optional={false}
        value={time}
        onChange={(next) => onChange(`${date}T${next}`)}
      />
    </span>
  );
}
