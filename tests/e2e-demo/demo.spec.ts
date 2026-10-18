import { expect, test, type Page } from '@playwright/test';
import { hydrated } from '../e2e/helpers';

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

const GRAPH = /\/projects\/([0-9a-f-]{36})\/graph$/;

async function open(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForURL(GRAPH);
  await expect(page.locator('svg.pg')).toBeVisible();
  await hydrated(page);
  return new URL(page.url()).pathname.split('/')[2];
}

test('the first visit opens a sandbox graph with no sign-in, and a second visit keeps it', async ({
  page,
  context,
}) => {
  const projectId = await open(page);
  const [cookie] = (await context.cookies()).filter((c) => c.name === 'pg_session');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(cookie.expires * 1000 - Date.now()).toBeGreaterThan(29 * 86_400_000);
  await page.locator('.me > summary').click();
  const menu = page.locator('.acct-pop');
  await expect(menu).toContainText('Your own demo copy. Nobody else sees your changes.');
  await expect(menu.getByRole('button', { name: 'Start over' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  expect(await open(page)).toBe(projectId);
  expect(await open(page, '/signin')).toBe(projectId);
});

test('two visitors get separate sandboxes, and one cannot open the other', async ({
  page,
  browser,
}) => {
  const mine = await open(page);
  const other = await browser.newContext();
  try {
    const theirs = await open(await other.newPage());
    expect(theirs).not.toBe(mine);
    await page.goto(`/projects/${theirs}/graph`);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  } finally {
    await other.close();
  }
});

test('a visitor acts as a demo person and opens a change request', async ({ page }) => {
  await open(page);
  await page.getByLabel('Demo: act as').click();
  await page.getByRole('option', { name: 'Lan Phạm', exact: true }).click();
  await expect(page.locator('.me b')).toHaveText('Lan Phạm');
  await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
  await page.locator('.m-card').getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/changes\/\d+$/);
  await expect(page.locator('.bbar').first()).toContainText('You are editing');
});

test('a visitor makes an agent token in Settings and MCP accepts it', async ({ page }) => {
  const projectId = await open(page);
  await page.goto(`/projects/${projectId}/settings/tokens`);
  const form = page.getByRole('form', { name: 'Create a token' });
  await form.getByLabel('Label').fill('Judge agent');
  await form.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.getByTestId('token-secret').textContent())!.trim();
  expect(secret).toMatch(/^inv_/);
  const answer = await page.request.post('/mcp', {
    headers: {
      authorization: `Bearer ${secret}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(answer.status()).toBe(200);
  expect(JSON.stringify(await answer.json())).toContain('add_queue_event');
});

test('Start over opens a fresh sandbox for a new person', async ({ page }) => {
  const before = await open(page);
  await page.locator('.me > summary').click();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.waitForURL((url) => GRAPH.test(url.pathname) && !url.pathname.includes(before));
  await expect(page.locator('svg.pg')).toBeVisible();
  await page.goto(`/projects/${before}/graph`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test.describe('a link preview', () => {
  test.use({ userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
  test('gets the read-only welcome page and no sandbox', async ({ page, context }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('link', { name: 'Open the demo' })).toHaveAttribute('href', '/');
    expect((await context.cookies()).filter((c) => c.name === 'pg_session')).toHaveLength(0);
    const head = await page.request.head('/');
    expect(new URL(head.url()).pathname).toBe('/welcome');
  });
});
