import { expect, test } from '@playwright/test';

const PROJECT = 'Larkspur Capital';

test('the rail folds to icons, keeps the state after a reload, and opens again', async ({
  page,
}) => {
  await page.goto('/signin?label=shell');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Project' });
  await expect(nav.getByRole('link', { name: 'Graph' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Review/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Escalations' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Proposals' })).toHaveCount(0);

  const fold = page.getByRole('button', { name: 'Collapse sidebar' });
  await fold.click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(nav.getByText('Graph', { exact: true })).toBeHidden();
  await page.reload();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(nav.getByRole('link', { name: 'Graph' })).toBeVisible();

  const graph = nav.getByRole('link', { name: 'Graph' });
  await page.locator('.proj-switch > summary').focus();
  await page.keyboard.press('Tab');
  await expect(graph).toBeFocused();
  await expect
    .poll(() => graph.evaluate((link) => getComputedStyle(link, '::before').content))
    .toBe('"Graph"');

  await page.getByRole('link', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'open');
  await expect(nav.getByText('Graph', { exact: true })).toBeVisible();
});

test('popovers close on Escape and on a press outside', async ({ page }) => {
  await page.goto('/signin?label=shell-pop');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/')[2];
  // The fold button stays disabled until React hydrates, and the close handlers need React.
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();

  const switcher = page.locator('details.proj-switch');
  await switcher.locator('summary').click();
  await expect(switcher).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(switcher).not.toHaveAttribute('open');
  await expect(switcher.locator('summary')).toBeFocused();

  const filter = page.locator('details.filter-pop');
  await filter.locator('summary').click();
  await expect(filter).toHaveAttribute('open', '');
  await page
    .locator('.topbar')
    .first()
    .click({ position: { x: 5, y: 5 } });
  await expect(filter).not.toHaveAttribute('open');

  await page.goto(`/projects/${projectId}/review`);
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();
  const newSet = page.locator('details.new-set');
  await newSet.locator('summary').click();
  await expect(newSet).toHaveAttribute('open', '');
  await page.locator('.queue').click({ position: { x: 5, y: 5 } });
  await expect(newSet).not.toHaveAttribute('open');
});
