import { expect, type Locator, type Page } from '@playwright/test';

export type Point = { x: number; y: number };

// Drags, dialogs, the Demo select and the review picks need React handlers; the fold button stays disabled until hydration.
export const hydrated = (page: Page) =>
  expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();

/** Picks an option of the app's Select: a combobox button with its list in a pop. */
export async function choose(select: Locator, option: string, timeout?: number) {
  await select.click({ timeout });
  await select.page().getByRole('option', { name: option, exact: true }).click({ timeout });
}

/** The centre of the part that shows: a graph row is wider than its scrolling time line. */
export async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.evaluate((el) => {
    let { left, top, right, bottom } = el.getBoundingClientRect();
    for (let up = el.parentElement; up; up = up.parentElement) {
      const style = getComputedStyle(up);
      if (!/auto|scroll|hidden/.test(style.overflowX + style.overflowY)) continue;
      const r = up.getBoundingClientRect();
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
    return { left, top, right, bottom };
  });
  if (box.right <= box.left || box.bottom <= box.top)
    throw new Error('The drag end is out of view');
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
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
