import { expect, test, type Page } from '@playwright/test';
import { choose, hydrated } from './helpers';

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

async function signIn(page: Page, label: string) {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  await hydrated(page);
  return new URL(page.url()).pathname.split('/')[2];
}

test('the project lead invites, sets grants, edits a team, removes a member and hands the lead over; the invited person reads the page', async ({
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
  const people = page.getByRole('table', { name: 'People' });
  const row = (text: string) => people.getByRole('row').filter({ hasText: text });
  await expect(people.getByRole('row')).toHaveCount(6);
  await expect(row('Minh Trần')).toContainText('You');
  await expect(row('Minh Trần')).toContainText('Project lead');
  await expect(row('Minh Trần').getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await expect(row('Minh Trần').getByRole('button', { name: /Make project lead/ })).toHaveCount(0);
  await expect(
    row('Lan Phạm').getByRole('button', { name: /Make project lead/ }),
  ).toHaveAccessibleName('Make project lead: Lan Phạm');
  await expect(page.getByLabel('Merge change requests: Minh Trần')).toBeDisabled();
  await expect(page.getByLabel('Merge change requests: Minh Trần')).toBeChecked();

  await test.step('invite an email that has no account yet', async () => {
    const form = page.getByRole('form', { name: 'Invite a person' });
    await form.getByLabel('Email').fill('members-guest@local.test');
    await form.getByRole('button', { name: 'Invite' }).click();
    await expect(toast).toContainText('Invited members-guest@local.test.');
    await expect(row('members-guest@local.test')).toContainText('Invited');
    await expect(form.getByLabel('Email')).toHaveValue('');
    await form.getByLabel('Email').fill('MEMBERS-GUEST@local.test');
    await form.getByRole('button', { name: 'Invite' }).click();
    await expect(page.locator('.pg-error')).toHaveText(
      'members-guest@local.test is already in this project.',
    );
    await form.getByLabel('Email').fill('a@b');
    await form.getByRole('button', { name: 'Invite' }).click();
    await expect(page.locator('.pg-error')).toHaveText('Invalid email address.');
  });

  await test.step('the invite is a person of the graph at once, in the Person filter', async () => {
    await page.goto(`/projects/${projectId}/graph`);
    await hydrated(page);
    await page.locator('.tfilter-btn').click();
    const panel = page.getByRole('group', { name: 'Filter the graph' });
    await expect(panel.locator('.fchip', { hasText: 'members-guest@local.test' })).toHaveCount(1);
    await expect(panel.locator('.fchip', { hasText: 'Sarah Kim' })).toHaveCount(1);
    await page.goto(`/projects/${projectId}/members`);
    await hydrated(page);
  });

  await test.step('grants follow their rule: a team lead keeps Create, Merge turns on its needs', async () => {
    const create = page.getByLabel('Create change requests: Lan Phạm');
    await expect(create).toBeChecked();
    await expect(create).toBeDisabled();
    const khoaCreate = page.getByLabel('Create change requests: Khoa Lê');
    await expect(page.getByLabel('View change requests: Khoa Lê')).toBeDisabled();
    await khoaCreate.click();
    await expect(toast).toContainText('Khoa Lê: Create change requests off.');
    await expect(page.getByLabel('View change requests: Khoa Lê')).toBeEnabled();
    await page.getByLabel('View change requests: Khoa Lê').click();
    await expect(toast).toContainText('Khoa Lê: View change requests off.');
    await page.getByLabel('Merge change requests: Khoa Lê').click();
    await expect(toast).toContainText('Khoa Lê: Merge change requests on.');
    await expect(page.getByLabel('View change requests: Khoa Lê')).toBeChecked();
    await expect(page.getByLabel('View change requests: Khoa Lê')).toBeDisabled();
  });

  await test.step('edit a team: add people and pick a lead', async () => {
    const teams = page.getByRole('table', { name: 'Teams' });
    await page.getByRole('button', { name: 'Edit Customer Success' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Customer Success' });
    await expect(editor.getByRole('button', { name: 'Delete team' })).toBeDisabled();
    await expect(editor).toContainText('Customer Success has 1 work item, so it stays.');
    await editor.getByRole('checkbox', { name: /Hà Đỗ/ }).check();
    await editor.getByRole('radio', { name: 'Lead' }).nth(4).check();
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(toast).toContainText('Saved Customer Success.');
    const team = teams.getByRole('row').filter({ hasText: 'Customer Success' });
    await expect(team).toContainText('Khoa Lê');
    await expect(team).toContainText('Hà Đỗ, Khoa Lê');
    await expect(row('Khoa Lê')).toContainText('Customer Success');
    await expect(page.getByLabel('Create change requests: Khoa Lê')).toBeChecked();
    await expect(page.getByLabel('Create change requests: Khoa Lê')).toBeDisabled();

    await page.getByRole('form', { name: 'Add a team' }).getByLabel('Team name').fill('Legal');
    await page.getByRole('form', { name: 'Add a team' }).getByLabel('Team name').press('Enter');
    await expect(toast).toContainText('Added Legal.');
    await page.getByRole('button', { name: 'Edit Legal' }).click();
    await page
      .getByRole('dialog', { name: 'Edit Legal' })
      .getByRole('button', { name: 'Delete team' })
      .click();
    await expect(toast).toContainText('Deleted Legal.');
    await expect(teams.getByRole('row').filter({ hasText: 'Legal' })).toHaveCount(0);
  });

  await test.step('remove Hà after the confirm', async () => {
    await page.getByRole('button', { name: 'Remove Hà Đỗ' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove Hà Đỗ?' });
    await expect(confirm).toContainText('can no longer open this project');
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(toast).toContainText('Hà Đỗ is no longer in this project.');
    await expect(row('Hà Đỗ')).toHaveCount(0);
  });

  await test.step('Hà keeps the name on past work, but new work cannot go to her', async () => {
    await page.goto(`/projects/${projectId}/graph`);
    await hydrated(page);
    await page.locator('.tfilter-btn').click();
    const panel = page.getByRole('group', { name: 'Filter the graph' });
    await expect(panel.locator('.fchip', { hasText: 'Hà Đỗ' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/changes\/\d+$/);
    await hydrated(page);
    await page
      .locator('.cr-side')
      .getByRole('button', { name: /^Queue/ })
      .click();
    await page.locator('.qpanel').getByRole('button', { name: 'Add' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add to the queue' });
    const who = dialog.getByLabel('Who');
    await who.click();
    await expect(page.getByRole('option', { name: 'Hà Đỗ' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Lan Phạm' })).toHaveCount(1);
    await who.press('Escape');
    await dialog.getByRole('button', { name: 'Work item' }).click();
    const doneBy = dialog.getByLabel('Done by');
    await doneBy.click();
    await expect(page.getByRole('option', { name: 'Hà Đỗ' })).toHaveCount(0);
    await doneBy.press('Escape');
    await page.keyboard.press('Escape');
    await page.goto(`/projects/${projectId}/members`);
    await hydrated(page);
  });

  await test.step('the invited person signs in, lands in the project and reads the page only', async () => {
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
    await expect(other.getByRole('form', { name: 'Invite a person' })).toHaveCount(0);
    await expect(other.locator('.mb-lede').first()).toContainText(
      'Only the project lead, Minh Trần, can change access and teams.',
    );
    const me = other
      .getByRole('table', { name: 'People' })
      .getByRole('row')
      .filter({ hasText: 'Local developer (members-guest)' });
    await expect(me).toContainText('You');
    await expect(me).toContainText('members-guest@local.test');
    await expect(other.getByRole('checkbox', { disabled: false })).toHaveCount(0);
    await expect(other.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await guest.close();
  });

  await test.step('hand the lead to Quang: Cancel keeps it, Make project lead moves it', async () => {
    await page.reload();
    await hydrated(page);
    await page.getByRole('button', { name: 'Make project lead: Quang Nguyễn' }).click();
    const confirm = page.getByRole('dialog', { name: 'Make Quang Nguyễn the project lead?' });
    await expect(confirm).toContainText('You keep every grant');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await page.getByRole('button', { name: 'Make project lead: Quang Nguyễn' }).click();
    await confirm.getByRole('button', { name: 'Make project lead' }).click();
    await expect(toast).toContainText('Quang Nguyễn is the project lead now.');
    await expect(page.getByRole('form', { name: 'Invite a person' })).toHaveCount(0);
    await expect(row('Quang Nguyễn')).toContainText('Project lead');
    await expect(page.getByLabel('Merge change requests: Minh Trần')).toBeChecked();
  });

  await test.step('in the demo, working as the new lead manages the members again', async () => {
    await page.goto(`/projects/${projectId}/graph`);
    await hydrated(page);
    await expect(page.locator('.bbar .gowner')).toContainText('Lead: Quang Nguyễn');
    await choose(page.getByLabel('Demo: act as'), 'Quang Nguyễn');
    await expect(page.locator('.p-head details.acct summary b')).toHaveText('Quang Nguyễn');
    await page.goto(`/projects/${projectId}/members`);
    await hydrated(page);
    await expect(page.getByRole('form', { name: 'Invite a person' })).toBeVisible();
    await expect(row('Quang Nguyễn')).toContainText('You');
  });

  expect(problems).toEqual([]);
});

test('an invited person with no grant sees why the graph is closed', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const projectId = await signIn(page, 'members-no-view');
  await page.goto(`/projects/${projectId}/members`);
  await hydrated(page);
  const form = page.getByRole('form', { name: 'Invite a person' });
  await form.getByLabel('Email').fill('members-blind@local.test');
  await form.getByRole('button', { name: 'Invite' }).click();
  const viewMain = page.getByLabel('View Main: members-blind@local.test');
  await expect(viewMain).toBeChecked();
  for (const name of ['Create change requests', 'View change requests', 'View Main']) {
    await page.getByLabel(`${name}: members-blind@local.test`).click();
    await expect(page.locator('.tk-toast')).toContainText(`${name} off.`);
  }
  await expect(viewMain).not.toBeChecked();

  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const other = await guest.newPage();
  await other.goto('/signin?label=members-blind');
  await other.getByRole('button', { name: /continue/i }).click();
  await other.waitForURL(new RegExp(`/projects/${projectId}/graph$`));
  await expect(other.getByRole('status')).toContainText('You cannot see Main of this project yet.');
  await other.goto(`/projects/${projectId}/changes/2`);
  await expect(other.getByRole('status')).toContainText('You cannot see Main of this project yet.');
  await other.getByRole('link', { name: 'Members page' }).click();
  await other.waitForURL(/\/members$/);
  await expect(other.getByRole('table', { name: 'People' })).toContainText('Minh Trần');
  await guest.close();
});
