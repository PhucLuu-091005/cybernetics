import { expect, type Page } from '@playwright/test';

export const changeSets = (page: Page) => page.getByRole('list', { name: 'Change sets' });
export const setActions = (page: Page) => page.getByRole('group', { name: 'Change set actions' });
export const approvedStatus = (page: Page) =>
  page.getByRole('status').filter({ hasText: /^Approved:/ });

export const idOfUrl = (url: string) =>
  url.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)![0];

export async function openChangeSet(page: Page, projectId: string, proposalId: string) {
  await page.goto(`/projects/${projectId}/review?tab=sets&item=${proposalId}`);
  await expect(setActions(page)).toBeVisible();
}

export const needsRebase = async (page: Page) =>
  (await page.getByRole('button', { name: 'Update to latest' }).count()) +
    (await page.getByRole('link', { name: 'Resolve conflict' }).count()) >
  0;

export async function clickApprove(page: Page) {
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  if (await refresh.count()) {
    await refresh.click();
    await expect(refresh).toHaveCount(0);
  }
  await setActions(page).getByRole('button', { name: 'Approve' }).click();
}

export async function approveChangeSet(page: Page, projectId: string, proposalId: string) {
  await openChangeSet(page, projectId, proposalId);
  await clickApprove(page);
  await expect(approvedStatus(page)).toBeVisible();
}
