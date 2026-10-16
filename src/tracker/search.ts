import type { TrackerState, WorkItem } from './model';

/** People type names without Vietnamese marks, so "pham" must find "Phạm" and "do" must find "Đỗ". */
export const foldText = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

function atWordStart(text: string, part: string): boolean {
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + 1))
    if (!isWordChar(text[i - 1])) return true;
  return false;
}

export function searchWorkItems(state: TrackerState, query: string): WorkItem[] {
  const terms = foldText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const whole = terms.join(' ');
  const teams = new Map(state.teams.map((t, order) => [t.id, { name: foldText(t.name), order }]));
  const people = new Map(state.people.map((p) => [p.id, foldText(p.name)]));
  const hits = state.workItems.flatMap((w, index) => {
    const title = foldText(w.title);
    const team = teams.get(w.teamId);
    const fields = [title, team?.name, people.get(w.doneBy), people.get(w.requestedBy)];
    const text = fields.filter(Boolean).join('\n');
    if (!terms.every((t) => text.includes(t))) return [];
    const rank = atWordStart(title, whole) ? 0 : title.includes(whole) ? 1 : 2;
    return [{ w, rank, order: team?.order ?? state.teams.length, index }];
  });
  return hits
    .sort((a, b) => a.rank - b.rank || a.order - b.order || a.index - b.index)
    .map((hit) => hit.w);
}
