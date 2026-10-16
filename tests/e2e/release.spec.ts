import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  approveChangeSet,
  approvedStatus,
  changeSets,
  clickApprove,
  idOfUrl,
  needsRebase,
  openChangeSet,
} from './review-helpers';
import { seedOnUserCreated } from '../../src/server/app';
import { createDatabase } from '../../src/server/db/client';
import { DbIdentityStore } from '../../src/server/db/identity-store';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '../../src/server/http/session';

/**
 * SRD 15.1 walkthrough (items 1, 2, 4–7, 9) against BASE_URL. Sign-in, in order of precedence:
 * - RELEASE_DATABASE_URL + RELEASE_SESSION_SECRET: a fresh seeded user per test with a minted session (a local production image; skips only the Google code exchange).
 * - RELEASE_STORAGE_STATE: a saved session from one manual Google sign-in (a live deployment; use an account that has never signed in, because the walkthrough changes its sandbox).
 * - otherwise: local sign-in with a per-test label (a loopback dev server).
 */
const PROJECT = 'Larkspur Capital, Fund III onboarding';
const QUOTE = "I'll renew the secret on Monday 12 October.";
// Render Free (0.1 CPU, 512 MB) cannot meet the SRD 14 budgets, so they fail a run only when RELEASE_TIMING_BUDGET is set; the numbers are always recorded.
const timingBudget = Boolean(process.env.RELEASE_TIMING_BUDGET);
const minted = Boolean(process.env.RELEASE_DATABASE_URL && process.env.RELEASE_SESSION_SECRET);
const stored = !minted && Boolean(process.env.RELEASE_STORAGE_STATE);
if (stored) test.use({ storageState: process.env.RELEASE_STORAGE_STATE });

const database = minted ? createDatabase(process.env.RELEASE_DATABASE_URL) : null;
test.afterAll(async () => {
  await database?.pool.end();
});
// One shared user stays under 20 writes a minute only if each test starts in a fresh rate-limit window.
test.beforeEach(async () => {
  if (stored) await new Promise((resolve) => setTimeout(resolve, 60_500 - (Date.now() % 60_000)));
});

const headCommit = (page: Page) => page.getByTestId('head-commit').getAttribute('title');
const records = (page: Page) => page.getByRole('list', { name: 'Records' });
const commits = (page: Page) => page.getByRole('list', { name: 'Versions' });
const loopPanel = (page: Page) => page.getByRole('complementary', { name: /loop panel/i });
const branch = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^Loop: ${title.replace(/[()]/g, '\\$&')},`) });
const originOf = (page: Page) => new URL(page.url()).origin;

async function signIn(page: Page, label: string): Promise<string> {
  if (database) {
    const { userId } = await new DbIdentityStore(database.db, {
      onUserCreated: seedOnUserCreated,
    }).provisionUser({
      subject: `google:release-${randomUUID()}`,
      email: null,
      name: `Release check (${label})`,
    });
    const base = new URL(test.info().project.use.baseURL!);
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: signSession(
          { userId, expiresAt: Date.now() + SESSION_TTL_MS },
          process.env.RELEASE_SESSION_SECRET!,
        ),
        domain: base.hostname,
        path: '/',
        httpOnly: true,
        secure: base.protocol === 'https:',
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/');
  } else if (stored) await page.goto('/');
  else {
    await page.goto(`/signin?label=release-${label}`);
    await page.getByRole('button', { name: /continue/i }).click();
  }
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

async function paste(
  page: Page,
  projectId: string,
  fields: { source: string; title: string; author: string; sentAt: string; text: string },
) {
  await page.goto(`/projects/${projectId}/inbox`);
  await expect(
    page.getByRole('button', { name: 'Import as pending record', includeHidden: true }),
  ).toBeEnabled();
  await page.getByText('Paste a record').click();
  await page.getByLabel('Source label').fill(fields.source);
  await page.getByLabel('Title').fill(fields.title);
  await page.getByLabel('Author').fill(fields.author);
  await page.getByLabel('Sent at').fill(fields.sentAt);
  await page.getByLabel('Message text').fill(fields.text);
  await page.getByRole('button', { name: 'Import as pending record' }).click();
  const receipt = page.getByRole('status', { name: 'Import receipt' });
  await expect(receipt).toContainText('new');
  await expect(receipt).toContainText('The graph did not change');
}

async function openProposal(page: Page, projectId: string, title: string): Promise<string> {
  await page.goto(`/projects/${projectId}/review`);
  const link = changeSets(page).getByRole('link', { name: title });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  await expect(page).toHaveURL(/item=[0-9a-f-]{36}/);
  return `/projects/${projectId}/proposals/${new URL(page.url()).searchParams.get('item')}`;
}
/** Keeps the proposal side of every conflict that the expected pattern names; any other conflict fails the walkthrough. */
async function rebaseOntoMain(page: Page, proposalUrl: string, expectedConflict?: RegExp) {
  await page.goto(`${proposalUrl}/rebase`);
  await expect(page.getByRole('button', { name: 'Apply my choices' })).toBeVisible();
  const conflicts = page.getByRole('group', { name: /^Conflict: / });
  if (expectedConflict) await expect(conflicts.first()).toBeVisible();
  for (const name of await conflicts.evaluateAll((groups) =>
    groups.map((group) => group.getAttribute('aria-label') ?? ''),
  )) {
    expect(name).toMatch(expectedConflict ?? /^$/);
    await page
      .getByRole('group', { name, exact: true })
      .getByRole('radio', { name: 'Keep change set' })
      .check();
  }
  await page.getByRole('button', { name: 'Apply my choices' }).click();
  await expect(page).toHaveURL(/\/review\?tab=sets&item=[0-9a-f-]{36}&updated=1$/);
  await expect(page.getByText('Updated. Check the changes again, then approve.')).toBeVisible();
}

type Rpc = { result?: { isError?: boolean; structuredContent?: any }; error?: unknown }; // eslint-disable-line @typescript-eslint/no-explicit-any
async function mcp(
  request: APIRequestContext,
  secret: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await request.post('/mcp', {
    headers: {
      authorization: `Bearer ${secret}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  expect(response.status(), `${name} HTTP status`).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const body = (await response.json()) as Rpc;
  expect(body.error, `${name} JSON-RPC error`).toBeUndefined();
  return body.result!;
}

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1];

test('production sign-in: health is live, the sign-in page offers only Google, and the Google redirect carries state and PKCE', async ({
  browser,
}) => {
  test.skip(!minted && !stored, 'A local dev server signs in without Google');
  // Playwright applies the stored session to browser.newContext() too, so an anonymous visitor needs an explicit empty state.
  const anonymous = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    ignoreHTTPSErrors: process.env.RELEASE_INSECURE_TLS === '1',
    storageState: { cookies: [], origins: [] },
  });
  const page = await anonymous.newPage(),
    request = anonymous.request;
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/signin');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: /continue \(local dev/i })).toHaveCount(0);
  const redirect = await request.get('/api/auth/google', { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const location = new URL(redirect.headers().location);
  expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(location.searchParams.get('redirect_uri')).toBe(
    `${new URL(test.info().project.use.baseURL!).origin}/api/auth/google/callback`,
  );
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const cookies = redirect
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .map((header) => header.value);
  expect(
    cookies.some(
      (cookie) =>
        cookie.startsWith('pg_oauth_state=') &&
        cookie.includes('HttpOnly') &&
        cookie.includes('Secure'),
    ),
  ).toBe(true);
  expect(
    cookies.some(
      (cookie) =>
        cookie.startsWith('pg_oauth_verifier=') &&
        cookie.includes('HttpOnly') &&
        cookie.includes('Secure'),
    ),
  ).toBe(true);
  expect(
    (
      await request.post('/api/auth/local', {
        headers: { Origin: new URL(test.info().project.use.baseURL!).origin },
      })
    ).status(),
  ).toBe(401);
  expect((await request.get('/api/v1/projects')).status()).toBe(401);
  await anonymous.close();
});

test('1 and 9: sign in reaches the seeded main graph, a red branch shows its proof, pending evidence is visible; timings on the seed', async ({
  page,
}) => {
  const projectId = await signIn(page, 'graph');
  await expect(page.getByTestId('main-badge')).toHaveText(/approved graph/i);
  await expect(
    page.getByText(/wait for review, so an empty warning list is not proof of health/),
  ).toBeVisible();
  await expect(branch(page, 'Client secret renewal')).toHaveAttribute(
    'aria-label',
    /unanswered request/i,
  );
  // A branch can sit outside the visible canvas; focus brings it into view, as Tab does.
  await branch(page, 'Client secret renewal').focus();
  await branch(page, 'Client secret renewal').click();
  await expect(loopPanel(page).getByTestId('verified-quote').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByRole('button', { name: /^Loop: / }).first()).toBeVisible();
  const firstContentfulPaintMs = await page.evaluate(() =>
    Math.round(
      performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint')
        ?.startTime ?? -1,
    ),
  );
  const samples: number[] = [];
  for (let sample = 0; sample < 25; sample++) {
    const started = performance.now();
    const response = await page.request.get(`/api/v1/projects/${projectId}/graph`);
    expect(response.status()).toBe(200);
    await response.body();
    samples.push(performance.now() - started);
  }
  const metrics = {
    firstContentfulPaintMs,
    graphApiP50Ms: Math.round(percentile(samples, 0.5)),
    graphApiP95Ms: Math.round(percentile(samples, 0.95)),
    samples: samples.length,
  };
  test.info().annotations.push({ type: 'release-metrics', description: JSON.stringify(metrics) });
  console.log(`release-metrics ${JSON.stringify(metrics)}`);
  expect(firstContentfulPaintMs).toBeGreaterThan(0);
  if (!timingBudget) {
    test.info().annotations.push({
      type: 'timing-budget',
      description:
        'not enforced; set RELEASE_TIMING_BUDGET=1 to require FCP < 2 s and graph API p95 < 500 ms',
    });
    console.log('release-metrics budget not enforced (RELEASE_TIMING_BUDGET unset)');
    return;
  }
  expect(firstContentfulPaintMs).toBeLessThan(2000);
  expect(metrics.graphApiP95Ms).toBeLessThan(500);
});

test('2: a pasted message stays pending and main keeps its head commit', async ({ page }) => {
  const projectId = await signIn(page, 'paste');
  const mainBefore = await headCommit(page);
  const marker = randomUUID().slice(0, 8),
    title = `Incident report chase ${marker}`;
  await paste(page, projectId, {
    source: '#larkspur-onboarding',
    title,
    author: 'Sarah Kim',
    sentAt: '2026-10-09T18:20',
    text: `Investors are still asking about the incident report. Ref ${marker}`,
  });
  await page.goto(`/projects/${projectId}/inbox?state=pending`);
  await expect(records(page).getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await page.goto(`/projects/${projectId}/graph`);
  await expect(page.getByTestId('head-commit')).toBeVisible();
  expect(await headCommit(page)).toBe(mainBefore);
});

test('4 and 5: a proposal cites the exact quote, a wrong link is corrected, the diff is reviewed and a human merge changes the branch', async ({
  page,
}) => {
  const projectId = await signIn(page, 'merge');
  const mainBefore = await headCommit(page);
  const marker = randomUUID().slice(0, 8),
    title = `Re: Azure client secret ${marker}`;
  await paste(page, projectId, {
    source: 'gmail:client-secret',
    title,
    author: 'Tom Becker',
    sentAt: '2026-10-09T15:10',
    text: `Hi Quang, sorry for the delay, I was out. ${QUOTE} Ref ${marker}`,
  });
  await records(page)
    .getByRole('link', { name: new RegExp(title) })
    .click();
  await expect(page.getByLabel('Record text')).toContainText(`Ref ${marker}`);
  await selectText(page, QUOTE);
  await page.getByRole('button', { name: 'Add an act from this quote' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/proposals/[0-9a-f-]{36}\\?cite=`),
  );
  await expect(page.getByText('Author: you')).toBeVisible();
  const editor = page.getByRole('form', { name: 'Act editor' });
  await expect(editor.getByTestId('citation-check')).toContainText(
    'Quote matches the record text at 42–85',
  );
  await expect(editor.getByTestId('citation-quote')).toHaveText(QUOTE);
  await editor.getByLabel('Act type').selectOption({ label: 'Promise' });
  await editor.getByLabel('Actor').selectOption({ label: 'Tom Becker' });
  await editor.getByLabel('Loop').selectOption({ label: 'Investor portal branding' });
  await editor.getByLabel('Requested by').selectOption({ label: 'Quang Nguyễn' });
  await editor.getByLabel('Done by').selectOption({ label: 'Tom Becker' });
  await editor.getByLabel('Action').fill('Renew the Azure client secret for the sync app');
  await editor.getByLabel('Due date').fill('2026-10-12');
  await editor.getByRole('button', { name: 'Save act to change set' }).click();
  await expect(page.getByTestId('proposal-revision')).toHaveText('1');
  const operations = page.getByRole('listbox', { name: 'What changes' });
  await expect(operations.getByRole('option', { name: /Promise by Tom Becker/ })).toContainText(
    'Investor portal branding',
  );

  await operations.getByRole('option', { name: /Promise by Tom Becker/ }).click();
  await editor.getByLabel('Loop').selectOption({ label: 'Client secret renewal' });
  await editor.getByRole('button', { name: 'Save act to change set' }).click();
  await expect(page.getByTestId('proposal-revision')).toHaveText('2');
  await expect(operations.getByRole('option', { name: /Promise by Tom Becker/ })).toContainText(
    'Client secret renewal',
  );

  const setTitle = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
  await page.getByRole('link', { name: 'Review and approve' }).click();
  await expect(
    page
      .getByRole('region', { name: 'What changes' })
      .getByRole('row', { name: /Promise by Tom Becker/ }),
  ).toContainText('+ added');
  await expect(
    page
      .getByRole('region', { name: 'Effect on the loops' })
      .getByRole('row', { name: /Client secret renewal/ }),
  ).toContainText('requested → promised');
  await expect(page.getByRole('region', { name: 'Quotes' }).locator('mark')).toHaveText(QUOTE);
  await clickApprove(page);
  await expect(approvedStatus(page)).toBeVisible();
  await page.goto(`/projects/${projectId}/history`);
  await expect(commits(page).getByRole('link').first()).toContainText(setTitle);

  await page.goto(`/projects/${projectId}/graph`);
  await expect(page.getByTestId('head-commit')).toBeVisible();
  expect(await headCommit(page)).not.toBe(mainBefore);
  await expect(branch(page, 'Client secret renewal')).not.toHaveAttribute(
    'aria-label',
    /unanswered request/i,
  );
});

test('6: of two competing proposals the stale merge fails, an explicit rebase needs a fresh review, then it merges', async ({
  page,
}) => {
  const projectId = await signIn(page, 'rebase');
  const sowUrl = await openProposal(
    page,
    projectId,
    'Retitle the Dynamics loop with the SOW scope',
  );
  const other = await page.context().newPage();
  const phaseOneUrl = await openProposal(
    other,
    projectId,
    'Retitle the Dynamics loop as a phase 1 request',
  );
  // Both drafts start on the seed main; on a shared sandbox earlier merges moved main, so each draft first rebases explicitly (SRD 6.4).
  for (const [tab, url] of [
    [page, sowUrl],
    [other, phaseOneUrl],
  ] as const)
    if (await needsRebase(tab)) await rebaseOntoMain(tab, url);

  await openChangeSet(page, projectId, idOfUrl(sowUrl));
  await expect(page.getByRole('region', { name: 'What changes' })).toContainText(
    'Dynamics CRM sync scope (SOW phase 2)',
  );
  await approveChangeSet(other, projectId, idOfUrl(phaseOneUrl));
  await other.close();

  await clickApprove(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Conflict' })).toContainText(
    'Conflict: the graph or this change set changed since this page loaded.',
  );
  await openChangeSet(page, projectId, idOfUrl(sowUrl));
  expect(await needsRebase(page)).toBe(true);
  await rebaseOntoMain(page, sowUrl, /Conflict: Loop: Dynamics CRM sync/);
  await clickApprove(page);
  await expect(approvedStatus(page)).toBeVisible();
  await page.goto(`/projects/${projectId}/history`);
  await expect(commits(page).getByRole('link').first()).toContainText(
    'Retitle the Dynamics loop with the SOW scope',
  );
  await page.goto(`/projects/${projectId}/graph`);
  await expect(branch(page, 'Dynamics CRM sync scope (SOW phase 2)')).toBeVisible();
});

test('7: a revert keeps an unrelated later change, and a restore of an older graph is a new commit', async ({
  page,
}) => {
  const projectId = await signIn(page, 'revert');
  await page.goto(`/projects/${projectId}/history`);
  await commits(page)
    .getByRole('link', { name: /^Note the SOW phase 2 scope/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: /^Note the SOW phase 2 scope/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview undo' }).click();
  const revert = page.getByRole('region', { name: /Undo preview/ });
  await expect(revert.getByTestId('preserved')).toContainText('Unrelated later work stays');
  await revert.getByRole('button', { name: 'Apply undo as a new version' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/history/[0-9a-f-]{36}$`));
  await expect(commits(page).getByRole('link').first()).toContainText(
    'Undo “Note the SOW phase 2 scope',
  );

  // After the revert, main can equal the seed snapshot, so restoring the seed could change nothing; the pre-revert commit always differs.
  const before = await commits(page).getByRole('link').count();
  await commits(page)
    .getByRole('link', { name: /^Note the SOW phase 2 scope/ })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: /^Note the SOW phase 2 scope/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview go back' }).click();
  const restore = page.getByRole('region', { name: /Go back preview/ });
  await expect(restore.getByTestId('removed-later')).toContainText('Adds back annotation');
  await restore.getByRole('button', { name: 'Apply go back as a new version' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/history/[0-9a-f-]{36}$`));
  await expect(commits(page).getByRole('link')).toHaveCount(before + 1);
  await expect(commits(page).getByRole('link').first()).toContainText('Go back');
  await expect(
    commits(page).getByRole('link', { name: /^Note the SOW phase 2 scope/ }),
  ).toHaveCount(1);
  const graph = await page.request.get(`/api/v1/projects/${projectId}/graph`);
  const annotations = (
    (await graph.json()) as { snapshot: { annotations: { text: string }[] } }
  ).snapshot.annotations.map((item) => item.text);
  expect(annotations.some((text) => text.includes('the SOW puts the Dynamics sync'))).toBe(true);
  await page.goto(`/projects/${projectId}/inbox?state=pending`);
  await expect(records(page).getByRole('link').first()).toBeVisible();
});

test('9: an agent token reads through MCP and submits a proposal, the default token cannot merge, and the proposal shows the agent author', async ({
  page,
}) => {
  const projectId = await signIn(page, 'agent');
  await page.goto(`/projects/${projectId}/settings/tokens`);
  const form = page.getByRole('form', { name: 'Create a token' });
  await expect(form.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await form.getByLabel('Label').fill('Release check agent');
  // New tokens default to the tracker scopes; this flow still needs the promise scopes.
  await form.getByRole('checkbox', { name: /Add records/ }).check();
  await form.getByRole('checkbox', { name: /Suggest changes/ }).check();
  await form.getByRole('button', { name: 'Create token' }).click();
  const secret = (await page.getByTestId('token-secret').innerText()).trim();
  expect(secret).toMatch(/^inv_[A-Za-z0-9_-]{43}$/);

  const project = await mcp(page.request, secret, 'get_project');
  expect(project.structuredContent).toMatchObject({
    projectId,
    project: { id: projectId },
  });
  expect(project.structuredContent.pendingEvidenceCount).toBeGreaterThan(0);
  const text = 'We will send the corrected investor list by 14 October.';
  const imported = await mcp(page.request, secret, 'import_records', {
    source: 'agent',
    sourceLabel: 'notion',
    records: [
      {
        externalId: `release-${randomUUID()}`,
        sourceLabel: 'notion',
        author: { name: 'Daniel Reyes', email: 'daniel@fundline.example' },
        recipients: [{ name: 'Sarah Kim' }],
        title: 'Investor list follow-up',
        bodyText: text,
        occurredAt: '2026-10-09T10:00:00+07:00',
      },
    ],
    idempotencyKey: `release-import-${randomUUID()}`,
  });
  const versionId = imported.structuredContent.items[0].recordVersionId as string;
  expect(
    (await mcp(page.request, secret, 'get_record', { recordVersionId: versionId }))
      .structuredContent.text,
  ).toBe(text);
  const inbox = await mcp(page.request, secret, 'list_inbox', { state: 'pending' });
  expect(inbox.isError, JSON.stringify(inbox.structuredContent)).toBeFalsy();
  expect(
    (inbox.structuredContent.items as { recordVersionId: string }[]).map(
      (item) => item.recordVersionId,
    ),
  ).toContain(versionId);
  const { mainCommitId, evidenceRevision } = (await mcp(page.request, secret, 'get_project'))
    .structuredContent.project;
  const loops = await mcp(page.request, secret, 'get_snapshot', {
    view: { kind: 'main' },
    collection: 'loops',
    limit: 50,
  });
  const loop = (loops.structuredContent.items as { id: string; title: string }[]).find(
    (item) => item.title === 'Sync incident report',
  );
  expect(loop).toBeDefined();
  const proposal = await mcp(page.request, secret, 'create_proposal', {
    baseCommitId: mainCommitId,
    title: 'Agent: corrected investor list',
    expectedEvidenceRevision: evidenceRevision,
    idempotencyKey: `release-create-${randomUUID()}`,
  });
  const proposalId = proposal.structuredContent.id as string;
  const act = {
    id: randomUUID(),
    citation: { recordVersionId: versionId, start: 0, end: text.length },
    type: 'promise',
    actor: { kind: 'side', side: 'vendor' },
    customer: { kind: 'side', side: 'client' },
    performer: { kind: 'side', side: 'vendor' },
    action: 'Send the corrected investor list',
    due: { date: '2026-10-14', precision: 'day' },
    hedged: false,
    loopId: loop!.id,
    hidden: false,
    origin: 'agent',
    confidence: 0.8,
  };
  const updated = await mcp(page.request, secret, 'update_proposal', {
    proposalId,
    expectedProposalRevision: 0,
    expectedEvidenceRevision: evidenceRevision,
    idempotencyKey: `release-update-${randomUUID()}`,
    operations: [
      { op: 'put', collection: 'acts', quote: text, value: act },
      {
        op: 'put',
        collection: 'recordDecisions',
        value: { recordVersionId: versionId, disposition: 'included', reason: '' },
      },
    ],
  });
  expect(updated.isError, JSON.stringify(updated.structuredContent)).toBeFalsy();
  const diff = await mcp(page.request, secret, 'diff_proposal', { proposalId });
  expect(diff.structuredContent.digest).toMatch(/^[a-f0-9]{64}$/);
  const merge = await mcp(page.request, secret, 'merge_proposal', {
    proposalId,
    expectedMainCommitId: diff.structuredContent.mainCommitId,
    expectedProposalRevision: diff.structuredContent.proposalRevision,
    expectedEvidenceRevision: diff.structuredContent.evidenceRevision,
    reviewDigest: diff.structuredContent.digest,
    T: diff.structuredContent.T,
    message: 'Agent merge attempt',
    idempotencyKey: `release-merge-${randomUUID()}`,
  });
  expect(merge).toMatchObject({ isError: true, structuredContent: { code: 'FORBIDDEN' } });
  const foreignOrigin = await page.request.post(`/api/v1/projects/${projectId}/agent-tokens`, {
    headers: { Origin: 'https://evil.example' },
    data: { label: 'cross-site', idempotencyKey: randomUUID() },
  });
  expect(foreignOrigin.status()).toBe(403);

  await page.goto(`/projects/${projectId}/proposals/${proposalId}`);
  await expect(page.getByText(/^Agent via MCP$/).first()).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'What changes' })).toContainText(
    'Sync incident report',
  );
  await page.goto(`/projects/${projectId}/graph`);
  expect(await headCommit(page)).toBe(mainCommitId);
  expect(originOf(page)).toBe(new URL(test.info().project.use.baseURL!).origin);
});
