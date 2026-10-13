import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { uuidFromKey } from '../../scripts/build-fixtures';
import { testDatabaseUrl } from '../support/db';

const PROJECT = 'Larkspur Capital, Fund III onboarding';
const COMPLAINT = 'You promised go-live by 30 September and never told us it slipped.';
const COVERAGE = 'This verdict covers the submitted evidence in this project only.';
// Fixture act IDs of the go-live loop; the sandbox re-keys them per project.
const PROMISE = '94f5c370-711a-4039-9e20-a02d1fd5e70d', RENEGOTIATE = 'fe8cb040-d525-4e8b-9009-a911e6098e6b', AGREE = '94e84396-211b-4c56-95bb-1464890069cc';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function signIn(page: Page, label: string): Promise<string> {
  await page.goto(`/signin?label=${label}`);
  await page.getByRole('button', { name: /continue/i }).click();
  await expect(page.getByText(PROJECT).first()).toBeVisible();
  await expect(page.getByTestId('head-commit')).toBeVisible();
  return new URL(page.url()).pathname.split('/')[2];
}

/** Lists page at 50 items and browser writes are limited to 20 a minute, so the paging test adds rows straight to the throwaway e2e database. */
async function sql(text: string, values: unknown[]): Promise<void> {
  const pool = new Pool({ connectionString: testDatabaseUrl(process.env.TEST_DATABASE_URL!, process.env.E2E_DATABASE_NAME!), max: 1 });
  try { await pool.query(text, values); } finally { await pool.end(); }
}

async function saveAnalysis(page: Page, projectId: string, escalationId: string, expectedAnalysisRevision: number | null, answerText: (act: (key: string) => string) => string) {
  const act = (key: string) => uuidFromKey(`${projectId}:${key}`);
  const { project } = await (await page.request.get(`/api/v1/projects/${projectId}`)).json() as { project: { mainCommitId: string; evidenceRevision: number } };
  const response = await page.request.post(`/api/v1/projects/${projectId}/escalations/${escalationId}/analyses`, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      graphCommitId: project.mainCommitId, expectedMainCommitId: project.mainCommitId, expectedEvidenceRevision: project.evidenceRevision, expectedAnalysisRevision, idempotencyKey: randomUUID(),
      claims: [
        { id: randomUUID(), text: 'Fundline promised go-live by 30 September.', type: 'promise', timeWindow: null, supportingActIds: [act(PROMISE)], contradictingActIds: [], openQuestions: [] },
        { id: randomUUID(), text: 'Fundline never told Larkspur that go-live slipped.', type: 'notice', timeWindow: null, supportingActIds: [], contradictingActIds: [act(RENEGOTIATE), act(AGREE)], openQuestions: ['Did anyone besides Sarah Kim see the 12 September email?'] },
      ],
      answerText: answerText(act),
    },
  });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; revision: number; contentHash: string };
}

test('an escalation analysis shows verdicts and cited acts, copies and downloads the answer, approves it, and a merge marks it stale and blocks approval', async ({ page }) => {
  const projectId = await signIn(page, 'escalation');
  await page.goto(`/projects/${projectId}/escalations`);
  const form = page.getByRole('form', { name: 'Open complaint' });
  const keys: string[] = [];
  await page.route('**/escalations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push((JSON.parse(route.request().postData()!) as { idempotencyKey: string }).idempotencyKey);
    return keys.length < 3 ? route.abort() : route.continue();
  });
  await form.getByLabel('Complaint').fill(COMPLAINT);
  await form.getByRole('button', { name: 'Open complaint' }).click();
  await expect(form.getByRole('alert')).toContainText('The complaint was not saved.');
  await form.getByRole('button', { name: 'Open complaint' }).click();
  await expect.poll(() => keys.length).toBe(2);
  await form.getByLabel('Complaint').fill(`${COMPLAINT} `);
  await form.getByLabel('Complaint').fill(COMPLAINT);
  await form.getByRole('button', { name: 'Open complaint' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/escalations/[0-9a-f-]{36}$`));
  const escalationId = new URL(page.url()).pathname.split('/')[4];
  await page.unroute('**/escalations');
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  await expect(page.getByTestId('complaint')).toHaveText(`“${COMPLAINT}”`);
  await expect(page.getByText('No analysis yet.')).toBeVisible();

  const first = await saveAnalysis(page, projectId, escalationId, null, act => `Dear Sarah, we committed to go-live by 30 September [act:${act(PROMISE)}]. On 12 September Minh asked to move go-live to 15 October [act:${act(RENEGOTIATE)}], and you confirmed the next morning [act:${act(AGREE)}]. <b>Not markup</b>`);
  await page.reload();
  const claims = page.getByRole('list', { name: 'Claims' }).getByRole('listitem');
  await expect(claims).toHaveCount(2);
  await expect(claims.nth(0)).toContainText('Fundline promised go-live by 30 September.');
  await expect(claims.nth(0).getByTestId('verdict')).toHaveText(/supported/);
  await expect(claims.nth(1).getByTestId('verdict')).toHaveText(/contradicted/);
  await expect(claims.nth(1)).toContainText('Did anyone besides Sarah Kim see the 12 September email?');
  await expect(claims.nth(0).getByRole('link')).toHaveText(['Minh Trần, 3 Jul: promise']);

  const answer = page.getByRole('region', { name: 'Answer draft' });
  await expect(answer.getByTestId('answer')).toContainText('Dear Sarah, we committed to go-live by 30 September');
  await expect(answer.getByTestId('answer')).toContainText('<b>Not markup</b>');
  await expect(answer.getByTestId('answer')).not.toContainText('[act:');
  await expect(answer.getByTestId('answer').getByRole('link')).toHaveCount(3);
  await expect(answer.getByTestId('answer').getByRole('link').first()).toHaveAttribute('href', new RegExp(`/projects/${projectId}/graph\\?escalation=${escalationId}&loop=`));
  await expect(answer).toContainText(COVERAGE);
  await expect(answer.getByTestId('stale-badge')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /send/i })).toHaveCount(0);

  await answer.getByRole('button', { name: 'Copy answer' }).click();
  await expect(answer.getByRole('status')).toHaveText('Answer copied.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Dear Sarah, we committed to go-live by 30 September [1].');
  expect(copied).toContain('[1] Minh Trần, 3 Jul 2026, promise: "');
  expect(copied).not.toContain('[act:');

  const [download] = await Promise.all([page.waitForEvent('download'), answer.getByRole('button', { name: 'Download .md' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const file = await readFile((await download.path())!, 'utf8');
  expect(file).toContain(COMPLAINT);
  expect(file).toContain(COVERAGE);
  expect(file).toContain('[3] Sarah Kim, 13 Sep 2026, agree to change: "');

  await answer.getByRole('button', { name: 'Approve answer' }).click();
  await expect(answer.getByTestId('approval')).toContainText('Approved by you');

  await claims.nth(0).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/graph\\?(.+&)?escalation=${escalationId}`));
  await expect.poll(() => page.locator('.br-faded').count()).toBeGreaterThan(0);

  await page.goto(`/projects/${projectId}/escalations/${escalationId}`);
  const second = await saveAnalysis(page, projectId, escalationId, first.revision, act => `Revised: the move to 15 October was agreed on 13 September [act:${act(AGREE)}].`);
  await page.reload();
  await expect(answer.getByTestId('approval')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Analysis revisions' }).getByRole('listitem')).toHaveCount(2);
  await expect(answer.getByRole('button', { name: 'Approve answer' })).toBeEnabled();

  await page.goto(`/projects/${projectId}/proposals`);
  await page.getByRole('link', { name: 'Retitle the Dynamics loop as a phase 1 request' }).click();
  await page.getByRole('link', { name: 'Review changes' }).click();
  await expect(page.getByRole('button', { name: 'Merge into main' })).toBeVisible();
  await page.getByRole('checkbox', { name: /still pending review/ }).check();
  await page.getByRole('button', { name: 'Merge into main' }).click();
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);

  await page.goto(`/projects/${projectId}/escalations/${escalationId}`);
  await expect(answer.getByTestId('stale-badge')).toHaveText('Stale');
  await expect(answer.getByRole('button', { name: 'Approve answer' })).toBeDisabled();
  await expect(answer).toContainText('Approval needs current pinned inputs.');
  const { project } = await (await page.request.get(`/api/v1/projects/${projectId}`)).json() as { project: { mainCommitId: string; evidenceRevision: number } };
  const refused = await page.request.post(`/api/v1/projects/${projectId}/escalations/${escalationId}/analyses/${second.id}/approval`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { expectedAnalysisRevision: second.revision, expectedMainCommitId: project.mainCommitId, expectedEvidenceRevision: project.evidenceRevision, contentHash: second.contentHash, idempotencyKey: randomUUID() },
  });
  expect(refused.status()).toBe(409);

  await page.goto(`/projects/${projectId}/escalations`);
  // The sandbox seeds the same complaint with one analysis, so the list holds it twice.
  const rows = page.getByRole('row', { name: new RegExp(COMPLAINT.slice(0, 30)) });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'revision 2' })).toHaveCount(1);
});

test('agent tokens: default scopes, a secret shown once, revocation, and the MCP config snippet', async ({ page }) => {
  const projectId = await signIn(page, 'tokens');
  await page.goto(`/projects/${projectId}/settings/tokens`);
  const form = page.getByRole('form', { name: 'Create a token' });
  for (const scope of ['project:read', 'records:import', 'graph:propose']) await expect(form.getByRole('checkbox', { name: new RegExp(`^${scope}`) })).toBeChecked();
  for (const scope of ['graph:merge', 'escalations:write']) await expect(form.getByRole('checkbox', { name: new RegExp(`^${scope}`) })).not.toBeChecked();
  await expect(form).toContainText('Lets this token merge, revert and restore without you.');

  const origin = new URL(page.url()).origin;
  await expect(page.getByTestId('mcp-snippet')).toContainText(`"url": "${origin}/mcp"`);
  await expect(page.getByTestId('mcp-snippet')).toContainText('"Authorization": "Bearer inv_..."');

  await form.getByLabel('Label').fill('E2E release agent');
  await form.getByRole('button', { name: 'Create token' }).click();
  const secret = page.getByTestId('token-secret');
  await expect(secret).toHaveText(/^inv_[A-Za-z0-9_-]{43}$/);
  const value = (await secret.textContent())!;
  await page.getByRole('button', { name: 'Copy secret' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);

  const row = page.getByRole('row', { name: /E2E release agent/ });
  await expect(row).toContainText(`${value.slice(0, 8)}…`);
  await expect(row).toContainText('project:read');
  await expect(row).not.toContainText('graph:merge');

  await page.getByRole('button', { name: 'I copied it, hide the secret' }).click();
  await expect(page.getByTestId('token-secret')).toHaveCount(0);
  expect(await page.content()).not.toContain(value);
  await page.reload();
  await expect(page.getByTestId('token-secret')).toHaveCount(0);
  expect(await page.content()).not.toContain(value);

  await row.getByRole('button', { name: 'Revoke' }).click();
  await row.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(row).toContainText('Revoked');
  await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
});

test('token and complaint lists page through every item, and a token on the second page can be revoked', async ({ page }) => {
  const projectId = await signIn(page, 'paging');
  await page.goto(`/projects/${projectId}/settings/tokens`);
  const form = page.getByRole('form', { name: 'Create a token' });
  await form.getByLabel('Label').fill('Oldest agent');
  await form.getByRole('button', { name: 'Create token' }).click();
  await page.getByRole('button', { name: 'I copied it, hide the secret' }).click();
  const { items } = await (await page.request.get(`/api/v1/projects/${projectId}/agent-tokens`)).json() as { items: { id: string; label: string }[] };
  await sql(`INSERT INTO agent_tokens (workspace_id, project_id, user_id, prefix, hash, label, scopes, idempotency_key, created_at, expires_at)
    SELECT workspace_id, project_id, user_id, 'inv_bulk', md5(random()::text) || md5(n::text), 'Bulk token ' || n, scopes, 'bulk-' || n, created_at + n * interval '1 second', expires_at
    FROM agent_tokens, generate_series(1, 50) AS n WHERE id = $1`, [items.find(item => item.label === 'Oldest agent')!.id]);
  await page.reload();
  await expect(page.getByRole('row', { name: /Bulk token 50\b/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Oldest agent/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Older tokens' }).click();
  await expect(page).toHaveURL(/[?&]cursor=/);
  const row = page.getByRole('row', { name: /Oldest agent/ });
  await row.getByRole('button', { name: 'Revoke' }).click();
  await row.getByRole('button', { name: 'Confirm revoke' }).click();
  await expect(row).toContainText('Revoked');
  await page.getByRole('link', { name: 'Newest tokens' }).click();
  await expect(page.getByRole('row', { name: /Bulk token 50\b/ })).toBeVisible();

  await page.goto(`/projects/${projectId}/escalations`);
  const complaintForm = page.getByRole('form', { name: 'Open complaint' });
  await complaintForm.getByLabel('Complaint').fill('Oldest complaint on record.');
  await complaintForm.getByRole('button', { name: 'Open complaint' }).click();
  await expect(page).toHaveURL(/\/escalations\/[0-9a-f-]{36}$/);
  await sql(`INSERT INTO escalations (workspace_id, project_id, complaint, author, created_at)
    SELECT workspace_id, project_id, 'Bulk complaint ' || n, author, created_at + n * interval '1 second' FROM escalations, generate_series(1, 50) AS n WHERE id = $1`, [new URL(page.url()).pathname.split('/')[4]]);
  await page.goto(`/projects/${projectId}/escalations`);
  await expect(page.getByRole('link', { name: 'Bulk complaint 50' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Oldest complaint on record.' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Older complaints' }).click();
  await expect(page.getByRole('link', { name: 'Oldest complaint on record.' })).toBeVisible();
  await page.getByRole('link', { name: 'Newest complaints' }).click();
  await expect(page.getByRole('link', { name: 'Bulk complaint 50' })).toBeVisible();
});
