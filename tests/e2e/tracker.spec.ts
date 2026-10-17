import { expect, test, type Page } from '@playwright/test';
import { drag, hydrated } from './helpers';

type TrackerRead = {
  crs: Array<{
    num: number;
    status: string;
    shares: Array<{ memberId: string; permission: string }>;
  }>;
  members: Array<{ id: string; name: string }>;
  commits: Array<{ crNum: number | null; resolutions: Array<{ chose: string }> }>;
};

async function visit(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

async function signIn(page: Page, label: string) {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  await expect(page.locator('svg.pg')).toBeVisible();
  await hydrated(page);
  const projectId = new URL(page.url()).pathname.split('/')[2];
  return { projectId, graph: `/projects/${projectId}/graph` };
}

async function actAs(page: Page, name: string) {
  await page.getByLabel('Demo: act as').selectOption({ label: name });
  await expect(page.locator('.me b')).toHaveText(name);
}

const crPath = (graph: string, num: number) => graph.replace(/graph$/, `changes/${num}`);

async function readTracker(page: Page, projectId: string): Promise<TrackerRead> {
  const response = await page.request.get(`/api/v1/projects/${projectId}/tracker`);
  expect(response.status()).toBe(200);
  return (await response.json()) as TrackerRead;
}

const noHorizontalScroll = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBe(0);

test.describe('the tracker walkthrough', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

  test('the 13 tasks of the prototype, from a date move to a merge with a clash', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });

    const { projectId, graph } = await signIn(page, 'tracker-walk');
    const bar = page.locator('.bbar').first();
    const toast = page.locator('.tk-toast');
    const dialog = page.locator('.m-card');
    const queueEvent = (text: string) => page.locator('[data-qevent]', { hasText: text });
    const row = (id: string) => page.locator(`svg.pg [data-loop="${id}"]`);
    const search = page.getByRole('combobox', { name: 'Search work items' });
    const drawer = page.locator('.drawer');
    const find = async (text: string, title: string) => {
      await search.fill(text);
      await expect(page.getByRole('option').first()).toContainText(title);
      await page.keyboard.press('Enter');
      await expect(drawer).toHaveAttribute('aria-label', title);
    };
    const side = page.locator('.cr-side');
    const changes = page.getByRole('list', { name: 'Changes' });
    const openCr = async (num: number) => {
      await visit(page, crPath(graph, num));
      await expect(bar).toContainText(`#${num}`);
    };
    const showQueue = () => side.getByRole('button', { name: /^Queue/ }).click();

    await test.step("0. Main says it is read-only, and Don't show again keeps the notice away", async () => {
      const note = page.getByRole('note', { name: 'Main is read-only' });
      await expect(note).toContainText('Main is read-only. To change it, create a change request.');
      await expect(note.getByRole('button', { name: 'New change request' })).toHaveCount(0);
      await expect(note.getByRole('button', { name: 'Close the notice' })).toBeVisible();
      await note.getByRole('button', { name: "Don't show again" }).click();
      await expect(note).toHaveCount(0);
      await visit(page, graph);
      await expect(page.locator('svg.pg')).toBeVisible();
      await expect(note).toHaveCount(0);
    });

    await test.step('0. Main has no Queue, no drag and no edit buttons', async () => {
      await expect(page.locator('.p-side')).toHaveCount(0);
      await expect(page.locator('.bin')).toHaveCount(0);
      await expect(page.locator('svg.tg .plus, svg.tg .pill')).toHaveCount(0);
      const ev = page.locator('svg.pg [data-act][data-in="pg203"]').last();
      await drag(page, ev, row('dynamics'));
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.ghost')).toHaveCount(0);
      await expect(page.locator('svg.pg [data-act][data-in="pg203"]')).toHaveCount(2);
      await row('pg203').focus();
      await page.keyboard.press('Enter');
      await expect(drawer.locator('h4')).toHaveText('PG-203 Country list field type');
      await expect(page.locator('.pop')).toHaveCount(0);
      for (const name of ['Add an event', 'Move the date', 'Rename', 'Mark done'])
        await expect(drawer.getByRole('button', { name })).toHaveCount(0);
      await expect(drawer.locator('select, input, textarea')).toHaveCount(0);
      await expect(drawer.locator('.facts')).toContainText('Not yet');
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
    });

    await test.step('1. Search finds the Go-live date; its details show the first date, the move and its reason', async () => {
      await find('go-live', 'Go-live date');
      await expect(drawer).toContainText(/First planned 30 Sept/i);
      await expect(drawer).not.toContainText('30 Sept → 15 Oct');
      await drawer.getByRole('button', { name: /Date moves/ }).click();
      await expect(drawer).toContainText('30 Sept → 15 Oct');
      await expect(drawer).toContainText('The CRS section is not ready.');
      await expect(drawer.getByRole('button', { name: 'Move the date' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
    });

    await test.step('2. Lan presses New change request, then drags a Queue event onto a work item', async () => {
      await actAs(page, 'Lan Phạm');
      await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await page.waitForURL(/\/changes\/5$/);
      await expect(bar).toContainText('#5');
      await expect(bar).toContainText('You are editing');
      await expect(side.getByRole('button', { name: /^Queue/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await drag(page, queueEvent('Where is the root cause report'), row('incident'));
      await expect(toast).toContainText('Message by Sarah Kim: added');
      await expect(bar).toContainText('1 change');
    });

    await test.step('3. Lan finds PG-203 with the search and moves its date in place, with a reason', async () => {
      await find('PG-203', 'PG-203 Country list field type');
      await expect(drawer.getByLabel('Done by').locator('option:checked')).toHaveText(
        'Quang Nguyễn',
      );
      await expect(drawer).toContainText(/Events \(\d+\)/);
      await expect(drawer.getByRole('button', { name: 'Move the date' })).toHaveCount(0);
      await drawer.getByLabel('Planned finish').fill('2026-10-10');
      await drawer.getByLabel('Time (optional)').fill('17:00');
      const save = drawer.getByRole('button', { name: 'Move the date' });
      await expect(save).toBeDisabled();
      const why = drawer.getByLabel(/Why does the date move/);
      await why.fill('   ');
      await expect(save).toBeDisabled();
      await why.fill('Lan sends the country list on 10 October, so the field ships later.');
      await save.click();
      await expect(toast).toContainText('PG-203 Country list field type: planned finish moved.');
      await expect(bar).toContainText('2 changes');
      await expect(why).toHaveCount(0);
      await expect(drawer.getByLabel('Time (optional)')).toHaveValue('17:00');
      await drawer.getByRole('button', { name: /Date moves/ }).click();
      await expect(drawer).toContainText('6 Oct → 10 Oct 17:00');
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
    });

    await test.step('4. Lan shares #5 with Khoa, Can edit', async () => {
      await bar.getByRole('button', { name: 'Share' }).click();
      await expect(dialog.getByLabel('Link')).toHaveValue(/\/projects\/[0-9a-f-]{36}\/changes\/5$/);
      await dialog.getByLabel('Person').selectOption({ label: 'Khoa Lê' });
      await dialog.getByLabel('Access', { exact: true }).selectOption('edit');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(toast).toContainText('Khoa Lê can edit #5. Send them the link.');
      await expect(dialog.getByLabel('Access for Khoa Lê')).toHaveValue('edit');
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('5. Khoa opens #5 while Lan edits and asks to edit', async () => {
      await actAs(page, 'Khoa Lê');
      await expect(page).toHaveURL(/\/changes\/5$/);
      await expect(bar).toContainText('Lan is editing');
      await bar.getByRole('button', { name: 'Ask to edit' }).click();
      await expect(bar).toContainText('Waiting for Lan');
    });

    await test.step('6. Lan sees the ask and hands over', async () => {
      await actAs(page, 'Lan Phạm');
      const ask = page.locator('.ask-row');
      await expect(ask).toContainText('Khoa Lê asks to edit #5.');
      await ask.getByRole('button', { name: 'Hand over' }).click();
      await expect(bar).toContainText('Khoa is editing');
    });

    await test.step('7. Khoa drags the scope call onto Dynamics CRM sync scope', async () => {
      await actAs(page, 'Khoa Lê');
      await expect(bar).toContainText('You are editing');
      await showQueue();
      await drag(page, queueEvent('Scope call'), row('dynamics'));
      await expect(toast).toContainText('Meeting by Sarah Kim: added');
      await expect(page.locator('.pop')).toContainText('Added a Meeting');
      await expect(bar).toContainText('3 changes');
    });

    await test.step('8. Khoa marks #5 as ready, which locks it', async () => {
      await bar.getByRole('button', { name: 'Mark as ready' }).click();
      await expect(toast).toContainText('#5 is ready. Minh Trần or Quang Nguyễn can merge it now.');
      await expect(bar).toContainText('Ready to merge');
      await expect(bar).toContainText('Locked. Waiting for Minh or Quang.');
      await expect(bar.getByRole('button', { name: 'Edit again' })).toBeVisible();
    });

    await test.step('9. Minh opens #2 from the Change requests button and merges it into Main', async () => {
      await actAs(page, 'Minh Trần');
      await expect(page).toHaveURL(/\/changes\/5$/);
      const requests = page.getByRole('button', { name: 'Change requests, 3 ready to merge' });
      await expect(requests.locator('.nbadge')).toHaveText('3');
      await requests.click();
      await page
        .locator('.drawer')
        .getByRole('button', { name: 'Review and merge' })
        .last()
        .click();
      await page.waitForURL(/\/changes\/2$/);
      await expect(bar).toContainText('#2');
      await expect(page.getByRole('button', { name: 'After', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Before', exact: true }).click();
      await page.getByRole('button', { name: 'After', exact: true }).click();
      await expect(page.getByRole('tab')).toHaveCount(0);
      await bar.getByRole('button', { name: 'Merge into Main' }).click();
      await expect(bar).toContainText('Merged into Main by Minh Trần');
      await expect(toast).toContainText('#2 is in Main now.');
      const tracker = await readTracker(page, projectId);
      expect(tracker.crs.find((c) => c.num === 2)?.status).toBe('merged');
      expect(tracker.commits).toHaveLength(2);
    });

    await test.step('10. Minh resolves the PG-203 name clash in #3 and merges', async () => {
      await openCr(3);
      await expect(bar).toContainText('1 clash with Main');
      const merge = bar.getByRole('button', { name: 'Merge into Main' });
      await expect(page.locator('.res-box')).toBeVisible();
      await expect(merge).toBeDisabled();
      await page.locator('.res-box input[type=radio][value="cr"]').first().check();
      await expect(merge).toBeEnabled();
      await merge.click();
      await expect(bar).toContainText('#3');
      await expect(bar).toContainText('Merged into Main by Minh Trần');
      const commit = (await readTracker(page, projectId)).commits.find((c) => c.crNum === 3);
      expect(commit?.resolutions.map((r) => r.chose)).toEqual(['cr']);
    });

    await test.step('11. Minh asks for changes on #5; Khoa reads the note and marks it ready again', async () => {
      await openCr(5);
      await expect(changes).toContainText('Why: Lan sends the country list on 10 October');
      await bar.getByRole('button', { name: 'Request changes' }).click();
      const send = dialog.getByRole('button', { name: 'Send back to draft' });
      await expect(send).toBeDisabled();
      await dialog
        .getByLabel('What should change?')
        .fill('Add the date Lan promised for the country list.');
      await send.click();
      await expect(toast).toContainText('#5 is a draft again. Khoa Lê sees your note.');
      await expect(bar.locator('.chipx').first()).toHaveText('Draft');
      await expect(page.getByText('This change request changed since you opened it.')).toHaveCount(
        0,
      );
      await expect
        .poll(async () => (await readTracker(page, projectId)).crs.find((c) => c.num === 5)?.status)
        .toBe('draft');

      await visit(page, graph);
      await actAs(page, 'Khoa Lê');
      await page.waitForURL(/\/changes\/5$/);
      await expect(bar).toContainText(
        'Minh Trần asked for changes: Add the date Lan promised for the country list.',
      );
      await bar.getByRole('button', { name: 'Mark as ready' }).click();
      await expect(toast).toContainText('#5 is ready');
    });

    await test.step('12. History lists the merges, and Open goes to the change request page', async () => {
      await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
      const history = page.locator('.drawer');
      for (const text of ['#3', '#2', '#1', '1 clash resolved'])
        await expect(history).toContainText(text);
      await history.getByRole('button', { name: 'Open #3' }).click();
      await page.waitForURL(/\/changes\/3$/);
      await expect(bar).toContainText('#3');
    });

    await test.step('13. Merged #1 is read-only history: no Queue and no drag', async () => {
      await visit(page, graph);
      await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
      await page.locator('.drawer').getByRole('button', { name: 'Open #1' }).click();
      await page.waitForURL(/\/changes\/1$/);
      await expect(bar).toContainText('Read-only history.');
      await expect(
        page.locator('.p-head').getByRole('button', { name: 'New change request' }),
      ).toBeVisible();
      await expect(page.locator('.qpanel')).toHaveCount(0);
      await expect(side.getByRole('button', { name: /^Queue/ })).toHaveCount(0);
      const ev = page.locator('svg.pg [data-act][data-in="golive"]').first();
      await drag(page, ev, row('test'));
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('svg.pg [data-act][data-in="test"]')).toHaveCount(0);
    });

    await test.step('14. Quang asks Hà for edit access to #4, and Hà grants Can edit', async () => {
      await openCr(4);
      await actAs(page, 'Quang Nguyễn');
      await expect(bar).toContainText('View only.');
      await bar.getByRole('button', { name: 'Ask for edit access' }).click();
      await expect(bar).toContainText('Waiting for Hà');
      await actAs(page, 'Hà Đỗ');
      const ask = page.locator('.ask-row');
      await expect(ask).toContainText('Quang Nguyễn asks for edit access to #4.');
      await ask.getByRole('button', { name: 'Grant Can edit' }).click();
      await expect(toast).toContainText('Quang Nguyễn can edit #4 now.');
      await expect(ask).toHaveCount(0);
      const tracker = await readTracker(page, projectId);
      const quang = tracker.members.find((m) => m.name === 'Quang Nguyễn')?.id;
      expect(tracker.crs.find((c) => c.num === 4)?.shares).toContainEqual({
        memberId: quang,
        permission: 'edit',
      });
    });

    await test.step('15. Hà cancels #4 with a reason; the header and History show it', async () => {
      await bar.getByRole('button', { name: 'Cancel change request' }).click();
      const confirm = dialog.getByRole('button', { name: 'Cancel change request' });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel('Reason').fill('Main has these test dates already.');
      await confirm.click();
      await expect(toast).toContainText('#4 is cancelled. Nothing went into Main.');
      await expect(bar).toContainText('Closed');
      await expect(bar).toContainText('Cancelled by Hà Đỗ');
      await expect(bar).toContainText('Reason: Main has these test dates already.');
      await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
      await expect(page.locator('.drawer')).toContainText('Cancelled (1)');
      await expect(page.locator('.drawer')).toContainText(
        'Reason: Main has these test dates already.',
      );
    });

    expect(problems).toEqual([]);
  });
});

test.describe('the top bar', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

  test('the context bar holds the view selector, and the Change requests button carries a badge', async ({
    page,
  }) => {
    const { projectId, graph } = await signIn(page, 'tracker-top-bar');
    const head = page.locator('.p-head');
    const bar = page.locator('.bbar');
    const view = bar.locator('.gpick > summary');
    await expect(head.locator('.gpick')).toHaveCount(0);
    await expect(bar).toHaveCount(1);
    await expect(view).toHaveAccessibleName(
      'View: Main, read-only, project lead Minh Trần. Switch view',
    );
    await expect(bar).toContainText('read-only');
    await expect(bar.locator('.gowner')).toContainText('Lead: Minh Trần');
    await expect(bar.locator('.gowner .av')).toHaveText('MT');
    await expect(page.getByText('Every change goes through a change request')).toHaveCount(0);

    const ready = (await readTracker(page, projectId)).crs.filter((c) => c.status === 'ready');
    const requests = head.getByRole('button', {
      name: `Change requests, ${ready.length} ready to merge`,
    });
    await expect(requests).toHaveCount(1);
    await expect(requests).toContainText('Change requests');
    await expect(requests.locator('.nbadge')).toHaveText(String(ready.length));
    await requests.click();
    const drawer = page.locator('.drawer', { hasText: 'Change requests' });
    await expect(drawer).toBeVisible();
    await expect(requests).toHaveAttribute('aria-expanded', 'true');
    await requests.click();
    await expect(drawer).toHaveCount(0);

    const search = head.locator('.tsearch');
    expect((await search.boundingBox())!.width).toBeGreaterThan(400);
    const box = await head.boundingBox();
    expect(box!.height).toBeLessThan(60);

    await view.click();
    await page
      .locator('.gmenu')
      .getByRole('button', { name: /#4 Test plan/ })
      .click();
    await page.waitForURL(/\/changes\/4$/);
    await expect(view).toContainText('#4 Test plan for the CRS section');

    await actAs(page, 'Hà Đỗ');
    await expect(page).toHaveURL(/\/changes\/4$/);
    await expect(bar).toContainText('You are editing');
    for (const name of ['Share', 'Mark as ready', 'Cancel change request'])
      await expect(bar.getByRole('button', { name })).toBeVisible();
    await expect(head.getByRole('button', { name: 'New change request' })).toHaveCount(1);

    await visit(page, graph);
    await bar.getByRole('button', { name: 'Open #4 (draft)' }).click();
    await page.waitForURL(/\/changes\/4$/);
    await visit(page, graph);
    await actAs(page, 'Minh Trần');
    await head.getByRole('button', { name: 'New change request' }).click();
    const dialog = page.locator('.m-card');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/changes\/5$/);
    await expect(bar).toContainText('#5');

    await page.goto(`${graph}?cr=2`);
    await page.waitForURL(/\/changes\/2$/);
    await page.goto(`/projects/${projectId}/changes/2?tab=talk`);
    await expect(bar).toContainText('#2');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByText('Conversation')).toHaveCount(0);
    await expect(page.locator('.p-head details.acct summary b')).toHaveText('Minh Trần');
  });
});

test.describe('milestone deadlines, hiding and the time zoom', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

  test('marks the milestone deadline on every member row and opens the milestone from it', async ({
    page,
  }) => {
    await signIn(page, 'tracker-goal');
    const dialog = page.locator('.m-card');
    const drawer = page.locator('.drawer');
    const tip = page.getByRole('tooltip');
    const goLive = page.locator(
      'svg.pg .deadline[aria-label^="Go-live and first close · deadline 15 Oct"]',
    );
    const crm = page.locator(
      'svg.pg .deadline[aria-label^="CRM integration live · deadline 18 Sept"]',
    );

    await expect(goLive).toHaveCount(5);
    await expect(crm).toHaveCount(4);
    await expect(page.locator('svg.pg-rail, svg.tg .ms-chip, svg.tg .goal')).toHaveCount(0);
    await expect(page.locator('svg.tg [data-ms="crm"] .ms-c')).toHaveCount(1);

    await crm.first().locator('.deadline-mark').hover();
    await expect(tip).toContainText('CRM integration live · deadline 18 Sept · Late');
    await crm.first().focus();
    await page.keyboard.press(' ');
    await expect(drawer).toContainText('CRM integration live');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    await page.locator('svg.pg [data-loop="pg201"]').focus();
    await page.keyboard.press('Enter');
    await expect(drawer.locator('h4')).toHaveText('PG-201 CRS form logic');
    await expect(drawer).toContainText(/Finished (early|on time)/);
    await expect(drawer.getByRole('button', { name: 'Move the date' })).toHaveCount(0);
    const facts = await drawer.locator('.facts dt').allTextContents();
    expect(facts.slice(facts.indexOf('Started'), facts.indexOf('Started') + 3)).toEqual([
      'Started',
      'Planned finish',
      'Finished',
    ]);
    await page.keyboard.press('Escape');

    await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/changes\/\d+$/);
    for (const [id, title] of [
      ['pg201', 'PG-201'],
      ['rehearsal', 'rehearsal'],
    ] as const) {
      await page.locator(`svg.pg [data-loop="${id}"]`).focus();
      await page.keyboard.press('Enter');
      await expect(drawer).toContainText(/Finished (early|on time)/);
      await expect(drawer).toHaveAttribute('aria-label', new RegExp(title, 'i'));
      await drawer.getByLabel('Planned finish').fill('2026-10-20');
      await expect(drawer.getByLabel(/Why does the date move/)).toBeVisible();
      await drawer.getByRole('button', { name: 'Cancel' }).click();
      await expect(drawer.getByLabel(/Why does the date move/)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
    }
  });

  test('a milestone deadline with a time sits at that time inside its busy day', async ({
    page,
  }) => {
    await signIn(page, 'tracker-time');
    const dialog = page.locator('.m-card');
    const drawer = page.locator('.drawer');
    await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/changes\/\d+$/);

    await page.locator('svg.tg [data-ms="crm"] .ms-hit').click();
    await expect(drawer.locator('h4')).toHaveText('CRM integration live');
    await drawer.getByLabel('Time (optional)').fill('12:00');
    await drawer.getByRole('button', { name: 'Save milestone' }).click();
    await expect(dialog).toContainText('Move the milestone date');
    await expect(dialog.getByLabel('Time (optional)')).toHaveValue('12:00');
    await dialog.getByLabel(/Why does the date move/).fill('The go-live call is at noon.');
    await dialog.getByRole('button', { name: 'Move the date' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(
      page.locator('svg.pg .deadline[aria-label^="CRM integration live · deadline 18 Sept 12:00"]'),
    ).toHaveCount(4);
    await expect(page.locator('svg.tg [data-ms="crm"]')).toHaveAttribute(
      'aria-label',
      /CRM integration live · 18 Sept 12:00 · Late \(was 18 Sept\)/,
    );
    await expect(drawer).toContainText('18 Sept → 18 Sept 12:00');

    await page.keyboard.press('Escape');
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 6; i += 1) await zoomIn.click();
    const mark = page.locator('svg.pg .deadline[data-goal="crm"]').nth(3);
    await mark.scrollIntoViewIfNeeded();
    const x = async (locator: ReturnType<typeof page.locator>) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error('No box');
      return box.x + box.width / 2;
    };
    const before = await x(page.locator('svg.pg [data-act="m1"]'));
    const at = await x(mark.locator('.deadline-mark'));
    const after = await x(page.locator('svg.pg [data-act="m3"]'));
    expect(before).toBeLessThan(at);
    expect(at).toBeLessThan(after);
  });

  test('folding the rail keeps the size of the graph and shows more of the time line', async ({
    page,
  }) => {
    await signIn(page, 'tracker-fold');
    const fit = page.getByRole('button', { name: 'Fit to width' });
    // One frame for both icons: the graph slides left while the rail folds.
    const measure = () =>
      page.evaluate(() => {
        const box = (id: string) =>
          document.querySelector(`svg.pg [data-act="${id}"] circle.bg`)!.getBoundingClientRect();
        const a = box('g2');
        return { width: a.width, height: a.height, gap: box('g4').x - a.x };
      });
    const lastTick = () => page.locator('svg.pg-top-time .tick').last().textContent();
    const timeLine = async () => (await page.locator('svg.pg').boundingBox())?.width ?? 0;
    await expect(fit).toBeDisabled();
    const open = await measure();
    const openEnd = await lastTick();
    const openLine = await timeLine();

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect.poll(timeLine).toBeGreaterThan(openLine + 100);
    const folded = await measure();
    expect(folded.width).toBeCloseTo(open.width, 1);
    expect(folded.height).toBeCloseTo(open.height, 1);
    expect(folded.gap).toBeCloseTo(open.gap, 1);
    expect(await lastTick()).not.toBe(openEnd);
    await expect(page.locator('.gscroll .gtime')).toHaveJSProperty('scrollLeft', 0);

    await expect(fit).toBeEnabled();
    await fit.click();
    await expect.poll(async () => (await measure()).gap).toBeGreaterThan(open.gap + 1);
    expect((await measure()).width).toBeCloseTo(open.width, 1);
    await expect(fit).toBeDisabled();
  });

  test('a click on a row opens its details, and an event brief leads to its work item', async ({
    page,
  }) => {
    await signIn(page, 'tracker-click');
    const drawer = page.locator('.drawer');
    const pop = page.locator('.pop');

    await page.locator('svg.pg [data-loop="pg203"]').click({ position: { x: 40, y: 15 } });
    await expect(drawer.locator('h4')).toHaveText('PG-203 Country list field type');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('svg.pg .hit.sel[data-loop="pg203"]')).toHaveCount(1);
    await expect(page.locator('svg.pg-side .hit.sel[data-rowlabel="pg203"]')).toHaveCount(1);
    const ring = await drawer.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(ring).toBe('none');
    const stroke = (id: string) =>
      page.locator(`svg.pg [data-loop="${id}"]`).evaluate((el) => getComputedStyle(el).stroke);
    expect(await stroke('pg203')).toBe('none');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const focusColour = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--focus').trim(),
    );
    expect(focusColour).not.toBe('');
    await expect(page.locator('svg.pg [data-loop="pg203"]')).toBeFocused();
    expect(await stroke('pg203')).not.toBe('none');

    await page.locator('svg.pg-side .label-hit[data-rowlabel="crs"]').click();
    await expect(drawer.locator('h4')).toHaveText('CRS tax residency section with DealCloud sync');
    await expect(page.locator('svg.pg .hit.sel')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    await page.locator('svg.pg [data-act="p31"]').click();
    await expect(pop).toContainText('Add a multi-select country list field.');
    await pop.getByRole('button', { name: 'View in work item' }).click();
    await expect(drawer.locator('h4')).toHaveText('PG-203 Country list field type');
    await expect(pop).toHaveCount(0);
  });

  test('filters in the search box narrow the graph and keep the parents as context', async ({
    page,
  }) => {
    await signIn(page, 'tracker-filter');
    const rows = page.locator('svg.pg [data-loop]');
    const control = page.locator('.tfilter-btn');
    const search = page.getByRole('combobox', { name: 'Search work items' });
    await expect(rows).toHaveCount(14);

    await control.click();
    const panel = page.getByRole('group', { name: 'Filter the graph' });
    await panel.locator('.fchip', { hasText: /^Late$/ }).click();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeEnabled();
    await expect(page.locator('summary[aria-label="Filters, 1 on"]')).toHaveCount(1);
    await expect(panel).toContainText('4 of 14 work items match');
    await expect(rows).toHaveCount(5);
    const dimmed = page.locator('svg.pg-side .row-label.dim');
    await expect(dimmed).toHaveCount(1);
    await expect(dimmed).toContainText('CRS tax residency');
    await expect(page.locator('svg.pg-side [data-eyeteam="digitization"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    await search.fill('PG-20');
    await expect(page.getByRole('listbox', { name: 'Work items' }).getByRole('option')).toHaveCount(
      3,
    );
    await expect(rows).toHaveCount(2);
    await search.fill('');
    await expect(rows).toHaveCount(5);
    await control.click();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(rows).toHaveCount(14);
    await expect(page.locator('summary[aria-label="Filters"]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await search.fill('pg-20');
    await expect(rows).toHaveCount(4);
    await page.keyboard.press('Enter');
    const drawer = page.locator('.drawer');
    await expect(drawer.locator('h4')).toHaveText('PG-201 CRS form logic');
    await expect(drawer).toBeFocused();
    expect(await drawer.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    await expect(search).toHaveValue('');
    await expect(rows).toHaveCount(14);
  });

  test('the axis stays pinned while the rows scroll, and follows the sideways scroll', async ({
    page,
  }) => {
    // The graph draws one pixel per unit, so a 600 px window leaves room to scroll 300 px.
    await page.setViewportSize({ width: 1440, height: 600 });
    await signIn(page, 'tracker-pin');
    const canvas = page.locator('.gcanvas');
    const head = page.locator('.ghead');
    const crm = page.locator('svg.tg [data-ms="crm"]');

    const top = (await canvas.boundingBox())!.y;
    await canvas.evaluate((el) => el.scrollTo(0, 400));
    await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
    await expect(crm).toBeInViewport();
    expect(Math.round((await head.boundingBox())!.y)).toBe(Math.round(top));
    await expect(page.locator('svg.pg-side [data-rowlabel="golive"]').first()).not.toBeInViewport();

    const golive = page.locator('svg.pg [data-loop="golive"]');
    await golive.focus();
    const headBottom = (await head.boundingBox())!;
    expect((await golive.boundingBox())!.y).toBeGreaterThanOrEqual(
      headBottom.y + headBottom.height - 1,
    );

    for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
    const rows = page.locator('.gscroll .gtime');
    await rows.evaluate((el) => el.scrollTo({ left: 300 }));
    await expect.poll(() => rows.evaluate((el) => el.scrollLeft)).toBe(300);
    await expect
      .poll(() => page.locator('.ghead .gtime').evaluate((el) => el.scrollLeft))
      .toBe(300);
  });

  test('full view fills the screen and leaves with the button or the browser', async ({ page }) => {
    await signIn(page, 'tracker-full');
    const full = page.getByRole('button', { name: 'Full view' });
    const board = page.locator('.tk.fullview');
    await full.click();
    await expect(board).toHaveCount(1);
    await expect(full).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.p-head')).toBeHidden();
    await expect(page.locator('.legend2')).toBeHidden();
    const box = (await page.locator('.tk.board').boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(1440);
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await full.click();
    await expect(board).toHaveCount(0);
    await expect(full).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);

    await full.click();
    await expect(board).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    // The browser's own Esc leaves full screen without a key event; the board follows the change.
    await page.evaluate(() => document.exitFullscreen());
    await expect(board).toHaveCount(0);
    await expect(page.locator('.p-head')).toBeVisible();
  });

  test('without the Fullscreen API, full view covers the window and Esc closes the top layer first', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => Promise.reject(new Error('refused'));
    });
    await signIn(page, 'tracker-fallback');
    const board = page.locator('.tk.fullview');
    const drawer = page.locator('.drawer');
    await page.getByRole('button', { name: 'Full view' }).click();
    await expect(board).toHaveCount(1);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    const box = (await page.locator('.tk.board').boundingBox())!;
    expect([box.x, box.y, box.width]).toEqual([0, 0, 1440]);
    await page.locator('svg.pg [data-loop="pg203"]').click({ position: { x: 40, y: 15 } });
    await expect(drawer.locator('h4')).toHaveText('PG-203 Country list field type');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(board).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(board).toHaveCount(0);
    await expect(page.locator('.legend2')).toBeVisible();
  });

  test('lists a stack, zooms it apart, and hides rows without a trace but a chip', async ({
    page,
  }) => {
    await signIn(page, 'tracker-zoom');
    const pop = page.locator('.pop');
    const scroller = page.locator('.gscroll .gtime');
    const overflow = () => scroller.evaluate((e) => e.scrollWidth - e.clientWidth);

    const stack = page.locator('svg.pg [data-act="r3"]');
    await expect(stack).toHaveAttribute('data-stack', 'r1,r2,r3');
    await stack.click();
    await expect(pop).toContainText('3 events here');
    await pop.locator('.stack-ev', { hasText: 'Delivery by Minh Trần' }).click();
    await expect(pop).toContainText('Minh sends the rehearsal report.');
    await page.keyboard.press('Escape');

    expect(await overflow()).toBe(0);
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    for (let i = 0; i < 6; i += 1) await zoomIn.click();
    await expect.poll(overflow).toBeGreaterThan(1000);
    await expect(page.locator('svg.pg [data-act="r1"]')).toHaveCount(1);
    await expect(page.locator('svg.pg-side .row-label').first()).toBeInViewport();
    await page.getByRole('button', { name: 'Fit to width' }).click();
    await expect.poll(overflow).toBe(0);

    await page.locator('svg.pg-side [data-eyerow="crs"]').click();
    await expect(page.locator('svg.pg [data-loop="crs"]')).toHaveCount(0);
    await expect(page.locator('svg.tg .fold')).toHaveCount(0);
    const arrows = page.locator(
      'svg.pg .chip[aria-label="Show CRS tax residency section with DealCloud sync"]',
    );
    await expect(arrows).toHaveCount(1);
    await expect(page.locator('svg.pg .chip')).toHaveCount(1);
    await expect(arrows.first().locator('title')).toHaveText(
      'From CRS tax residency section with DealCloud sync (hidden)',
    );
    await arrows.first().click();
    await expect(page.locator('svg.pg [data-loop="crs"]')).toHaveCount(1);

    await page.locator('svg.pg-side [data-eyeteam="engineering"]').click();
    await expect(page.locator('svg.pg [data-loop="pg203"]')).toHaveCount(0);
    await page.locator('.hid-menu > summary').click();
    await page.getByRole('button', { name: 'Unhide Engineering' }).click();
    await expect(page.locator('svg.pg [data-loop="pg203"]')).toHaveCount(1);
  });

  test('a handoff mark finds the receiving row, focus shows one tree, and hiding leaves no row', async ({
    page,
  }) => {
    await signIn(page, 'tracker-view');
    const row = (id: string) => page.locator(`svg.pg [data-loop="${id}"]`);
    const rows = page.locator('svg.pg [data-loop]');
    const side = page.locator('svg.pg-side');
    const tip = page.getByRole('tooltip');
    const fit = page.getByRole('button', { name: 'Fit to width' });
    await expect(rows).toHaveCount(14);

    await test.step('one mark per source lists every handoff, and a click on a receiver shows it', async () => {
      await expect(page.locator('svg.tg path.link, svg.tg path.stem')).toHaveCount(0);
      const lines = [
        'Handed over to Solutions Engineering · received in PG-201 CRS form logic',
        'Handed over to Solutions Engineering · received in PG-202 DealCloud mapping for CRS fields',
        'Handed over to Engineering · received in PG-203 Country list field type',
      ];
      const marks = page.locator('svg.pg [data-handoff="analyse"]');
      await expect(marks).toHaveCount(1);
      const mark = marks.first();
      // The Handoff event icon is the mark: one symbol, with the receiver count on it.
      await expect(mark).toHaveAttribute('data-stack', /a3/);
      await expect(mark.locator('.hand-count')).toHaveText('3');
      await expect(page.locator('svg.pg .handoff[data-handoff="analyse"]')).toHaveCount(0);
      await mark.hover();
      for (const line of lines) await expect(tip).toContainText(line);
      await page.mouse.move(5, 5);
      await expect(tip).toHaveCount(0);
      await side.locator('[data-eyerow="pg203"]').click();
      await expect(row('pg203')).toHaveCount(0);
      await mark.focus();
      for (const line of lines) await expect(tip).toContainText(line);
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', {
        name: 'Handoffs from Analyse the CRS and FATCA rules',
      });
      await expect(menu.getByRole('menuitem')).toHaveCount(4);
      await expect(menu.getByRole('menuitem').last()).toHaveText(/Show the \d events here/);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(mark).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(menu).toHaveCount(0);
      await expect(mark).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await page.locator('.zoombar').getByRole('button', { name: 'Zoom in' }).focus();
      await expect(menu).toHaveCount(0);
      await mark.click();
      await menu.getByRole('menuitem', { name: /PG-203 Country list field type/ }).click();
      await expect(menu).toHaveCount(0);
      await expect(row('pg203')).toHaveCount(1);
      await expect(page.locator('svg.pg .hit.flash[data-loop="pg203"]')).toHaveCount(1);
      await expect(fit).toBeEnabled();
      await fit.click();

      const single = page.getByRole('button', {
        name: 'Hands over to Digitization QA when done · received in Test the CRS section end to end',
      });
      await single.click();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(page.locator('svg.pg .hit.flash[data-loop="test"]')).toHaveCount(1);
      await fit.click();
    });

    await test.step('a team focus shows its rows and the work from them', async () => {
      const teamFocus = side.getByRole('button', { name: 'Focus on Digitization', exact: true });
      await teamFocus.click();
      await expect(teamFocus).toHaveAttribute('aria-pressed', 'true');
      await expect(rows).toHaveCount(6);
      const panel = page.getByRole('complementary', { name: 'Focus on Digitization' });
      await expect(panel).toContainText('6 work items');
      await expect(panel).toContainText('Legal review routing');
      await page.keyboard.press('Escape');
      await expect(rows).toHaveCount(14);
      await expect(teamFocus).toHaveAttribute('aria-pressed', 'false');
    });

    await test.step('focus shows the work item and its descendants, with a tree in the side panel', async () => {
      await side.getByRole('button', { name: 'Focus on Analyse the CRS and FATCA rules' }).click();
      await expect(rows).toHaveCount(5);
      await expect(side.locator('[data-eyeteam="implementation"]')).toHaveCount(0);
      const panel = page.getByRole('complementary', {
        name: 'Focus on Analyse the CRS and FATCA rules',
      });
      await expect(panel).toContainText('5 work items');
      await panel.getByRole('button', { name: /Test the CRS section end to end/ }).click();
      await expect(page.locator('svg.pg .hit.flash[data-loop="test"]')).toHaveCount(1);
      await fit.click();
      await panel
        .getByRole('button', { name: /CRS tax residency section with DealCloud sync/ })
        .click();
      await expect(rows).toHaveCount(6);
      await expect(
        page.getByRole('complementary', {
          name: 'Focus on CRS tax residency section with DealCloud sync',
        }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(rows).toHaveCount(14);
      const focusPg201 = side.getByRole('button', { name: 'Focus on PG-201 CRS form logic' });
      await focusPg201.click();
      await expect(rows).toHaveCount(2);
      await expect(focusPg201).toHaveAttribute('aria-pressed', 'true');
      await focusPg201.click();
      await expect(rows).toHaveCount(14);
      await expect(focusPg201).toHaveAttribute('aria-pressed', 'false');
      await focusPg201.click();
      await page.getByRole('complementary').getByRole('button', { name: 'Leave focus' }).click();
      await expect(rows).toHaveCount(14);
    });

    await test.step('hiding the team of the focused row ends the focus, and the parent link shows a hidden parent', async () => {
      const searchBox = page.getByRole('combobox', { name: 'Search work items' });
      await side.getByRole('button', { name: 'Focus on Analyse the CRS and FATCA rules' }).click();
      await searchBox.fill('PG-201');
      await page.keyboard.press('Enter');
      await expect(page.locator('.drawer h4')).toHaveText('PG-201 CRS form logic');
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('complementary', { name: 'Focus on Analyse the CRS and FATCA rules' }),
      ).toBeVisible();
      await expect(searchBox).toBeFocused();
      await side.locator('[data-eyeteam="digitization"]').click();
      await expect(rows).toHaveCount(12);
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await page.locator('.hid-menu > summary').click();
      await page.getByRole('button', { name: 'Unhide Digitization' }).click();
      await expect(rows).toHaveCount(14);
      await expect(searchBox).toBeFocused();

      await side.locator('[data-eyerow="crs"]').click();
      await expect(row('crs')).toHaveCount(0);
      await side.getByRole('button', { name: 'Focus on Analyse the CRS and FATCA rules' }).click();
      await page
        .getByRole('complementary')
        .getByRole('button', { name: /CRS tax residency section with DealCloud sync/ })
        .click();
      await expect(row('crs')).toHaveCount(1);
      await expect(rows).toHaveCount(6);
      await page.keyboard.press('Escape');
      await expect(rows).toHaveCount(14);
      await expect(page.locator('.hid-menu')).toHaveCount(0);
    });

    await test.step('a hidden team and a team with every row hidden take no room, and the badge unhides them', async () => {
      const height = () => side.evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.height);
      const full = await height();
      await side.locator('[data-eyeteam="engineering"]').click();
      await side.locator('[data-eyerow="pg201"]').click();
      await side.locator('[data-eyerow="pg202"]').click();
      await expect(rows).toHaveCount(8);
      await expect(side.locator('[data-eyeteam="engineering"]')).toHaveCount(0);
      await expect(side.locator('[data-eyeteam="solutions-engineering"]')).toHaveCount(0);
      await expect(side.getByText(/hidden/)).toHaveCount(0);
      expect(await height()).toBe(full - 6 * 32 - 2 * (22 + 6));

      const badge = page.locator('.hid-menu > summary');
      await expect(badge).toContainText('3 hidden');
      const list = page.getByRole('dialog', { name: 'Hidden teams and work items' });
      await badge.click();
      await expect(list).toBeVisible();
      await expect(list).toContainText('Engineering');
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await badge.click();
      await list.getByRole('button', { name: 'Unhide PG-201 CRS form logic' }).click();
      await expect(row('pg201')).toHaveCount(1);
      await expect(badge).toContainText('2 hidden');
      await list.getByRole('button', { name: 'Unhide all' }).click();
      await expect(rows).toHaveCount(14);
      await expect(page.locator('.hid-menu')).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Search work items' })).toBeFocused();
    });
  });
});

test.describe('events at their own time', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });

  test('Fit shows the earliest events, and a sideways drag moves nothing', async ({ page }) => {
    const { projectId } = await signIn(page, 'tracker-day');
    // At Fit the 2 Jul and 3 Jul events stack, with the later one on top.
    const g1 = page.locator('svg.pg [data-stack*="g1"]');
    await expect(g1).toHaveCount(1);
    await expect(g1).toBeInViewport();
    const side = await page.locator('svg.pg-side').boundingBox();
    const first = await g1.boundingBox();
    if (!side || !first) throw new Error('No box');
    expect(first.x).toBeGreaterThan(side.x + side.width + 4);
    await expect(page.locator('svg.pg [data-loop="golive"]')).toHaveAttribute(
      'aria-label',
      /Go-live date/,
    );

    const r3 = page.locator('svg.pg [data-act="r3"]');
    await expect(r3).toHaveAttribute('data-stack', 'r1,r2,r3');
    const before = (await r3.boundingBox())!;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/offsets/')) writes.push(r.url());
    });
    const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 1, { steps: 3 });
    await page.mouse.move(from.x + 40, from.y + 2, { steps: 8 });
    await page.mouse.up();
    await expect(r3).toHaveAttribute('data-stack', 'r1,r2,r3');
    expect((await r3.boundingBox())!.x).toBeCloseTo(before.x, 0);
    expect(writes).toEqual([]);
    await r3.click();
    const pop = page.locator('.pop');
    await expect(pop).toContainText('3 events here');
    await expect(pop.getByRole('button', { name: 'Reset position' })).toHaveCount(0);
    const read = await page.request.get(`/api/v1/projects/${projectId}/tracker`);
    expect(read.status()).toBe(200);
  });
});

test.describe('the tracker at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true });

  test('the graph, a change request page, its modals and the other pages never scroll sideways', async ({
    page,
  }) => {
    await page.goto('/signin?label=tracker-phone');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
    const graph = new URL(page.url()).pathname;
    await expect(page.locator('svg.pg')).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByRole('combobox', { name: 'Search work items' }).fill('pg');
    await expect(page.getByRole('option').first()).toBeVisible();
    await noHorizontalScroll(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('.drawer h4')).toHaveText(/^PG-/);
    await noHorizontalScroll(page);
    await page.keyboard.press('Escape');

    // The phone rail hides the fold button, so the first picks may land before hydration.
    await expect(async () => {
      await page.getByLabel('Demo: act as').selectOption({ label: 'Hà Đỗ' }, { timeout: 2_000 });
      await expect(page).toHaveURL(/\/changes\/4$/, { timeout: 2_000 });
    }).toPass();
    await expect(page.locator('.bbar').first()).toContainText('#4');
    await noHorizontalScroll(page);

    const add = page.getByRole('dialog', { name: 'Add to the queue' });
    await expect(async () => {
      await page
        .locator('.cr-side')
        .getByRole('button', { name: /^Queue/ })
        .click({ timeout: 2_000 });
      await page.locator('.qpanel').getByRole('button', { name: 'Add' }).click({ timeout: 2_000 });
      await expect(add).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await noHorizontalScroll(page);
    await page.keyboard.press('Escape');

    await page.locator('.bbar').getByRole('button', { name: 'Cancel change request' }).click();
    await expect(page.getByRole('dialog', { name: 'Cancel #4?' })).toBeVisible();
    await noHorizontalScroll(page);
    await page.keyboard.press('Escape');

    await page.goto(graph.replace(/graph$/, 'changes/2'));
    await expect(page.locator('.bbar').first()).toContainText('#2');
    await noHorizontalScroll(page);

    for (const path of ['members', 'settings/tokens']) {
      await page.goto(graph.replace(/graph$/, path));
      await expect(page.locator('.pg-head h1')).toBeVisible();
      await noHorizontalScroll(page);
    }
  });
});
