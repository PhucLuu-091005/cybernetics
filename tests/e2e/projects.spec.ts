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
  await create.getByLabel('Teams, one per line').fill('Onboarding\nEngineering\nQA');
  await create.getByLabel('First milestone (optional)').fill('Portal live');
  await create.getByLabel('Milestone date').fill('2026-11-20');
  await create.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(
    (url) => url.pathname !== larkspur && /^\/projects\/[0-9a-f-]{36}\/graph$/.test(url.pathname),
  );
  const graph = new URL(page.url()).pathname;
  await hydrated(page);

  const svg = page.locator('svg.pg');
  for (const team of ['Onboarding', 'Engineering', 'QA'])
    await expect(svg.getByRole('button', { name: `Hide ${team}`, exact: true })).toBeVisible();
  await expect(svg).toContainText('Portal live · 20 Nov · Planned');
  await expect(svg.locator('[data-loop]')).toHaveCount(0);
  await expect(page.locator('.empty')).toContainText('This project has no work yet.');
  const bar = page.locator('.bbar').first();
  await expect(bar).toContainText('Main · read-only');
  await expect(bar).toContainText(`Owner: ${owner}.`);
  await expect(page.getByLabel('Demo: act as')).toHaveCount(0);
  await expect(page.locator('.me')).toContainText('Project owner, owns Main');

  await page.getByRole('button', { name: 'Add a work item' }).click();
  const add = page.getByRole('dialog', { name: 'Add to the queue' });
  await add.getByLabel('Name').fill('Tax ID field on the KYC form');
  await add.getByLabel('Note').fill('Country formats for the tax ID');
  await add.getByRole('button', { name: 'Add work item' }).click();
  await expect(page.locator('.tk-toast')).toContainText('Added to the queue.');
  const card = page.locator('[data-qitem]', { hasText: 'Tax ID field on the KYC form' });
  await expect(card).toBeVisible();

  await bar.getByRole('button', { name: 'New change request' }).click();
  const named = page.getByRole('dialog', { name: 'New change request' });
  await named.getByLabel('Name').fill('Place the tax ID work');
  await named.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForURL(/cr=1$/);
  await expect(bar).toContainText('#1 Place the tax ID work');
  await expect(bar).toContainText('You are editing');
  await expect(bar.getByRole('button', { name: 'Mark as ready' })).toBeDisabled();

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
  await bar.getByRole('link', { name: 'Review and merge' }).click();
  await page.waitForURL(/\/changes\/1$/);
  await hydrated(page);
  await expect(page.getByText('No clashes', { exact: true })).toBeVisible();
  await expect(page.locator('#rv-panel')).toContainText('Team: Engineering');
  await page.getByRole('button', { name: 'Merge into Main' }).click();
  await page.waitForURL(/\/graph/);
  await expect(bar).toContainText(`Merged into Main by ${owner}`);

  await page.goto(graph);
  await hydrated(page);
  await expect(bar).toContainText('Main · read-only');
  await expect(svg.locator('[data-loop]')).toHaveCount(1);
  await expect(page.locator('.empty')).toHaveCount(0);
  await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
  const history = page.locator('.drawer');
  await expect(history).toContainText('#1 Place the tax ID work');
  await expect(history).toContainText('Tax ID field on the KYC form: placed → Engineering');
});
