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
const stepZoom = async (page: Page, name: 'Zoom in' | 'Zoom out', times: number) => {
  for (let i = 0; i < times; i++) await controls(page).getByRole('button', { name }).click();
};
const viewOf = (page: Page) =>
  page.locator('.react-flow__viewport').evaluate((node) => getComputedStyle(node).transform);
/** A jump or a fit animates for 200 ms; a geometry check reads the canvas only after it stops. */
async function viewSettled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = await viewOf(page);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}
// The first view fits the project, so a case that reads cards or measures icons zooms to 100 % first.
async function atHundred(page: Page) {
  for (let zoom = await zoomOf(page); zoom < 1; zoom = await zoomOf(page)) {
    await controls(page).getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(zoom);
  }
  await expect.poll(() => zoomOf(page)).toBe(1);
}

// The canvas and card tests sign in as their own users, so the spec stays under the per-user read limit of 60 a minute.
async function signIn(page: Page, label = 'graph') {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeAttached();
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
  await expect(page.getByText('Larkspur Capital, Fund III onboarding').first()).toBeVisible();
  await expect(page.getByTestId('main-badge')).toHaveText(/approved graph/i);
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
  // SRD 7.5 sets 2 s; shared CI runners measured 2.0–2.8 s for the same build, so CI allows 3 s (owner, 15 Oct 2026).
  expect(paint.firstContentfulPaintMs).toBeLessThan(process.env.CI ? 3000 : 2000);
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
  await page.locator('details.filter-pop > summary').click();
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

test('a problem on a finished loop reads as past, and the parties read Requested by and Done by', async ({
  page,
}) => {
  await signIn(page, 'graph-past');
  const coverage = page.locator('p.coverage');
  await expect(coverage).toContainText('✕ 4 broken');
  await expect(coverage).toContainText('! 2 warning');
  await expect(coverage).toContainText('2 finished loops had a problem earlier.');

  await openLoop(page.getByRole('button', { name: /^Loop: Subscription documents/ }));
  const panel = loopPanel(page);
  await expect(panel.getByText('Past: Late delivery')).toBeVisible();
  await expect(panel.getByText('Past problem: Late delivery')).toBeVisible();
  await expect(panel.getByText('Broken')).toHaveCount(0);
  await expect(panel.getByText('Requested by', { exact: true })).toBeVisible();
  await expect(panel.getByText('Done by', { exact: true })).toBeVisible();

  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'List' })
    .click();
  const table = page.getByRole('table', { name: /loops/i });
  await expect(table.getByRole('columnheader', { name: 'Requested by' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Department' })).toBeVisible();
  const row = table.locator('tbody tr').filter({ hasText: 'Subscription documents' });
  await expect(row).toContainText('Past: Late delivery');
  await expect(row).not.toContainText('✕');

  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'Graph' })
    .click();
  await openLoop(page.getByRole('button', { name: /^Milestone: Documents received/ }));
  const milestone = page.getByRole('complementary', { name: 'Milestone panel' });
  await expect(milestone.getByText('Past: Late delivery')).toBeVisible();
  await expect(milestone).toContainText('0 open, 0 broken');
});

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

test('the canvas opens fitted to the project, the wheel moves it, and Ctrl + wheel zooms it', async ({
  page,
}) => {
  await signIn(page, 'graph-canvas');
  const fitted = await zoomOf(page);
  expect(fitted).toBeLessThan(0.2);
  const first = await viewOf(page);
  const box = await boxOf(graph(page));
  const trunk = page.locator('.react-flow__viewport');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await trunk.evaluate((node) => getComputedStyle(node).transform);
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => trunk.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe(before);
  expect(await zoomOf(page)).toBe(fitted);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(fitted);
  // Ctrl + wheel inside the canvas zooms the canvas, never the browser page.
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  // Spec 5.1: the first view is the Fit action, so Fit returns to the first view.
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  await viewSettled(page);
  expect(await viewOf(page)).toBe(first);
  // The pinch tests below start on a fresh page: d3 ends its wheel gesture 150 ms later and would cut a pinch short.
});

test('a drag on empty canvas moves it; the lane names stay in their column and follow the zoom', async ({
  page,
}) => {
  await signIn(page, 'graph-canvas');
  await atHundred(page);
  const column = page.getByTestId('lane-column');
  const name = column.locator('[data-lane]').filter({ hasText: /^Engineering$/ });
  const nameBefore = await boxOf(name);
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.evaluate(
    (node) => new DOMMatrix(getComputedStyle(node).transform).e,
  );
  const start = await emptyPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 300, start.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => viewport.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).e))
    .toBeLessThan(before - 200);
  expect((await boxOf(name)).x).toBe(nameBefore.x);
  await stepZoom(page, 'Zoom in', 3);
  await expect.poll(async () => (await boxOf(name)).height).toBeGreaterThan(nameBefore.height);
});

test('the controls step the zoom, the % is plain text, and titles hide under 60 %', async ({
  page,
}) => {
  await signIn(page, 'graph-canvas');
  await atHundred(page);
  await expect(page.locator('text.br-title').first()).toBeAttached();
  await controls(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => zoomOf(page)).toBe(1.25);
  await controls(page).getByRole('button', { name: 'Zoom out' }).click();
  await controls(page).getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => zoomOf(page)).toBe(0.75);
  await stepZoom(page, 'Zoom in', 4);
  await expect.poll(() => zoomOf(page)).toBe(2);
  await expect(controls(page).getByLabel('Zoom level')).toHaveText('200%');
  await expect(controls(page).getByRole('button', { name: 'Zoom level' })).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(
    page
      .getByTestId('time-axis')
      .getByText(/^\d{1,2} \w+$/)
      .first(),
  ).toBeVisible();
  await stepZoom(page, 'Zoom out', 5);
  await expect.poll(() => zoomOf(page)).toBe(0.5);
  await expect(page.locator('text.br-title').first()).toBeHidden();
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(1);
});

test('a double-click on a branch zooms to that loop, between 60 % and 150 %', async ({ page }) => {
  await signIn(page, 'graph-canvas');
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(0.1);
  const branch = page.getByRole('button', { name: /^Loop: Client secret renewal/ });
  await branch.locator('.hit').dispatchEvent('dblclick');
  await expect.poll(() => zoomOf(page)).toBeGreaterThanOrEqual(0.6);
  expect(await zoomOf(page)).toBeLessThanOrEqual(1.5);
  const area = await boxOf(graph(page));
  const hit = await boxOf(branch.locator('.hit'));
  // The loop starts in view; a long loop continues past the right edge.
  expect(hit.x).toBeGreaterThanOrEqual(area.x);
  expect(hit.x).toBeLessThan(area.x + area.width);
});

test('the canvas has no minimap; full screen enters and exits', async ({ page }) => {
  await signIn(page, 'graph-canvas');
  await expect(controls(page).getByRole('button', { name: 'Minimap' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Minimap' })).toHaveCount(0);

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

const secretRenewal = (page: Page) =>
  page.getByRole('button', { name: /^Loop: Client secret renewal/ });
async function firstCardOf(page: Page, branch: Locator) {
  await branch.focus();
  const actId = (await branch.locator('.hit-dot').first().getAttribute('data-act'))!;
  return {
    actId,
    card: page.locator(`.ev-card[data-act="${actId}"]`),
    icon: branch.locator(`.hit-dot[data-act="${actId}"]`),
  };
}

test('an event card shows the act, the person, the quote and a source link, and hides under 45 %', async ({
  page,
}) => {
  await signIn(page, 'graph-cards');
  await atHundred(page);
  const { card } = await firstCardOf(page, secretRenewal(page));
  await expect(card).toBeVisible();
  await expect(card.locator('.ev-h b')).toHaveText(/\w+/);
  await expect(card.locator('.ev-p')).toHaveText(/\w+/);
  await expect(card.locator('.ev-q')).toHaveText(/\w+/);
  // No card text spills out of its card: every header and person line fits its width.
  const spills = await page
    .locator('.ev-card .ev-h, .ev-card .ev-p')
    .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length);
  expect(spills).toBe(0);
  const link = card.getByRole('link');
  await expect(link).toHaveAttribute('href', /^https:\/\/fundline-larkspur\.slack\.com\//);
  await expect(link).toHaveAttribute('target', '_blank');
  await controls(page).getByRole('button', { name: 'Fit the project' }).click();
  await expect.poll(() => zoomOf(page)).toBeLessThan(0.45);
  await expect(card).toBeHidden();
});

for (const target of ['card', 'icon'] as const)
  test(`a pinch over an event ${target} zooms the canvas`, async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await signIn(page, 'graph-cards');
    await atHundred(page);
    const found = await firstCardOf(page, secretRenewal(page));
    const box = await boxOf(found[target]);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
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
    // Both fingers start on the target: an icon is about 22 px wide at 100 %.
    const start = target === 'icon' ? 4 : 20;
    await touch('touchStart', start);
    for (const spread of [start + 20, start + 40, start + 60]) await touch('touchMove', spread);
    await touch('touchEnd', 0);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(1);
  });

test('a press on an event card opens its loop at that act', async ({ page }) => {
  await signIn(page, 'graph-cards');
  await atHundred(page);
  const { card } = await firstCardOf(page, secretRenewal(page));
  await card.locator('.ev-p').click();
  const panel = loopPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-current="step"]')).toHaveCount(1);
});

test('the Notes card shows the summary, and a cite opens the loop panel at that step', async ({
  page,
}) => {
  await signIn(page, 'graph-notes');
  const card = page.getByRole('region', { name: 'Notes' });
  await expect(card).toContainText('As of 9 October, 27 of 36 loops are closed.');
  await card.getByRole('button', { name: 'Open step 3' }).click();
  const panel = loopPanel(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Sync incident report');
  await expect(panel.locator('[aria-current="step"]')).toContainText('Promise');
  await expect(panel.getByRole('region', { name: 'Loop notes' })).toContainText(
    'As of 9 October, 27 of 36 loops are closed.',
  );
});

test('a cite to a step after the As-of time is grey and not a button', async ({ page }) => {
  await signIn(page, 'graph-notes-asof');
  await page.goto(`${page.url().split('?')[0]}?t=2026-09-20T12:00:00%2B07:00`);
  const card = page.getByRole('region', { name: 'Notes' });
  // The sync report promise (cite 3) is dated 1 October, after this As-of time.
  await expect(card).toContainText('As of 9 October');
  await expect(card.getByRole('button', { name: 'Open step 3' })).toHaveCount(0);
  await expect(card.locator('.note-cite.off', { hasText: '3' })).toHaveAttribute(
    'title',
    'This step is not on the graph in this view',
  );
});

test('a cite to a loop that the filters hide clears the filters and opens the loop at that step', async ({
  page,
}) => {
  await signIn(page, 'graph-notes-filter');
  const card = page.getByRole('region', { name: 'Notes' });
  const problems = page.getByRole('button', { name: 'Problems only' });
  const search = page.getByRole('searchbox', { name: 'Search loop titles and quotes' });
  await problems.click();
  await search.fill('secret');
  await expect(problems).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Loop: Go-live date/ })).toHaveCount(0);
  // The go-live loop has no problem at T and no "secret" in its title or quotes, so both filters hide it.
  await card.getByRole('button', { name: 'Open step 1' }).click();
  const panel = loopPanel(page);
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Go-live date');
  await expect(panel.locator('[aria-current="step"]')).toContainText('Renegotiate');
  await expect(problems).toHaveAttribute('aria-pressed', 'false');
  await expect(search).toHaveValue('');
});

test('a cite to a loop that Show only hides shows every loop again and opens the loop', async ({
  page,
}) => {
  await signIn(page, 'graph-notes-only');
  const all = await branches(page).count();
  await page.getByRole('button', { name: 'Show only Kickoff agenda' }).click();
  await expect(branches(page)).not.toHaveCount(all);
  await expect(page.getByRole('button', { name: /^Loop: Go-live date/ })).toHaveCount(0);
  await page
    .getByRole('region', { name: 'Notes' })
    .getByRole('button', { name: 'Open step 1' })
    .click();
  await expect(loopPanel(page).getByRole('heading', { level: 2 })).toHaveText('Go-live date');
  await expect(branches(page)).toHaveCount(all);
});

/** A point on bare canvas, so a drag there pans instead of moving a card or an icon. */
async function emptyPoint(page: Page) {
  const box = await boxOf(graph(page));
  const point = await page.evaluate((area) => {
    for (let y = area.y + area.height - 40; y > area.y + 20; y -= 23)
      for (let x = area.x + area.width - 40; x > area.x + 20; x -= 31) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.classList.contains('react-flow__pane')) return { x, y };
      }
    return null;
  }, box);
  return point!;
}
const centre = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

test('a sideways drag keeps an event in its day, an upward drag on its icon moves the branch, and Reset layout restores both', async ({
  page,
}) => {
  await signIn(page, 'graph-cards');
  await atHundred(page);
  const branch = secretRenewal(page);
  const { icon } = await firstCardOf(page, branch);
  const before = await boxOf(icon);
  const columns = await page
    .getByTestId('time-axis')
    .locator('.axis-day')
    .evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    );
  const column = columns.find(
    (item) => item.left <= centre(before).x && centre(before).x < item.right,
  )!;
  await drag(page, centre(before), 600, 0);
  const after = await boxOf(icon);
  expect(centre(after).x).toBeGreaterThanOrEqual(column.left);
  expect(centre(after).x).toBeLessThan(column.right);
  await expect(loopPanel(page)).toBeHidden();

  const line = await boxOf(branch.locator('.hit'));
  await drag(page, centre(after), 0, -40);
  await expect.poll(async () => (await boxOf(branch.locator('.hit'))).y).toBeLessThan(line.y - 10);
  const saved = () =>
    page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('promise-graph:layout:v1:')),
    );
  expect(await saved()).toHaveLength(1);

  await page.reload();
  await expect(graph(page)).toHaveAttribute('data-ready', 'true');
  const reset = controls(page).getByRole('button', { name: 'Reset layout' });
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toBeHidden();
  expect(await saved()).toHaveLength(0);
});

test('a dragged event never passes an earlier event of its loop on the same day', async ({
  page,
}) => {
  await signIn(page, 'graph-cards');
  await atHundred(page);
  const branch = page.getByRole('button', { name: /^Loop: Investor import sample/ });
  await branch.focus();
  const icons = branch.locator('.hit-dot');
  const request = await boxOf(icons.nth(0)),
    promise = await boxOf(icons.nth(1));
  await drag(page, centre(promise), -600, 0);
  await expect
    .poll(async () => centre(await boxOf(icons.nth(1))).x)
    .toBeGreaterThan(centre(request).x);
  expect(centre(await boxOf(icons.nth(0))).x).toBeCloseTo(centre(request).x, 0);
});

test('a card drags on its own, keeps its place after a reload, and Reset layout puts it back', async ({
  page,
}) => {
  await signIn(page, 'graph-cards');
  await atHundred(page);
  const { icon, card } = await firstCardOf(page, secretRenewal(page));
  const iconBefore = await boxOf(icon),
    cardBefore = await boxOf(card);
  await drag(page, { x: cardBefore.x + 30, y: cardBefore.y + 40 }, 80, -60);
  const moved = await boxOf(card);
  expect(moved.x - cardBefore.x).toBeCloseTo(80, -1);
  expect(moved.y - cardBefore.y).toBeCloseTo(-60, -1);
  expect(await boxOf(icon)).toEqual(iconBefore);
  await expect(loopPanel(page)).toBeHidden();

  await page.reload();
  await expect(graph(page)).toHaveAttribute('data-ready', 'true');
  await atHundred(page);
  await secretRenewal(page).focus();
  const icon2 = await boxOf(icon),
    card2 = await boxOf(card);
  expect(card2.x - icon2.x).toBeCloseTo(moved.x - iconBefore.x, -1);
  expect(card2.y - icon2.y).toBeCloseTo(moved.y - iconBefore.y, -1);
  await controls(page).getByRole('button', { name: 'Reset layout' }).click();
  await expect
    .poll(async () => Math.round((await boxOf(card)).y - (await boxOf(icon)).y))
    .toBe(Math.round(cardBefore.y - iconBefore.y));
});

test('a loop-list click opens the panel and hides the list; closing the panel brings the list back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'graph-list');
  const list = page.getByRole('complementary', { name: 'Loop list' });
  const closePanel = page.getByRole('button', { name: 'Close loop panel' });
  await expect(list.getByRole('listitem')).toHaveCount(36);
  const total = await branches(page).count();
  const before = await zoomOf(page);
  await list.getByRole('button', { name: /^Sync incident report/ }).click();
  await expect(closePanel).toBeVisible();
  await expect(loopPanel(page).getByRole('heading', { level: 2 })).toHaveText(
    'Sync incident report',
  );
  await expect(list).toBeHidden();
  await expect.poll(() => zoomOf(page)).not.toBe(before);
  await controls(page).getByRole('button', { name: 'Loop list' }).click();
  await expect(closePanel).toBeHidden();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: /^Kickoff agenda/ }).click();
  await expect(loopPanel(page).getByRole('heading', { level: 2 })).toHaveText('Kickoff agenda');
  // The zoom reads the canvas width with the panel open, so the whole loop fits the canvas that the user sees.
  await viewSettled(page);
  const kickoff = await boxOf(
    page.getByRole('button', { name: /^Loop: Kickoff agenda/ }).locator('.hit'),
  );
  const area = await boxOf(graph(page));
  expect(kickoff.x).toBeGreaterThanOrEqual(area.x);
  expect(kickoff.x + kickoff.width).toBeLessThanOrEqual(area.x + area.width);
  await closePanel.click();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: /^Go-live date/ }).click();
  await expect(loopPanel(page).getByRole('heading', { level: 2 })).toHaveText('Go-live date');
  await closePanel.click();
  await expect(list).toBeVisible();

  await list.getByRole('button', { name: /^Client secret renewal/ }).click();
  await expect(loopPanel(page).getByRole('heading', { level: 2 })).toHaveText(
    'Client secret renewal',
  );
  await viewSettled(page);
  const secret = await boxOf(secretRenewal(page).locator('.hit'));
  const canvas = await boxOf(graph(page));
  expect(secret.x).toBeGreaterThanOrEqual(canvas.x);
  expect(secret.x).toBeLessThan(canvas.x + canvas.width);
  await closePanel.click();
  await expect(list.locator('li[aria-current="true"]')).toContainText('Client secret renewal');

  await list.getByRole('button', { name: 'Show only Client secret renewal' }).click();
  await expect(branches(page)).toHaveCount(1);
  await list
    .getByRole('button', { name: 'Show only CRS tax residency section with DealCloud sync' })
    .click();
  await expect(branches(page)).toHaveCount(7);
  await list.getByRole('button', { name: 'Show all' }).click();
  await expect(branches(page)).toHaveCount(total);

  await controls(page).getByRole('button', { name: 'Loop list' }).click();
  await expect(list).toBeHidden();
});

test('the list button closes an open panel and shows the list, even when the list was closed', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('promise-graph:loop-list', 'closed'));
  await signIn(page, 'graph-list-closed');
  const list = page.getByRole('complementary', { name: 'Loop list' });
  await expect(list).toBeHidden();
  await openLoop(secretRenewal(page));
  await expect(loopPanel(page)).toBeVisible();
  await expect(list).toBeHidden();
  await controls(page).getByRole('button', { name: 'Loop list' }).click();
  await expect(loopPanel(page)).toBeHidden();
  await expect(list).toBeVisible();
});

test('a promise split into tasks shows its gateways, its waiting note, its task panel and the indented list', async ({
  page,
}) => {
  await signIn(page, 'graph-tasks');
  await expect(page.locator('.gateway.split')).toHaveCount(1);
  await expect(page.locator('.gateway.handoff')).toHaveCount(4);
  await expect(page.locator('.gateway.handoff.pending')).toHaveCount(1);
  await expect(page.locator('.gateway.join')).toHaveCount(1);
  await expect(page.locator('.handoff-note')).toContainText([
    'waited 4 business days',
    'waiting for PG-203 Country list field type',
  ]);
  await openLoop(page.getByRole('button', { name: /^Loop: CRS tax residency section/ }));
  const work = loopPanel(page).getByRole('region', { name: 'Tasks and handoffs' });
  await expect(work).toContainText('3 of 5 done');
  await work.getByRole('button', { name: /PG-201 CRS form logic/ }).click();
  const task = loopPanel(page).getByRole('region', { name: 'Tasks and handoffs' });
  await expect(task).toContainText('Part of');
  await expect(task).toContainText('Blocked by');
  await expect(task).toContainText('Blocks');
  await expect(task.getByRole('button', { name: /CRS tax residency section/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page
    .getByRole('group', { name: /^view$/i })
    .getByRole('button', { name: 'List' })
    .click();
  const rows = page.getByRole('table', { name: /loops/i }).getByRole('row');
  const names = await rows.evaluateAll((items) => items.map((item) => item.textContent ?? ''));
  const parentAt = names.findIndex((text) => text.includes('CRS tax residency section'));
  expect(names[parentAt + 1]).toContain('Analyse the CRS and FATCA rules');
  await expect(rows.filter({ hasText: 'PG-201 CRS form logic' })).toHaveClass(/task-row/);
});

test('the time axis shows day labels and no axis menu or resize handle', async ({ page }) => {
  await signIn(page, 'graph-days');
  const axis = page.getByTestId('time-axis');
  await expect(axis.getByText(/^\d{1,2} \w+$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time axis: days' })).toHaveCount(0);
  await expect(axis.getByRole('separator')).toHaveCount(0);
});

test('the loop list search narrows the list by title or department and keeps a task with its promise', async ({
  page,
}) => {
  await signIn(page, 'graph-list');
  const list = page.getByRole('complementary', { name: 'Loop list' });
  const search = list.getByRole('searchbox', { name: 'Search loops' });
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(36);
  await search.fill('SECRET');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Client secret renewal');
  await expect(list).toContainText('1 of 36');
  await search.fill('pg-20');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('CRS tax residency section');
  await expect(rows.first()).toHaveClass(/context/);
  await search.fill('Digitization QA');
  await expect(rows.filter({ hasText: 'Test the CRS section end to end' })).toHaveCount(1);
  await search.fill('no such loop');
  await expect(rows).toHaveCount(0);
  await expect(list).toContainText('No loop matches');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(36);
  await expect(branches(page)).toHaveCount(36);
});

test('the loop panel shows sub-issues and the handoffs among its steps, like a ticket tracker', async ({
  page,
}) => {
  await signIn(page, 'graph-tasks');
  await openLoop(page.getByRole('button', { name: /^Loop: CRS tax residency section/ }));
  const panel = loopPanel(page);
  const work = panel.getByRole('region', { name: 'Tasks and handoffs' });
  await expect(work.getByRole('progressbar', { name: 'Sub-issues done' })).toHaveAttribute(
    'aria-valuenow',
    '3',
  );
  await expect(work.getByRole('listitem')).toHaveCount(5);
  await expect(
    work.getByRole('listitem').filter({ hasText: 'Test the CRS section end to end' }),
  ).toContainText('blocked');
  const steps = panel.getByRole('list', { name: 'Steps' });
  await expect(steps).toContainText('Split into 5 tasks for');

  await work.getByRole('button', { name: /PG-201 CRS form logic/ }).click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('PG-201 CRS form logic');
  await expect(steps).toContainText('Handed over from Analyse the CRS and FATCA rules');
  await expect(steps).toContainText('Handed off to Test the CRS section end to end');
  await steps.getByRole('button', { name: /Test the CRS section end to end/ }).click();
  await expect(steps).toContainText(/Waiting for PG-203 Country list field type/);
  await expect(work).toContainText('Blocked by');
});

test('the canvas and the open panel share one height, and the panel, list and department column resize', async ({
  page,
}) => {
  await signIn(page, 'graph-layout');
  const index = page.getByRole('complementary', { name: 'Loop list' });
  const listWidth = (await boxOf(index)).width;
  await drag(
    page,
    centre(await boxOf(page.getByRole('separator', { name: 'Loop list width' }))),
    -60,
    0,
  );
  await expect
    .poll(async () => Math.abs((await boxOf(index)).width - (listWidth + 60)))
    .toBeLessThan(2);

  await openLoop(secretRenewal(page));
  await expect(index).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Loop list width' })).toBeHidden();
  const stage = page.locator('.canvas-stage');
  const drawer = page.locator('.drawer');
  expect(Math.abs((await boxOf(stage)).height - (await boxOf(drawer)).height)).toBeLessThan(2);

  const panelWidth = (await boxOf(drawer)).width;
  const handle = await boxOf(page.getByRole('separator', { name: 'Panel width' }));
  await drag(page, centre(handle), -100, 0);
  await expect
    .poll(async () => Math.abs((await boxOf(drawer)).width - (panelWidth + 100)))
    .toBeLessThan(2);

  const column = page.getByTestId('lane-column');
  const columnWidth = (await boxOf(column)).width;
  await drag(
    page,
    centre(await boxOf(page.getByRole('separator', { name: 'Department column width' }))),
    60,
    0,
  );
  await expect
    .poll(async () => Math.abs((await boxOf(column)).width - (columnWidth + 60)))
    .toBeLessThan(2);

  await page.reload();
  await expect(graph(page)).toHaveAttribute('data-ready', 'true');
  await expect
    .poll(async () => Math.abs((await boxOf(column)).width - (columnWidth + 60)))
    .toBeLessThan(2);
  await page.getByRole('separator', { name: 'Department column width' }).dblclick();
  await expect
    .poll(async () => Math.abs((await boxOf(column)).width - columnWidth))
    .toBeLessThan(2);
});

test('View record opens the record inside the stage, so full screen stays on', async ({ page }) => {
  await signIn(page, 'graph-layout');
  await openLoop(secretRenewal(page));
  const url = page.url();
  const enabled = await page.evaluate(() => document.fullscreenEnabled);
  if (enabled) await controls(page).getByRole('button', { name: 'Full screen' }).click();
  await loopPanel(page).getByRole('button', { name: 'View record' }).first().click();
  const record = page.getByRole('dialog', { name: 'Record' });
  await expect(record.locator('mark')).toHaveText(/\w+/);
  expect(page.url()).toBe(url);
  if (enabled)
    expect(await page.evaluate(() => document.fullscreenElement?.className ?? '')).toContain(
      'stage',
    );
  await page.keyboard.press('Escape');
  await expect(record).toBeHidden();
  await expect(loopPanel(page)).toBeVisible();
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
