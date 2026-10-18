import { expect, test } from '@playwright/test';
import { drag, hydrated } from './helpers';

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

test('a new project starts with its teams and an empty graph, and its first change request reaches Main', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = 'Local developer (projects-first-cr)';
  await page.goto('/signin?label=projects-first-cr');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  const larkspur = new URL(page.url()).pathname;
  await hydrated(page);

  const switcher = page.locator('details.proj-switch');
  await switcher.locator('summary').click();
  await switcher.getByRole('button', { name: '+ New project' }).click();
  const create = page.getByRole('dialog', { name: 'New project' });
  await create.getByLabel('Project name').fill('KYC portal');
  await create.getByLabel('Client').fill('Brightwater Bank');
  const teams = create.getByRole('list', { name: 'Teams' });
  await expect(teams.getByRole('listitem')).toHaveText([
    'Product',
    'Design',
    'Engineering',
    'QA',
    'Operations',
  ]);
  for (const team of ['Product', 'Design', 'Engineering', 'QA', 'Operations'])
    await create.getByRole('button', { name: `Remove ${team}` }).click();
  await expect(create).toContainText('Add at least one team');
  const addTeam = create.getByLabel('Add a team');
  for (const team of ['Onboarding', 'Engineering', 'QA']) {
    await addTeam.fill(team);
    await addTeam.press('Enter');
  }
  await addTeam.fill('qa');
  await create.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(create).toContainText('QA is already in the list.');
  await addTeam.fill('');
  await expect(teams.getByRole('listitem')).toHaveText(['Onboarding', 'Engineering', 'QA']);
  await create.getByLabel('First milestone (optional)').fill('Portal live');
  const milestoneDate = create.getByLabel('Milestone date');
  await expect(milestoneDate).toHaveAttribute('placeholder', 'Date');
  await expect(create.locator('input[type="date"], input[type="time"]')).toHaveCount(0);
  await create.getByRole('button', { name: 'Open the calendar' }).click();
  const calendar = page.getByRole('dialog', { name: 'Calendar' });
  await expect(calendar.getByRole('button', { name: 'Today' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(create).toBeVisible();
  await milestoneDate.fill('20 Nov 2026');
  await create.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(
    (url) => url.pathname !== larkspur && /^\/projects\/[0-9a-f-]{36}\/graph$/.test(url.pathname),
  );
  const graph = new URL(page.url()).pathname;
  await hydrated(page);

  const svg = page.locator('svg.pg');
  const side = page.locator('svg.pg-side');
  for (const team of ['Onboarding', 'Engineering', 'QA'])
    await expect(side.getByRole('button', { name: `Hide ${team}`, exact: true })).toBeVisible();
  await expect(page.locator('svg.pg-top-time')).toContainText('Portal live · 20 Nov · Planned');
  await expect(svg.locator('[data-loop]')).toHaveCount(0);
  await expect(page.locator('.empty')).toContainText('This project has no work yet.');
  const bar = page.locator('.bbar').first();
  await expect(bar.locator('.gpick > summary')).toHaveAccessibleName(
    `View: Main, read-only, project lead ${owner}. Switch view`,
  );
  await expect(bar).toContainText('read-only');
  await expect(bar).toContainText(`Lead: ${owner}`);
  await expect(page.getByLabel('Demo: act as')).toHaveCount(0);
  await expect(page.locator('.me')).toContainText('Project lead');

  await expect(page.locator('.p-side')).toHaveCount(0);
  await expect(page.locator('.empty').getByRole('button', { name: 'Add a work item' })).toHaveCount(
    0,
  );

  await page.locator('.empty').getByRole('button', { name: 'New change request' }).click();
  const named = page.getByRole('dialog', { name: 'New change request' });
  await named.getByLabel('Name').fill('Place the tax ID work');
  await named.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/\/changes\/1$/);
  await hydrated(page);
  await expect(bar).toContainText('#1 Place the tax ID work');
  await expect(bar).toContainText('You are editing');
  await expect(bar.getByRole('button', { name: 'Mark as ready' })).toBeDisabled();

  await page.locator('.empty').getByRole('button', { name: 'Add a work item' }).click();
  const add = page.getByRole('dialog', { name: 'Add to the queue' });
  await add.getByLabel('Name').fill('Tax ID field on the KYC form');
  await add.getByLabel('Note').fill('Country formats for the tax ID');
  await add.getByRole('button', { name: 'Add work item' }).click();
  await expect(page.locator('.tk-toast')).toContainText('Added to the queue.');
  const card = page.locator('[data-qitem]', { hasText: 'Tax ID field on the KYC form' });
  await expect(card).toBeVisible();

  await drag(page, card, svg.locator('rect.lane-drop').nth(1));
  await expect(bar).toContainText('1 change');
  await expect(svg.locator('[data-loop]')).toHaveCount(1);
  await expect(svg.locator('[data-loop]')).toHaveAttribute(
    'aria-label',
    /^Tax ID field on the KYC form/,
  );
  await expect(card).toHaveCount(0);

  await bar.getByRole('button', { name: 'Mark as ready' }).click();
  await expect(bar).toContainText('Ready to merge');
  await expect(page.getByRole('region', { name: 'Clashes with Main' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Changes' })).toContainText(
    'Tax ID field on the KYC form: placed',
  );
  await bar.getByRole('button', { name: 'Merge into Main' }).click();
  await expect(bar).toContainText(`Merged into Main by ${owner}`);

  await page.goto(graph);
  await hydrated(page);
  await expect(bar).toContainText('read-only');
  await expect(svg.locator('[data-loop]')).toHaveCount(1);
  await expect(page.locator('.empty')).toHaveCount(0);
  await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
  const history = page.locator('.drawer');
  await expect(history).toContainText('#1 Place the tax ID work');
  await expect(history).toContainText('Tax ID field on the KYC form: placed → Engineering');
});
