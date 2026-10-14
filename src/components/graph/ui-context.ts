'use client';
import {
  createContext,
  useContext,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { ActGlyph } from '../../contracts/layout';

/** What the custom nodes and the branch edge read; React Flow rebuilds them only when layout changes. */
export type GraphUi = {
  selectedLoopId: string | null;
  selectedMilestoneId: string | null;
  faded: ReadonlySet<string>;
  /** Loops a proposal changes; they carry the violet halo from the design. */
  halo: ReadonlySet<string>;
  currentActId: string | null;
  activeKey: string | null;
  navKeyDown(event: KeyboardEvent, key: string): void;
  navFocus(event: FocusEvent, key: string): void;
  selectLoop(loopId: string, actId?: string): void;
  selectMilestone(milestoneId: string): void;
  /** A press on an event card or icon: a click opens the loop at that act, a drag moves the act or the branch. */
  startDrag(event: PointerEvent, glyph: ActGlyph): void;
  zoomToLoop(loopId: string): void;
};
export const GraphUiContext = createContext<GraphUi | null>(null);
export function useGraphUi(): GraphUi {
  const ui = useContext(GraphUiContext);
  if (!ui) throw new Error('Graph elements render inside PromiseGraph');
  return ui;
}
export const loopKey = (loopId: string) => `l:${loopId}`;
export const milestoneKey = (milestoneId: string) => `m:${milestoneId}`;
