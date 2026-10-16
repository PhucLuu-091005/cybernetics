import { expect, test, type Locator, type Page } from '@playwright/test';

const PROJECT = 'Larkspur Capital';

async function signIn(page: Page, label: string) {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const match = page.url().match(/\/projects\/([0-9a-f-]{36})\//);
  expect(match).not.toBeNull();
  return match![1];
}
const sets = (page: Page) => page.getByRole('list', { name: 'Change sets' });
const actions = (page: Page) => page.getByRole('group', { name: 'Change set actions' });
async function openSet(page: Page, name: RegExp) {
  const link = sets(page).getByRole('link', { name });
  const href = (await link.getAttribute('href'))!;
  await link.click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === href);
  await expect(link).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}
const approved = (page: Page, title: RegExp) => page.getByRole('status').filter({ hasText: title });

test('approve the agent change set from Review and see it leave the queue', async ({ page }) => {
  const projectId = await signIn(page, 'queue-approve');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up on the incident report/);
  await expect(page.getByRole('heading', { name: 'What changes' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Quotes' })
      .getByText('Where is the root cause report you promised?'),
  ).toBeVisible();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved: Add Sarah's follow-up/)).toBeVisible();
  await expect(sets(page).getByRole('link', { name: /Add Sarah's follow-up/ })).toHaveCount(0);
});

test('after one title change set is approved the competing one reaches Resolve conflict', async ({
  page,
}) => {
  const projectId = await signIn(page, 'queue-compete');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /as a phase 1 request/);
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved: Retitle the Dynamics loop as a phase 1/)).toBeVisible();
  await openSet(page, /with the SOW scope/);
  await expect(page.getByText(/Choose which side stays/)).toBeVisible();
  await page.getByRole('link', { name: 'Resolve conflict' }).click();
  await expect(page).toHaveURL(/\/rebase$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Resolve conflict' })).toBeVisible();
});

test('a change set made before another approval shows Update to latest and then approves', async ({
  page,
}) => {
  const projectId = await signIn(page, 'queue-update');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved: Add Sarah's follow-up/)).toBeVisible();
  await openSet(page, /as a phase 1 request/);
  await expect(page.getByText(/Nothing conflicts/)).toBeVisible();
  await expect(actions(page).getByRole('button', { name: 'Approve' })).toBeDisabled();
  await page.getByRole('button', { name: 'Update to latest' }).click();
  await expect(approved(page, /^Updated\. Check the changes again/)).toBeVisible();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved: Retitle the Dynamics loop as a phase 1/)).toBeVisible();
});

test('reject asks to confirm, then the change set leaves the queue', async ({ page }) => {
  const projectId = await signIn(page, 'queue-reject');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /with the SOW scope/);
  await actions(page).getByRole('button', { name: 'Reject' }).click();
  await actions(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(actions(page).getByRole('button', { name: 'Confirm reject' })).toHaveCount(0);
  await expect(sets(page).getByRole('link', { name: /with the SOW scope/ })).toHaveCount(1);

  await actions(page).getByRole('button', { name: 'Reject' }).click();
  await actions(page).getByRole('button', { name: 'Confirm reject' }).click();
  await expect(
    approved(page, /^Rejected: Retitle the Dynamics loop with the SOW scope\.$/),
  ).toBeVisible();
  await expect(sets(page).getByRole('link', { name: /with the SOW scope/ })).toHaveCount(0);
});

test('ignore the out-of-office reply: it leaves New records and sits in My review', async ({
  page,
}) => {
  const projectId = await signIn(page, 'queue-ignore');
  await page.goto(`/projects/${projectId}/review?tab=records`);
  await page.getByRole('link', { name: /Automatic reply: out of office/ }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Automatic reply: out of office' }),
  ).toBeVisible();
  await page.getByLabel('Reason to ignore').fill('Auto-reply');
  await page.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(page.getByRole('link', { name: /Automatic reply: out of office/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Change sets/ }).click();
  await openSet(page, /^My review/);
  await expect(page.getByText('Automatic reply: out of office')).toBeVisible();
});

test('a second approve of the same change set shows a conflict and stays on the screen', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const projectId = await signIn(page, 'queue-double');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(actions(other).getByRole('button', { name: 'Approve' })).toBeEnabled();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved:/)).toBeVisible();
  await actions(other).getByRole('button', { name: 'Approve' }).click();
  await expect(other.getByRole('status').filter({ hasText: /^Approved:/ })).toHaveCount(0);
  await expect(other.getByRole('alert').filter({ hasText: 'Conflict' })).toBeVisible();
  await expect(other).toHaveURL(/item=/);
  await context.close();
});

test('a record ignored after another approval still lands in the same My review', async ({
  page,
}) => {
  const projectId = await signIn(page, 'queue-focus');
  const ignoreRecord = async (title: string) => {
    await page.goto(`/projects/${projectId}/review?tab=records`);
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    await page.getByLabel('Reason to ignore').fill('Not a promise');
    await page.getByRole('button', { name: 'Ignore', exact: true }).click();
    await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);
  };
  await ignoreRecord('Automatic reply: out of office');
  const missing = page.getByRole('link', { name: /Missing investors after the sync failure/ });
  await expect(missing).toBeVisible();

  await page.goto(`/projects/${projectId}/review?tab=sets`);
  await openSet(page, /Add Sarah's follow-up/);
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved: Add Sarah's follow-up/)).toBeVisible();

  await page.goto(`/projects/${projectId}/review?tab=records`);
  await expect(page.getByRole('list', { name: 'Records' })).toBeVisible();
  await expect(missing).toHaveCount(0);
  const tabCount = async (name: RegExp) =>
    Number(await page.getByRole('tab', { name }).locator('.c').textContent());
  const setCount = await tabCount(/^Change sets/);
  const recordCount = await tabCount(/^New records/);
  await expect(page.getByRole('list', { name: 'Records' }).getByRole('listitem')).toHaveCount(
    recordCount,
  );
  await expect(
    page.getByRole('link', { name: `Review, ${setCount + recordCount} waiting` }),
  ).toBeVisible();

  await ignoreRecord('Go-live slip');

  await page.getByRole('tab', { name: /^Change sets/ }).click();
  await expect(sets(page).getByRole('link', { name: /^My review/ })).toHaveCount(1);
  await openSet(page, /^My review/);
  await expect(page.getByText('Automatic reply: out of office')).toBeVisible();
  await expect(page.getByText('Go-live slip')).toBeVisible();
});

test('an unknown or already approved change set id is handled', async ({ page }) => {
  const projectId = await signIn(page, 'queue-ids');
  const unknown = await page.goto(
    `/projects/${projectId}/review?tab=sets&item=${crypto.randomUUID()}`,
  );
  expect(unknown?.status()).toBe(404);

  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const itemUrl = page.url();
  await actions(page).getByRole('button', { name: 'Approve' }).click();
  await expect(approved(page, /^Approved: Add Sarah's follow-up/)).toBeVisible();
  await page.goto(itemUrl);
  await expect(page.getByText('This change set is no longer open')).toBeVisible();
  await expect(page.getByRole('link', { name: 'See Activity' })).toBeVisible();
});

const box = async (locator: Locator) => (await locator.boundingBox())!;
const graphRegion = (page: Page) => page.getByRole('region', { name: 'On the graph' });

test('the change set header holds the title with Reject and Approve on its right', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectId = await signIn(page, 'queue-header');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const title = await box(page.getByRole('heading', { level: 2, name: /Add Sarah's follow-up/ }));
  const reject = await box(actions(page).getByRole('button', { name: 'Reject' }));
  const approve = await box(actions(page).getByRole('button', { name: 'Approve' }));
  expect(reject.x).toBeGreaterThanOrEqual(title.x + title.width);
  expect(approve.x).toBeGreaterThan(reject.x);
  for (const button of [reject, approve]) {
    expect(button.y).toBeLessThan(title.y + title.height);
    expect(button.y + button.height).toBeGreaterThan(title.y);
  }
  await expect(actions(page).getByRole('link')).toHaveCount(0);
});

test('What changes comes first, then the change set graph with the canvas', async ({ page }) => {
  const projectId = await signIn(page, 'queue-graph');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const changes = page.getByRole('region', { name: 'What changes' });
  await expect(changes.getByRole('link', { name: 'Edit' })).toHaveAttribute(
    'href',
    new RegExp(`/projects/${projectId}/proposals/[0-9a-f-]{36}$`),
  );
  const region = graphRegion(page);
  await expect(region.getByRole('group', { name: /promise graph for/i })).toBeVisible();
  expect((await box(changes)).y + (await box(changes)).height).toBeLessThanOrEqual(
    (await box(region)).y,
  );
});

test('the change set graph has no edit control, keeps the Review URL and lets another set open', async ({
  page,
}) => {
  const projectId = await signIn(page, 'queue-readonly');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const region = graphRegion(page);
  await expect(region.getByRole('group', { name: /promise graph for/i })).toHaveAttribute(
    'data-ready',
    'true',
  );
  await region
    .locator('.ev-card', { hasText: 'Where is the root cause report you promised?' })
    .locator('.ev-p')
    .click();
  const panel = region.getByRole('complementary', { name: /loop panel/i });
  await expect(panel.getByRole('heading', { level: 4 })).toHaveText('Sync incident report');
  await page.getByRole('heading', { level: 2, name: /Add Sarah's follow-up/ }).click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('listitem').first()).toBeVisible();
  await expect(panel.getByLabel('Act actions')).toHaveCount(0);
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  await expect(panel.getByText('Go-live and first close')).toBeVisible();
  await expect(
    region.getByRole('button', {
      name: /Change type|Move to another loop|Hide this act|Apply to change set/,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]tab=sets&item=[0-9a-f-]{36}.*[?&]loop=[0-9a-f-]{36}/);

  await openSet(page, /as a phase 1 request/);
  await expect(region.getByRole('complementary', { name: /loop panel/i })).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]loop=/);
});

test('the change set graph opens on the changed step', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const projectId = await signIn(page, 'queue-step-focus');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const canvas = graphRegion(page).getByRole('group', { name: /promise graph for/i });
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  const step = canvas.locator('.ev-card', {
    hasText: 'Where is the root cause report you promised?',
  });
  await expect(step).toBeVisible();
  await expect
    .poll(async () => {
      const [area, card] = [await box(canvas), await box(step)];
      return (
        card.x >= area.x &&
        card.y >= area.y &&
        card.x + card.width <= area.x + area.width &&
        card.y + card.height <= area.y + area.height
      );
    })
    .toBe(true);
});

test('Open full graph leads to the change set on the graph page', async ({ page }) => {
  const projectId = await signIn(page, 'queue-full-graph');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up/);
  const proposalId = new URL(page.url()).searchParams.get('item')!;
  await graphRegion(page).getByRole('link', { name: 'Open full graph' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/graph\\?proposal=${proposalId}&rev=\\d+$`),
  );
  await expect(page.getByText('Change set, open')).toBeVisible();
});
