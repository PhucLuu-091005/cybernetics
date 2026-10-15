import type { Act } from '../../contracts';
import { quoteContext } from '../../lib/quote-context';
import type { CitedRecord } from '../../server/domain/records';
import { shortStamp } from '../graph/labels';
import { describeEntity, type Names } from './describe';

const MAX_SOURCES = 20;

export function CitedSources({
  acts,
  cited,
  names,
  timeZone,
}: {
  acts: readonly Act[];
  cited: ReadonlyMap<string, CitedRecord>;
  names: Names;
  timeZone: string;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {acts.length === 0 && (
        <p className="faint" style={{ fontSize: 13 }}>
          No added or changed act in this change set.
        </p>
      )}
      {acts.slice(0, MAX_SOURCES).map((act) => {
        const record = cited.get(act.citation.recordVersionId),
          body = record?.bodyText ?? null;
        const context =
          body === null ? null : quoteContext(body, act.citation.start, act.citation.end);
        return (
          <div key={act.id}>
            {body === null || context === null ? (
              <div className="quote">
                <span className="badge b-stale">Unavailable evidence</span>
              </div>
            ) : (
              <div className="quote" style={{ fontSize: 14 }}>
                {context.before}
                <mark>{body.slice(act.citation.start, act.citation.end)}</mark>
                {context.after}
              </div>
            )}
            <div className="faint" style={{ fontSize: 12 }}>
              {describeEntity('acts', act.id, act, names).name};{' '}
              {record
                ? `${record.author}, ${record.sourceLabel} “${record.title}”, ${shortStamp(record.occurredAt, timeZone)}`
                : 'unknown record'}
            </div>
          </div>
        );
      })}
      {acts.length > MAX_SOURCES && (
        <p className="faint" style={{ fontSize: 12 }}>
          {acts.length - MAX_SOURCES} more cited acts are not shown.
        </p>
      )}
    </div>
  );
}
