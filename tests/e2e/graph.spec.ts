import { expect, test, type Page } from '@playwright/test';

const PROJECT = 'Larkspur Capital, Fund III onboarding';
const activeLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
const loopPanel = (page: Page) => page.getByRole('complementary', { name: /loop panel/i });
const branches = (page: Page) => page.getByRole('button', { name: /^Loop: / });
const branchTitles = async (page: Page) => (await branches(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? ''))).map(name => name.slice('Loop: '.length).split(', ')[0]).sort();

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT)).toBeVisible();
}

test('sign in reaches the seeded graph in at most 3 clicks and shows proof in one click', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText('Larkspur Capital, Fund III onboarding')).toBeVisible();
  await expect(page.getByTestId('main-badge')).toHaveText(/main/i);
  for (const name of ['unanswered request', 'silent overdue', 'late delivery', 'unilateral change', 'rejected delivery', 'ambiguous promise', 'unconfirmed delivery']) {
    await page.getByRole('button', { name: new RegExp(`Loop: .*${name}`, 'i') }).first().click();
    await expect(page.getByRole('complementary', { name: /loop panel/i }).getByTestId('verified-quote').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }

  // SRD 7.5 target: first graph paint under 2 seconds on the seeded project. The reload measures a warm server, not the dev compile.
  await page.reload();
  await expect(branches(page).first()).toBeVisible();
  const paint = await page.evaluate(() => {
    const timing = performance.timing;
    const fcp = performance.getEntriesByType('paint').find(entry => entry.name === 'first-contentful-paint');
    return { firstContentfulPaintMs: Math.round(fcp?.startTime ?? -1), domContentLoadedMs: timing.domContentLoadedEventEnd - timing.navigationStart, loadMs: timing.loadEventEnd - timing.navigationStart };
  });
  test.info().annotations.push({ type: 'first-paint', description: JSON.stringify(paint) });
  console.log(`first-paint ${JSON.stringify(paint)}`);
  expect(paint.firstContentfulPaintMs).toBeGreaterThan(0);
  expect(paint.firstContentfulPaintMs).toBeLessThan(2000);
});

test('keyboard: Tab reaches a branch, Enter opens the panel, arrows move between acts', async ({ page }) => {
  await signIn(page);
  await page.getByRole('searchbox', { name: /search loop titles and quotes/i }).focus();

  // SRD 7.3: Tab moves through milestones in time order, then through branches in start-time order.
  const visited: string[] = [];
  for (let presses = 0; presses < 60 && !visited.at(-1)?.startsWith('Loop: '); presses++) {
    await page.keyboard.press('Tab');
    visited.push(await activeLabel(page));
  }
  const graphStops = visited.filter(name => name.startsWith('Milestone: ') || name.startsWith('Loop: '));
  expect(graphStops.at(-1)).toMatch(/^Loop: /);
  expect(graphStops.slice(0, -1)).toHaveLength(7);
  expect(graphStops.slice(0, -1).every(name => name.startsWith('Milestone: '))).toBe(true);
  expect(graphStops[0]).toMatch(/^Milestone: Kickoff, /);

  const loopName = graphStops.at(-1)!;
  await page.keyboard.press('Enter');
  const panel = loopPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(loopName.slice('Loop: '.length).split(', ')[0]);

  const steps = panel.getByRole('list', { name: /steps/i }).getByRole('listitem');
  expect(await steps.count()).toBeGreaterThan(1);
  await expect(panel.locator('[aria-current="step"]')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('ArrowRight');
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(0)).not.toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('ArrowLeft');
  await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(await activeLabel(page)).toBe(loopName);
  await page.keyboard.press('Tab');
  const next = await activeLabel(page);
  expect(next).toMatch(/^Loop: /);
  expect(next).not.toBe(loopName);
});

test('list view shows the same loops as the graph with the same filters', async ({ page }) => {
  await signIn(page);
  await expect.poll(() => branches(page).count()).toBeGreaterThanOrEqual(30);
  const total = await branches(page).count();

  await page.getByRole('searchbox', { name: /search loop titles and quotes/i }).fill('sync');
  await page.getByRole('group', { name: /^side$/i }).getByRole('button', { name: 'Vendor' }).click();
  await expect(page).toHaveURL(/[?&]q=sync(&|$)/);
  await expect(page).toHaveURL(/[?&]side=vendor(&|$)/);
  await expect.poll(() => branches(page).count()).toBeLessThan(total);
  const graphTitles = await branchTitles(page);
  expect(graphTitles.length).toBeGreaterThan(0);

  await page.getByRole('group', { name: /^view$/i }).getByRole('button', { name: 'List' }).click();
  await expect(page).toHaveURL(/[?&]view=list(&|$)/);
  const rows = page.getByRole('table', { name: /loops/i }).locator('tbody tr');
  await expect(rows).toHaveCount(graphTitles.length);
  const listTitles = (await rows.locator('td:first-child').allInnerTexts()).map(text => text.trim()).sort();
  expect(listTitles).toEqual(graphTitles);
  await expect(branches(page)).toHaveCount(0);

  // The URL holds the filters, so a reload reproduces the same list.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: /search loop titles and quotes/i })).toHaveValue('sync');
  await expect(page.getByRole('table', { name: /loops/i }).locator('tbody tr')).toHaveCount(graphTitles.length);

  await page.getByRole('group', { name: /^view$/i }).getByRole('button', { name: 'Graph' }).click();
  await expect.poll(() => branchTitles(page)).toEqual(graphTitles);
});
