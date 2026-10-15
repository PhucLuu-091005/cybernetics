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
  await expect(nav.getByRole('link', { name: 'Escalations' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Proposals' })).toHaveCount(0);

  const fold = page.getByRole('button', { name: 'Collapse sidebar' });
  // The fold button works only after React owns it; an earlier click does nothing.
  await expect
    .poll(() =>
      fold.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps'))),
    )
    .toBe(true);
  await fold.click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(nav.getByText('Graph', { exact: true })).toBeHidden();
  await page.reload();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(nav.getByRole('link', { name: 'Graph' })).toBeVisible();

  await page.getByRole('link', { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');

  // The Next.js dev indicator sits over the folded button, so a pointer click lands on it.
  await page.getByRole('button', { name: 'Expand sidebar' }).dispatchEvent('click');
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'open');
  await expect(nav.getByText('Graph', { exact: true })).toBeVisible();
});
