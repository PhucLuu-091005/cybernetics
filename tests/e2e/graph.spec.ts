import { expect, test, type Page } from '@playwright/test';

const PROJECT = 'Larkspur Capital, Fund III onboarding';
// Each spec signs in as its own local user, so specs share neither the per-user rate limit nor sandbox state.
const activeLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
const loopPanel = (page: Page) => page.getByRole('complementary', { name: /loop panel/i });
const branches = (page: Page) => page.getByRole('button', { name: /^Loop: / });
const branchTitles = async (page: Page) =>
  (
    await branches(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    )
  )
    .map((name) => name.slice('Loop: '.length).split(', ')[0])
    .sort();

async function signIn(page: Page) {
  await page.goto('/signin?label=graph');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT)).toBeVisible();
  // Keyboard and wheel handlers attach on hydration; data-ready appears once the client has measured the graph.
  await expect(page.getByRole('group', { name: /promise graph for/i })).toHaveAttribute(
    'data-ready',
    'true',
  );
  await expect(branches(page).first()).toBeVisible();
}

test('sign in reaches the seeded graph in at most 3 clicks and shows proof in one click', async ({
  page,
}) => {
  await page.goto('/signin?label=graph');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText('Larkspur Capital, Fund III onboarding')).toBeVisible();
  await expect(page.getByTestId('main-badge')).toHaveText(/main/i);
  for (const name of [
    'unanswered request',
    'silent overdue',
    'late delivery',
    'unilateral change',
    'rejected delivery',
    'ambiguous promise',
    'unconfirmed delivery',
  ]) {
    await page
      .getByRole('button', { name: new RegExp(`Loop: .*${name}`, 'i') })
      .first()
      .click();
    await expect(
      page
        .getByRole('complementary', { name: /loop panel/i })
        .getByTestId('verified-quote')
        .first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  }

  // SRD 7.5 target: first graph paint under 2 seconds on the seeded project. The reload measures a warm server, not the dev compile.
  await page.reload();
  await expect(branches(page).first()).toBeVisible();
  const paint = await page.evaluate(() => {
    const timing = performance.timing;
    const fcp = performance
      .getEntriesByType('paint')
      .find((entry) => entry.name === 'first-contentful-paint');
    return {
      firstContentfulPaintMs: Math.round(fcp?.startTime ?? -1),
      domContentLoadedMs: timing.domContentLoadedEventEnd - timing.navigationStart,
      loadMs: timing.loadEventEnd - timing.navigationStart,
    };
  });
  test.info().annotations.push({ type: 'first-paint', description: JSON.stringify(paint) });
  console.log(`first-paint ${JSON.stringify(paint)}`);
  expect(paint.firstContentfulPaintMs).toBeGreaterThan(0);
  expect(paint.firstContentfulPaintMs).toBeLessThan(2000);
});

test('keyboard: Tab reaches a branch, Enter opens the panel, arrows move between acts', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('searchbox', { name: /search loop titles and quotes/i }).focus();

  // SRD 7.3: Tab moves through milestones in time order, then through branches in start-time order.
  const visited: string[] = [];
  for (let presses = 0; presses < 60 && !visited.at(-1)?.startsWith('Loop: '); presses++) {
    await page.keyboard.press('Tab');
    visited.push(await activeLabel(page));
  }
  const graphStops = visited.filter(
    (name) => name.startsWith('Milestone: ') || name.startsWith('Loop: '),
  );
  expect(graphStops.at(-1)).toMatch(/^Loop: /);
  expect(graphStops.slice(0, -1)).toHaveLength(7);
  expect(graphStops.slice(0, -1).every((name) => name.startsWith('Milestone: '))).toBe(true);
  expect(graphStops[0]).toMatch(/^Milestone: Kickoff, /);

  const loopName = graphStops.at(-1)!;
  await page.keyboard.press('Enter');
  const panel = loopPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
    loopName.slice('Loop: '.length).split(', ')[0],
  );

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
  await page
    .getByRole('group', { name: /^side$/i })
    .getByRole('button', { name: 'Vendor' })
    .click();
  await expect(page).toHaveURL(/[?&]q=sync(&|$)/);
  await expect(page).toHaveURL(/[?&]side=vendor(&|$)/);
  await expect.poll(() => branches(page).count()).toBeLessThan(total);
  const graphTitles = await branchTitles(page);
  expect(graphTitles.length).toBeGreaterThan(0);

  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'List' })
    .click();
  await expect(page).toHaveURL(/[?&]view=list(&|$)/);
  const rows = page.getByRole('table', { name: /loops/i }).locator('tbody tr');
  await expect(rows).toHaveCount(graphTitles.length);
  const listTitles = (await rows.locator('td:first-child').allInnerTexts())
    .map((text) => text.trim())
    .sort();
  expect(listTitles).toEqual(graphTitles);
  await expect(branches(page)).toHaveCount(0);

  // The URL holds the filters, so a reload reproduces the same list.
  await page.reload();
  await expect(page.getByRole('searchbox', { name: /search loop titles and quotes/i })).toHaveValue(
    'sync',
  );
  await expect(page.getByRole('table', { name: /loops/i }).locator('tbody tr')).toHaveCount(
    graphTitles.length,
  );

  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'Graph' })
    .click();
  await expect.poll(() => branchTitles(page)).toEqual(graphTitles);
});

const projectIdOf = (page: Page) => new URL(page.url()).pathname.split('/')[2];

test('the loop panel shows each quote inside its surrounding text, with the source and an agent permalink as plain text', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: /^Loop: Client secret renewal/ }).click();
  const panel = loopPanel(page);
  const first = panel.getByTestId('verified-quote').first();
  await expect(first).toBeVisible();
  const quote = (await first.innerText()).trim();
  const block = panel.getByTestId('quote-context').first();
  await expect
    .poll(async () => (await block.innerText()).trim().length)
    .toBeGreaterThan(quote.length);
  expect(await block.innerText()).toContain(quote);
  // SRD 17: the seed arrives through the agent path, so its Slack-shaped permalinks stay inactive text.
  await expect(
    panel.getByText(/^https:\/\/fundline-larkspur\.slack\.example\//).first(),
  ).toBeVisible();
  await expect(panel.getByRole('link', { name: /^Open in/ })).toHaveCount(0);
  await expect(panel.getByText('#larkspur-it').first()).toBeVisible();
});

test('a rate-limited loop read shows a short retry note and keeps the bare quotes', async ({
  page,
}) => {
  await signIn(page);
  await page.route(/\/api\/v1\/projects\/[^/]+\/loops\/[^/?]+\?/, (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        requestId: 'e2e',
      }),
    }),
  );
  await page.getByRole('button', { name: /^Loop: Client secret renewal/ }).click();
  const panel = loopPanel(page);
  await expect(panel.getByRole('status')).toHaveText('Too many requests — try again in a minute.');
  await expect(panel.getByTestId('verified-quote').first()).toBeVisible();
});

test('a project the user cannot see returns 404 with the not-found page', async ({ page }) => {
  await signIn(page);
  const response = await page.goto('/projects/6f1c2a8e-4b1d-4c3a-9e2f-0a1b2c3d4e5f/graph');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
  expect((await page.goto('/projects/not-a-uuid/graph'))?.status()).toBe(404);
});

test('keys do not act while typing, inside an open menu, or while the list view hides the panel', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: /^Loop: Go-live date/ }).click();
  const panel = loopPanel(page);
  await expect(panel).toBeVisible();
  const search = page.getByRole('searchbox', { name: /search loop titles and quotes/i });
  await search.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-current="step"]')).toHaveCount(0);
  await panel.locator('summary[aria-label="Act actions"]').first().click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'List' })
    .click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowRight');
  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'Graph' })
    .click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-current="step"]')).toHaveCount(0);
});

test('an escalation without analysis fades no loop and says so', async ({ page }) => {
  await signIn(page);
  const projectId = projectIdOf(page);
  const created = await page.request.post(`/api/v1/projects/${projectId}/escalations`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { complaint: 'The incident report is late.', idempotencyKey: `e2e-${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/projects/${projectId}/graph?escalation=${id}`);
  await expect(page.getByText(/no analysis yet/i)).toBeVisible();
  await expect.poll(() => branches(page).count()).toBeGreaterThanOrEqual(30);
  await expect(page.locator('.br-faded')).toHaveCount(0);
});

test('wheel and pinch both zoom the time axis', async ({ page }) => {
  await signIn(page);
  const graph = page.getByRole('group', { name: /promise graph for/i });
  await expect.poll(() => graph.getAttribute('data-px-per-day')).not.toBeNull();
  const start = Number(await graph.getAttribute('data-px-per-day'));
  const box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect
    .poll(async () => Number(await graph.getAttribute('data-px-per-day')))
    .toBeGreaterThan(start);
  const wheeled = Number(await graph.getAttribute('data-px-per-day'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const y = box.y + box.height / 2,
    x = box.x + box.width / 2;
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', spread: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: x - spread, y, id: 1 },
              { x: x + spread, y, id: 2 },
            ],
    });
  await touch('touchStart', 40);
  for (const spread of [60, 90, 120]) await touch('touchMove', spread);
  await touch('touchEnd', 0);
  await expect
    .poll(async () => Number(await graph.getAttribute('data-px-per-day')))
    .toBeGreaterThan(wheeled);
});

test('phone width: no horizontal page scroll on graph, open panel and list; sign out is reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect.poll(() => branches(page).count()).toBeGreaterThanOrEqual(30);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('phone-graph.png'), fullPage: true });
  await branches(page).first().click();
  await expect(loopPanel(page)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('phone-panel.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'List' })
    .click();
  await expect(page.getByRole('table', { name: /loops/i })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('phone-list.png'), fullPage: true });
});
