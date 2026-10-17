import { expect, test, type Page } from '@playwright/test';
import { hydrated } from './helpers';

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

async function signIn(page: Page, label: string) {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  await hydrated(page);
  return new URL(page.url()).pathname.split('/')[2];
}

test('the owner invites by email, changes a role, removes a member and hands Main over; the invited person reads the list', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  const projectId = await signIn(page, 'members-owner');
  const toast = page.locator('.tk-toast');

  await page
    .getByRole('navigation', { name: 'Project' })
    .getByRole('link', { name: 'Members' })
    .click();
  await page.waitForURL(/\/members$/);
  await hydrated(page);
  await expect(page.locator('.pg-head h1')).toHaveText('Members');
  const list = page.getByRole('list', { name: 'Members' });
  await expect(list.getByRole('listitem')).toHaveCount(5);
  const row = (text: string) => list.getByRole('listitem').filter({ hasText: text });
  await expect(row('Minh Trần')).toContainText('You');
  await expect(row('Minh Trần')).toContainText('Owner');
  await expect(row('Minh Trần').getByRole('button', { name: /Remove/ })).toHaveCount(0);

  await test.step('invite an email that has no account yet', async () => {
    const form = page.getByRole('form', { name: 'Invite a member' });
    await form.getByLabel('Email').fill('members-guest@local.test');
    await form.getByLabel('Role').selectOption('member');
    await form.getByRole('button', { name: 'Invite' }).click();
    await expect(toast).toContainText('Invited members-guest@local.test.');
    await expect(row('members-guest@local.test')).toContainText('Invited');
    await expect(form.getByLabel('Email')).toHaveValue('');
    await form.getByLabel('Email').fill('MEMBERS-GUEST@local.test');
    await form.getByRole('button', { name: 'Invite' }).click();
    await expect(page.locator('.pg-error')).toHaveText(
      'members-guest@local.test is already in this project.',
    );
  });

  await test.step('make Lan a viewer: the Demo select no longer offers Lan', async () => {
    await page.getByLabel('Role of Lan Phạm').selectOption('viewer');
    await expect(toast).toContainText('Lan Phạm is a viewer now.');
    await expect(page.getByLabel('Role of Lan Phạm')).toHaveValue('viewer');
    await page.goto(`/projects/${projectId}/graph`);
    await hydrated(page);
    const options = page.getByLabel('Demo: act as').locator('option');
    await expect(options.filter({ hasText: 'Lan Phạm' })).toHaveCount(0);
    await expect(options).toHaveCount(4);
    await page.goto(`/projects/${projectId}/members`);
    await hydrated(page);
  });

  await test.step('remove Khoa after the confirm', async () => {
    await page.getByRole('button', { name: 'Remove Khoa Lê' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Khoa Lê?' });
    await expect(confirm).toContainText('can no longer open this project');
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(toast).toContainText('Khoa Lê is no longer in this project.');
    await expect(row('Khoa Lê')).toHaveCount(0);
  });

  await test.step('the invited person signs in, lands in the project and reads the list only', async () => {
    const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const other = await guest.newPage();
    await other.goto('/signin?label=members-guest');
    await other.getByRole('button', { name: /continue/i }).click();
    await other.waitForURL(new RegExp(`/projects/${projectId}/graph$`));
    await hydrated(other);
    await expect(other.getByLabel('Demo: act as')).toHaveCount(0);
    await expect(other.locator('.p-head details.acct summary b')).toHaveText(
      'Local developer (members-guest)',
    );
    await other.goto(`/projects/${projectId}/members`);
    await hydrated(other);
    await expect(other.getByRole('form', { name: 'Invite a member' })).toHaveCount(0);
    await expect(other.getByRole('note')).toContainText(
      'Only the owner, Minh Trần, can invite people and change roles.',
    );
    const me = other
      .getByRole('list', { name: 'Members' })
      .getByRole('listitem')
      .filter({ hasText: 'Local developer (members-guest)' });
    await expect(me).toContainText('You');
    await expect(me).toContainText('members-guest@local.test');
    await expect(other.getByRole('combobox')).toHaveCount(0);
    await guest.close();
  });

  await test.step('hand Main to Quang: Cancel keeps it, Make owner moves it', async () => {
    await page.reload();
    await hydrated(page);
    const role = page.getByLabel('Role of Quang Nguyễn');
    await role.selectOption('owner');
    const confirm = page.getByRole('dialog', { name: 'Make Quang Nguyễn the owner?' });
    await expect(confirm).toContainText('You become a member');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(role).toHaveValue('member');
    await role.selectOption('owner');
    await confirm.getByRole('button', { name: 'Make owner' }).click();
    await expect(toast).toContainText('Quang Nguyễn owns Main now.');
    await expect(page.getByRole('form', { name: 'Invite a member' })).toHaveCount(0);
    await expect(row('Quang Nguyễn')).toContainText('Owner');
    await expect(row('Minh Trần')).toContainText('Member');
  });

  await test.step('in the demo, working as the new owner manages the members again', async () => {
    await page.goto(`/projects/${projectId}/graph`);
    await hydrated(page);
    await expect(page.locator('.bbar .gowner')).toContainText('Owner: Quang Nguyễn');
    await page.getByLabel('Demo: act as').selectOption({ label: 'Quang Nguyễn' });
    await expect(page.locator('.p-head details.acct summary b')).toHaveText('Quang Nguyễn');
    await page.goto(`/projects/${projectId}/members`);
    await hydrated(page);
    await expect(page.getByRole('form', { name: 'Invite a member' })).toBeVisible();
    await expect(row('Quang Nguyễn')).toContainText('You');
  });

  expect(problems).toEqual([]);
});
