'use client';
import { useState } from 'react';
import type { Annotation } from '../../contracts';
import { NoteText } from './NoteText';

export function NotesCard({
  notes,
  actLoop,
  onCite,
}: {
  notes: readonly Annotation[];
  actLoop: ReadonlyMap<string, string>;
  onCite(loopId: string, actId: string): void;
}) {
  const [all, setAll] = useState(false);
  if (!notes.length) return null;
  const shown = all ? [...notes].reverse() : [notes.at(-1)!];
  return (
    <section className={`notes-card${all ? ' open' : ''}`} aria-label="Notes">
      <header>
        <b>Notes</b>
        <span className="faint">Interpretation, not evidence</span>
        <button type="button" className="link" onClick={() => setAll(!all)}>
          {all ? 'Show less' : notes.length > 1 ? `Show all notes (${notes.length})` : 'Show more'}
        </button>
      </header>
      {shown.map((note) => (
        <NoteText key={note.id} note={note} actLoop={actLoop} onCite={onCite} />
      ))}
    </section>
  );
}
