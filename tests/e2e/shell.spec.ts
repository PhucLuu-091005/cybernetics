import { expect, test } from '@playwright/test';

const PROJECT = 'Larkspur Capital';

test('the rail folds to icons, keeps the state after a reload, and opens again', async ({
  page,
}) => {
  await page.goto('/signin?label=shell');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Project' });
  await expect(nav.getByRole('link')).toHaveText(['Graph', 'Members', 'Settings']);
  for (const gone of [/^Review/, 'Escalations', 'Inbox', 'Proposals'])
    await expect(nav.getByRole('link', { name: gone })).toHaveCount(0);
  await expect(page.getByText('Nothing changes the graph until a person approves it.')).toHaveCount(
    0,
  );
  const rail = page.locator('.rail');
  await expect(rail.locator('.rail-foot').getByRole('button')).toHaveCount(1);
  await expect(rail.getByRole('button', { name: /theme|sign out/i })).toHaveCount(0);
  await expect(rail).not.toContainText('Main changes only when a person with the');

  const fold = page.getByRole('button', { name: 'Collapse sidebar' });
  await expect(fold.locator('path')).toHaveAttribute('d', /M9 3v18M16 15l-3-3 3-3$/);
  await fold.click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }).locator('path'),
  ).toHaveAttribute('d', /M9 3v18M14 9l3 3-3 3$/);
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

  await page.locator('.rail').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/tokens$/);
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'collapsed');

  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('.rail')).toHaveAttribute('data-state', 'open');
  await expect(nav.getByText('Graph', { exact: true })).toBeVisible();
});

test('the avatar menu switches the theme, keeps it after a reload, and signs out', async ({
  page,
}) => {
  await page.goto('/signin?label=shell-account');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();
  const html = page.locator('html');
  const menu = page.locator('.p-head details.acct');
  await expect(menu.locator('summary b')).toHaveText('Minh Trần');

  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  const theme = menu.getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: 'System' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await theme.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();
  await menu.locator('summary').click();
  await expect(theme.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await theme.getByRole('radio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await theme.getByRole('radio', { name: 'System' }).click();
  await expect(html).not.toHaveAttribute('data-theme');

  await menu.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/signin$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin$/);
});

test('the project switcher closes on Escape', async ({ page }) => {
  await page.goto('/signin?label=shell-pop');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  // The fold button stays disabled until React hydrates, and the close handlers need React.
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();

  const switcher = page.locator('details.proj-switch');
  await switcher.locator('summary').click();
  await expect(switcher).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(switcher).not.toHaveAttribute('open');
  await expect(switcher.locator('summary')).toBeFocused();
});

test('the project switcher creates a project, opens its graph and lists both projects', async ({
  page,
}) => {
  await page.goto('/signin?label=new-project');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const larkspur = new URL(page.url()).pathname;
  // The dialog opens from a React handler, so the click must wait for hydration.
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();

  const switcher = page.locator('details.proj-switch');
  await switcher.locator('summary').click();
  await switcher.getByRole('button', { name: '+ New project' }).click();
  await expect(switcher).not.toHaveAttribute('open');
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await expect(dialog.getByLabel('Project name')).toBeFocused();
  const create = dialog.getByRole('button', { name: 'Create project' });
  await expect(create).toBeDisabled();
  await dialog.getByLabel('Project name').fill('Brightwater Bank KYC portal');
  await dialog.getByLabel('Client').fill('Brightwater Bank');
  await expect(create).toBeEnabled();
  await dialog.getByLabel('Client').press('Enter');

  await page.waitForURL(
    (url) => url.pathname !== larkspur && /^\/projects\/[0-9a-f-]{36}\/graph$/.test(url.pathname),
  );
  await expect(dialog).toBeHidden();

  await switcher.locator('summary').click();
  const projects = page.getByRole('list', { name: 'Projects' }).getByRole('link');
  await expect(projects).toHaveCount(2);
  await expect(projects.nth(1)).toContainText('Brightwater Bank');
  await expect(projects.nth(1)).toHaveAttribute('aria-current', 'true');
  await projects.nth(0).click();
  await expect(page).toHaveURL(larkspur);
  await expect(page.getByText(PROJECT).first()).toBeVisible();
});

test('the New project dialog keeps the typed values after a failure and closes on Escape', async ({
  page,
}) => {
  await page.goto('/signin?label=new-project-failure');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeEnabled();
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INTERNAL', message: 'Internal error' }),
    }),
  );

  const switcher = page.locator('details.proj-switch');
  await switcher.locator('summary').click();
  await switcher.getByRole('button', { name: '+ New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Project name').fill('Brightwater Bank KYC portal');
  await dialog.getByLabel('Client').fill('Brightwater Bank');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The project was not created.');
  await expect(dialog.getByRole('alert')).toContainText('Internal error');
  await expect(dialog.getByLabel('Project name')).toHaveValue('Brightwater Bank KYC portal');
  await expect(dialog.getByLabel('Client')).toHaveValue('Brightwater Bank');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(switcher.locator('summary')).toBeFocused();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/graph$/);

  await switcher.locator('summary').click();
  await switcher.getByRole('button', { name: '+ New project' }).click();
  await expect(dialog.getByLabel('Project name')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('Settings shows plain permission names, and Last call changes from Never after an agent call and Check again', async ({
  page,
}) => {
  await page.goto('/signin?label=settings-last-call');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`/projects/${projectId}/settings/tokens`);

  await expect(page.getByTestId('mcp-endpoint')).toHaveText(/\/mcp$/);
  await expect(page.getByText("Paste this into your agent's MCP settings.")).toBeVisible();
  await expect(page.getByText('Streamable HTTP')).toHaveCount(0);

  const form = page.getByRole('form', { name: 'Create a token' });
  const permissions = form.getByRole('group', { name: 'Permissions' });
  await expect(permissions.getByRole('checkbox')).toHaveCount(2);
  await expect(permissions.getByRole('checkbox', { name: /Read the project/ })).toBeChecked();
  await expect(permissions.getByRole('checkbox', { name: /Add to the Queue/ })).toBeChecked();

  await expect(form.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await form.getByLabel('Label').fill('Last call agent');
  await form.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.getByTestId('token-secret').innerText()).trim();
  expect(secret).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);
  await expect(
    page.getByText(
      'Ask your agent to list its tools. Then press Check again: Last call shows the time of that call.',
    ),
  ).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: 'Last call agent' });
  await expect(row.getByTestId('last-call')).toHaveText('Never');
  await expect(row.getByText('Read the project, Add to the Queue')).toBeVisible();

  const response = await page.request.post('/mcp', {
    headers: {
      authorization: `Bearer ${secret}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(response.status()).toBe(200);

  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(row.getByTestId('last-call')).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/);
});

test('a missing page keeps the stored theme and logs no console error', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text()))
      problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/signin?label=shell-missing');
  await page.evaluate(() => localStorage.setItem('pg-theme', 'dark'));
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  for (const path of ['/no-such-page', '/projects/00000000-0000-4000-8000-000000000000/graph']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
  await page.getByRole('link', { name: 'Go to your projects' }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(problems).toEqual([]);
});

test('a signed-out person who opens a change request link lands on it after sign-in', async ({
  page,
  context,
}) => {
  await page.goto('/signin?label=shell-return');
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  const projectId = new URL(page.url()).pathname.split('/')[2];
  const link = `/projects/${projectId}/changes/2`;
  await context.clearCookies();

  await page.goto(link);
  await page.waitForURL(/\/signin\?/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(link);
  await page.goto(`/signin?label=shell-return&next=${encodeURIComponent(link)}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL((url) => url.pathname === link);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.goto(`/signin?next=${encodeURIComponent(`/projects/${projectId}/members`)}`);
  await page.waitForURL((url) => url.pathname === `/projects/${projectId}/members`);

  await context.clearCookies();
  await page.goto('/signin?label=shell-return&next=%2F%2Fevil.example%2Fx');
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  expect(new URL(page.url()).host).toBe(new URL(link, page.url()).host);
});
