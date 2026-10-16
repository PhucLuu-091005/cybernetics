import { expect, test, type Locator, type Page } from '@playwright/test';

type Point = { x: number; y: number };
type TrackerRead = {
  crs: Array<{ num: number; status: string }>;
  commits: Array<{ crNum: number | null; resolutions: Array<{ chose: string }> }>;
};

// Drags, the Demo select and the review picks need React handlers; the fold button stays disabled until hydration.
const hydrated = (page: Page) =>
  expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();

async function visit(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

async function signIn(page: Page, label: string) {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  await expect(page.locator('svg.pg')).toBeVisible();
  await hydrated(page);
  const projectId = new URL(page.url()).pathname.split('/')[2];
  return { projectId, graph: `/projects/${projectId}/graph` };
}

async function actAs(page: Page, name: string) {
  await page.getByLabel('Demo: act as').selectOption({ label: name });
  await expect(page.locator('.me b')).toHaveText(name);
}

async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The drag end has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Moves the mouse in small steps, as a person does, so the drag passes the start threshold. */
async function drag(page: Page, from: Locator, to: Locator | Point) {
  await from.scrollIntoViewIfNeeded();
  const a = await centerOf(from);
  const b = 'x' in to ? to : await centerOf(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 8, a.y + 8, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function readTracker(page: Page, projectId: string): Promise<TrackerRead> {
  const response = await page.request.get(`/api/v1/projects/${projectId}/tracker`);
  expect(response.status()).toBe(200);
  return (await response.json()) as TrackerRead;
}

const noHorizontalScroll = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBe(0);

test.describe('the tracker walkthrough', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

  test('the 13 tasks of the prototype, from a date move to a merge with a clash', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });

    const { projectId, graph } = await signIn(page, 'tracker-walk');
    const bar = page.locator('.bbar').first();
    const toast = page.locator('.tk-toast');
    const dialog = page.locator('.m-card');
    const queueEvent = (text: string) => page.locator('[data-qevent]', { hasText: text });
    const row = (id: string) => page.locator(`svg.pg [data-loop="${id}"]`);
    const openReview = async (num: number) => {
      await visit(page, `${graph}?cr=${num}`);
      await bar.getByRole('link', { name: 'Review and merge' }).click();
      await page.waitForURL(new RegExp(`/changes/${num}`));
      await expect(page.locator('.pr-tabs')).toBeVisible();
      await hydrated(page);
    };

    await test.step('1. the Go-live date flag shows the first date, the move and its reason', async () => {
      await page.locator('svg.pg [data-due="golive"]').click();
      const pop = page.locator('.pop');
      await expect(pop).toContainText(/First planned 30 Sept/i);
      await expect(pop).toContainText('30 Sept → 15 Oct');
      await expect(pop).toContainText('The CRS section is not ready.');
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
    });

    await test.step('2. Lan drags a Queue event onto a work item and starts change request #5', async () => {
      await actAs(page, 'Lan Phạm');
      await drag(page, queueEvent('Where is the root cause report'), row('incident'));
      await expect(dialog).toContainText('Main is read-only');
      await dialog.getByRole('button', { name: 'New change request' }).click();
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await page.waitForURL(/cr=5$/);
      await expect(bar).toContainText('#5');
      await expect(bar).toContainText('You are editing');
      await expect(bar).toContainText('1 change');
    });

    await test.step('3. Lan drags the PG-203 flag and must write a reason', async () => {
      const flag = page.locator('svg.pg [data-due="pg203"]');
      const at = await centerOf(flag);
      await drag(page, flag, { x: at.x + 70, y: at.y });
      await expect(dialog).toContainText('Move the planned finish');
      expect((await dialog.locator('input[type=date]').inputValue()) > '2026-10-06').toBe(true);
      const save = dialog.getByRole('button', { name: 'Move the date' });
      await expect(save).toBeDisabled();
      await dialog.locator('textarea').fill('   ');
      await expect(save).toBeDisabled();
      await dialog
        .locator('textarea')
        .fill('Lan sends the country list on 10 October, so the field ships later.');
      await save.click();
      await expect(toast).toContainText('PG-203 Country list field type: planned finish moved.');
      await expect(bar).toContainText('2 changes');
    });

    await test.step('4. Lan shares #5 with Khoa, Can edit', async () => {
      await bar.getByRole('button', { name: 'Share' }).click();
      await expect(dialog.getByLabel('Link')).toHaveValue(
        /\/projects\/[0-9a-f-]{36}\/graph\?cr=5$/,
      );
      await dialog.getByLabel('Person').selectOption({ label: 'Khoa Lê' });
      await dialog.getByLabel('Access', { exact: true }).selectOption('edit');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(toast).toContainText('Khoa Lê can edit #5. Send them the link.');
      await expect(dialog.getByLabel('Access for Khoa Lê')).toHaveValue('edit');
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('5. Khoa opens #5 while Lan edits and asks to edit', async () => {
      await actAs(page, 'Khoa Lê');
      await expect(page).toHaveURL(/cr=5$/);
      await expect(bar).toContainText('Lan is editing');
      await bar.getByRole('button', { name: 'Ask to edit' }).click();
      await expect(bar).toContainText('Waiting for Lan');
    });

    await test.step('6. Lan sees the ask and hands over', async () => {
      await actAs(page, 'Lan Phạm');
      const ask = page.locator('.ask-row');
      await expect(ask).toContainText('Khoa Lê asks to edit #5.');
      await ask.getByRole('button', { name: 'Hand over' }).click();
      await expect(bar).toContainText('Khoa is editing');
    });

    await test.step('7. Khoa drags the scope call onto Dynamics CRM sync scope', async () => {
      await actAs(page, 'Khoa Lê');
      await expect(bar).toContainText('You are editing');
      await drag(page, queueEvent('Scope call'), row('dynamics'));
      await expect(toast).toContainText('Meeting by Sarah Kim: added');
      await expect(page.locator('.pop')).toContainText('Added a Meeting');
      await expect(bar).toContainText('3 changes');
    });

    await test.step('8. Khoa marks #5 as ready, which locks it', async () => {
      await bar.getByRole('button', { name: 'Mark as ready' }).click();
      await expect(toast).toContainText('#5 is ready. Minh Trần can merge it now.');
      await expect(bar).toContainText('Ready to merge');
      await expect(bar).toContainText('Locked. Waiting for Minh.');
      await expect(bar.getByRole('button', { name: 'Edit again' })).toBeVisible();
    });

    await test.step('9. Minh reviews #2 and merges it into Main', async () => {
      await actAs(page, 'Minh Trần');
      await expect(page.locator('.drawer', { hasText: 'Change requests' })).toBeVisible();
      await openReview(2);
      await page.getByRole('tab', { name: /On the graph/ }).click();
      await expect(page.getByRole('button', { name: 'After', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: /Changes/ }).click();
      await page.getByRole('button', { name: 'Merge into Main' }).click();
      await page.waitForURL(/\/graph/);
      await expect(bar).toContainText('Merged into Main by Minh Trần');
      const tracker = await readTracker(page, projectId);
      expect(tracker.crs.find((c) => c.num === 2)?.status).toBe('merged');
      expect(tracker.commits).toHaveLength(2);
    });

    await test.step('10. Minh resolves the PG-203 name clash in #3 and merges', async () => {
      await visit(page, `${graph}?cr=3`);
      await expect(bar).toContainText('1 clash with Main');
      await bar.getByRole('link', { name: 'Review and merge' }).click();
      await page.waitForURL(/\/changes\/3/);
      await hydrated(page);
      const merge = page.getByRole('button', { name: 'Merge into Main' });
      await expect(page.locator('.res-box')).toBeVisible();
      await expect(merge).toBeDisabled();
      await page.locator('.res-box input[type=radio][value="cr"]').first().check();
      await expect(merge).toBeEnabled();
      await merge.click();
      await page.waitForURL(/\/graph/);
      const commit = (await readTracker(page, projectId)).commits.find((c) => c.crNum === 3);
      expect(commit?.resolutions.map((r) => r.chose)).toEqual(['cr']);
    });

    await test.step('11. Minh asks for changes on #5; Khoa reads the note and marks it ready again', async () => {
      await openReview(5);
      await expect(page.locator('.dquote', { hasText: 'Why it moves' })).toContainText(
        'Lan sends the country list on 10 October',
      );
      await page.getByRole('button', { name: 'Request changes' }).click();
      await page.locator('#rv-note').fill('Add the date Lan promised for the country list.');
      await page.getByRole('button', { name: 'Send back to draft' }).click();
      await expect
        .poll(async () => (await readTracker(page, projectId)).crs.find((c) => c.num === 5)?.status)
        .toBe('draft');

      await visit(page, graph);
      await actAs(page, 'Khoa Lê');
      await expect(bar).toContainText('Minh Trần asked for changes');
      await bar.getByRole('link', { name: 'Read', exact: true }).click();
      await page.waitForURL(/\/changes\/5/);
      await expect(page.locator('#rv-panel')).toContainText(
        'Add the date Lan promised for the country list.',
      );
      await page.getByRole('link', { name: 'Back to the graph' }).first().click();
      await expect(page.locator('svg.pg')).toBeVisible();
      await hydrated(page);
      await bar.getByRole('button', { name: 'Mark as ready' }).click();
      await expect(toast).toContainText('#5 is ready');
    });

    await test.step('12. History lists the merges, and See changes opens one', async () => {
      await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
      const history = page.locator('.drawer');
      for (const text of ['#3', '#2', '#1', '1 clash resolved'])
        await expect(history).toContainText(text);
      await history.getByRole('link', { name: 'See changes' }).first().click();
      await page.waitForURL(/\/changes\/3/);
      await expect(page.locator('.pr-tabs')).toBeVisible();
    });

    await test.step('13. A drag on merged #1 asks for a new change request', async () => {
      await visit(page, graph);
      await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
      await page.locator('.drawer').getByRole('button', { name: 'Open graph' }).last().click();
      await page.waitForURL(/cr=1$/);
      await drag(page, queueEvent('The test environment has no country list'), row('test'));
      await expect(dialog).toContainText('#1 is merged');
      await expect(dialog).toContainText('Your change goes into it');
      await expect(dialog.getByRole('button', { name: 'New change request' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    expect(problems).toEqual([]);
  });
});

test.describe('the tracker at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true });

  test('the graph, a change request, a modal and the review page never scroll sideways', async ({
    page,
  }) => {
    await page.goto('/signin?label=tracker-phone');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
    const graph = new URL(page.url()).pathname;
    await expect(page.locator('svg.pg')).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto(`${graph}?cr=4`);
    await expect(page.locator('.bbar').first()).toContainText('#4');
    await noHorizontalScroll(page);

    const add = page.getByRole('dialog', { name: 'Add to the queue' });
    // The phone rail hides the fold button, so the first clicks may land before hydration.
    await expect(async () => {
      await page.locator('.p-side').getByRole('button', { name: 'Add' }).click({ timeout: 2_000 });
      await expect(add).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await noHorizontalScroll(page);
    await page.keyboard.press('Escape');

    await page.goto(graph.replace(/graph$/, 'changes/2'));
    await expect(page.locator('.pr-tabs')).toBeVisible();
    await noHorizontalScroll(page);
  });
});
