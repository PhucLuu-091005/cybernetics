import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

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

/** The tab icon and the home screen icon that `page` links, fetched with no session. */
export async function expectAppIcons(request: APIRequestContext, page: string) {
  const html = await (await request.get(page)).text();
  const links = [...html.matchAll(/<link [^>]*>/g)].map(([tag]) => ({
    rel: /rel="([^"]+)"/.exec(tag)?.[1],
    href: /href="([^"]+)"/.exec(tag)?.[1]?.replaceAll('&amp;', '&'),
  }));
  const hrefOf = (rel: string) => links.find((link) => link.rel === rel)?.href;
  for (const [rel, type] of [
    ['icon', 'image/svg+xml'],
    ['apple-touch-icon', 'image/png'],
  ]) {
    const href = hrefOf(rel);
    expect(href, rel).toBeTruthy();
    const response = await request.get(href!, { maxRedirects: 0 });
    expect(response.status(), href).toBe(200);
    expect(response.headers()['content-type']).toContain(type);
  }
}

const PHOTO_SRC = /^\/api\/v1\/avatars\/(members\/)?[0-9a-f-]{36}\/[0-9a-f]{64}$/;

/**
 * Sets a photo on Profile for the person on screen, then moves inside the app (no reload) and
 * checks that the account menu and the person's Members row show it at once, and after a reload.
 * Remove photo brings the initials back the same way.
 */
export async function photoShowsEverywhere(
  page: Page,
  opts: {
    projectId: string;
    name: string;
    initials: string;
    png: Buffer;
    /** Runs on Members while the photo is set. */
    onMembers?: () => Promise<void>;
  },
) {
  const { projectId, name, initials, png } = opts;
  const menu = page.locator('.p-head details.acct .acct-av');
  const memberFace = () =>
    page.getByRole('row').filter({ hasText: name }).first().locator('.acct-av');
  await page.locator('.p-head details.acct > summary').click();
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/profile`);
  await hydrated(page);
  const section = page.getByRole('region', { name: 'Photo' });
  await expect(section.locator('.pf-face svg')).toContainText(initials);
  await expect(menu).toHaveText(initials);
  await section.getByRole('button', { name: 'Upload photo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a photo' });
  await page
    .getByLabel('Photo file')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Save photo' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(section.locator('.pf-face img')).toHaveAttribute('src', PHOTO_SRC);
  await expect(menu.locator('img')).toHaveAttribute('src', PHOTO_SRC);

  const rail = page.getByRole('navigation', { name: 'Project' });
  await rail.getByRole('link', { name: 'Graph' }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/graph`);
  await expect(menu.locator('img')).toHaveAttribute('src', PHOTO_SRC);
  await rail.getByRole('link', { name: 'Members' }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/members`);
  await expect(memberFace().locator('img')).toHaveAttribute('src', PHOTO_SRC);
  await opts.onMembers?.();
  await page.goBack();
  await expect(page).toHaveURL(`/projects/${projectId}/graph`);
  await expect(menu.locator('img')).toHaveAttribute('src', PHOTO_SRC);
  await page.reload();
  await expect(menu.locator('img')).toHaveAttribute('src', PHOTO_SRC);

  await page.goto(`/projects/${projectId}/profile`);
  await hydrated(page);
  await section.getByRole('button', { name: 'Remove photo' }).click();
  await expect(section.locator('.pf-face svg')).toContainText(initials);
  await expect(menu).toHaveText(initials);
  await rail.getByRole('link', { name: 'Graph' }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/graph`);
  await expect(menu).toHaveText(initials);
  await expect(menu.locator('img')).toHaveCount(0);
  await rail.getByRole('link', { name: 'Members' }).click();
  await expect(memberFace().locator('img')).toHaveCount(0);
}
