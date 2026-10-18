import type { SnapshotDiff } from '../../contracts';
import { changeClass, entityTitle, KIND, newestImage, type Names } from '../review/describe';
import { ChangeCells } from '../review/DiffView';

const MAX_ROWS = 150;

export function CommitDiff({ diff, names }: { diff: SnapshotDiff; names: Names }) {
  const counts = diff.changes.reduce<Record<string, number>>(
    (total, change) => ({ ...total, [change.kind]: (total[change.kind] ?? 0) + 1 }),
    {},
  );
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="faint" style={{ fontSize: 12 }}>
        {diff.changes.length} {diff.changes.length === 1 ? 'item' : 'items'}: {counts.added ?? 0}{' '}
        added, {counts.changed ?? 0} changed, {counts.removed ?? 0} removed.
      </p>
      <div className="tablewrap" style={{ border: 0 }}>
        <table aria-label="Changes in this version">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Item</th>
              <th>Change</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {diff.changes.slice(0, MAX_ROWS).map((change) => (
              <tr key={`${change.collection}/${change.id}`}>
                <td>{KIND[change.collection]}</td>
                <td>
                  {entityTitle(
                    change.collection,
                    change.id,
                    newestImage(change.after, change.before),
                    names,
                  )}
                </td>
                <td className={`change ${changeClass(change.kind)}`}>{change.kind}</td>
                <ChangeCells change={change} names={names} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {diff.changes.length > MAX_ROWS && (
        <p className="faint" style={{ fontSize: 12 }}>
          {diff.changes.length - MAX_ROWS} more changes are not listed.
        </p>
      )}
    </div>
  );
}
