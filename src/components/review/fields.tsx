import { useId, type ReactNode } from 'react';
import type { Person } from '../../contracts';

/** The label must not wrap the select: a wrapping label's text would include every option and make label lookups ambiguous. */
export function SelectField({
  label,
  children,
}: {
  label: string;
  children(id: string): ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

/** Acts may not name a person of unknown side, so those people are not offered. */
export function PartyOptions({ people }: { people: readonly Person[] }) {
  const usable = people.filter((person) => person.side !== 'unknown');
  return (
    <>
      {usable.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}
        </option>
      ))}
      <option value="side:client">Client side</option>
      <option value="side:vendor">Vendor side</option>
    </>
  );
}

export function OmittedRecordsNote({ omitted }: { omitted: number }) {
  if (!omitted) return null;
  return (
    <p className="faint" role="note" style={{ fontSize: 12 }}>
      {omitted} more {omitted === 1 ? 'record is' : 'records are'} not shown by name;{' '}
      {omitted === 1 ? 'it appears' : 'they appear'} as a short record ID.
    </p>
  );
}
