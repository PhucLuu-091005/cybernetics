import { expect, request, test, type Page } from '@playwright/test';
import sharp from 'sharp';
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

test('a demo visitor uses Profile in their own copy: a photo and a personal key for that copy only', async ({
  page,
}) => {
  const projectId = await open(page);
  await page.locator('.me > summary').click();
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/profile`);
  await page.getByRole('button', { name: 'Upload photo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a photo' });
  const png = await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 90, g: 60, b: 160 } },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Photo file')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Save photo' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('details.acct .acct-av img')).toHaveAttribute(
    'src',
    /^\/api\/v1\/avatars\//,
  );

  const form = page.getByRole('form', { name: 'Create a personal key' });
  await form.getByLabel('Label').fill('Demo laptop');
  await form.getByRole('button', { name: 'Create key' }).click();
  const secret = (await page.getByTestId('token-secret').innerText()).trim();
  const reply = await page.request.post('/mcp', {
    headers: {
      authorization: `Bearer ${secret}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} },
    },
  });
  const projects = (await reply.json()).result.structuredContent.projects;
  expect(projects.map((p: { id: string }) => p.id)).toEqual([projectId]);
});

// next dev builds each route on its own, so these prove the limits answer from any route, not 500.
test('the 31st new copy in an hour from one address gets the busy page', async ({ baseURL }) => {
  test.setTimeout(180_000);
  const visit = async () => {
    // A fresh client each time: a kept cookie would reopen the first copy instead of making one.
    const api = await request.newContext({ baseURL });
    try {
      const reply = await api.get('/api/auth/demo', {
        maxRedirects: 0,
        headers: {
          accept: 'text/html',
          'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
          'x-forwarded-for': '203.0.113.31',
        },
      });
      expect(reply.status()).toBe(303);
      return reply.headers()['location'];
    } finally {
      await api.dispose();
    }
  };
  // The first route to read the limits builds the shared limiter; here a REST route, not this one.
  const rest = await request.newContext({ baseURL });
  await rest.get('/api/v1/projects');
  await rest.dispose();
  for (let i = 0; i < 30; i++) expect(await visit()).toMatch(/^\/api\/auth\/demo\?check=1/);
  expect(await visit()).toBe('/welcome?reason=busy');
});

test('a token gets 429 RATE_LIMITED on its 61st MCP call in a minute', async ({ page }) => {
  const projectId = await open(page);
  await page.goto(`/projects/${projectId}/settings/tokens`);
  const form = page.getByRole('form', { name: 'Create a token' });
  await form.getByLabel('Label').fill('Busy agent');
  await form.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.getByTestId('token-secret').textContent())!.trim();
  const list = () =>
    page.request.post('/mcp', {
      headers: {
        authorization: `Bearer ${secret}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
  const statuses: number[] = [];
  for (let i = 0; i < 60; i++) statuses.push((await list()).status());
  expect(statuses.every((status) => status === 200)).toBe(true);
  const refused = await list();
  expect(refused.status()).toBe(429);
  expect(await refused.json()).toMatchObject({ code: 'RATE_LIMITED' });
});
