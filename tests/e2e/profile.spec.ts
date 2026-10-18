import { expect, test, type Page } from '@playwright/test';
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
