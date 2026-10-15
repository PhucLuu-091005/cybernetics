'use client';
import type { Annotation } from '../../contracts';
import { noteView } from './note-view';

export function NoteText({
  note,
  actLoop,
  onCite,
}: {
  note: Annotation;
  actLoop: ReadonlyMap<string, string>;
  onCite(loopId: string, actId: string): void;
}) {
  return (
    <p className="note-text">
      {noteView(note).map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>;
        const loopId = actLoop.get(part.actId);
        return loopId ? (
          <button
            key={index}
            type="button"
            className="note-cite"
            aria-label={`Open step ${part.n}`}
            onClick={() => onCite(loopId, part.actId)}
          >
            {part.n}
          </button>
        ) : (
          <span
            key={index}
            className="note-cite off"
            title="This step is not on the graph at this date"
          >
            {part.n}
          </span>
        );
      })}
    </p>
  );
}
