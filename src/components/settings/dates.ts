const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partsOf = (instant: string, timeZone: string, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, ...options })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );

export function shortStamp(instant: string, timeZone: string): string {
  const parts = partsOf(instant, timeZone, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
}

export function shortDay(instant: string, timeZone: string, withYear = false): string {
  const parts = partsOf(instant, timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' });
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}${withYear ? ` ${parts.year}` : ''}`;
}
