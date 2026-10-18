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
  /** The canvas zoom; marks read it to keep their `SCREEN_MIN` size. */
  zoom: number;
  activeKey: string | null;
  navKeyDown(event: KeyboardEvent, key: string): void;
  navFocus(event: FocusEvent, key: string): void;
  selectLoop(loopId: string, actId?: string): void;
  selectMilestone(milestoneId: string): void;
  /** A press on an event card or icon: a click opens the loop at that act; a drag moves the card, or the act or its branch. */
  startDrag(event: PointerEvent, glyph: ActGlyph, target: DragTarget): void;
  zoomToLoop(loopId: string): void;
  /** Opens a cited record in the stage, so full screen stays on. */
  viewRecord(recordVersionId: string, quote: string | null): void;
};
export const GraphUiContext = createContext<GraphUi | null>(null);
export function useGraphUi(): GraphUi {
  const ui = useContext(GraphUiContext);
  if (!ui) throw new Error('Graph elements render inside PromiseGraph');
  return ui;
}
export const loopKey = (loopId: string) => `l:${loopId}`;
export const milestoneKey = (milestoneId: string) => `m:${milestoneId}`;
export type DragTarget = 'icon' | 'card';
/** One drag step: an act inside its day, a branch inside its lane, or a card on its own. */
export type DragChange =
  | { kind: 'acts'; id: string; fraction: number }
  | { kind: 'loops'; id: string; shift: number }
  | { kind: 'cards'; id: string; dx: number; dy: number };
