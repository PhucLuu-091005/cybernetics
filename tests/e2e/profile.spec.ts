import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { hydrated } from './helpers';

const PROJECT = 'Larkspur Capital';

async function signIn(page: Page, label: string): Promise<string> {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  return new URL(page.url()).pathname.split('/')[2];
}

async function openProfile(page: Page, projectId: string) {
  await hydrated(page);
  await page.locator('details.acct > summary').click();
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(`/projects/${projectId}/profile`);
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
}

test('the account menu opens Profile, where a personal key reaches every project of its person', async ({
  page,
}) => {
  const projectId = await signIn(page, 'profile-keys');
  await openProfile(page, projectId);

  const form = page.getByRole('form', { name: 'Create a personal key' });
  const permissions = form.getByRole('group', { name: 'Permissions' });
  await expect(permissions.getByRole('checkbox', { name: /Read the project/ })).toBeChecked();
  await expect(permissions.getByRole('checkbox', { name: /Merge into Main/ })).toBeEnabled();
  await form.getByLabel('Label').fill('Laptop agent');
  await form.getByRole('button', { name: 'Create key' }).click();
  const secret = (await page.getByTestId('token-secret').innerText()).trim();
  expect(secret).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);
  const keys = page.getByRole('table', { name: 'Your personal keys' });
  const row = keys.getByRole('row').filter({ hasText: 'Laptop agent' });
  await expect(row.getByText('Read, Add to Queue')).toBeVisible();

  const mcp = (body: object) =>
    page.request.post('/mcp', {
      headers: {
        authorization: `Bearer ${secret}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      data: { jsonrpc: '2.0', id: 1, ...body },
    });
  const listed = await (
    await mcp({ method: 'tools/call', params: { name: 'list_projects', arguments: {} } })
  ).json();
  expect(listed.result.structuredContent.projects).toContainEqual({
    id: projectId,
    name: 'Larkspur Capital, Fund III onboarding',
  });

  await page.getByRole('button', { name: 'I copied it, hide the secret' }).click();
  await row.getByRole('button', { name: 'Revoke' }).click();
  await row.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(row).toContainText(/Revoked \d{1,2} [A-Z][a-z]{2}/);
  expect((await mcp({ method: 'tools/list' })).status()).toBe(401);
});

test('Profile uploads a photo after a preview, shows it in every avatar, and removes it', async ({
  page,
}) => {
  const projectId = await signIn(page, 'profile-photo');
  await openProfile(page, projectId);
  const section = page.getByRole('region', { name: 'Photo' });
  await expect(section.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
  await section.getByRole('button', { name: 'Upload photo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a photo' });
  const save = dialog.getByRole('button', { name: 'Save photo' });
  await expect(save).toBeDisabled();
  const file = page.getByLabel('Photo file');

  await file.setInputFiles({
    name: 'renamed.png',
    mimeType: 'image/png',
    buffer: Buffer.from('a text file with a png name'),
  });
  await expect(dialog.getByRole('alert')).toHaveText('Use a PNG, JPEG or WebP under 5 MB.');
  await expect(dialog.locator('.pf-face img')).toHaveCount(0);
  await expect(save).toBeDisabled();

  await file.setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF'),
  });
  await expect(dialog.getByRole('alert')).toHaveText('Use a PNG, JPEG or WebP under 5 MB.');
  await expect(save).toBeDisabled();

  const png = await sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 30, g: 140, b: 110 } },
  })
    .png()
    .toBuffer();
  await file.setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.locator('.pf-face img')).toHaveAttribute('src', /^blob:/);
  await save.click();
  await expect(dialog).toHaveCount(0);
  const photo = /^\/api\/v1\/avatars\/[0-9a-f-]{36}\/[0-9a-f]{64}$/;
  await expect(section.locator('.pf-face img')).toHaveAttribute('src', photo);
  await expect(page.locator('details.acct .acct-av img')).toHaveAttribute('src', photo);
  const src = await section.locator('.pf-face img').getAttribute('src');
  const served = await page.request.get(src!);
  expect(served.headers()['content-type']).toBe('image/webp');

  await page.goto(`/projects/${projectId}/members`);
  const row = page.getByRole('row').filter({ hasText: 'Minh Trần' }).first();
  await expect(row.locator('.acct-av img')).toHaveAttribute('src', photo);
  await page.goto(`/projects/${projectId}/graph`);
  await expect(page.locator('.p-head .acct-av img')).toHaveAttribute('src', photo);

  await page.goto(`/projects/${projectId}/profile`);
  await hydrated(page);
  await section.getByRole('button', { name: 'Remove photo' }).click();
  await expect(section.getByRole('button', { name: 'Remove photo' })).toHaveCount(0);
  await expect(section.locator('.pf-face svg')).toContainText('LD');
  expect((await page.request.get(src!)).status()).toBe(404);
});
