type KeyOption = { value: string; label: string; disabled?: boolean };

const PAGE = 8;
const canPick = (options: readonly KeyOption[], at: number) =>
  at >= 0 && at < options.length && !options[at].disabled;

/** The current value when it can be picked, else the first option that can; -1 when none can. */
export function activeOnOpen(options: readonly KeyOption[], value: string): number {
  const at = options.findIndex((option) => option.value === value);
  if (canPick(options, at)) return at;
  return options.findIndex((_, i) => canPick(options, i));
}

/** The nearest option that can be picked from `target` towards `by`, never past an end; else `from`. */
function nearest(options: readonly KeyOption[], from: number, target: number, by: 1 | -1) {
  const end = by > 0 ? options.length - 1 : 0;
  const start = by > 0 ? Math.min(target, end) : Math.max(target, end);
  for (let at = start; by > 0 ? at > from : at < from; at -= by)
    if (canPick(options, at)) return at;
  for (let at = start; by > 0 ? at <= end : at >= end; at += by)
    if (canPick(options, at)) return at;
  return from;
}

export function moveActive(options: readonly KeyOption[], from: number, key: string): number {
  switch (key) {
    case 'ArrowDown':
      return nearest(options, from, from + 1, 1);
    case 'ArrowUp':
      return nearest(options, from, from - 1, -1);
    case 'PageDown':
      return nearest(options, from, from + PAGE, 1);
    case 'PageUp':
      return nearest(options, from, from - PAGE, -1);
    case 'Home':
      return nearest(options, options.length, 0, -1);
    case 'End':
      return nearest(options, -1, options.length - 1, 1);
    default:
      return from;
  }
}

const plain = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/**
 * One letter finds the next option after `from` that starts with it, so pressing it again cycles;
 * more letters keep the current option while it still matches.
 */
export function typeahead(options: readonly KeyOption[], from: number, query: string): number {
  const typed = plain(query);
  const first = typed.length === 1 ? 1 : 0;
  for (let step = first; step < options.length + first; step++) {
    const at = (Math.max(from, 0) + step) % options.length;
    if (canPick(options, at) && plain(options[at].label).startsWith(typed)) return at;
  }
  return from;
}
