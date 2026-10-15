import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  approvedStatus,
  changeSets,
  clickApprove,
  idOfUrl,
  openChangeSet,
  setActions,
} from './review-helpers';

const PROJECT = 'Larkspur Capital, Fund III onboarding';
const QUOTE = "I'll renew the secret on Monday 12 October.";
const headCommit = (page: Page) => page.getByTestId('head-commit').getAttribute('title');
const records = (page: Page) => page.getByRole('list', { name: 'Records' });
const commits = (page: Page) => page.getByRole('list', { name: 'Commits' });
const branch = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^Loop: ${title.replace(/[()]/g, '\\$&')},`) });

/** Each test signs in as its own local user, so every test starts from a fresh seeded sandbox. */
async function signIn(page: Page, label: string): Promise<string> {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  await expect(page.getByTestId('head-commit')).toBeVisible();
  return new URL(page.url()).pathname.split('/')[2];
}

async function selectText(page: Page, text: string) {
  await page.getByLabel('Record text').evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(target) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + target.length);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      return;
    }
    throw new Error(`Text not found: ${target}`);
  }, text);
}

test('create a proposal from an inbox citation, correct its loop, review the diff and effects, merge, and see history and main change', async ({
  page,
}) => {
  const projectId = await signIn(page, 'review-merge');
  const mainBefore = await headCommit(page);
  await expect(branch(page, 'Client secret renewal')).toHaveAttribute(
    'aria-label',
    /unanswered request/i,
  );

  await page.goto(`/projects/${projectId}/inbox`);
  const marker = randomUUID().slice(0, 8),
    title = `Re: Azure client secret ${marker}`;
  await expect(
    page.getByRole('button', { name: 'Import as pending record', includeHidden: true }),
  ).toBeEnabled();
  await page.getByText('Paste a record').click();
  await page.getByLabel('Source label').fill('gmail:client-secret');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Author').fill('Tom Becker');
  await page.getByLabel('Sent at').fill('2026-10-09T15:10');
  await page
    .getByLabel('Message text')
    .fill(`Hi Quang, sorry for the delay, I was out. ${QUOTE} Ref ${marker}`);
  await page.getByRole('button', { name: 'Import as pending record' }).click();
  await expect(page.getByRole('status', { name: 'Import receipt' })).toContainText('new');
  await records(page)
    .getByRole('link', { name: new RegExp(title) })
    .click();
  await expect(page.getByLabel('Record text')).toContainText(`Ref ${marker}`);

  await selectText(page, QUOTE);
  await page.getByRole('button', { name: 'Add an act from this quote' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/proposals/[0-9a-f-]{36}\\?cite=`),
  );
  const proposalUrl = new URL(page.url()).pathname;
  await expect(page.getByText('Change set, open')).toBeVisible();
  await expect(page.getByTestId('proposal-revision')).toHaveText('0');
  const editor = page.getByRole('form', { name: 'Act editor' });
  await expect(editor.getByTestId('citation-check')).toContainText(
    'Quote matches the record text at 42–85',
  );
  await expect(editor.getByTestId('citation-quote')).toHaveText(QUOTE);

  await editor.getByLabel('Act type').selectOption({ label: 'Promise' });
  await editor.getByLabel('Actor').selectOption({ label: 'Tom Becker' });
  await editor.getByLabel('Loop').selectOption({ label: 'Dynamics CRM sync scope' });
  await editor.getByLabel('Customer').selectOption({ label: 'Quang Nguyễn' });
  await editor.getByLabel('Performer').selectOption({ label: 'Tom Becker' });
  await editor.getByLabel('Action').fill('Renew the Azure client secret for the sync app');
  await editor.getByLabel('Due date').fill('2026-10-12');
  await editor.getByRole('button', { name: 'Save act to draft' }).click();
  await expect(page.getByTestId('proposal-revision')).toHaveText('1');
  const operations = page.getByRole('listbox', { name: 'What changes' });
  await expect(operations.getByRole('option', { name: /Promise by Tom Becker/ })).toContainText(
    'Dynamics CRM sync scope',
  );
  await expect(operations.getByRole('option', { name: /Include record/ })).toBeVisible();

  await operations.getByRole('option', { name: /Promise by Tom Becker/ }).click();
  await expect(editor.getByLabel('Loop')).toHaveValue(/[0-9a-f-]{36}/);
  await editor.getByLabel('Loop').selectOption({ label: 'Client secret renewal' });
  await editor.getByRole('button', { name: 'Save act to draft' }).click();
  await expect(page.getByTestId('proposal-revision')).toHaveText('2');
  await expect(operations.getByRole('option', { name: /Promise by Tom Becker/ })).toContainText(
    'Client secret renewal',
  );
  await expect(page.getByTestId('main-badge')).toHaveCount(0);

  const setTitle = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
  await page.getByRole('link', { name: 'Review and approve' }).click();
  await expect(page).toHaveURL(
    `/projects/${projectId}/review?tab=sets&item=${idOfUrl(proposalUrl)}`,
  );
  await expect(page.getByRole('heading', { level: 2, name: setTitle })).toBeVisible();
  const structural = page.getByRole('region', { name: 'What changes' });
  await expect(structural.getByRole('row', { name: /Promise by Tom Becker/ })).toContainText(
    '+ added',
  );
  await expect(page.getByRole('region', { name: 'Record decisions' })).toContainText(
    `Included: ${title}`,
  );
  const effects = page.getByRole('region', { name: 'Effect on the loops' });
  await expect(effects.getByRole('row', { name: /Client secret renewal/ })).toContainText(
    'requested → promised',
  );
  await expect(effects.getByRole('row', { name: /Client secret renewal/ })).toContainText(
    'Unanswered request',
  );
  await expect(page.getByRole('region', { name: 'Quotes' }).locator('mark')).toHaveText(QUOTE);
  await page.getByText('Technical details').click();
  await expect(page.locator('details.tech')).toContainText(/Change set revision\s*2/);

  await clickApprove(page);
  await expect(approvedStatus(page)).toBeVisible();
  await page.goto(`/projects/${projectId}/history`);
  await expect(commits(page).getByRole('link').first()).toContainText(setTitle);
  await expect(commits(page).getByRole('link').first()).toContainText('merge');

  await page.goto(`/projects/${projectId}/graph`);
  await expect(page.getByTestId('head-commit')).toBeVisible();
  expect(await headCommit(page)).not.toBe(mainBefore);
  await expect(branch(page, 'Client secret renewal')).not.toHaveAttribute(
    'aria-label',
    /unanswered request/i,
  );
});

test('competing drafts: a stale approve shows the conflict banner and keeps the change set, a rebase choice needs a fresh look, then approves', async ({
  page,
}) => {
  const projectId = await signIn(page, 'review-rebase');
  await page.goto(`/projects/${projectId}/review`);
  const sowLink = changeSets(page).getByRole('link', {
    name: 'Retitle the Dynamics loop with the SOW scope',
  });
  await sowLink.click();
  await expect(sowLink).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(/item=[0-9a-f-]{36}/);
  const sowId = idOfUrl(new URL(page.url()).searchParams.get('item')!);
  const sowUrl = `/projects/${projectId}/proposals/${sowId}`;
  await expect(page.getByRole('region', { name: 'What changes' })).toContainText(
    'Dynamics CRM sync scope (SOW phase 2)',
  );

  const other = await page.context().newPage();
  await other.goto(`/projects/${projectId}/review`);
  const phaseOneLink = changeSets(other).getByRole('link', {
    name: 'Retitle the Dynamics loop as a phase 1 request',
  });
  await phaseOneLink.click();
  await expect(phaseOneLink).toHaveAttribute('aria-current', 'true');
  await expect(other).toHaveURL(/item=[0-9a-f-]{36}/);
  await expect(setActions(other).getByRole('button', { name: 'Approve' })).toBeEnabled();
  await clickApprove(other);
  await expect(approvedStatus(other)).toBeVisible();
  await other.close();

  await clickApprove(page);
  const banner = page.getByRole('alert').filter({ hasText: 'Conflict' });
  await expect(banner).toContainText(
    'Conflict: the graph or this change set changed since this page loaded.',
  );
  await expect(banner).toContainText('Nothing changed.');
  await page.goto(sowUrl);
  await expect(page.getByText('Change set, open')).toBeVisible();
  await expect(page.getByTestId('proposal-revision')).toHaveText('1');
  await openChangeSet(page, projectId, sowId);
  await expect(page.getByText(/Choose which side stays/)).toBeVisible();

  await page.getByRole('link', { name: 'Resolve conflict' }).click();
  await expect(page).toHaveURL(`${sowUrl}/rebase`);
  const conflict = page.getByRole('group', { name: /Conflict: Loop: Dynamics CRM sync/ });
  await expect(conflict.getByTestId('side-base')).toContainText('Dynamics CRM sync scope');
  await expect(conflict.getByTestId('side-main')).toContainText('Dynamics CRM sync in phase 1');
  await expect(conflict.getByTestId('side-proposal')).toContainText(
    'Dynamics CRM sync scope (SOW phase 2)',
  );
  const apply = page.getByRole('button', { name: 'Apply my choices' });
  await expect(apply).toBeDisabled();
  await conflict.getByRole('radio', { name: 'Keep change set' }).check();
  await apply.click();

  await expect(page).toHaveURL(/\/review\?tab=sets&item=[0-9a-f-]{36}&updated=1$/);
  await expect(page.getByText('Updated. Check the changes again, then approve.')).toBeVisible();
  await page.getByText('Technical details').click();
  await expect(page.locator('details.tech')).toContainText(/Change set revision\s*2/);
  await clickApprove(page);
  await expect(approvedStatus(page)).toBeVisible();
  await page.goto(`/projects/${projectId}/history`);
  await expect(commits(page).getByRole('link').first()).toContainText(
    'Retitle the Dynamics loop with the SOW scope',
  );

  await page.goto(`/projects/${projectId}/graph`);
  await expect(branch(page, 'Dynamics CRM sync scope (SOW phase 2)')).toBeVisible();
});

test('revert preview: a conflicting inverse becomes a proposal, an unrelated later change is preserved, and apply creates a revert commit', async ({
  page,
}) => {
  const projectId = await signIn(page, 'review-revert');
  await page.goto(`/projects/${projectId}/history`);
  await commits(page)
    .getByRole('link', { name: /^Ignore the out-of-office reply/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: /^Ignore the out-of-office reply/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview undo' }).click();
  const preview = page.getByRole('region', { name: /Undo preview/ });
  await expect(preview).toContainText('conflicts with later changes');
  await preview.getByRole('button', { name: 'Create a change set that undoes it' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/proposals/[0-9a-f-]{36}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: /^Revert: Ignore the out-of-office reply/ }),
  ).toBeVisible();

  await page.goto(`/projects/${projectId}/history`);
  await commits(page)
    .getByRole('link', { name: /^Note the SOW phase 2 scope/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: /^Note the SOW phase 2 scope/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview undo' }).click();
  await expect(preview.getByRole('table', { name: 'Touched entities' })).toContainText(
    'Annotation',
  );
  await expect(preview.getByTestId('preserved')).toContainText('Unrelated later work stays');
  await expect(preview.getByTestId('preserved')).toContainText(
    'Revert "Ignore the out-of-office reply',
  );
  await preview.getByRole('button', { name: 'Apply undo as a new version' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/history/[0-9a-f-]{36}$`));
  const top = commits(page).getByRole('link').first();
  await expect(top).toContainText('Undo “Note the SOW phase 2 scope');
  await expect(top).toContainText('revert');

  const graph = await page.request.get(`/api/v1/projects/${projectId}/graph`);
  expect(graph.ok()).toBe(true);
  const annotations = (
    (await graph.json()) as { snapshot: { annotations: { text: string }[] } }
  ).snapshot.annotations.map((item) => item.text);
  expect(annotations.some((text) => text.includes('the SOW puts the Dynamics sync'))).toBe(false);
  expect(annotations.some((text) => text.includes('Tom was out of the office'))).toBe(false);
  await page.goto(`/projects/${projectId}/inbox?state=pending`);
  await expect(page.getByText('Approved graph')).toBeVisible();
  await expect(
    records(page).getByRole('link', { name: /Automatic reply: out of office/ }),
  ).toBeVisible();
});

test('restore preview lists removed later changes and apply creates a new restore commit', async ({
  page,
}) => {
  const projectId = await signIn(page, 'review-restore');
  await page.goto(`/projects/${projectId}/history`);
  const before = await commits(page).getByRole('link').count();
  await commits(page)
    .getByRole('link', { name: /^Seed Larkspur main snapshot/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: /^Seed Larkspur main snapshot/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview go back' }).click();
  const preview = page.getByRole('region', { name: /Go back preview/ });
  await expect(preview.getByTestId('removed-later')).toContainText('Removes annotation');
  await expect(preview.getByTestId('removed-later')).toContainText('Note the SOW phase 2 scope');
  await preview.getByRole('button', { name: 'Apply go back as a new version' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/history/[0-9a-f-]{36}$`));
  await expect(commits(page).getByRole('link')).toHaveCount(before + 1);
  const top = commits(page).getByRole('link').first();
  await expect(top).toContainText('restore');
  await expect(top).toContainText('Seed Larkspur main snapshot');
});

test('loop panel edits on main open a proposal first; change type, move and hide then edit that draft; main stays unchanged', async ({
  page,
}) => {
  const projectId = await signIn(page, 'review-panel');
  const mainBefore = await headCommit(page);
  await expect(page.getByRole('group', { name: /promise graph for/i })).toHaveAttribute(
    'data-ready',
    'true',
  );
  // A branch can sit outside the visible canvas; focus brings it into view, as Tab does.
  await branch(page, 'Client secret renewal').focus();
  await branch(page, 'Client secret renewal').click();
  const panel = page.getByRole('complementary', { name: /loop panel/i });
  await panel.getByLabel('Milestone').selectOption({ label: 'Hypercare end' });
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/graph\\?.*proposal=[0-9a-f-]{36}.*rev=1`),
  );
  await expect(page.getByText('Change set, open')).toBeVisible();
  await expect(panel.getByLabel('Milestone')).toHaveValue(/[0-9a-f-]{36}/);

  await panel.getByLabel('Act actions').first().click();
  await panel.getByRole('button', { name: 'Change type' }).click();
  await panel.getByLabel('New act type').selectOption({ label: 'Follow-up' });
  await panel.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page).toHaveURL(/rev=2/);
  await expect(page.getByText('Change set, open')).toBeVisible();
  const steps = panel.getByRole('list', { name: 'Steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(2);

  await panel.getByLabel('Act actions').nth(1).click();
  await panel.getByRole('button', { name: 'Move to another loop' }).click();
  await panel.getByLabel('Target loop').selectOption({ label: 'Dynamics CRM sync scope' });
  await panel.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page).toHaveURL(/rev=3/);
  await expect(steps).toHaveCount(1);

  await panel.getByLabel('Act actions').first().click();
  await panel.getByRole('button', { name: 'Hide this act' }).click();
  await panel.getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page).toHaveURL(/rev=4/);
  await expect(panel.getByText('No acts yet at the evaluation time.')).toBeVisible();

  await page.goto(`/projects/${projectId}/graph`);
  expect(await headCommit(page)).toBe(mainBefore);
});
