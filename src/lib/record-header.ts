import type { GraphContext } from '../contracts/graph';
import type { RecordVersion } from '../contracts/records';

export function buildRecordHeader(version: RecordVersion, context: Pick<GraphContext, 'timeZone'>): string {
  if (version.withdrawn) return `Unavailable evidence — version ${version.id}`;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: context.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(version.occurredAt));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const when = version.timePrecision === 'day' ? `${version.occurredDate ?? date} (day precision, ${version.occurredTimeZone ?? context.timeZone})` : `${date} ${get('hour')}:${get('minute')} (${context.timeZone})`;
  const recipients = version.recipients.length ? ` → ${version.recipients.map(alias => alias.name).join(', ')}` : '';
  return `${version.title} — ${version.author.name}${recipients} — ${when} — ${version.sourceLabel} [${version.source}] — version ${version.id}`;
}
