'use client';

/** Empty means no time: the deadline is then the end of the day. */
export function TimeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="time-in">
      <input
        type="time"
        value={value}
        aria-label="Time (optional)"
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" className="btn sm" onClick={() => onChange('')}>
          No time
        </button>
      )}
    </span>
  );
}
