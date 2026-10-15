import { expect, test, type Page } from '@playwright/test';

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
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}
const approved = (page: Page, title: RegExp) => page.getByRole('status').filter({ hasText: title });

test('approve the agent change set from Review and see the follow-up on the graph', async ({
  page,
}) => {
  const projectId = await signIn(page, 'queue-approve');
  await page.goto(`/projects/${projectId}/review`);
  await openSet(page, /Add Sarah's follow-up on the incident report/);
  await expect(page.getByRole('heading', { name: 'What changes' })).toBeVisible();
  await expect(page.getByText('Where is the root cause report you promised?')).toBeVisible();
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
  await expect(other.getByRole('alert').filter({ hasText: 'Conflict' })).toBeVisible();
  await expect(other).toHaveURL(/item=/);
  await context.close();
});
