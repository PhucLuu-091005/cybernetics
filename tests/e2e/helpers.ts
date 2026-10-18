import { expect, type Locator, type Page } from '@playwright/test';

export type Point = { x: number; y: number };

// Drags, dialogs, the Demo select and the review picks need React handlers; the fold button stays disabled until hydration.
export const hydrated = (page: Page) =>
  expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();

export async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The drag end has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the mouse in small steps, as a person does, so the drag passes the start threshold. */
export async function drag(page: Page, from: Locator, to: Locator | Point) {
  // The Queue and the graph canvas scroll on their own, so both ends can be in view at once.
  if (!('x' in to)) await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = await centerOf(from);
  const b = 'x' in to ? to : await centerOf(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 8, a.y + 8, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}
