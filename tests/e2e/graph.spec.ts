import { expect, test, type Locator, type Page } from '@playwright/test';

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

const graph = (page: Page) => page.getByRole('group', { name: /promise graph for/i });
const zoomOf = async (page: Page) => Number(await graph(page).getAttribute('data-zoom'));
const boxOf = async (locator: Locator) => (await locator.boundingBox())!;
const controls = (page: Page) => page.getByRole('toolbar', { name: 'Canvas controls' });
/** A branch can sit outside the visible canvas; focus brings it into view, as Tab does. */
const openLoop = async (locator: Locator) => {
  await locator.focus();
  await locator.click();
};
const preset = async (page: Page, name: string) => {
  await controls(page).getByRole('button', { name: 'Zoom level' }).click();
  await page.getByRole('menuitem', { name }).click();
};

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
    await openLoop(page.getByRole('button', { name: new RegExp(`Loop: .*${name}`, 'i') }).first());
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

test('the loop panel shows each quote inside its surrounding text, with the source and a Slack link', async ({
  page,
}) => {
  await signIn(page);
  await openLoop(page.getByRole('button', { name: /^Loop: Client secret renewal/ }));
  const panel = loopPanel(page);
  const first = panel.getByTestId('verified-quote').first();
  await expect(first).toBeVisible();
  const quote = (await first.innerText()).trim();
  const block = panel.getByTestId('quote-context').first();
  await expect
    .poll(async () => (await block.innerText()).trim().length)
    .toBeGreaterThan(quote.length);
  expect(await block.innerText()).toContain(quote);
  // SRD 17: an agent permalink on a Slack host is an active link that opens in a new tab.
  const link = panel.getByRole('link', { name: 'Open in Slack' }).first();
  await expect(link).toHaveAttribute('href', /^https:\/\/fundline-larkspur\.slack\.com\//);
  await expect(link).toHaveAttribute('target', '_blank');
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
  await openLoop(page.getByRole('button', { name: /^Loop: Client secret renewal/ }));
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
  await openLoop(page.getByRole('button', { name: /^Loop: Go-live date/ }));
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

test('the canvas opens at 100 %, the wheel moves it, and Ctrl + wheel or a pinch zooms it', async ({
  page,
}) => {
  // d3-zoom registers touch listeners only when the page starts on a touch device.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  await signIn(page);
  expect(await zoomOf(page)).toBe(1);
  const box = await boxOf(graph(page));
  const trunk = page.locator('.react-flow__viewport');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await trunk.evaluate((node) => getComputedStyle(node).transform);
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => trunk.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe(before);
  expect(await zoomOf(page)).toBe(1);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);
  const wheeled = await zoomOf(page);
  // Ctrl + wheel inside the canvas zooms the canvas, never the browser page.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
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
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(wheeled);
});

test('a drag on empty canvas moves it; the lane names stay in their column and follow the zoom', async ({
  page,
}) => {
  await signIn(page);
  const column = page.getByTestId('lane-column');
  const name = column.locator('[data-lane]').filter({ hasText: 'Engineering' });
  const nameBefore = await boxOf(name);
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.evaluate(
    (node) => new DOMMatrix(getComputedStyle(node).transform).e,
  );
  const box = await boxOf(graph(page));
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 90);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 360, box.y + box.height - 90, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => viewport.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).e))
    .toBeLessThan(before - 200);
  expect((await boxOf(name)).x).toBe(nameBefore.x);
  await preset(page, '200%');
  await expect.poll(async () => (await boxOf(name)).height).toBeGreaterThan(nameBefore.height);
});

test('the controls step the zoom, the % menu applies presets, and titles hide under 60 %', async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator('text.br-title').first()).toBeAttached();
  await controls(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => zoomOf(page)).toBe(1.25);
  await controls(page).getByRole('button', { name: 'Zoom out' }).click();
  await controls(page).getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => zoomOf(page)).toBe(0.75);
  await preset(page, '200%');
  await expect.poll(() => zoomOf(page)).toBe(2);
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(
    page
      .getByTestId('time-axis')
      .getByText(/^\d{1,2} \w+$/)
      .first(),
  ).toBeVisible();
  await preset(page, '50%');
  await expect.poll(() => zoomOf(page)).toBe(0.5);
  await expect(page.locator('text.br-title').first()).toBeHidden();
  await preset(page, 'Fit this week');
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(2);
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(1);
});

test('a double-click on a branch zooms to that loop, at 150 % at most', async ({ page }) => {
  await signIn(page);
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(0.6);
  const branch = page.getByRole('button', { name: /^Loop: Client secret renewal/ });
  await branch.locator('.hit').dispatchEvent('dblclick');
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(0.6);
  expect(await zoomOf(page)).toBeLessThanOrEqual(1.5);
  const area = await boxOf(graph(page));
  const hit = await boxOf(branch.locator('.hit'));
  expect(hit.x).toBeGreaterThanOrEqual(area.x);
  expect(hit.x + hit.width).toBeLessThanOrEqual(area.x + area.width);
});

test('the minimap moves the canvas on a click; full screen enters and exits', async ({ page }) => {
  await signIn(page);
  await controls(page).getByRole('button', { name: 'Minimap' }).click();
  const map = page.getByRole('img', { name: 'Minimap' });
  await expect(map).toBeVisible();
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.evaluate((node) => getComputedStyle(node).transform);
  const m = await boxOf(map);
  await page.mouse.click(m.x + 8, m.y + m.height / 2);
  await expect
    .poll(() => viewport.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe(before);
  await controls(page).getByRole('button', { name: 'Minimap' }).click();
  await expect(map).toBeHidden();

  const enabled = await page.evaluate(() => document.fullscreenEnabled);
  if (!enabled) {
    await expect(controls(page).getByRole('button', { name: /full screen/i })).toHaveCount(0);
    return;
  }
  await controls(page).getByRole('button', { name: 'Full screen' }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className ?? ''))
    .toContain('stage');
  await controls(page).getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
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
  await openLoop(branches(page).first());
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
