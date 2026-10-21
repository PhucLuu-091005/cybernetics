// The full feature tour video, for an app in demo mode (the deployed app or AUTH_MODE=demo): the visitor
// opens the demo and uses every feature on their own Larkspur copy. Run from the QA worktree root:
//   node .claude/skills/et-qa/scripts/tour.mjs --base <url> --out <dir>
// It makes 2 demo copies (the tour and its Start over). Token and key secrets are blurred on screen.
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(
  pathToFileURL(path.resolve('node_modules/@playwright/test/index.mjs')).href
);
const sharp = createRequire(path.resolve('package.json'))('sharp');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base');
const OUT = arg('out');
if (!BASE || !OUT) {
  console.error('usage: tour.mjs --base <url> --out <dir>');
  process.exit(2);
}
const RAW = path.join(OUT, 'raw');
const SHOTS = path.join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ slowMo: 40 });
const problems = [];
const chapters = [];
const t0 = Date.now();

async function overlay(ctx) {
  await ctx.addInitScript(() => {
    addEventListener('load', () => {
      const c = document.createElement('qa-cursor');
      c.style.cssText =
        'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,196,0,.45);border:2px solid #d97706;pointer-events:none;left:-50px;top:-50px;transition:transform .12s';
      document.body.appendChild(c);
      addEventListener(
        'mousemove',
        (e) => {
          c.style.left = e.clientX + 'px';
          c.style.top = e.clientY + 'px';
        },
        true,
      );
      addEventListener('mousedown', () => (c.style.transform = 'scale(.6)'), true);
      addEventListener('mouseup', () => (c.style.transform = 'scale(1)'), true);
      // A closed shadow root keeps the caption out of the page's own text and roles.
      const host = document.createElement('qa-caption');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText =
        'position:fixed;z-index:2147483646;left:0;right:0;bottom:56px;display:none;justify-content:center;pointer-events:none';
      const box = document.createElement('div');
      box.style.cssText =
        'max-width:min(900px,92%);padding:10px 18px;border-radius:10px;background:rgba(17,24,39,.9);color:#fff;font:600 17px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.25)';
      host.attachShadow({ mode: 'closed' }).appendChild(box);
      document.body.appendChild(host);
      // A video must not show a working secret.
      const veil = document.createElement('style');
      veil.textContent = '[data-testid="token-secret"]{filter:blur(8px)}';
      document.head.appendChild(veil);
      window.__say = (t) => {
        box.textContent = t;
        host.style.display = t ? 'flex' : 'none';
      };
      window.__say(sessionStorage.getItem('qa-caption') || '');
    });
  });
}
async function newCtx(opts) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    colorScheme: 'light',
    ...opts,
    recordVideo: { dir: RAW, size: opts.viewport },
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await overlay(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|preload/.test(m.text()))
      problems.push('console: ' + m.text().slice(0, 200));
  });
  return { ctx, page };
}

const { ctx, page } = await newCtx({ viewport: { width: 1440, height: 900 } });
let n = 0;
const pause = (ms = 900) => page.waitForTimeout(ms);
async function say(text, ms = 2200) {
  await page.evaluate((t) => {
    sessionStorage.setItem('qa-caption', t);
    window.__say?.(t);
  }, text);
  await pause(ms);
}
// A viewer needs a moment to read the line that leads to the next feature.
async function chapter(title, lead) {
  chapters.push({ title, at: (Date.now() - t0) / 1000 });
  console.log(`== ${title}`);
  await say(lead, 3200);
}
async function shot(name) {
  n += 1;
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}-${name}.png` });
}
async function visible(el) {
  return el.evaluate((node) => {
    let { left, top, right, bottom } = node.getBoundingClientRect();
    for (let up = node.parentElement; up; up = up.parentElement) {
      const s = getComputedStyle(up);
      if (!/auto|scroll|hidden/.test(s.overflowX + s.overflowY)) continue;
      const r = up.getBoundingClientRect();
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top };
  });
}
// The owner asked for the cursor to circle a control before the click, so the eye finds it.
async function circle(locator, ms = 1300) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const c = await visible(locator);
  const rx = Math.min(Math.max(c.w / 2 + 10, 18), 150);
  const ry = Math.min(Math.max(c.h / 2 + 8, 14), 70);
  await page.mouse.move(c.x + rx, c.y, { steps: 14 });
  const steps = 36;
  for (let i = 1; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    await page.mouse.move(c.x + rx * Math.cos(a), c.y + ry * Math.sin(a));
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.move(c.x, c.y, { steps: 6 });
  return c;
}
async function click(locator, ms = 1300) {
  await circle(locator, ms);
  await pause(150);
  await locator.click();
}
async function clickShape(locator) {
  const c = await circle(locator);
  await pause(150);
  await page.mouse.click(c.x, c.y);
}
async function choose(field, test) {
  await click(field);
  const list = page.locator(`[id="${await field.getAttribute('aria-controls')}"]`);
  const opts = list.getByRole('option');
  const texts = (await opts.allInnerTexts()).map((t) => t.trim());
  const i = texts.findIndex(test);
  if (i < 0) throw new Error(`no option in: ${texts.join(' | ')}`);
  await click(opts.nth(i), 700);
  return texts[i];
}
async function type(locator, text) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const c = await visible(locator);
  await page.mouse.move(c.x, c.y, { steps: 14 });
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 35 });
}
const hydrated = () =>
  page.waitForFunction(() => {
    const b = document.querySelector('button[aria-label$="sidebar"]');
    return b && !b.disabled;
  });
async function drag(from, to) {
  await to.scrollIntoViewIfNeeded().catch(() => {});
  const a = await circle(from);
  const b = await visible(to);
  await page.mouse.move(a.x, a.y, { steps: 6 });
  await pause(300);
  await page.mouse.down();
  await page.mouse.move(a.x + 8, a.y + 8, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 40 });
  await pause(300);
  await page.mouse.up();
}
async function actAs(name) {
  await choose(page.getByLabel('Demo: act as').first(), (t) => t.includes(name));
  await page.locator(`details.acct summary[aria-label^="${name}"]`).waitFor();
  await pause(700);
}
async function rpc(token, name, args) {
  const r = await page.request.post('/mcp', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const body = await r.json();
  if (body.error || body.result?.isError) throw new Error(`${name}: ${JSON.stringify(body)}`);
  return body.result;
}
const bar = () => page.locator('.bbar').first();
const head = () => page.locator('.p-head');
const nav = (name) => page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name });
const row = (title) => page.locator(`svg.pg [data-loop][aria-label^="${title}"]`);
const side = () => page.locator('svg.pg-side');
const toastSays = (text) => page.locator('.tk-toast').filter({ hasText: text }).waitFor();
const crSide = page.locator('.cr-side');
const drawer = page.locator('.drawer');

let pid = '';
try {
  chapters.push({ title: 'Open the demo', at: 0 });
  console.log('== Open the demo');
  await page.goto('/welcome');
  await say('Promise Graph: see every step of a project, and why the plan changed', 3000);
  await say('Each visitor gets a private copy of the sample project, Larkspur Capital', 2600);
  await click(page.getByRole('link', { name: 'Open the demo' }));
  await page.waitForURL(/\/graph$/);
  await hydrated();
  pid = page.url().split('/')[4];
  // 0.1.6 opens with an intro card on the first visit; it carries the pitch.
  const intro = page.getByRole('dialog').filter({ hasText: 'Pull requests for a project plan' });
  if (await intro.count()) {
    await say(
      'The first visit opens with the idea in one card: pull requests for a project plan',
      1400,
    );
    await circle(intro.getByText('Pull requests for a project plan').first(), 2200);
    await pause(2600);
    await shot('intro');
    await click(intro.getByRole('button', { name: 'Explore the demo' }));
  }
  await say('No sign-in. You are Minh Trần, the project lead.', 2600);
  const legend = page.getByRole('dialog', { name: 'Legend' });
  if (await legend.count()) await click(legend.getByRole('button', { name: 'Close legend' }), 800);
  await shot('main');

  await chapter('Three words', 'First, three words you will see everywhere');
  await say('A work item is one row: a piece of work, owned by a team', 1200);
  await circle(side().getByText('Go-live date', { exact: true }).first(), 1800);
  await circle(row('Go-live date'), 1800);
  await pause(900);
  await say('An event is a circle on the row: something that happened, by whom and when', 1200);
  await circle(page.locator('svg.pg [data-act]').first(), 1800);
  await pause(900);
  await say('A milestone is a deadline on the time axis. Its work items show a diamond.', 1200);
  await circle(page.locator('svg.pg-top-time [data-ms]').first(), 1800);
  await pause(900);
  await say('The vertical T line is now. Red parts are late.', 2600);
  await shot('three-words');

  await chapter('Read the graph', 'Next: read the graph of Main');
  await say(
    'Main is the agreed plan. It is read-only: every change goes through a change request.',
    3000,
  );
  const note = page.getByRole('note', { name: 'Main is read-only' });
  if (await note.count()) await click(note.getByRole('button', { name: 'Close the notice' }));
  await say('Zoom in, zoom out and Fit show the whole time line', 1200);
  await click(page.getByRole('button', { name: 'Zoom in' }));
  await pause(700);
  const fit = page.getByRole('button', { name: 'Fit to width' });
  if (await fit.isEnabled()) await click(fit);
  await pause(800);
  await say('The Legend explains every colour and event kind', 1200);
  await click(page.getByRole('button', { name: 'Legend' }));
  await pause(2400);
  await click(
    page.getByRole('dialog', { name: 'Legend' }).getByRole('button', { name: 'Close legend' }),
    800,
  );
  await say('Click an event to see who did what, and when', 1200);
  await clickShape(page.locator('svg.pg [data-act]').first());
  await page.locator('.pop').waitFor();
  await pause(2600);
  await page.keyboard.press('Escape');
  await say('Click a milestone on the axis: its work items light up', 1200);
  await clickShape(page.locator('svg.pg-top-time [data-ms]').first());
  await pause(2600);
  await page.keyboard.press('Escape');
  await shot('pops');

  await chapter('Work item details', 'Next: the details of a work item, and its date history');
  await say('Search a work item by code or name', 1200);
  await type(page.getByRole('combobox', { name: 'Search work items' }), 'Go-live');
  await pause(700);
  await page.keyboard.press('Enter');
  await drawer.waitFor();
  await say('The details: who does it, the planned finish, the events and the milestone', 2600);
  await click(drawer.getByRole('button', { name: /Date moves/ }));
  await say('Date moves: every move keeps the old date, the new date, who moved it and why', 3400);
  await shot('date-moves');
  await page.keyboard.press('Escape');

  await chapter('Focus, filters and hiding', 'Next: tools to see less, and see it better');
  await say('Focus on a work item: the graph keeps only the work linked to it', 1400);
  await click(side().getByRole('button', { name: 'Focus on PG-201 CRS form logic', exact: true }));
  const focus = page.locator('.drawer', { has: page.getByRole('heading', { name: 'Focus' }) });
  await focus.waitFor();
  await pause(2600);
  await shot('focus');
  await click(focus.getByRole('button', { name: 'Leave focus' }));
  await pause(600);
  await say('Filters: for example, only the late work', 1200);
  await click(page.locator('summary[aria-label^=Filters]'));
  const fp = page.getByRole('group', { name: 'Filter the graph' });
  await click(fp.getByRole('checkbox', { name: 'Late', exact: true }));
  await pause(2400);
  await shot('filter-late');
  await click(fp.getByRole('button', { name: 'Clear filters' }));
  await page.keyboard.press('Escape');
  await say('Hide a row or a team; the "hidden" badge brings it back', 1200);
  await click(
    side()
      .getByRole('button', { name: /^Hide / })
      .nth(1),
  );
  await pause(800);
  await click(page.getByText(/\d+ hidden/).first());
  await pause(900);
  await click(page.getByRole('button', { name: 'Unhide all' }));
  await pause(600);
  await say(
    'A handoff mark: one piece of work handed to several teams; click to jump to each',
    1400,
  );
  await clickShape(page.locator('svg.pg [data-handoff][aria-label*="handoffs from"]').first());
  const handoffs = page.getByLabel(/^Handoffs from/).first();
  await handoffs.waitFor();
  await pause(2200);
  await shot('handoffs');
  await click(handoffs.locator('button').first());
  await pause(1200);

  await chapter('History and change requests', 'Next: how Main changes over time');
  await say('History: every merge into Main since the project started, with who and when', 1200);
  await click(head().getByRole('button', { name: 'History' }));
  await page.locator('.drawer', { hasText: 'Main history' }).waitFor();
  await pause(2800);
  await shot('history');
  await page.keyboard.press('Escape');
  await say(
    'Change requests: the proposed changes; the number counts the ones ready to merge',
    1200,
  );
  await click(head().getByRole('button', { name: /^Change requests/ }));
  await page.locator('.drawer', { hasText: 'Change requests' }).waitFor();
  await pause(2800);
  await shot('change-requests');
  await page.keyboard.press('Escape');

  await chapter(
    'Review and merge',
    'Next: review a change request and merge it, like a pull request',
  );
  await page.goto(`/projects/${pid}/changes/11`);
  await hydrated();
  await say('Lan marked #11 as ready to merge. Yellow marks show what it changes.', 2600);
  if (await crSide.getByRole('button', { name: /^Changes/ }).count())
    await click(crSide.getByRole('button', { name: /^Changes/ }));
  await say('Before and After compare Main without and with the change', 1200);
  await click(page.getByRole('button', { name: 'Before', exact: true }));
  await pause(1800);
  await click(page.getByRole('button', { name: 'After', exact: true }));
  await pause(1200);
  await shot('review');
  await say('Minh holds the Merge right: Merge into Main', 1200);
  await click(bar().getByRole('button', { name: 'Merge into Main' }));
  await bar().filter({ hasText: 'Merged into Main' }).waitFor();
  await pause(1800);
  await page.goto(`/projects/${pid}/changes/12`);
  await hydrated();
  await say('#12 changes the same spot as the merge we just did. The app shows the clash.', 2600);
  const clash = page.getByRole('region', { name: 'Clashes with Main' });
  await clash.waitFor();
  await circle(clash, 1800);
  await shot('clash');
  await say(
    'Pick the version to keep for each clash, or one button for all; only then can you merge',
    1400,
  );
  await click(clash.getByRole('button', { name: 'Keep this change request for all' }));
  await click(bar().getByRole('button', { name: 'Merge into Main' }));
  await bar().filter({ hasText: 'Merged into Main' }).waitFor();
  await pause(1800);

  await chapter('Work together', 'Next: several people on one change request');
  await page.goto(`/projects/${pid}/graph`);
  await hydrated();
  await say('The demo lets you act as each person of the project', 1200);
  await actAs('Lan Phạm');
  await say('Lan creates a new change request', 1200);
  await click(head().getByRole('button', { name: 'New change request' }));
  const newCr = page.locator('.m-card');
  await type(newCr.getByLabel('Name'), 'Root cause report follow-up');
  await click(newCr.getByRole('button', { name: 'Create', exact: true }));
  await page.waitForURL(/\/changes\/\d+$/);
  await hydrated();
  await say('The Queue on the left holds events and work items waiting for the plan', 1200);
  await click(crSide.getByRole('button', { name: /^Queue/ }));
  await click(crSide.getByRole('button', { name: /^Events/ }));
  await say('Lan puts a Queue event on a work item', 1200);
  await click(page.locator('[data-qevent]', { hasText: 'Where is the root cause report' }).first());
  const attach = page.getByRole('dialog', { name: 'Add this event to a work item' });
  await choose(attach.locator('select, [role="combobox"]').first(), (t) =>
    t.includes('Sync incident report'),
  );
  await click(attach.getByRole('button', { name: 'Add to work item' }));
  await attach.waitFor({ state: 'detached' });
  await pause(1200);
  await say('Share: Khoa may edit this change request', 1200);
  await click(bar().getByRole('button', { name: 'Share' }));
  const share = page.locator('.m-card');
  await choose(share.getByLabel('Person').first(), (t) => t.includes('Khoa Lê'));
  await choose(share.getByLabel('Access', { exact: true }).first(), (t) => /edit/i.test(t));
  await click(share.getByRole('button', { name: 'Add', exact: true }));
  await toastSays('Khoa Lê can edit');
  await pause(900);
  await shot('share');
  await click(share.getByRole('button', { name: 'Done' }));
  await say('One person edits at a time. Khoa asks to edit.', 1400);
  await actAs('Khoa Lê');
  await click(bar().getByRole('button', { name: 'Ask to edit' }));
  await pause(1400);
  await actAs('Lan Phạm');
  await say('Lan sees the request and hands over', 1200);
  const ask = page.locator('.ask-row');
  await ask.filter({ hasText: 'Khoa Lê asks to edit' }).waitFor();
  await shot('ask-to-edit');
  await click(ask.getByRole('button', { name: 'Hand over' }));
  await pause(1400);
  await actAs('Khoa Lê');
  await say('Khoa finishes and marks it as ready', 1200);
  await click(bar().getByRole('button', { name: 'Mark as ready' }));
  await bar().filter({ hasText: 'Ready to merge' }).waitFor();
  await pause(1400);
  await actAs('Minh Trần');
  await say("Minh merges Khoa's change into Main", 1200);
  await click(bar().getByRole('button', { name: 'Merge into Main' }));
  await bar().filter({ hasText: 'Merged into Main' }).waitFor();
  await pause(1800);

  await chapter(
    'Plan in your own change request',
    'Next: plan new work in your own change request',
  );
  await page.goto(`/projects/${pid}/graph`);
  await hydrated();
  await click(head().getByRole('button', { name: 'New change request' }));
  await type(page.locator('.m-card').getByLabel('Name'), 'Plan the CRS release');
  await click(page.locator('.m-card').getByRole('button', { name: 'Create', exact: true }));
  await page.waitForURL(/\/changes\/\d+$/);
  await hydrated();
  const mine = Number(page.url().split('/').pop());
  await say('Add a new work item to the Queue', 1200);
  await click(crSide.getByRole('button', { name: /^Queue/ }));
  await click(crSide.getByRole('button', { name: 'Add', exact: true }));
  const add = page.getByRole('dialog', { name: 'Add to the queue' });
  const wiTab = add.getByRole('button', { name: 'Work item', exact: true });
  if (await wiTab.count()) await click(wiTab);
  await type(add.getByLabel('Name'), 'CRS release checklist');
  await type(add.getByLabel('Note'), 'Steps for the go-live day');
  await choose(add.getByLabel('Done by', { exact: true }).first(), (t) => t.includes('Lan Phạm'));
  await type(add.getByLabel('Planned finish'), '23 Oct 2026');
  await add.getByLabel('Planned finish').press('Tab');
  await shot('add-work-item');
  await click(add.getByRole('button', { name: 'Add work item' }));
  await toastSays('Added to the queue');
  await say('Drag the work item from the Queue onto a team', 1200);
  await drag(
    page.locator('[data-qitem]', { hasText: 'CRS release checklist' }),
    page.locator('svg.pg rect.lane-drop').first(),
  );
  await toastSays('CRS release checklist: placed');
  await pause(1400);
  await shot('placed');
  await say('Log an event on the row: Add an event in the details', 1200);
  await clickShape(row('CRS release checklist'));
  await drawer.waitFor();
  await click(drawer.getByRole('button', { name: 'Add an event' }));
  const ev = page.getByRole('dialog', { name: 'Add an event' });
  await click(ev.getByRole('button', { name: 'Meeting', exact: true }));
  await type(ev.getByRole('textbox').first(), 'Release call with Larkspur: checklist agreed.');
  await click(ev.getByRole('button', { name: 'Add event' }));
  await toastSays('added');
  await pause(1400);
  await say('Move the planned finish: the app asks for a reason and keeps the history', 1400);
  await type(drawer.getByLabel('Planned finish'), '27 Oct 2026');
  await drawer.getByLabel('Planned finish').press('Tab');
  await type(
    drawer.getByLabel(/Why does the date move/),
    'Larkspur asked for one more review round.',
  );
  await click(drawer.getByRole('button', { name: 'Move the date' }));
  await toastSays('planned finish moved');
  await pause(900);
  await say('Open Date moves: the reason is kept with the move', 1200);
  await click(drawer.getByRole('button', { name: /Date moves/ }));
  const reason = drawer.getByText('Larkspur asked for one more review round.').first();
  await reason.waitFor();
  await circle(reason, 2000);
  await pause(1600);
  await shot('date-move');
  await page.keyboard.press('Escape');
  await say('Add a new milestone on the time axis', 1200);
  await click(page.getByRole('button', { name: /New milestone/ }).first());
  const ms = page.getByRole('dialog', { name: 'New milestone' });
  await type(ms.getByLabel('Name'), 'CRS release');
  await type(ms.getByLabel('Planned date'), '28 Oct 2026');
  await ms.getByLabel('Planned date').press('Tab');
  await click(ms.getByRole('checkbox', { name: /CRS release checklist/ }));
  await click(ms.getByRole('button', { name: 'Create milestone' }));
  await toastSays('CRS release: added');
  await pause(1600);
  await say('The Changes tab lists every change; each line can be removed', 1200);
  await click(crSide.getByRole('button', { name: /^Changes/ }));
  await pause(2600);
  await shot('changes');

  await chapter('An AI agent over MCP', 'Next: your own AI agent works in the project through MCP');
  await say('An agent connects with a token that has the rights you pick', 1200);
  await click(nav('Settings'));
  await page.waitForURL(/settings/);
  await hydrated();
  await type(page.getByLabel('Label'), 'My agent');
  await say('Create token: the secret shows once (blurred in this video)', 1200);
  await click(page.getByRole('button', { name: 'Create token' }));
  await click(page.getByRole('button', { name: 'Copy secret' }));
  const token = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  await pause(1500);
  await shot('token');
  await click(page.getByRole('button', { name: 'I copied it, hide the secret' }));
  await say('The box on the right is the MCP setup to paste into the agent', 1200);
  await circle(page.getByText('Connect your agent').first(), 1800);
  await page.goto(`/projects/${pid}/changes/${mine}`);
  await hydrated();
  await click(crSide.getByRole('button', { name: /^Queue/ }));
  await click(crSide.getByRole('button', { name: /^Events/ }));
  await say(
    'The agent sends a note to the Queue. The screen never changes under your hands.',
    2600,
  );
  await rpc(token, 'add_queue_event', {
    kind: 'message',
    at: new Date().toISOString(),
    text: 'Agent: Larkspur confirmed the CRS checklist by email.',
  });
  await say(
    'The app checks for news every 5 minutes, and at once when you come back to the tab',
    2800,
  );
  // A headless tab never hides, so the tour plays the return to the tab.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const fresh = bar().locator('.fresh');
  await fresh.waitFor({ timeout: 10000 });
  await say('The bar says "The Queue changed · Refresh", like a pull request page', 1200);
  await circle(fresh, 1800);
  await shot('refresh-notice');
  await click(fresh.getByRole('button', { name: 'Refresh' }));
  const agentNote = page.locator('[data-qevent]', { hasText: 'Larkspur confirmed' }).first();
  await agentNote.waitFor();
  await say("After Refresh, the agent's note is in the Queue", 1200);
  await circle(agentNote, 2200);
  await pause(800);
  await shot('agent-event');

  await chapter('Merge the plan', 'Next: put the plan into Main');
  await say('Mark as ready locks the change request for review', 1200);
  await click(bar().getByRole('button', { name: 'Mark as ready' }));
  await bar().filter({ hasText: 'Ready to merge' }).waitFor();
  await pause(900);
  await click(bar().getByRole('button', { name: 'Merge into Main' }));
  await bar().filter({ hasText: 'Merged into Main' }).waitFor();
  await say('Merged. Main now shows the new plan.', 1400);
  await page.goto(`/projects/${pid}/graph`);
  await hydrated();
  await clickShape(row('CRS release checklist'));
  await pause(2600);
  await shot('main-after-merge');
  await page.keyboard.press('Escape');

  await chapter('Members and teams', 'Next: the people of the project');
  await click(nav('Members'));
  await page.waitForURL(/members$/);
  await hydrated();
  await say("The Members page manages each person's rights", 1200);
  await circle(page.getByRole('columnheader', { name: 'Merge' }).first(), 1600);
  await pause(600);
  await say(
    'and the teams with their leads. This demo has no sign-in, so it invites nobody.',
    1200,
  );
  await circle(page.getByRole('heading', { name: /^Teams/ }).first(), 1600);
  await pause(1200);
  await shot('members');

  await chapter('New project', 'Next: start a project of your own');
  await say('The project menu: + New project', 1200);
  const sw = page.locator('details.proj-switch');
  await click(sw.locator('summary'));
  await click(sw.getByRole('button', { name: '+ New project' }));
  const create = page.getByRole('dialog', { name: 'New project' });
  await type(create.getByLabel('Project name'), 'Website relaunch');
  await type(create.getByLabel('Client'), 'Acme Coffee');
  await type(create.getByLabel('First milestone (optional)'), 'Beta launch');
  await type(create.getByLabel('Milestone date'), '6 Nov 2026');
  await create.getByLabel('Milestone date').press('Tab');
  await pause(600);
  await shot('new-project');
  await click(create.getByRole('button', { name: 'Create project' }));
  await page.waitForURL((u) => !u.href.includes(pid) && /\/graph$/.test(u.pathname));
  await hydrated();
  await say('The new project has its teams and first milestone; the graph is empty', 2600);
  await click(sw.locator('summary'));
  await pause(1200);
  await click(
    sw
      .getByRole('link', { name: /Larkspur/ })
      .or(sw.getByRole('button', { name: /Larkspur/ }))
      .first(),
  );
  await page.waitForURL(new RegExp(pid));
  await hydrated();

  await chapter('Profile', 'Next: your profile, your photo and a personal key');
  const menu = page.locator('details.acct.me');
  await click(menu.locator('summary'));
  await say('The account menu: Profile, theme, About this demo and Start over', 1400);
  await click(menu.getByRole('link', { name: 'Profile' }));
  await page.waitForURL(/\/profile$/);
  await hydrated();
  // A server without photo storage shows initials only, so the tour skips the photo there.
  const upload = page.getByRole('button', { name: 'Upload photo' });
  if (await upload.count()) {
    await click(upload);
    const photo = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="256" cy="200" r="92" fill="#fff" opacity=".92"/><path d="M96 470c20-110 90-160 160-160s140 50 160 160z" fill="#fff" opacity=".92"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    await page
      .getByLabel('Photo file')
      .setInputFiles({ name: 'minh.png', mimeType: 'image/png', buffer: photo });
    const dialog = page.getByRole('dialog', { name: 'Upload a photo' });
    await dialog.locator('.pf-face img').waitFor();
    await say('Upload a photo: PNG, JPEG or WebP under 5 MB', 1200);
    await click(dialog.getByRole('button', { name: 'Save photo' }));
    await dialog.waitFor({ state: 'detached' });
    await say('The photo shows on Profile, in the account menu and on Members', 2400);
    await shot('profile-photo');
  }
  await say('A personal key lets your agent work in every project you belong to', 2400);
  await type(page.getByLabel('Label'), 'Laptop agent');
  await click(page.getByRole('button', { name: 'Create key' }));
  await page.getByRole('button', { name: 'Copy secret' }).waitFor();
  await pause(1600);
  await click(page.getByRole('button', { name: 'I copied it, hide the secret' }));
  await say('Revoke stops a key at once', 1200);
  await click(page.getByRole('button', { name: 'Revoke' }).first());
  await click(page.getByRole('button', { name: 'Confirm revoke' }).first());
  await page
    .getByText(/Revoked/)
    .first()
    .waitFor();
  await pause(1400);
  await shot('personal-key');

  await chapter('Start over', 'Last: start again with a fresh copy');
  await page.goto(`/projects/${pid}/graph`);
  await hydrated();
  await click(menu.locator('summary'));
  await say('Start over drops this copy and opens a fresh Larkspur project. It asks first.', 1400);
  await click(menu.getByRole('button', { name: 'Start over' }));
  const sure = page.getByRole('dialog').filter({ hasText: 'Start over?' });
  await sure.waitFor();
  await pause(1800);
  await click(sure.getByRole('button', { name: 'Start over' }));
  await page.waitForURL((u) => /\/graph$/.test(u.pathname) && !u.href.includes(pid));
  await hydrated();
  await say('That is the whole tour. Thank you for watching.', 3200);
  await shot('start-over');
  console.log(JSON.stringify({ ok: true, problems }));
} catch (e) {
  await page.screenshot({ path: `${SHOTS}/zz-failure.png` }).catch(() => {});
  console.log(
    JSON.stringify({
      ok: false,
      error: String(e.stack || e)
        .split('\n')
        .slice(0, 6)
        .join('\n'),
      problems,
    }),
  );
} finally {
  await ctx.close().catch(() => {});
  await browser.close();
  const raw = await page
    .video()
    ?.path()
    .catch(() => null);
  const mp4 = path.join(OUT, 'demo-day-du-tinh-nang.mp4');
  const r = raw
    ? spawnSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        raw,
        '-vf',
        'fps=25,setsar=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '22',
        '-movflags',
        '+faststart',
        mp4,
      ])
    : { status: 1 };
  writeFileSync(path.join(OUT, 'chapters.json'), JSON.stringify(chapters, null, 1));
  if (r.status === 0) {
    rmSync(RAW, { recursive: true, force: true });
    console.log(`VIDEO ${mp4}`);
  } else console.log(`VIDEO failed; the clip stays in ${RAW}`);
}
