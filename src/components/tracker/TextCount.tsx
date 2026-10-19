/** Shown from 90% of the limit, so a long text sees the end coming before the input stops it. */
export function TextCount({ value, max }: { value: string; max: number }) {
  if (value.length < max * 0.9) return null;
  return (
    <small className="count" aria-live="polite">
      {value.length}/{max}
    </small>
  );
}
