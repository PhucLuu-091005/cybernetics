import { z } from 'zod';
import { DAY_WIDTH_MAX, DAY_WIDTH_MIN } from '../../contracts/layout';
import { DateSchema } from '../../contracts/primitives';
import type { KeyValueStore } from './offset-store';

export type DayWidths = Readonly<Record<string, number>>;

const StoredSchema = z.strictObject({
  v: z.literal(1),
  widths: z.record(DateSchema, z.number().min(DAY_WIDTH_MIN).max(DAY_WIDTH_MAX)),
});

export const dayWidthKey = (projectId: string) => `promise-graph:day-widths:v1:${projectId}`;

export function readDayWidths(store: KeyValueStore | null, projectId: string): DayWidths {
  try {
    const raw = store?.getItem(dayWidthKey(projectId));
    if (!raw) return {};
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.widths : {};
  } catch {
    return {};
  }
}

export function writeDayWidths(
  store: KeyValueStore | null,
  projectId: string,
  widths: DayWidths,
): void {
  try {
    if (!Object.keys(widths).length) store?.removeItem(dayWidthKey(projectId));
    else store?.setItem(dayWidthKey(projectId), JSON.stringify({ v: 1, widths }));
  } catch {
    // A full or blocked store keeps the widths for this page view only.
  }
}

/** `null` or the default width removes the entry, so storage holds only the days a user changed. */
export function withDayWidth(
  widths: DayWidths,
  date: string,
  width: number | null,
  defaultWidth: number,
): DayWidths {
  const rest = Object.fromEntries(Object.entries(widths).filter(([key]) => key !== date));
  if (width === null) return rest;
  const clamped = Math.round(Math.min(DAY_WIDTH_MAX, Math.max(DAY_WIDTH_MIN, width)));
  return clamped === defaultWidth ? rest : { ...rest, [date]: clamped };
}
