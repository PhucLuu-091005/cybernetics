// Scripted QA checks per area. Run from the QA worktree root:
//   node .claude/skills/et-qa/scripts/checks.mjs --base http://localhost:<port> --out <dir> [--areas auth,shell,...]
//   add --demo for a server in demo mode, --tag live for the deployed app, --append to keep earlier results,
//   --video <dir> for one video of the whole run.
// Writes <out>/results.json and <out>/checks/*.png. Exit code 1 when a check fails.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(
  pathToFileURL(path.resolve('node_modules/@playwright/test/index.mjs')).href
);

export const AREAS = [
  'auth',
  'shell',
  'project',
  'graph',
  'cr',
  'collab',
  'members',
  'settings',
  'access',
  'api',
  'phone',
  'mcp',
  'profile',
  'fresh',
  'visitor',
];
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base');
const out = arg('out');
if (!base || !out) {
  console.error('usage: checks.mjs --base <url> --out <dir> [--areas a,b]');
  process.exit(2);
}
if (['3100', '3200', '3310'].includes(new URL(base).port)) {
  console.error('that port belongs to the owner; use the server from env.sh');
  process.exit(2);
}
const demo = process.argv.includes('--demo');
const tag = arg('tag', '');
const live = tag === 'live';
const areas = arg('areas', AREAS.filter((a) => a !== 'visitor').join(','))
  .split(',')
  .filter(Boolean);
for (const a of areas) if (!AREAS.includes(a)) throw new Error(`unknown area ${a}; use ${AREAS}`);
// --video records every page with the running check written on it, then joins the clips into one file.
const videoDir = arg('video');
const clips = [];
let caption = '';
const shots = path.join(out, 'checks');
mkdirSync(shots, { recursive: true });
// Local sign-in labels allow a-z, 0-9 and "-" only; anything else silently signs in as "dev".
const run = Date.now().toString(36);
const label = (what) => `qa-${what}-${run}`;

const browser = await chromium.launch();
const results = [];
// HTTP failures show up as statuses in the checks; a negative test expects some of them.
const NOISE =
  /was preloaded using link preload|Download the React DevTools|Failed to load resource/;

async function newPage(opts = {}) {
  const size = opts.viewport ?? { width: 1440, height: 900 };
  const ctx = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    ...opts,
    ...(videoDir ? { recordVideo: { dir: path.join(videoDir, 'raw'), size } } : {}),
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  if (videoDir) await recordCaptions(ctx);
  // The first visit of a demo copy opens an intro card over the app; a check closes it as a visitor would.
  ctx.on('page', (p) =>
    p
      .addLocatorHandler(
        p.getByRole('dialog').filter({ hasText: 'Pull requests for a project plan' }),
        (d) => d.getByRole('button', { name: 'Explore the demo' }).click(),
      )
      .catch(() => {}),
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text()))
      page.errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  return page;
}
async function recordCaptions(ctx) {
  await ctx.exposeBinding('qaCaption', () => caption);
  // A closed shadow root keeps the caption out of getByText, and the body is React's only after hydration.
  await ctx.addInitScript(() => {
    addEventListener('load', async () => {
      const host = document.createElement('qa-caption');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText =
        'position:fixed;left:0;right:0;bottom:10px;z-index:2147483647;pointer-events:none;display:none;justify-content:center';
      const box = document.createElement('div');
      box.style.cssText =
        'max-width:92%;padding:6px 14px;border-radius:8px;background:rgba(17,24,39,.86);color:#fff;font:600 14px/1.35 system-ui,sans-serif;text-align:center';
      host.attachShadow({ mode: 'closed' }).appendChild(box);
      document.body.appendChild(host);
      // A video must not show a working secret.
      const veil = document.createElement('style');
      veil.textContent = '[data-testid="token-secret"]{filter:blur(8px)}';
      document.head.appendChild(veil);
      window.__qaSay = (t) => {
        box.textContent = t;
        host.style.display = t ? 'flex' : 'none';
      };
      window.__qaSay(await window.qaCaption());
    });
  });
  ctx.on('page', (page) => {
    const clip = { page, at: Date.now(), moved: false };
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) clip.moved = true;
    });
    clips.push(clip);
  });
}
async function say(text) {
  caption = text;
  await Promise.all(
    clips
      .filter((c) => !c.page.isClosed())
      .map((c) => c.page.evaluate((t) => window.__qaSay?.(t), text).catch(() => {})),
  );
}
// The fold button stays disabled until React hydrates; on a phone it exists but is hidden.
const hydrated = (page) =>
  page.waitForFunction(
    () => {
      const b = document.querySelector('button[aria-label$="sidebar"]');
      return b && !b.disabled;
    },
    null,
    { timeout: 30000 },
  );
// In demo mode every new browser context is a new visitor with a new copy of Larkspur.
async function signIn(page, who) {
  if (demo) await page.goto('/');
  else {
    await page.goto(`/signin?label=${who}`);
    await page.getByRole('button', { name: /continue/i }).click();
  }
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
  await hydrated(page);
  return page.url().split('/')[4];
}
async function tracker(page, pid) {
  const r = await page.request.get(`/api/v1/projects/${pid}/tracker`);
  return r.json();
}
/** Centre of the part of an element that its scrolling parents show. */
async function visibleCentre(loc) {
  return loc.evaluate((el) => {
    let { left, top, right, bottom } = el.getBoundingClientRect();
    for (let up = el.parentElement; up; up = up.parentElement) {
      const s = getComputedStyle(up);
      if (!/auto|scroll|hidden/.test(s.overflowX + s.overflowY)) continue;
      const r = up.getBoundingClientRect();
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  });
}
async function drag(page, from, to) {
  await to.scrollIntoViewIfNeeded().catch(() => {});
  await from.scrollIntoViewIfNeeded();
  const a = await visibleCentre(from);
  const b = await visibleCentre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 8, a.y + 8, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}
/** SVG groups with long labels have a centre that misses the shape; click the shape itself. */
async function clickShape(page, loc) {
  const shape = loc.locator('circle, rect, path, polygon').first();
  // The pinned axis copies the sideways scroll of the rows and cannot scroll itself, so fit the time line.
  const pinned = await loc.evaluate((el) => !!el.closest('svg.pg-top-time'));
  const fit = page.getByRole('button', { name: 'Fit to width' });
  if (pinned && (await fit.isEnabled())) await fit.click();
  else await shape.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await page.waitForTimeout(200);
  const box = await shape.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
/**
 * Picks an option in a native select or in the app's Select combobox, by { label }, { index } or a
 * value string that the option text contains.
 */
async function pick(control, option) {
  const field = control.first();
  if ((await field.evaluate((e) => e.tagName)) === 'SELECT') return field.selectOption(option);
  await field.click();
  const list = field.page().locator(`[id="${await field.getAttribute('aria-controls')}"]`);
  const opts = list.getByRole('option');
  if (typeof option === 'object' && 'index' in option) return opts.nth(option.index).click();
  const want = typeof option === 'string' ? option : option.label;
  const texts = (await opts.allInnerTexts()).map((t) => t.trim());
  let i = texts.indexOf(want);
  if (i < 0) i = texts.findIndex((t) => t.toLowerCase().includes(want.toLowerCase()));
  if (i < 0) throw new Error(`no option "${want}" in: ${texts.join(' | ')}`);
  await opts.nth(i).click();
}
const selectIn = (scope) => scope.locator('select, [role="combobox"]');
async function actAs(page, name) {
  await pick(page.getByLabel('Demo: act as'), { label: name });
  await page.locator(`details.acct summary[aria-label^="${name}"]`).waitFor();
  await page.waitForTimeout(600);
}
async function crOps(page, pid, num) {
  return (await tracker(page, pid)).crs.find((c) => c.num === num).ops.map((o) => o.op);
}
async function waitOps(page, pid, num, test, what) {
  for (let i = 0; i < 20; i++) {
    const ops = await crOps(page, pid, num);
    if (test(ops)) return ops;
    await page.waitForTimeout(250);
  }
  throw new Error(`${what}: ops are ${(await crOps(page, pid, num)).join(',')}`);
}
/** React may reset a controlled input that was filled before hydration ends, so fill until it sticks. */
async function fillStable(loc, value) {
  for (let i = 0; i < 10; i++) {
    await loc.fill(value);
    await loc.page().waitForTimeout(150);
    if ((await loc.inputValue()) === value) return;
  }
  throw new Error(`could not fill ${value}`);
}
/** Adds a Queue event to a work item with the click way, which needs no visible row. */
async function addQueueEventByClick(page, text, workItem) {
  const side = page.locator('.cr-side');
  await side.getByRole('button', { name: /^Queue/ }).click();
  await side.getByRole('button', { name: /^Events/ }).click();
  await page.locator('[data-qevent]', { hasText: text }).first().click();
  const d = page.getByRole('dialog', { name: 'Add this event to a work item' });
  await pick(selectIn(d).first(), { label: workItem });
  await d.getByRole('button', { name: 'Add to work item' }).click();
  await d.waitFor({ state: 'detached' });
}
const scrollX = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const changeCount = async (page) =>
  Number(((await page.locator('.bbar').first().innerText()).match(/(\d+) changes?/) || [0, 0])[1]);

let current;
async function check(area, name, fn, page) {
  const t0 = Date.now();
  const entry = {
    area: tag ? `${tag} ${area}` : area,
    name,
    status: 'pass',
    note: '',
    shot: null,
    ms: 0,
  };
  if (videoDir) {
    entry.clipAt = t0;
    await say(`${entry.area} · ${name}`);
  }
  try {
    const note = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 60 s')), 60000)),
    ]);
    if (typeof note === 'string') entry.note = note;
    if (note && typeof note === 'object') Object.assign(entry, note);
  } catch (e) {
    entry.status = 'fail';
    entry.note = String(e.message || e)
      .split('\n')[0]
      .slice(0, 300);
  }
  const p = page ?? current;
  if (videoDir) {
    await say(`${entry.status === 'pass' ? '✓' : '✗ FAIL'} ${entry.area} · ${name}`);
    await new Promise((r) => setTimeout(r, 500));
    entry.clipPage = clips.findIndex((c) => c.page === p);
    entry.clipEnd = Date.now();
    await p?.evaluate(() => window.__qaSay?.('')).catch(() => {});
  }
  if (p && !p.isClosed()) {
    const file = `${tag ? `${tag}-` : ''}${area}-${String(results.length + 1).padStart(3, '0')}.png`;
    // The default caret: 'hide' injects a style, and on a page that still hydrates React reports it as a mismatch.
    await p.screenshot({ path: path.join(shots, file), caret: 'initial' }).catch(() => {});
    entry.shot = `checks/${file}`;
  }
  entry.ms = Date.now() - t0;
  results.push(entry);
  console.log(
    `${entry.status === 'pass' ? 'ok  ' : 'FAIL'} ${area}: ${name}${entry.note ? ' — ' + entry.note : ''}`,
  );
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function errorsCheck(area, page) {
  await check(
    area,
    'no page or console errors',
    async () => {
      expect(!page.errors.length, page.errors.slice(0, 3).join(' | '));
    },
    page,
  );
}

const suites = {
  async auth() {
    const page = (current = await newPage());
    await check('auth', 'signed-out root and project links go to /signin', async () => {
      await page.goto('/');
      expect(page.url().endsWith('/signin'), `root went to ${page.url()}`);
      await page.goto('/projects/00000000-0000-0000-0000-000000000000/graph');
      expect(/\/signin/.test(page.url()), `project link went to ${page.url()}`);
      return page.url().includes('next=')
        ? ''
        : 'the original link is lost after sign-in (no return URL)';
    });
    await check('auth', 'API without a session answers 401, health answers ok', async () => {
      const r = await page.request.get('/api/v1/projects');
      expect(r.status() === 401, `API status ${r.status()}`);
      const h = await page.request.get('/api/health');
      expect(h.status() === 200, `health ${h.status()}`);
    });
    await check('auth', 'Continue creates the Larkspur sandbox and opens its graph', async () => {
      await signIn(page, label('auth'));
      await page.locator('svg.pg').waitFor();
    });
    await check('auth', 'Sign out returns to /signin', async () => {
      await page.locator('details.acct summary').click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.waitForURL(/\/signin$/);
    });
    await errorsCheck('auth', page);
  },

  async shell() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('shell'));
    await check(
      'shell',
      'project switcher opens, lists the project and closes on Esc',
      async () => {
        await page.locator('details.proj-switch summary').click();
        await page.getByRole('button', { name: '+ New project' }).waitFor();
        await page.keyboard.press('Escape');
        expect(!(await page.locator('details.proj-switch').evaluate((d) => d.open)), 'still open');
      },
    );
    await check('shell', 'view selector lists Main and the open change requests', async () => {
      await page.locator('.bbar .gpick > summary').click();
      const text = await page.locator('.bbar .gpick').innerText();
      expect(/Main/.test(text) && /#\d/.test(text), text.slice(0, 120));
      await page.keyboard.press('Escape');
    });
    await check('shell', 'theme Dark sticks after a reload, then System', async () => {
      await page.locator('details.acct summary').click();
      await page.getByRole('radio', { name: 'Dark' }).click();
      await page.reload();
      await hydrated(page);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.locator('details.acct summary').click();
      await page.getByRole('radio', { name: 'System' }).click();
      await page.keyboard.press('Escape');
      expect(theme === 'dark', `data-theme=${theme}`);
    });
    await check('shell', 'rail folds, stays folded after a reload, opens again', async () => {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await page.reload();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await page.getByRole('button', { name: 'Collapse sidebar' }).waitFor();
    });
    await check('shell', 'Demo act as switches the person', async () => {
      await actAs(page, 'Lan Phạm');
      await page.locator('details.acct summary[aria-label^="Lan Phạm"]').waitFor();
      await actAs(page, 'Minh Trần');
    });
    await check('shell', 'rail links open Members, Settings and Graph', async () => {
      const nav = page.getByRole('navigation', { name: 'Project' });
      for (const [link, url] of [
        ['Members', /members$/],
        ['Settings', /settings\/tokens$/],
        ['Graph', /graph$/],
      ]) {
        await nav.getByRole('link', { name: link }).click();
        await page.waitForURL(url);
      }
    });
    await check('shell', 'every page has one main landmark for screen readers', async () => {
      const missing = [];
      for (const p of ['graph', 'changes/11', 'members', 'settings/tokens']) {
        // A client route change that is still in flight aborts a goto; the second goto is the test.
        await page.goto(`/projects/${pid}/${p}`).catch(() => page.goto(`/projects/${pid}/${p}`));
        await hydrated(page);
        if ((await page.locator('main, [role="main"]').count()) !== 1) missing.push(p);
      }
      await page.goto(`/projects/${pid}/graph`);
      await hydrated(page);
      expect(!missing.length, `no main landmark on: ${missing.join(', ')}`);
    });
    await check(
      'shell',
      'the first Tab shows Skip to content, and Enter moves into main',
      async () => {
        await page.locator('body').focus();
        await page.keyboard.press('Tab');
        const link = await page.evaluate(() => document.activeElement.textContent.trim());
        await page.keyboard.press('Enter');
        const inMain = await page.evaluate(() => !!document.activeElement.closest('main'));
        expect(
          link === 'Skip to content' && inMain,
          `first Tab: "${link}", focus in main: ${inMain}`,
        );
      },
    );
    await errorsCheck('shell', page);
  },

  async graph() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('graph'));
    const rows = () => page.locator('svg.pg [data-loop]').count();
    const note = page.getByRole('note', { name: 'Main is read-only' });
    await check('graph', "notice: × closes for now, Don't show again keeps it closed", async () => {
      await note.getByRole('button', { name: 'Close the notice' }).click();
      await page.reload();
      await hydrated(page);
      await page.waitForTimeout(1200);
      expect((await note.count()) === 1, 'notice did not come back after × and a reload');
      await note.getByRole('button', { name: "Don't show again" }).click();
      await page.reload();
      await hydrated(page);
      await page.waitForTimeout(1200);
      expect((await note.count()) === 0, "notice came back after Don't show again");
    });
    await check(
      'graph',
      'Main is read-only: no Queue panel, no edit buttons in the details',
      async () => {
        expect((await page.locator('.p-side').count()) === 0, 'Queue panel on Main');
        const search = page.getByRole('combobox', { name: 'Search work items' });
        await search.fill('PG-203');
        await page.keyboard.press('Enter');
        const d = page.locator('.drawer');
        await d.waitFor();
        for (const name of ['Add an event', 'Mark done', 'Move the date'])
          expect((await d.getByRole('button', { name }).count()) === 0, `${name} on Main`);
        expect((await d.locator('select, input, textarea').count()) === 0, 'inputs on Main');
        const txt = await d.innerText();
        await page.keyboard.press('Escape');
        return /\b(Late)\s+late\b/i.test(txt.replace(/\n/g, ' '))
          ? 'status text repeats: "Late late …"'
          : '';
      },
    );
    await check(
      'graph',
      'search lists matches, Enter opens the details, no match says so',
      async () => {
        const search = page.getByRole('combobox', { name: 'Search work items' });
        await search.fill('pg-20');
        const n = await page.getByRole('listbox').getByRole('option').count();
        expect(n >= 3, `${n} options`);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.locator('.drawer').waitFor();
        await page.keyboard.press('Escape');
        await search.fill('zzzz-nothing');
        await page.getByText('No work item matches.').waitFor();
        await search.fill('');
      },
    );
    await check('graph', 'filters narrow the rows and Clear filters restores them', async () => {
      const all = await rows();
      await page.locator('summary[aria-label^=Filters]').click();
      const fp = page.getByRole('group', { name: 'Filter the graph' });
      await fp.getByRole('checkbox', { name: 'Late', exact: true }).check();
      const late = await rows();
      await fp.getByRole('button', { name: 'Clear filters' }).click();
      const back = await rows();
      await page.keyboard.press('Escape');
      expect(late < all && back === all, `rows ${all} → ${late} → ${back}`);
    });
    await check(
      'graph',
      'History and Change requests open; the badge counts ready CRs',
      async () => {
        const head = page.locator('.p-head');
        await head.getByRole('button', { name: 'History' }).click();
        await page.locator('.drawer', { hasText: 'Main history' }).waitFor();
        await page.keyboard.press('Escape');
        const ready = (await tracker(page, pid)).crs.filter((c) => c.status === 'ready').length;
        await head
          .getByRole('button', { name: `Change requests, ${ready} ready to merge` })
          .click();
        await page.locator('.drawer', { hasText: 'Change requests' }).waitFor();
        await page.keyboard.press('Escape');
      },
    );
    await check('graph', 'focus a team, Esc leaves the focus', async () => {
      // Teams can be folded, so count the team heads rather than the rows.
      const heads = () =>
        page
          .locator('svg.pg-side')
          .getByRole('button', { name: /\d+ work items?:/ })
          .count();
      const all = await heads();
      const name = (
        await page
          .locator('svg.pg-side')
          .getByRole('button', { name: /\d+ work items?:/ })
          .nth(1)
          .getAttribute('aria-label')
      ).split(',')[0];
      await page
        .locator('svg.pg-side')
        .getByRole('button', { name: `Focus on ${name}`, exact: true })
        .click();
      const f = await heads();
      await page.keyboard.press('Escape');
      expect(f < all && (await heads()) === all, `team heads ${all} → ${f} → ${await heads()}`);
    });
    await check('graph', 'hide a row and a team, then Unhide all from the badge', async () => {
      const all = await rows();
      const side = page.locator('svg.pg-side');
      await side
        .getByRole('button', { name: /^Hide / })
        .nth(1)
        .click();
      await side
        .getByRole('button', { name: /^Hide / })
        .last()
        .click();
      await page.getByText(/\d+ hidden/).click();
      await page.getByRole('button', { name: 'Unhide all' }).click();
      expect((await rows()) === all, `rows ${all} → ${await rows()}`);
    });
    await check(
      'graph',
      'zoom in widens the time line; Fit; Full view hides the rail and Esc leaves',
      async () => {
        const w = () => page.locator('svg.pg').evaluate((s) => s.getBoundingClientRect().width);
        const w0 = await w();
        await page.getByRole('button', { name: 'Zoom in' }).click();
        expect((await w()) > w0, 'zoom in did not widen');
        const fit = page.getByRole('button', { name: 'Fit to width' });
        if (await fit.isEnabled()) await fit.click();
        await page.getByRole('button', { name: 'Full view' }).click();
        await page.waitForTimeout(400);
        const rail = await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label=Project]');
          const r = nav.getBoundingClientRect();
          return r.width > 0 && nav.contains(document.elementFromPoint(r.left + 20, r.top + 20));
        });
        await page.keyboard.press('Escape');
        expect(!rail, 'rail still shows in full view');
      },
    );
    await check('graph', 'an event and a milestone open their pops', async () => {
      await clickShape(page, page.locator('svg.pg [data-act]').first());
      await page.locator('.pop').waitFor();
      await page.keyboard.press('Escape');
      await clickShape(page, page.locator('svg.pg-top-time [data-ms]').first());
      await page.locator('.pop, .drawer').first().waitFor();
      const txt = (await page.locator('.pop, .drawer').first().innerText()).replace(/\n/g, ' ');
      await page.keyboard.press('Escape');
      return /\bLate\s+late\b/i.test(txt) ? 'status text repeats: "Late late …"' : '';
    });
    const viewMenu = async () => {
      const btn = page.getByRole('button', { name: 'Row height and teams' });
      if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
      return page.locator(`#${await btn.getAttribute('aria-controls')}`);
    };
    await check('graph', 'Expand all opens every team, Collapse all folds them', async () => {
      let menu = await viewMenu();
      await menu.getByRole('button', { name: 'Collapse all' }).click();
      const folded = await rows();
      menu = await viewMenu();
      await menu.getByRole('button', { name: 'Expand all' }).click();
      const open = await rows();
      expect(folded === 0 && open > folded, `rows: collapsed ${folded}, expanded ${open}`);
    });
    await check(
      'graph',
      'focus a work item, move the focus to its parent, Leave focus',
      async () => {
        const all = await rows();
        await page
          .locator('svg.pg-side')
          .getByRole('button', { name: 'Focus on PG-201 CRS form logic', exact: true })
          .click();
        const panel = page.locator('.drawer', {
          has: page.getByRole('heading', { name: 'Focus' }),
        });
        await panel.getByRole('button', { name: /focus on it instead/ }).click();
        await panel.getByText('CRS tax residency section', { exact: false }).first().waitFor();
        await panel.getByRole('button', { name: 'Leave focus' }).click();
        await panel.waitFor({ state: 'detached' });
        expect((await rows()) === all, `rows ${all} → ${await rows()}`);
      },
    );
    await check('graph', 'Focus and Leave focus in the work item details', async () => {
      const all = await rows();
      const details = page.locator('.drawer', { has: page.locator('.wi-view') });
      await page.getByRole('combobox', { name: 'Search work items' }).fill('PG-203');
      await page.keyboard.press('Enter');
      await details
        .getByRole('button', { name: 'Focus on PG-203 Country list field type', exact: true })
        .click();
      await page
        .locator('.drawer', { has: page.getByRole('heading', { name: 'Focus' }) })
        .waitFor();
      const focused = await rows();
      await page.locator('svg.pg-side rect.label-hit[data-rowlabel="pg203"]').click();
      const leave = details.getByRole('button', {
        name: 'Leave focus on PG-203 Country list field type',
        exact: true,
      });
      const pressed = await leave.getAttribute('aria-pressed');
      await leave.click();
      await page.waitForTimeout(400);
      const back = await rows();
      await page.keyboard.press('Escape');
      expect(
        focused < all && back === all && pressed === 'true',
        `rows ${all} → ${focused} → ${back}, Leave focus pressed=${pressed}`,
      );
    });
    await check(
      'graph',
      'row height Comfortable, Compact and Dense change the graph height',
      async () => {
        const menu = await viewMenu();
        const h = () => page.locator('svg.pg').evaluate((el) => el.getBoundingClientRect().height);
        const sizes = {};
        for (const name of ['Comfortable', 'Dense', 'Compact']) {
          await menu.getByRole('button', { name, exact: true }).click();
          await page.waitForTimeout(300);
          sizes[name] = await h();
        }
        await page.keyboard.press('Escape');
        expect(
          sizes.Comfortable > sizes.Compact && sizes.Compact > sizes.Dense,
          JSON.stringify(sizes),
        );
      },
    );
    await check('graph', 'a handoff mark with several receivers lists them and jumps', async () => {
      const mark = page.locator('svg.pg [data-handoff][aria-label*="handoffs from"]').first();
      await clickShape(page, mark);
      const list = page.getByLabel(/^Handoffs from/).first();
      await list.waitFor();
      const n = await list.locator('button').count();
      expect(n >= 2, `${n} entries`);
      await list.locator('button').first().click();
      await page.waitForTimeout(400);
      expect((await list.count()) === 0, 'the list stays open after a pick');
    });
    await check('graph', 'a window resize closes an open handoff list', async () => {
      await page.goto(`/projects/${pid}/graph`);
      await hydrated(page);
      const mark = page.locator('svg.pg [data-handoff][aria-label*="handoffs from"]').first();
      await clickShape(page, mark);
      const list = page.getByLabel(/^Handoffs from/).first();
      await list.waitFor();
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForTimeout(400);
      const open = await list.count();
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(open === 0, 'the list stays open after a resize');
    });
    await check('graph', 'Ctrl and the wheel zoom the time line', async () => {
      const w = () => page.locator('svg.pg').evaluate((el) => el.getBoundingClientRect().width);
      const w0 = await w();
      // Playwright's wheel does not carry the Ctrl key, so send the event the browser would send.
      await page.locator('svg.pg').evaluate((el) =>
        el.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -300,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            clientX: 700,
            clientY: 400,
          }),
        ),
      );
      await page.waitForTimeout(400);
      expect((await w()) > w0, `${w0} → ${await w()}`);
    });
    await check('graph', 'Zoom out narrows the time line again', async () => {
      const w = () => page.locator('svg.pg').evaluate((el) => el.getBoundingClientRect().width);
      const w0 = await w();
      await page.getByRole('button', { name: 'Zoom out' }).click();
      expect((await w()) < w0, `${w0} → ${await w()}`);
    });
    await check(
      'graph',
      'Date moves in the details lists the first date, the move and its reason',
      async () => {
        await page.getByRole('combobox', { name: 'Search work items' }).fill('Go-live date');
        await page.keyboard.press('Enter');
        const d = page.locator('.drawer');
        await d.getByRole('button', { name: /Date moves/ }).click();
        await d
          .getByText(/^\d+ \w+ → \d+ \w+$/)
          .first()
          .waitFor();
        await d.getByText(/^First planned \d+ \w+ · moved \d+×$/).waitFor();
        await page.keyboard.press('Escape');
      },
    );
    await check('graph', 'the legend lists every event kind of the model', async () => {
      // The kinds change between releases, so read them from the model of the build under test.
      const { readFileSync: rf } = await import('node:fs');
      const block = rf('src/tracker/model.ts', 'utf8').match(/KIND_LABEL[^{]*\{([^}]*)\}/)[1];
      const kinds = [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
      const text = await page.getByLabel('Event kinds').first().innerText();
      const missing = kinds.filter((k) => !text.includes(k));
      expect(kinds.length >= 8 && !missing.length, `kinds ${kinds.length}, missing: ${missing}`);
    });
    await check('graph', 'Close legend hides it and the Legend button opens it again', async () => {
      const pop = page.getByRole('dialog', { name: 'Legend' });
      await pop.getByRole('button', { name: 'Close legend' }).click();
      await pop.waitFor({ state: 'detached' });
      const toggle = page.getByRole('button', { name: 'Legend', exact: true });
      expect((await toggle.getAttribute('aria-expanded')) === 'false', 'aria-expanded stays true');
      await toggle.click();
      await pop.getByLabel('Event kinds').waitFor();
    });
    await check('graph', 'the T line does not show through an axis label', async () => {
      const hits = await page.evaluate(() => {
        const top = document.querySelector('svg.pg-top-time');
        const t =
          [...top.querySelectorAll('line, rect, text')].find((e) =>
            /^T\s/.test(e.textContent || ''),
          ) || [...top.querySelectorAll('text')].find((e) => /^T /.test(e.textContent));
        const tx = t ? t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2 : null;
        if (tx == null) return ['no T marker found'];
        const across = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.left + 2 < tx && tx < r.right - 2;
        };
        // A label may sit across T when a panel-colored rect painted after the line covers it.
        const tLine = [...top.querySelectorAll('line')].find((l) => {
          const r = l.getBoundingClientRect();
          return r.height > r.width && Math.abs(r.left + r.width / 2 - tx) < 2;
        });
        const backed = (e) => {
          const ms = e.closest('[data-ms]')?.getAttribute('data-ms');
          const back = ms
            ? top.querySelector(`.label-back[data-back="${CSS.escape(ms)}"]`)
            : e.previousElementSibling;
          return (
            back?.classList.contains('label-back') &&
            across(back) &&
            (!tLine || tLine.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING)
          );
        };
        return [...top.querySelectorAll('text')]
          .filter((e) => !/^T /.test(e.textContent))
          .filter((e) => across(e) && !backed(e))
          .map((e) => e.textContent.trim());
      });
      expect(!hits.length, `the T line crosses: ${hits.join(' | ')}`);
    });
    await errorsCheck('graph', page);
  },

  async cr() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('cr'));
    const toast = page.locator('.tk-toast');
    const bar = page.locator('.bbar').first();
    const side = page.locator('.cr-side');
    const svg = page.locator('svg.pg');
    const queueAdd = () => side.getByRole('button', { name: 'Add', exact: true }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add to the queue' });
    const WI = 'QA export the KYC logs';
    await check('cr', 'New change request opens an editable page', async () => {
      await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
      await page.locator('.m-card').getByLabel('Name').fill('QA change request');
      await page.locator('.m-card').getByRole('button', { name: 'Create', exact: true }).click();
      await page.waitForURL(/\/changes\/\d+$/);
      await hydrated(page);
      await bar.locator('text=You are editing >> visible=true').first().waitFor();
    });
    await check('cr', 'Add event: empty text is refused with a message', async () => {
      await queueAdd();
      await addDialog.getByRole('button', { name: 'Add event' }).click();
      await toast.filter({ hasText: 'Write what happened first.' }).waitFor();
    });
    await check('cr', 'Add event: markup stays text and the card lands in the Queue', async () => {
      await addDialog.getByRole('button', { name: 'Issue', exact: true }).click();
      await addDialog.getByRole('textbox').first().fill('<script>window.qaXss=1</script> QA issue');
      await addDialog.getByRole('button', { name: 'Add event' }).click();
      await toast.filter({ hasText: 'Added to the queue' }).waitFor();
      await page.locator('[data-qevent]', { hasText: 'QA issue' }).waitFor();
      expect(!(await page.evaluate(() => window.qaXss)), 'script ran');
    });
    await check('cr', 'Add work item, then drag it onto a team', async () => {
      await queueAdd();
      await addDialog.getByRole('button', { name: 'Work item', exact: true }).click();
      await addDialog.getByLabel('Name').fill(WI);
      await addDialog.getByRole('button', { name: 'Add work item' }).click();
      await toast.filter({ hasText: 'Added to the queue' }).waitFor();
      await side.getByRole('button', { name: /^Work items/ }).click();
      await drag(
        page,
        page.locator('[data-qitem]', { hasText: WI }),
        svg.locator('rect.lane-drop').nth(1),
      );
      await toast.filter({ hasText: `${WI}: placed` }).waitFor();
    });
    const row = svg.locator(`[data-loop][aria-label^="${WI}"]`);
    await check(
      'cr',
      'during a drag the toast steps aside for the bin, then comes back',
      async () => {
        await side.getByRole('button', { name: /^Events/ }).click();
        await queueAdd();
        await addDialog.getByRole('button', { name: 'Task', exact: true }).click();
        await addDialog.getByRole('textbox').first().fill('QA toast probe');
        await addDialog.getByRole('button', { name: 'Add event' }).click();
        await toast.filter({ hasText: 'Added to the queue' }).waitFor();
        const card = page.locator('[data-qevent]', { hasText: 'QA toast probe' });
        const a = await visibleCentre(card);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(a.x + 8, a.y + 8, { steps: 3 });
        await page.mouse.move(a.x + 300, a.y - 100, { steps: 6 });
        const during = await page.evaluate(() => {
          const t = document.querySelector('.tk-toast');
          const bin = document.querySelector('.bin');
          const r = (e) => e?.getBoundingClientRect();
          const tr = r(t);
          const br = r(bin);
          const shown = (e) =>
            !!e &&
            getComputedStyle(e).visibility !== 'hidden' &&
            +getComputedStyle(e).opacity > 0.1;
          const overlap =
            tr &&
            br &&
            shown(t) &&
            tr.left < br.right &&
            br.left < tr.right &&
            tr.top < br.bottom &&
            br.top < tr.bottom;
          return { paused: t?.dataset.paused === 'true', bin: shown(bin), overlap: !!overlap };
        });
        await page.mouse.move(a.x, a.y, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const after = await toast.filter({ hasText: 'Added to the queue' }).isVisible();
        expect(
          during.paused && during.bin && !during.overlap && after,
          `during: ${JSON.stringify(during)}, toast back after: ${after}`,
        );
      },
    );
    await check('cr', 'drag a Queue event onto the new row', async () => {
      await side.getByRole('button', { name: /^Events/ }).click();
      await drag(page, page.locator('[data-qevent]', { hasText: 'QA issue' }), row);
      await toast.filter({ hasText: /added/ }).waitFor();
      const pop = page.locator('.pop').filter({ hasText: 'Added' }).first();
      await pop.waitFor({ timeout: 4000 });
      const text = (await pop.innerText()).replace(/\s+/g, ' ');
      await page.keyboard.press('Escape');
      expect(/Added an Issue\b/.test(text), `the pop says: ${text.slice(0, 80)}`);
    });
    const drawer = page.locator('.drawer');
    const openRow = async () => {
      await page.getByRole('combobox', { name: 'Search work items' }).fill(WI);
      await page.keyboard.press('Enter');
      await drawer.getByLabel('Name').waitFor();
    };
    await check('cr', 'rename in the details; an empty name is refused', async () => {
      await openRow();
      await drawer.getByLabel('Name').fill(`${WI} v2`);
      await drawer.getByLabel('Name').press('Enter');
      await toast.filter({ hasText: 'renamed' }).waitFor();
      await drawer.getByLabel('Name').fill('   ');
      await drawer.getByLabel('Name').press('Enter');
      await page.waitForTimeout(400);
      expect((await drawer.getByLabel('Name').inputValue()).trim().length > 0, 'empty name kept');
    });
    await check(
      'cr',
      'moving the planned finish needs a reason and lands in Date moves',
      async () => {
        const p = drawer.getByLabel('Planned finish');
        await p.fill('30 Oct 2026');
        await p.press('Enter');
        const save = drawer.getByRole('button', { name: 'Move the date' });
        expect(await save.isDisabled(), 'Move the date enabled without a reason');
        await drawer
          .getByLabel(/Why does the date move/)
          .fill('QA: the auditor asked for more time.');
        await save.click();
        await toast.filter({ hasText: 'planned finish moved' }).waitFor();
        await drawer.getByRole('button', { name: /Date moves/ }).click();
        await drawer.getByText('QA: the auditor asked for more time.').waitFor();
      },
    );
    await check('cr', 'Mark done pre-fills Who with the Done by person', async () => {
      await pick(drawer.getByLabel('Done by'), { label: 'Hà Đỗ' });
      await toast.filter({ hasText: 'done by changed' }).waitFor();
      await pick(drawer.getByLabel('Requested by'), { label: 'Sarah Kim' });
      await toast.filter({ hasText: 'requested by changed' }).waitFor();
      await drawer.getByRole('button', { name: 'Mark done' }).click();
      const m = page.getByRole('dialog', { name: 'Add an event' });
      const who = (await m.getByRole('combobox', { name: 'Who' }).innerText()).trim();
      await m.getByRole('textbox').first().fill('QA: sent the export.');
      await m.getByRole('button', { name: 'Add event' }).click();
      await toast.filter({ hasText: 'Done by' }).waitFor();
      await page.keyboard.press('Escape');
      expect(who === 'Hà Đỗ', `Who was "${who}", Done by is Hà Đỗ`);
    });
    await check('cr', 'New milestone: empty name refused, then created on the axis', async () => {
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: /New milestone/ })
        .first()
        .click();
      const m = page.getByRole('dialog', { name: 'New milestone' });
      await m.getByRole('button', { name: 'Create milestone' }).click();
      await toast.filter({ hasText: 'Give the milestone a name.' }).waitFor();
      await m.getByLabel('Name').fill('QA sign-off');
      await m.getByLabel('Planned date').fill('6 Nov 2026');
      await m.getByLabel('Planned date').press('Tab');
      await m.getByRole('button', { name: 'Create milestone' }).click();
      await page.locator('svg.pg-top-time [data-ms][aria-label^="QA sign-off"]').waitFor();
    });
    await check('cr', 'New team: a duplicate is refused, a new name is added', async () => {
      const nt = page.getByRole('button', { name: /New team/ }).first();
      await nt.scrollIntoViewIfNeeded();
      await nt.click();
      const m = page.getByRole('dialog', { name: 'New team' });
      await m.getByRole('textbox').first().fill('engineering');
      await m.getByRole('button', { name: 'Add team' }).click();
      await toast.filter({ hasText: 'already a team' }).waitFor();
      await m.getByRole('textbox').first().fill('QA Compliance');
      await m.getByRole('button', { name: 'Add team' }).click();
      await toast.filter({ hasText: 'QA Compliance: added' }).waitFor();
    });
    await check('cr', 'Undo the last change lowers the count by one', async () => {
      await side.getByRole('button', { name: /^Changes/ }).click();
      const before = await changeCount(page);
      await side.getByRole('button', { name: 'Undo the last change' }).click();
      for (let i = 0; i < 12 && (await changeCount(page)) !== before - 1; i++)
        await page.waitForTimeout(250);
      expect((await changeCount(page)) === before - 1, `${before} → ${await changeCount(page)}`);
    });
    await check('cr', 'undoing a placement does not leave dead changes in the count', async () => {
      const before = await changeCount(page);
      await side.getByRole('button', { name: `Undo this change: ${WI}, placed` }).click();
      await page.waitForTimeout(900);
      const after = await changeCount(page);
      const dead = await page
        .getByRole('list', { name: 'Changes' })
        .getByText('no longer applies')
        .count();
      expect(
        dead === 0 || after === before - 1 - dead,
        `${before} → ${after} changes; ${dead} say "no longer applies" but still count`,
      );
    });
    const num = Number(page.url().split('/').pop());
    await check('cr', 'Clear removes the changes that no longer apply', async () => {
      const note = side.getByRole('note', { name: 'Changes that no longer apply' });
      const stale = Number(((await note.innerText()).match(/(\d+) changes? no longer/) || [])[1]);
      const before = (await crOps(page, pid, num)).length;
      await side.getByRole('button', { name: 'Clear the changes that no longer apply' }).click();
      await note.waitFor({ state: 'detached' });
      const after = (await crOps(page, pid, num)).length;
      expect(
        stale > 0 && after === before - stale,
        `ops ${before} → ${after}; the note said ${stale}`,
      );
    });
    await check('cr', 'click way: a Queue event goes onto a work item without a drag', async () => {
      const before = (await crOps(page, pid, num)).length;
      await addQueueEventByClick(page, 'Scope call', 'Dynamics CRM sync scope');
      await page.waitForTimeout(600);
      const after = await crOps(page, pid, num);
      expect(after.length === before + 1 && after.at(-1) === 'attach', after.join(','));
      const t = await page
        .locator('.tk-toast')
        .innerText()
        .catch(() => '');
      return t.trim() ? '' : 'no toast after the click way, unlike a drag';
    });
    await check(
      'cr',
      'event pop: Change kind, Move to another work item, Hide, Undo from the toast',
      async () => {
        // The seed dates follow the real clock, so pin the event by the day it shows today.
        const label = await svg
          .locator('[data-act][aria-label*="by Sarah Kim, "]')
          .first()
          .getAttribute('aria-label');
        const day = label.match(/by Sarah Kim, \d+ \w+/)[0];
        const ev = () => svg.locator(`[data-act][aria-label*="${day}"]`).first();
        const pop = page.locator('.pop');
        const n0 = (await crOps(page, pid, num)).length;
        await clickShape(page, ev());
        await pop.getByRole('button', { name: 'Change kind' }).click();
        await pop.getByRole('button', { name: 'Decision', exact: true }).click();
        await waitOps(page, pid, num, (o) => o.at(-1) === 'kind', 'Change kind');
        await page.keyboard.press('Escape');
        await clickShape(page, ev());
        await pop.getByRole('button', { name: 'Move to another work item' }).click();
        await page.locator('.move-hint', { hasText: 'Click the work item' }).waitFor();
        await svg.locator('[data-loop][aria-label^="Sync monitoring"]').click();
        await waitOps(page, pid, num, (o) => o.at(-1) === 'move', 'Move');
        await page.keyboard.press('Escape');
        await clickShape(page, ev());
        await pop.getByRole('button', { name: 'Hide this event' }).click();
        await waitOps(page, pid, num, (o) => o.at(-1) === 'hide', 'Hide');
        await toast.getByRole('button', { name: 'Undo' }).click();
        const ops = await waitOps(
          page,
          pid,
          num,
          (o) => o.length === n0 + 2,
          'Undo from the toast',
        );
        expect(ops.slice(-2).join() === 'kind,move', ops.join(','));
      },
    );
    await check('cr', 'click way: Place this work item, and Remove from queue', async () => {
      await side.getByRole('button', { name: /^Queue/ }).click();
      await side.getByRole('button', { name: /^Work items/ }).click();
      const cards = page.locator('[data-qitem]');
      const n0 = await cards.count();
      const first = await cards.first().getAttribute('aria-label');
      await cards.first().click();
      const d = page.getByRole('dialog', { name: 'Place this work item' });
      await pick(selectIn(d).first(), { index: 1 });
      await d.getByRole('button', { name: 'Place work item' }).click();
      await toast.filter({ hasText: 'placed' }).waitFor();
      await queueAdd();
      await addDialog.getByRole('button', { name: 'Work item', exact: true }).click();
      await addDialog.getByLabel('Name').fill('QA throwaway card');
      await addDialog.getByRole('button', { name: 'Add work item' }).click();
      await toast.filter({ hasText: 'Added to the queue' }).waitFor();
      await page.locator('[data-qitem]', { hasText: 'QA throwaway card' }).click();
      await d.getByRole('button', { name: 'Remove from queue' }).click();
      await page
        .locator('[data-qitem]', { hasText: 'QA throwaway card' })
        .waitFor({ state: 'detached' });
      await d.waitFor({ state: 'detached' });
      await side.getByRole('button', { name: /^Work items/ }).click();
      expect(
        (await cards.count()) === n0 - 1,
        `queue ${n0} → ${await cards.count()} (placed ${first})`,
      );
    });
    await check('cr', 'a Queue event can start a new work item in a team', async () => {
      await side.getByRole('button', { name: /^Queue/ }).click();
      await side.getByRole('button', { name: /^Events/ }).click();
      await page.locator('[data-qevent]').first().click();
      const d = page.getByRole('dialog', { name: 'Add this event to a work item' });
      await pick(d.getByLabel('Team'), { index: 1 });
      await d.getByRole('button', { name: 'New work item' }).click();
      const n = page.getByRole('dialog', { name: /^New work item in / });
      await n.getByRole('textbox').first().fill('QA work item from an event');
      await n.getByRole('button').last().click();
      await n.waitFor({ state: 'detached' });
      await svg
        .locator('[data-loop][aria-label^="QA work item from an event"]')
        .waitFor({ state: 'attached' });
    });
    await check('cr', 'queue search says when nothing matches', async () => {
      await side.getByLabel('Search the queue').fill('zzz-nothing');
      await side
        .getByText(/No (work item|event)s? matches/)
        .first()
        .waitFor();
      await side.getByLabel('Search the queue').fill('');
    });
    await check('cr', 'the side panel hides and comes back', async () => {
      await side.getByRole('button', { name: 'Hide the side panel' }).click();
      expect(!(await side.isVisible()), 'side panel still shows');
      await page.getByRole('button', { name: /^Changes and Queue/ }).click();
      await side.waitFor();
    });
    await check(
      'cr',
      'milestone editor: a date move needs a reason; add and remove a work item',
      async () => {
        await clickShape(page, page.locator('svg.pg-top-time [data-ms]').first());
        const d = page
          .locator('.drawer, .pop')
          .filter({ has: page.getByRole('button', { name: 'Save milestone' }) })
          .first();
        await d.getByLabel('Planned date').fill('25 Sept 2026');
        await d.getByLabel('Planned date').press('Tab');
        await d.getByRole('button', { name: 'Save milestone' }).click();
        const move = page.getByRole('dialog', { name: 'Move the milestone date' });
        const ok = move.getByRole('button', { name: 'Move the date' });
        expect(await ok.isDisabled(), 'Move the date enabled without a reason');
        await move
          .getByLabel(/Why does the date move/)
          .fill('QA: the CRM partner moved the go-live.');
        await ok.click();
        await toast.filter({ hasText: 'planned date moved' }).waitFor();
        const add = d.getByLabel('Work item to add');
        await pick(add, { index: 1 });
        await d.getByRole('button', { name: 'Add', exact: true }).click();
        await page.waitForTimeout(500);
        await d.getByRole('button', { name: 'Remove' }).first().click();
        await page.waitForTimeout(500);
        const unnamed = await d
          .locator('input')
          .evaluateAll(
            (l) => l.filter((i) => !i.labels?.length && !i.getAttribute('aria-label')).length,
          );
        await page.keyboard.press('Escape');
        return unnamed ? `${unnamed} input(s) in the milestone editor have no label` : '';
      },
    );
    await check('cr', 'Cancel work item needs a reason and sets the status Cancelled', async () => {
      await page.getByRole('combobox', { name: 'Search work items' }).fill('Sync incident report');
      await page.keyboard.press('Enter');
      const d = page.locator('.drawer');
      await d.getByRole('button', { name: 'Cancel work item' }).click();
      const c = page.getByRole('dialog', { name: 'Cancel this work item' });
      await c.getByRole('button', { name: 'Cancel work item' }).click();
      await toast.filter({ hasText: 'Write why the work item is cancelled.' }).waitFor();
      await c.getByRole('textbox').first().fill('QA: the client dropped it.');
      await c.getByRole('button', { name: 'Cancel work item' }).click();
      await svg
        .locator('[data-loop][aria-label^="Sync incident report, Cancelled"]')
        .waitFor({ state: 'attached' });
      await page.keyboard.press('Escape');
    });
    await check('cr', 'calendar: months move and Today picks the demo day', async () => {
      await queueAdd();
      await addDialog.getByRole('button', { name: 'Work item', exact: true }).click();
      await addDialog.getByRole('button', { name: 'Open the calendar' }).click();
      const cal = page.getByRole('dialog', { name: 'Calendar' });
      const title = async () => (await cal.innerText()).split('\n')[0];
      const t0 = await title();
      await cal.getByRole('button', { name: 'Next month' }).click();
      const t1 = await title();
      await cal.getByRole('button', { name: 'Previous month' }).click();
      await cal.getByRole('button', { name: 'Today' }).click();
      const value = await addDialog.getByLabel('Planned finish').inputValue();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      expect(t0 !== t1 && /\d{1,2} \w+ 20\d\d/.test(value), `${t0} → ${t1}, value ${value}`);
    });
    await check('cr', 'Before shows Main, After shows the change request', async () => {
      await page.getByRole('button', { name: 'Before', exact: true }).click();
      expect(
        (await page.locator('svg.pg-top-time [data-ms][aria-label^="QA sign-off"]').count()) === 0,
        'Before shows the new milestone',
      );
      await page.getByRole('button', { name: 'After', exact: true }).click();
    });
    await check('cr', 'Share: add a person, change access, Copy link', async () => {
      await bar.getByRole('button', { name: 'Share' }).click();
      const m = page.locator('.m-card');
      await pick(m.getByLabel('Person'), { label: 'Lan Phạm' });
      await pick(m.getByLabel('Access', { exact: true }), 'view');
      await m.getByRole('button', { name: 'Add', exact: true }).click();
      await pick(m.getByLabel('Access for Lan Phạm'), 'edit');
      await m.getByRole('button', { name: 'Copy link' }).click();
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      await pick(m.getByLabel('Access for Lan Phạm'), 'remove');
      await m.getByLabel('Access for Lan Phạm').waitFor({ state: 'detached' });
      await m.getByRole('button', { name: 'Done' }).click();
      expect(/\/changes\/\d+$/.test(clip), `clipboard: ${clip}`);
    });
    await check('cr', 'Mark as ready, then Merge into Main; History lists it', async () => {
      await bar.getByRole('button', { name: 'Mark as ready' }).click();
      await bar.locator('text=Ready to merge >> visible=true').first().waitFor();
      await bar.getByRole('button', { name: 'Merge into Main' }).click();
      await bar.locator('text=/Merged into Main/ >> visible=true').first().waitFor();
      await page.goto(`/projects/${pid}/graph`);
      await hydrated(page);
      await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
      await page.locator('.drawer', { hasText: 'QA change request' }).waitFor();
      await page.keyboard.press('Escape');
    });
    await check('cr', 'Request changes needs a note and sends #12 back to Draft', async () => {
      await page.goto(`/projects/${pid}/changes/12`);
      await hydrated(page);
      await bar.getByRole('button', { name: 'Request changes' }).click();
      const m = page.locator('.m-card');
      expect(
        await m.getByRole('button', { name: 'Send back to draft' }).isDisabled(),
        'enabled without a note',
      );
      await m.getByLabel('What should change?').fill('QA: add the staging link.');
      await m.getByRole('button', { name: 'Send back to draft' }).click();
      await toast.filter({ hasText: 'is a draft again' }).waitFor();
    });
    await check('cr', 'Cancel change request needs a reason and closes #13', async () => {
      await page.goto(`/projects/${pid}/changes/13`);
      await hydrated(page);
      await bar.getByRole('button', { name: 'Cancel change request' }).click();
      const m = page.locator('.m-card');
      const confirm = m.getByRole('button', { name: 'Cancel change request' });
      expect(await confirm.isDisabled(), 'enabled without a reason');
      await m.getByLabel('Reason').fill('QA: not needed.');
      await confirm.click();
      await bar.getByText('Closed').first().waitFor();
    });
    await errorsCheck('cr', page);
  },

  async members() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('members'));
    const toast = page.locator('.tk-toast');
    await page.goto(`/projects/${pid}/members`);
    await hydrated(page);
    const form = page.getByRole('form', { name: 'Invite a person' });
    const guest = label('guest');
    await check('members', 'invite with a bad email shows a clear message', async () => {
      await form.getByLabel('Email').fill('a@b');
      await form.getByRole('button', { name: 'Invite' }).click();
      await page.locator('.pg-error').first().waitFor();
      const msg = await page.locator('.pg-error').first().innerText();
      expect(/email/i.test(msg), `message is "${msg}"`);
    });
    await check('members', 'invite a new email, and a second invite of it is refused', async () => {
      await form.getByLabel('Email').fill(`${guest}@local.test`);
      await form.getByRole('button', { name: 'Invite' }).click();
      await toast.filter({ hasText: `Invited ${guest}@local.test` }).waitFor();
      await form.getByLabel('Email').fill(`${guest.toUpperCase()}@local.test`);
      await form.getByRole('button', { name: 'Invite' }).click();
      await page.locator('.pg-error', { hasText: 'already in this project' }).waitFor();
    });
    await check('members', 'a grant box toggles with a toast', async () => {
      await page.getByLabel('Merge change requests: Khoa Lê').click();
      await toast.filter({ hasText: 'Khoa Lê: Merge change requests on' }).waitFor();
    });
    await check(
      'members',
      'team editor: Delete is locked for a team with work, Save works',
      async () => {
        await page.getByRole('button', { name: 'Edit Customer Success' }).click();
        const ed = page.getByRole('dialog', { name: 'Edit Customer Success' });
        expect(
          await ed.getByRole('button', { name: 'Delete team' }).isDisabled(),
          'Delete enabled',
        );
        await ed.getByRole('checkbox', { name: /Hà Đỗ/ }).check();
        await ed.getByRole('button', { name: 'Save' }).click();
        await toast.filter({ hasText: 'Saved Customer Success' }).waitFor();
      },
    );
    await check(
      'members',
      'Add a team refuses a duplicate, adds and deletes a new one',
      async () => {
        const add = page.getByRole('form', { name: 'Add a team' });
        await add.getByLabel('Team name').fill('it');
        await add.getByLabel('Team name').press('Enter');
        await page.locator('.pg-error', { hasText: 'already a team' }).waitFor();
        await add.getByLabel('Team name').fill('QA Legal');
        await add.getByLabel('Team name').press('Enter');
        await toast.filter({ hasText: 'Added QA Legal' }).waitFor();
        await page.getByRole('button', { name: 'Edit QA Legal' }).click();
        await page
          .getByRole('dialog', { name: 'Edit QA Legal' })
          .getByRole('button', { name: 'Delete team' })
          .click();
        await toast.filter({ hasText: 'Deleted QA Legal' }).waitFor();
      },
    );
    let other;
    // Demo mode has no sign-in for a second person.
    if (!demo)
      await check(
        'members',
        'the invited person signs in, lands in the project, sees Members read-only',
        async () => {
          other = await newPage();
          await other.goto(`/signin?label=${guest}`);
          await other.getByRole('button', { name: /continue/i }).click();
          await other.waitForURL(new RegExp(`/projects/${pid}/graph$`));
          await other.goto(`/projects/${pid}/members`);
          await hydrated(other);
          expect(
            (await other.getByRole('form', { name: 'Invite a person' }).count()) === 0,
            'invite form shows',
          );
        },
        page,
      );
    await check(
      'members',
      'the joined member can be picked as Done by / Who on the graph',
      async () => {
        const t = await tracker(page, pid);
        const names = t.base.people.map((p) => p.name);
        const member = t.members.find(
          (m) => m.name.includes(guest) || (m.email || '').includes(guest),
        );
        expect(member, 'member row not found');
        expect(
          names.includes(member.name),
          `graph people: ${names.length}; members not in it: ${member.name}`,
        );
      },
    );
    // Demo mode has no sign-in for a second person.
    if (!demo)
      await check(
        'members',
        'a member with no grant sees why the graph is closed, with a Members link',
        async () => {
          const blind = label('blind');
          await form.getByLabel('Email').fill(`${blind}@local.test`);
          await form.getByRole('button', { name: 'Invite' }).click();
          await toast.filter({ hasText: `Invited ${blind}` }).waitFor();
          for (const g of ['Create change requests', 'View change requests', 'View Main']) {
            await page.getByLabel(`${g}: ${blind}@local.test`).click();
            await toast.filter({ hasText: `${g} off` }).waitFor();
          }
          const b = await newPage();
          await b.goto(`/signin?label=${blind}`);
          await b.getByRole('button', { name: /continue/i }).click();
          await b.getByText('You cannot see Main of this project yet.').waitFor();
          await b.getByRole('link', { name: 'Members page' }).click();
          await b.waitForURL(/\/members$/);
          await b.context().close();
        },
      );
    await check('members', 'Remove asks to confirm and takes the person out', async () => {
      await page.reload();
      await hydrated(page);
      await page.getByRole('button', { name: 'Remove Hà Đỗ' }).click();
      const c = page.getByRole('dialog', { name: 'Remove Hà Đỗ?' });
      await c.getByRole('button', { name: 'Remove', exact: true }).click();
      await toast.filter({ hasText: 'Hà Đỗ is no longer in this project.' }).waitFor();
    });
    await check('members', '"Make project lead" buttons name their person', async () => {
      const names = await page
        .getByRole('button', { name: /Make project lead/ })
        .evaluateAll((l) => l.map((b) => b.getAttribute('aria-label') || b.innerText));
      expect(
        names.every((n) => n !== 'Make project lead'),
        'every button is just "Make project lead"',
      );
    });
    await errorsCheck('members', page);
    if (other) await other.context().close();
  },

  async settings() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('settings'));
    await page.goto(`/projects/${pid}/settings/tokens`);
    await hydrated(page);
    let token = '';
    const mcp = async (method, params = {}, t = token) => {
      const r = await page.request.post('/mcp', {
        headers: {
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        data: { jsonrpc: '2.0', id: 1, method, params },
      });
      return { status: r.status(), body: await r.json().catch(() => ({})) };
    };
    await check(
      'settings',
      'Create token shows the secret once; Copy secret copies it',
      async () => {
        await fillStable(page.getByLabel('Label'), 'QA agent');
        await page.getByRole('button', { name: 'Create token' }).click();
        await page.getByRole('button', { name: 'Copy secret' }).click();
        token = (await page.evaluate(() => navigator.clipboard.readText())).trim();
        expect(/^inv_/.test(token), 'no secret in the clipboard');
      },
    );
    await check(
      'settings',
      'MCP: initialize, 7 tools, add_queue_event, bad kind is an error',
      async () => {
        expect(
          (
            await mcp('initialize', {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'qa', version: '1' },
            })
          ).status === 200,
          'initialize',
        );
        const tools = (await mcp('tools/list')).body.result.tools.map((t) => t.name);
        expect(tools.length >= 7, tools.join(','));
        const add = await mcp('tools/call', {
          name: 'add_queue_event',
          arguments: {
            kind: 'message',
            at: '2026-10-09T08:00:00Z',
            by: 'sarah',
            text: 'QA agent note.',
          },
        });
        expect(!add.body.result.isError, JSON.stringify(add.body).slice(0, 200));
        const bad = await mcp('tools/call', {
          name: 'add_queue_event',
          arguments: { kind: 'party', at: '2026-10-09T08:00:00Z', by: 'sarah', text: 'x' },
        });
        expect(bad.body.result.isError, 'bad kind accepted');
      },
    );
    await check('settings', 'every MCP tool answers', async () => {
      const call = async (name, args) =>
        (await mcp('tools/call', { name, arguments: args })).body.result;
      const bad = [];
      const results = {
        get_project: await call('get_project', {}),
        get_tracker: await call('get_tracker', {}),
        list_queue: await call('list_queue', {}),
        add_queue_item: await call('add_queue_item', {
          title: 'QA agent work item',
          doneBy: 'sarah',
          requestedBy: 'sarah',
          plannedFinish: '2026-10-30',
        }),
        list_change_requests: await call('list_change_requests', {}),
        get_change_request: await call('get_change_request', { num: 11 }),
      };
      for (const [name, r] of Object.entries(results))
        if (!r || r.isError) bad.push(`${name}: ${JSON.stringify(r).slice(0, 120)}`);
      expect(!bad.length, bad.join(' | '));
    });
    await check(
      'settings',
      'Copy config with this secret holds the secret; I copied it hides it',
      async () => {
        await page.getByRole('button', { name: 'Copy config with this secret' }).click();
        const cfg = await page.evaluate(() => navigator.clipboard.readText());
        expect(cfg.includes(token) && cfg.includes('/mcp'), 'config without the secret or the URL');
        await page.getByRole('button', { name: 'I copied it, hide the secret' }).click();
        expect((await page.getByText(token).count()) === 0, 'the secret still shows');
      },
    );
    await check('settings', 'Check again shows the last call time', async () => {
      await page.getByRole('button', { name: 'Check again' }).click();
      await page.waitForTimeout(800);
      const text = await page.locator('body').innerText();
      const last = (text.match(/QA agent[\s\S]{0,120}?(Never|\d{1,2} \w+ \d{2}:\d{2})/) || [])[1];
      expect(last && last !== 'Never', `last call: ${last}`);
    });
    await check('settings', 'Select all checks every scope, and again clears them', async () => {
      const all = page.getByRole('checkbox', { name: 'Select all' });
      const count = async () =>
        (await page.getByRole('checkbox').evaluateAll((l) => l.filter((c) => c.checked).length)) -
        ((await all.isChecked()) ? 1 : 0);
      await all.check();
      const on = await count();
      const said = (await page.locator('body').innerText()).match(/(\d+) of (\d+)/);
      await all.uncheck();
      const off = await count();
      await page.getByRole('checkbox', { name: /Read the project/ }).check();
      await page.getByRole('checkbox', { name: /Add to the Queue/ }).check();
      expect(
        on === 10 && off === 0 && said?.[1] === '10',
        `on ${on}, off ${off}, label ${said?.[0]}`,
      );
    });
    await check('settings', 'Revoke then Confirm revoke blocks the token', async () => {
      await page.getByRole('button', { name: 'Revoke' }).first().click();
      const t0 = Date.now();
      const busy = page
        .getByText('Revoking')
        .first()
        .waitFor({ timeout: 3000 })
        .then(
          () => true,
          () => false,
        );
      await page.getByRole('button', { name: 'Confirm revoke' }).click();
      await page
        .getByText(/Revoked/)
        .first()
        .waitFor();
      const ms = Date.now() - t0;
      expect((await mcp('tools/list')).status === 401, 'token still works');
      expect((await mcp('tools/list', {}, 'inv_wrong')).status === 401, 'wrong token works');
      expect(
        (await busy) || ms < 300,
        `the table took ${ms} ms to show Revoked, with no busy state`,
      );
    });
    await check('settings', 'a token without Add to the Queue cannot add', async () => {
      await fillStable(page.getByLabel('Label'), 'QA read only');
      await page.getByRole('checkbox', { name: /Add to the Queue/ }).uncheck();
      await page.getByRole('button', { name: 'Create token' }).click();
      await page.getByRole('button', { name: 'Copy secret' }).click();
      const ro = (await page.evaluate(() => navigator.clipboard.readText())).trim();
      await page.getByRole('button', { name: 'I copied it, hide the secret' }).click();
      const read = await mcp('tools/call', { name: 'get_project', arguments: {} }, ro);
      const add = await mcp(
        'tools/call',
        {
          name: 'add_queue_event',
          arguments: { kind: 'message', at: '2026-10-09T08:00:00Z', by: 'sarah', text: 'x' },
        },
        ro,
      );
      expect(read.status === 200 && !read.body.result?.isError, 'project:read failed');
      expect(
        add.status !== 200 || add.body.result?.isError || add.body.error,
        'queue:add worked without the scope',
      );
    });
    await errorsCheck('settings', page);
  },

  async mcp() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('mcp'));
    const H = { Origin: base };
    const ALL = [
      'project:read',
      'queue:add',
      'queue:dismiss',
      'crs:edit',
      'crs:ready',
      'crs:comment',
      'crs:merge',
      'crs:close',
      'members:manage',
      'teams:manage',
    ];
    const mint = async (p, name, scopes) => {
      const r = await p.request.post(`/api/v1/projects/${pid}/agent-tokens`, {
        headers: H,
        data: { label: name, scopes, idempotencyKey: `${name}-${run}` },
      });
      return { status: r.status(), secret: (await r.json().catch(() => ({}))).secret };
    };
    const all = (await mint(page, 'qa-all', ALL)).secret;
    const call = async (name, args = {}, token = all) => {
      const r = await page.request.post('/mcp', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      });
      const b = await r.json().catch(() => ({}));
      const text = b.result?.content?.[0]?.text ?? JSON.stringify(b.error ?? b);
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { error: !!b.result?.isError || !!b.error, data, text: String(text).slice(0, 160) };
    };
    const okCall = async (name, args) => {
      const r = await call(name, args);
      expect(!r.error, `${name}: ${r.text}`);
      return r.data;
    };
    const failCall = async (name, args, code) => {
      const r = await call(name, args);
      expect(r.error && r.data?.code === code, `${name} should answer ${code}: ${r.text}`);
    };
    const rev = (d) => d.changeRequest.revision;
    let tools = [];
    await check('mcp', 'tools/list names every tool with its scope', async () => {
      const r = await page.request.post('/mcp', {
        headers: { Authorization: `Bearer ${all}`, Accept: 'application/json, text/event-stream' },
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      });
      tools = (await r.json()).result.tools.map((t) => ({
        name: t.name,
        scope: (t.description.match(/Scope: ([a-z:]+)\./) || [])[1],
        readOnly: t.annotations?.readOnlyHint === true,
      }));
      const bad = tools.filter((t) => !ALL.includes(t.scope)).map((t) => t.name);
      const roWrong = tools.filter((t) => t.readOnly !== /^(get|list)_/.test(t.name));
      expect(tools.length >= 29 && !bad.length, `${tools.length} tools; no scope: ${bad}`);
      expect(!roWrong.length, `readOnlyHint wrong: ${roWrong.map((t) => t.name)}`);
    });
    const without = {};
    await check('mcp', 'every tool refuses a token that lacks only its scope', async () => {
      for (const s of ALL)
        without[s] = (
          await mint(
            page,
            `qa-no-${s.replace(':', '-')}`,
            ALL.filter((x) => x !== s),
          )
        ).secret;
      const allowed = [];
      for (const t of tools) {
        const r = await call(t.name, {}, without[t.scope]);
        if (!(r.error && r.data?.code === 'FORBIDDEN')) allowed.push(`${t.name}: ${r.text}`);
      }
      expect(!allowed.length, allowed.slice(0, 3).join(' | '));
    });
    let people, members, queue;
    await check(
      'mcp',
      'read tools: project, tracker, members, queue, change requests',
      async () => {
        expect((await okCall('get_project')).project.id === pid, 'get_project: wrong project');
        people = (await okCall('get_tracker')).people;
        members = await okCall('list_members');
        expect(members.members.length >= 5 && members.teams.length >= 5, 'list_members is short');
        const crs = await okCall('list_change_requests', { status: 'draft' });
        expect(
          crs.items.every((c) => c.status === 'draft'),
          'status filter ignored',
        );
        expect((await okCall('get_change_request', { num: 13 })).changeRequest.num === 13, '#13');
        expect(people.length >= 5, `people ${people.length}`);
      },
    );
    await check(
      'mcp',
      'Queue tools: add an event and two work items, remove one card',
      async () => {
        const me = members.leadId;
        await okCall('add_queue_event', {
          kind: 'issue',
          at: '2026-10-09T16:30+07:00',
          by: 'sarah',
          text: 'QA MCP issue',
        });
        for (const title of ['QA MCP work item', 'QA MCP duplicate'])
          await okCall('add_queue_item', {
            title,
            doneBy: me,
            requestedBy: 'sarah',
            plannedFinish: '2026-10-30',
          });
        queue = await okCall('list_queue', { limit: 10 });
        const dup = queue.items.find((i) => i.title === 'QA MCP duplicate');
        await okCall('remove_queue_card', { queueId: dup.id });
        const after = await okCall('list_queue', { limit: 10 });
        expect(!after.items.some((i) => i.id === dup.id), 'the removed card is still there');
        expect(
          queue.items.find((i) => i.title === 'QA MCP work item').agent === true,
          'agent flag',
        );
      },
    );
    await check(
      'mcp',
      'change request tools: create, add, stale revision, remove, share, comment, ready, draft, request changes, merge',
      async () => {
        const item = queue.items.find((i) => i.title === 'QA MCP work item');
        const ev = queue.events.find((e) => e.text === 'QA MCP issue');
        const lan = members.members.find((m) => m.name === 'Lan Phạm').id;
        let d = await okCall('create_change_request', {
          title: 'QA MCP flow',
          ops: [{ op: 'place', a: { itemId: item.id, teamId: 'engineering' } }],
        });
        const num = d.changeRequest.num;
        d = await okCall('add_change', {
          num,
          expectedRevision: rev(d),
          op: { op: 'attach', a: { eventId: ev.id, workItemId: item.id } },
        });
        d = await okCall('add_change', {
          num,
          expectedRevision: rev(d),
          op: { op: 'rename', a: { workItemId: 'golive', title: 'Go-live date (QA)' } },
        });
        await failCall(
          'add_change',
          {
            num,
            expectedRevision: rev(d) - 1,
            op: { op: 'rename', a: { workItemId: 'golive', title: 'x' } },
          },
          'CONFLICT',
        );
        d = await okCall('remove_change', { num, expectedRevision: rev(d), index: 'last' });
        expect(d.changeRequest.changeCount === 2, `changes ${d.changeRequest.changeCount}`);
        d = await okCall('share_change_request', {
          num,
          expectedRevision: rev(d),
          memberId: lan,
          permission: 'edit',
        });
        d = await okCall('comment_change_request', {
          num,
          expectedRevision: rev(d),
          body: 'QA note',
          opIndex: 0,
        });
        d = await okCall('mark_ready', { num, expectedRevision: rev(d) });
        d = await okCall('mark_draft', { num, expectedRevision: rev(d) });
        d = await okCall('mark_ready', { num, expectedRevision: rev(d) });
        d = await okCall('request_changes', {
          num,
          expectedRevision: rev(d),
          note: 'QA: check the dates',
        });
        expect(d.changeRequest.status === 'draft', 'request_changes left it ready');
        d = await okCall('mark_ready', { num, expectedRevision: rev(d) });
        d = await okCall('merge_change_request', { num, expectedRevision: rev(d) });
        const wi = (await okCall('get_tracker')).workItems.find(
          (w) => w.title === 'QA MCP work item',
        );
        expect(d.changeRequest.status === 'merged' && wi?.teamId === 'engineering', 'not in Main');
      },
    );
    await check('mcp', 'ask, cancel ask, decline, hand over and cancel through MCP', async () => {
      const id = (n) => members.members.find((m) => m.name === n).id;
      let g = (await okCall('get_change_request', { num: 13 })).changeRequest;
      let d = await okCall('ask_to_edit', { num: 13, expectedRevision: g.revision });
      await okCall('cancel_ask_to_edit', { num: 13, expectedRevision: rev(d) });
      d = await okCall('create_change_request', {
        title: 'QA MCP handover',
        ops: [{ op: 'rename', a: { workItemId: 'crs', title: 'CRS section (QA)' } }],
      });
      const num = d.changeRequest.num;
      await page.goto(`/projects/${pid}/changes/${num}`);
      await hydrated(page);
      await actAs(page, 'Lan Phạm');
      await page
        .locator('.bbar')
        .first()
        .getByRole('button', { name: 'Ask for edit access' })
        .click();
      await page.waitForTimeout(600);
      await actAs(page, 'Minh Trần');
      g = (await okCall('get_change_request', { num })).changeRequest;
      expect(g.asks.length === 1, `asks ${JSON.stringify(g.asks)}`);
      d = await okCall('decline_ask_to_edit', {
        num,
        expectedRevision: g.revision,
        who: id('Lan Phạm'),
      });
      expect(!(await okCall('get_change_request', { num })).changeRequest.asks.length, 'ask stays');
      d = await okCall('share_change_request', {
        num,
        expectedRevision: rev(d),
        memberId: id('Khoa Lê'),
        permission: 'edit',
      });
      d = await okCall('hand_over_change_request', {
        num,
        expectedRevision: rev(d),
        to: id('Khoa Lê'),
      });
      expect(d.changeRequest.editor.name === 'Khoa Lê', `editor ${d.changeRequest.editor.name}`);
      await failCall(
        'add_change',
        {
          num,
          expectedRevision: rev(d),
          op: { op: 'rename', a: { workItemId: 'crs', title: 'x' } },
        },
        'FORBIDDEN',
      );
      const own = await okCall('create_change_request', { title: 'QA MCP to cancel' });
      d = await okCall('cancel_change_request', {
        num: own.changeRequest.num,
        expectedRevision: rev(own),
        reason: 'QA: not needed',
      });
      expect(d.changeRequest.status === 'closed', d.changeRequest.status);
    });
    await check(
      'mcp',
      "cancelling another person's change request also needs crs:merge",
      async () => {
        const t = (await mint(page, 'qa-close-only', ['project:read', 'crs:close'])).secret;
        const g = (await okCall('get_change_request', { num: 13 })).changeRequest;
        const r = await call(
          'cancel_change_request',
          { num: 13, expectedRevision: g.revision, reason: 'QA' },
          t,
        );
        expect(r.error && /crs:merge/.test(r.text), r.text);
      },
    );
    await check('mcp', 'member and team tools, and their guards', async () => {
      const email = `${label('mcp-invitee')}@local.test`;
      await okCall('invite_member', {
        email,
        grants: { viewMain: true, viewCrs: true, createCrs: false, mergeCrs: false },
      });
      let list = await okCall('list_members');
      const nm = list.members.find((m) => m.email === email);
      expect(
        nm && (await okCall('get_tracker')).people.some((p) => p.id === nm.id),
        'invitee is not a person',
      );
      await okCall('set_member_grants', {
        memberId: nm.id,
        grants: { viewMain: true, viewCrs: true, createCrs: true, mergeCrs: false },
      });
      await failCall(
        'set_member_grants',
        {
          memberId: list.leadId,
          grants: { viewMain: true, viewCrs: false, createCrs: false, mergeCrs: false },
        },
        'VALIDATION',
      );
      await okCall('add_team', { name: 'QA MCP team' });
      const teamId = (await okCall('list_members')).teams.find((t) => t.name === 'QA MCP team').id;
      await okCall('update_team', {
        teamId,
        name: 'QA MCP team 2',
        leadId: nm.id,
        memberIds: [nm.id],
      });
      await failCall('add_team', { name: 'engineering' }, 'VALIDATION');
      await failCall('delete_team', { teamId: 'engineering' }, 'VALIDATION');
      await okCall('delete_team', { teamId });
      await okCall('remove_member', { memberId: nm.id });
      await failCall('remove_member', { memberId: list.leadId }, 'VALIDATION');
      list = await okCall('list_members');
      expect(!list.members.some((m) => m.id === nm.id), 'the removed member stays');
    });
    await check(
      'mcp',
      'list_members says what the token can manage: members and teams, each by its scope',
      async () => {
        const seen = {};
        for (const [who, token] of [
          ['all', all],
          ['no members:manage', without['members:manage']],
          ['no teams:manage', without['teams:manage']],
        ]) {
          const r = await call('list_members', {}, token);
          seen[who] = [r.data.canManage, r.data.canManageTeams];
        }
        expect(
          JSON.stringify(seen) ===
            JSON.stringify({
              all: [true, true],
              'no members:manage': [false, true],
              'no teams:manage': [true, false],
            }),
          `[canManage, canManageTeams]: ${JSON.stringify(seen)}`,
        );
      },
    );
    // Demo mode has no sign-in for a second person.
    if (!demo)
      await check('mcp', 'the server refuses a scope that the creator lacks', async () => {
        const b = await newPage();
        const email = `${label('mcp-viewer')}@local.test`;
        await okCall('invite_member', {
          email,
          grants: { viewMain: true, viewCrs: true, createCrs: false, mergeCrs: false },
        });
        await signIn(b, email.split('@')[0]);
        const read = await mint(b, 'qa-viewer-read', ['project:read']);
        const add = await mint(b, 'qa-viewer-add', ['project:read', 'queue:add']);
        const manage = await mint(b, 'qa-viewer-manage', ['members:manage']);
        await b.context().close();
        expect(read.status === 201, `project:read: ${read.status}`);
        expect(
          add.status >= 400 && manage.status >= 400,
          `queue:add ${add.status}, members:manage ${manage.status}`,
        );
      });
    await errorsCheck('mcp', page);
  },

  async access() {
    const owner = (current = await newPage());
    const pid = await signIn(owner, label('access-owner'));
    const H = { Origin: base };
    const stranger = await newPage();
    await signIn(stranger, label('access-stranger'));
    await check(
      'access',
      'a stranger gets 404 on every page and the API',
      async () => {
        for (const p of ['graph', 'changes/11', 'members', 'settings/tokens']) {
          const r = await stranger.goto(`/projects/${pid}/${p}`);
          expect(r.status() === 404, `${p}: ${r.status()}`);
        }
        expect(
          (await stranger.request.get(`/api/v1/projects/${pid}/tracker`)).status() === 404,
          'API',
        );
        const inv = await stranger.request.post(`/api/v1/projects/${pid}/members`, {
          headers: H,
          data: { email: 'x@local.test' },
        });
        expect(inv.status() === 404, `invite ${inv.status()}`);
      },
      stranger,
    );
    await check(
      'access',
      'the 404 page has no console error',
      async () => {
        expect(!stranger.errors.length, stranger.errors.slice(0, 2).join(' | '));
      },
      stranger,
    );
    await check(
      'access',
      'a request from another origin is refused',
      async () => {
        const r = await owner.request.post(`/api/v1/projects/${pid}/members`, {
          headers: { Origin: 'https://evil.example' },
          data: { email: 'z@local.test' },
        });
        expect(r.status() === 403, `status ${r.status()}`);
      },
      owner,
    );
    // Demo mode has no sign-in for a second person.
    if (demo) return;
    const member = await newPage();
    const who = label('access-member');
    await owner.goto(`/projects/${pid}/members`);
    await hydrated(owner);
    await owner
      .getByRole('form', { name: 'Invite a person' })
      .getByLabel('Email')
      .fill(`${who}@local.test`);
    await owner
      .getByRole('form', { name: 'Invite a person' })
      .getByRole('button', { name: 'Invite' })
      .click();
    await owner.locator('.tk-toast', { hasText: 'Invited' }).waitFor();
    await member.goto(`/signin?label=${who}`);
    await member.getByRole('button', { name: /continue/i }).click();
    await member.waitForURL(new RegExp(pid));
    await check(
      'access',
      'a member without rights cannot invite or merge through the API',
      async () => {
        const inv = await member.request.post(`/api/v1/projects/${pid}/members`, {
          headers: H,
          data: { email: 'y@local.test' },
        });
        expect(inv.status() === 403, `invite ${inv.status()}`);
        const t = await tracker(member, pid);
        const cr = t.crs.find((c) => c.status === 'ready');
        const m = await member.request.post(
          `/api/v1/projects/${pid}/tracker/crs/${cr.num}/actions`,
          { headers: H, data: { action: 'merge', expectedRevision: cr.revision, picks: {} } },
        );
        expect(m.status() === 403, `merge ${m.status()}`);
      },
      member,
    );
  },

  async project() {
    const page = (current = await newPage());
    await signIn(page, label('project'));
    const first = page.url();
    const sw = page.locator('details.proj-switch');
    const dialog = page.getByRole('dialog', { name: 'New project' });
    const open = async () => {
      await sw.locator('summary').click();
      await sw.getByRole('button', { name: '+ New project' }).click();
      await dialog.waitFor();
    };
    await check('project', 'New project: no team and a duplicate team are refused', async () => {
      await open();
      for (const t of ['Product', 'Design', 'Engineering', 'QA', 'Operations'])
        await dialog.getByRole('button', { name: `Remove ${t}` }).click();
      await dialog.getByText('Add at least one team').waitFor();
      const add = dialog.getByLabel('Add a team');
      await add.fill('Platform');
      await add.press('Enter');
      await add.fill('platform');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await dialog.getByText('Platform is already in the list.').waitFor();
      await add.fill('');
    });
    await check('project', 'New project: Esc closes the dialog', async () => {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    });
    await check(
      'project',
      'create a project with a first milestone; its graph starts empty',
      async () => {
        await open();
        await dialog.getByLabel('Project name').fill('QA portal');
        await dialog.getByLabel('Client').fill('QA Bank');
        await dialog.getByLabel('First milestone (optional)').fill('Portal live');
        await dialog.getByLabel('Milestone date').fill('20 Nov 2026');
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await page.waitForURL((u) => u.href !== first && /\/graph$/.test(u.pathname));
        await hydrated(page);
        await page.locator('.empty', { hasText: 'This project has no work yet.' }).waitFor();
        await page.locator('svg.pg-top-time', { hasText: 'Portal live' }).waitFor();
        expect(
          (await page.getByLabel('Demo: act as').count()) === 0,
          'Demo select in a real project',
        );
      },
    );
    await check(
      'project',
      'the switcher lists both projects and switches between them',
      async () => {
        await sw.locator('summary').click();
        const text = await sw.innerText();
        expect(/QA portal/.test(text) && /Larkspur/.test(text), text.replace(/\n/g, ' | '));
        await sw.getByText('Larkspur Capital', { exact: true }).last().click();
        await page.waitForURL(first);
      },
    );
    await errorsCheck('project', page);
  },

  async collab() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('collab'));
    const bar = page.locator('.bbar').first();
    const ask = page.locator('.ask-row');
    const toast = page.locator('.tk-toast');
    const visible = (t) => bar.locator(`text=${t} >> visible=true`).first();
    let num;
    await check(
      'collab',
      'Lan creates a change request, adds a change and shares Can edit with Khoa',
      async () => {
        await actAs(page, 'Lan Phạm');
        await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
        await page.locator('.m-card').getByRole('button', { name: 'Create', exact: true }).click();
        await page.waitForURL(/\/changes\/\d+$/);
        num = Number(page.url().split('/').pop());
        await hydrated(page);
        await addQueueEventByClick(page, 'Where is the root cause report', 'Sync incident report');
        await bar.getByRole('button', { name: 'Share' }).click();
        const m = page.locator('.m-card');
        await pick(m.getByLabel('Person'), { label: 'Khoa Lê' });
        await pick(m.getByLabel('Access', { exact: true }), 'edit');
        await m.getByRole('button', { name: 'Add', exact: true }).click();
        await toast.filter({ hasText: 'Khoa Lê can edit' }).waitFor();
        await m.getByRole('button', { name: 'Done' }).click();
      },
    );
    await check('collab', 'Khoa asks to edit; Lan presses Not now, then Hand over', async () => {
      await actAs(page, 'Khoa Lê');
      await visible('Lan is editing').waitFor();
      await bar.getByRole('button', { name: 'Ask to edit' }).click();
      await visible('Waiting for Lan').waitFor();
      await actAs(page, 'Lan Phạm');
      await ask.filter({ hasText: 'Khoa Lê asks to edit' }).waitFor();
      await ask.getByRole('button', { name: 'Not now' }).click();
      await ask.waitFor({ state: 'detached' });
      await actAs(page, 'Khoa Lê');
      await bar.getByRole('button', { name: 'Ask to edit' }).click();
      // Act as skips the write queue, so a switch before the answer shows the wrong person (finding of 19 Oct).
      await visible('Waiting for Lan').waitFor();
      await actAs(page, 'Lan Phạm');
      await ask.getByRole('button', { name: 'Hand over' }).click();
      await visible('Khoa is editing').waitFor();
    });
    await check(
      'collab',
      'Khoa marks it ready, presses Edit again, marks it ready again',
      async () => {
        await actAs(page, 'Khoa Lê');
        await bar.getByRole('button', { name: 'Mark as ready' }).click();
        await visible('Ready to merge').waitFor();
        await bar.getByRole('button', { name: 'Edit again' }).click();
        await visible('You are editing').waitFor();
        await bar.getByRole('button', { name: 'Mark as ready' }).click();
        await visible('Ready to merge').waitFor();
      },
    );
    await check(
      'collab',
      'the view selector opens All change requests and another change request',
      async () => {
        await actAs(page, 'Minh Trần');
        await bar.locator('.gpick > summary').click();
        await bar.getByRole('button', { name: 'All change requests' }).click();
        await page.locator('.drawer', { hasText: 'Change requests' }).waitFor();
        await page.keyboard.press('Escape');
        await bar.locator('.gpick > summary').click();
        await bar.locator('.gpick').getByRole('button', { name: /#13/ }).click();
        await page.waitForURL(/\/changes\/13$/);
      },
    );
    await check('collab', 'the view selector goes back to Main', async () => {
      await bar.locator('.gpick > summary').click();
      await bar.locator('.gpick').getByRole('button', { name: /^Main/ }).click();
      await page.waitForURL(/\/graph$/);
      await hydrated(page);
    });
    await check(
      'collab',
      'Minh merges #11, then #12 only after he picks a side for the clash',
      async () => {
        await page.goto(`/projects/${pid}/changes/11`);
        await hydrated(page);
        await bar.getByRole('button', { name: 'Merge into Main' }).click();
        await visible('Merged into Main').waitFor();
        await page.goto(`/projects/${pid}/changes/12`);
        await hydrated(page);
        const merge = bar.getByRole('button', { name: 'Merge into Main' });
        await page.getByRole('region', { name: 'Clashes with Main' }).waitFor();
        expect(await merge.isDisabled(), 'Merge enabled before a pick');
        await page.locator('.res-box input[type=radio][value="cr"]').first().check();
        await merge.click();
        await visible('Merged into Main').waitFor();
        const commit = (await tracker(page, pid)).commits.find((c) => c.crNum === 12);
        expect(commit?.resolutions?.length === 1, JSON.stringify(commit?.resolutions));
      },
    );
    await check(
      'collab',
      'Quang asks Hà for edit access to #13 and Hà grants Can edit',
      async () => {
        await page.goto(`/projects/${pid}/changes/13`);
        await hydrated(page);
        await actAs(page, 'Quang Nguyễn');
        await visible('View only.').waitFor();
        await bar.getByRole('button', { name: 'Ask for edit access' }).click();
        await visible('Waiting for Hà').waitFor();
        await actAs(page, 'Hà Đỗ');
        await ask.getByRole('button', { name: 'Grant Can edit' }).click();
        await toast.filter({ hasText: 'Quang Nguyễn can edit #13 now.' }).waitFor();
      },
    );
    await check('collab', `the ready change request reaches Main after a merge`, async () => {
      await actAs(page, 'Minh Trần');
      await page.goto(`/projects/${pid}/changes/${num}`);
      await hydrated(page);
      await bar.getByRole('button', { name: 'Merge into Main' }).click();
      await visible('Merged into Main').waitFor();
    });
    await errorsCheck('collab', page);
  },

  async api() {
    const owner = (current = await newPage());
    const pid = await signIn(owner, label('api-owner'));
    const stranger = await newPage();
    await signIn(stranger, label('api-stranger'));
    const anon = await newPage();
    const { readdirSync: ls, statSync: st, readFileSync: rf } = await import('node:fs');
    const walk = (d) =>
      ls(d).flatMap((f) =>
        st(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)],
      );
    const routes = walk('src/app/api/v1')
      .filter((f) => f.endsWith('route.ts'))
      .flatMap((f) =>
        [...rf(f, 'utf8').matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => ({
          method: m[1],
          path:
            '/' +
            path
              .dirname(path.relative('src/app', f))
              .replace('[projectId]', pid)
              .replace(/\[num\]/, '2')
              .replace(/\[index\]/, '0')
              .replace(/\[[^\]]+\]/g, '00000000-0000-0000-0000-000000000000'),
        })),
      );
    const call = (p, r, headers = {}) =>
      p.request.fetch(r.path, {
        method: r.method,
        headers,
        data: r.method === 'GET' ? undefined : {},
      });
    const H = { Origin: base };
    await check(
      'api',
      `${routes.length} API routes answer 401 without a session`,
      async () => {
        const bad = [];
        for (const r of routes) {
          const s = (await call(anon, r, H)).status();
          if (s !== 401) bad.push(`${r.method} ${r.path.replace(pid, '<id>')}: ${s}`);
        }
        expect(!bad.length, bad.join(' | '));
      },
      owner,
    );
    await check(
      'api',
      'project routes answer 404 to a person outside the project',
      async () => {
        const bad = [];
        for (const r of routes.filter((x) => x.path.includes(pid))) {
          const s = (await call(stranger, r, H)).status();
          if (s !== 404) bad.push(`${r.method} ${r.path.replace(pid, '<id>')}: ${s}`);
        }
        expect(!bad.length, bad.join(' | '));
      },
      owner,
    );
    await check(
      'api',
      'writes from another origin answer 403',
      async () => {
        const bad = [];
        for (const r of routes.filter((x) => x.method !== 'GET')) {
          const s = (await call(owner, r, { Origin: 'https://evil.example' })).status();
          if (s !== 403) bad.push(`${r.method} ${r.path.replace(pid, '<id>')}: ${s}`);
        }
        expect(!bad.length, bad.join(' | '));
      },
      owner,
    );
    await check(
      'api',
      'MCP refuses a missing or wrong token',
      async () => {
        for (const auth of [undefined, 'Bearer inv_wrong']) {
          const r = await anon.request.post('/mcp', {
            headers: {
              ...(auth ? { Authorization: auth } : {}),
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            },
            data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          });
          expect(r.status() === 401, `${auth ?? 'no token'}: ${r.status()}`);
        }
      },
      owner,
    );
  },

  async phone() {
    const page = (current = await newPage({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
      isMobile: true,
      hasTouch: true,
    }));
    const pid = await signIn(page, label('phone'));
    for (const p of ['graph', 'changes/11', 'changes/13', 'members', 'settings/tokens']) {
      await check('phone', `390 px dark: ${p} has no sideways scroll`, async () => {
        await page.goto(`/projects/${pid}/${p}`);
        await hydrated(page);
        await page.waitForTimeout(600);
        const s = await scrollX(page);
        expect(s === 0, `scrolls ${s} px sideways`);
      });
    }
    await check('phone', '390 px dark: the details panel fits', async () => {
      await page.goto(`/projects/${pid}/graph`);
      await hydrated(page);
      await page.getByRole('combobox', { name: 'Search work items' }).fill('PG-203');
      await page.keyboard.press('Enter');
      await page.locator('.drawer').waitFor();
      expect((await scrollX(page)) === 0, 'sideways scroll with the panel open');
    });
    await check('phone', '390 px: row names show on the first view of the graph', async () => {
      await page.goto(`/projects/${pid}/graph`);
      await hydrated(page);
      await page.waitForTimeout(600);
      const shown = await page.locator('svg.pg-side').evaluate((s) => {
        const r = s.getBoundingClientRect();
        return r.right > 40 && r.left < innerWidth - 40;
      });
      expect(shown, 'the row names are scrolled out of view');
    });
    const teamHead = (name) => page.locator(`svg.pg-side [data-teammenu][aria-label^="${name},"]`);
    const menu = page.getByRole('menu');
    const rowCount = () => page.locator('svg.pg [data-loop]').count();
    await check(
      'phone',
      'a tap on a team name opens its menu, a second tap closes it',
      async () => {
        await teamHead('Engineering').tap();
        const items = await menu.getByRole('menuitem').allInnerTexts();
        const first = await page.evaluate(() => document.activeElement.getAttribute('role'));
        await teamHead('Engineering').tap();
        await page.waitForTimeout(300);
        expect(
          items.join('|') === 'Collapse|Focus|Hide' &&
            first === 'menuitem' &&
            !(await menu.count()),
          `items ${items.join('|')}, focus on ${first}, open after a second tap: ${await menu.count()}`,
        );
      },
    );
    await check('phone', 'team menu: Collapse, then Expand, gives the focus back', async () => {
      const all = await rowCount();
      await teamHead('Engineering').tap();
      await menu.getByRole('menuitem', { name: 'Collapse Engineering' }).tap();
      const folded = await rowCount();
      const back = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
      await teamHead('Engineering').tap();
      await menu.getByRole('menuitem', { name: 'Expand Engineering' }).tap();
      expect(
        folded < all && (await rowCount()) === all && /^Engineering,.*collapsed$/.test(back),
        `rows ${all} → ${folded} → ${await rowCount()}, focus on ${back}`,
      );
    });
    await check(
      'phone',
      'team menu: arrow keys move, Esc closes, a tap outside closes',
      async () => {
        await teamHead('Engineering').tap();
        await page.keyboard.press('ArrowDown');
        const second = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
        await page.keyboard.press('Escape');
        const esc = await menu.count();
        await teamHead('Engineering').tap();
        await page.touchscreen.tap(300, 250);
        await page.waitForTimeout(300);
        expect(
          second === 'Focus on Engineering' && !esc && !(await menu.count()),
          `ArrowDown → ${second}, open after Esc ${esc}, after a tap outside ${await menu.count()}`,
        );
      },
    );
    await check(
      'phone',
      'team menu: Focus opens the Focus panel, Leave focus ends it',
      async () => {
        const all = await rowCount();
        await teamHead('Engineering').tap();
        await menu.getByRole('menuitem', { name: 'Focus on Engineering' }).tap();
        const panel = page.locator('.drawer', {
          has: page.getByRole('heading', { name: 'Focus' }),
        });
        await panel.waitFor();
        const focused = await rowCount();
        await panel.getByRole('button', { name: 'Leave focus' }).tap();
        await panel.waitFor({ state: 'detached' });
        expect(
          focused < all && (await rowCount()) === all,
          `rows ${all} → ${focused} → ${await rowCount()}`,
        );
      },
    );
    await check(
      'phone',
      'team menu: Hide hides the team and the badge brings it back',
      async () => {
        await teamHead('Customer Success').tap();
        await menu.getByRole('menuitem', { name: 'Hide Customer Success' }).tap();
        await teamHead('Customer Success').waitFor({ state: 'detached' });
        const on = await page.evaluate(() => document.activeElement.textContent.trim());
        await page.locator('.hid-menu > summary').tap();
        await page.getByRole('button', { name: /^Unhide all/ }).tap();
        await teamHead('Customer Success').waitFor();
        expect(/hidden/.test(on), `focus after Hide: ${on}`);
      },
    );
    const expandAll = async () => {
      const folded = page.locator('svg.pg-side [data-teammenu][aria-label$="collapsed"]');
      for (let i = 0; i < 12 && (await folded.count()); i++) {
        const h = folded.first();
        // A menu that opens low on the screen scrolls and closes at once (see the next check).
        await h.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        const b = await h.boundingBox();
        await page.touchscreen.tap(b.x + 30, b.y + b.height / 2);
        await menu.getByRole('menuitem', { name: /^Expand / }).tap();
        await menu.waitFor({ state: 'detached' });
      }
    };
    await check(
      'phone',
      'the menu of the lowest team on the screen opens with every item in reach',
      async () => {
        await page.goto(`/projects/${pid}/graph`);
        await hydrated(page);
        await page.waitForTimeout(600);
        await expandAll();
        await page.evaluate(() => scrollTo(0, 0));
        const barTop = (await page.getByRole('button', { name: 'Fit to width' }).boundingBox()).y;
        let last, box;
        for (const h of await page.locator('svg.pg-side [data-teammenu]').all()) {
          const b = await h.boundingBox();
          if (b.y + b.height < barTop) [last, box] = [h, b];
        }
        const name = (await last.getAttribute('aria-label')).split(',')[0];
        await page.touchscreen.tap(box.x + 30, box.y + box.height / 2);
        const opened = await menu.waitFor({ timeout: 2000 }).then(
          () => true,
          () => false,
        );
        expect(
          opened,
          `${name} at y ${Math.round(box.y)}: the menu closes at once (scrollY ${await page.evaluate(() => scrollY)})`,
        );
        const hidden = await menu.getByRole('menuitem').evaluateAll((items) =>
          items
            .filter((i) => {
              const r = i.getBoundingClientRect();
              const top = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
              return r.bottom > innerHeight || !i.contains(top);
            })
            .map((i) => i.textContent),
        );
        await page.keyboard.press('Escape');
        expect(!hidden.length, `${name}: out of reach or covered: ${hidden.join(', ')}`);
      },
    );
    await check('phone', 'a second tap on a handoff mark closes its list', async () => {
      const mark = page.locator('svg.pg [data-handoff][aria-label*="handoffs from"]').first();
      const shape = mark.locator('circle, rect, path, polygon').first();
      await shape.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
      await page.waitForTimeout(300);
      const b = await shape.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(300);
      const open = await page.locator('.hand-menu').count();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(300);
      expect(
        open === 1 && !(await page.locator('.hand-menu').count()),
        `open ${open}, then ${await page.locator('.hand-menu').count()}`,
      );
    });
    await check('phone', 'the zoom bar stays on the screen after a scroll', async () => {
      await page.evaluate(() => scrollTo(0, 0));
      const fit = page.getByRole('button', { name: 'Fit to width' });
      const y0 = (await fit.boundingBox()).y;
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const b = await fit.boundingBox();
      const vh = await page.evaluate(() => innerHeight);
      expect(
        b.y >= 0 && b.y + b.height <= vh,
        `bar at ${Math.round(y0)} → ${Math.round(b.y)} in ${vh}`,
      );
    });
    await check(
      'phone',
      'a change request opens with its first change above the zoom bar, with every team open',
      async () => {
        await page.goto(`/projects/${pid}/graph`);
        await hydrated(page);
        await expandAll();
        await page.goto(`/projects/${pid}/changes/13`);
        await hydrated(page);
        await page.waitForTimeout(1500);
        const r = await page.evaluate(() => {
          const marks = [...document.querySelectorAll('svg.pg .halo')].map(
            (m) => m.getBoundingClientRect().bottom,
          );
          const bar = document
            .querySelector('button[aria-label="Fit to width"]')
            ?.getBoundingClientRect().top;
          return { first: Math.round(Math.min(...marks)), bar: Math.round(bar), n: marks.length };
        });
        expect(r.n > 0 && r.first < r.bar, JSON.stringify(r));
      },
    );
    await errorsCheck('phone', page);
  },
  async profile() {
    const page = (current = await newPage());
    const pid = await signIn(page, label('profile'));
    const H = { Origin: base };
    const ALL = [
      'project:read',
      'queue:add',
      'queue:dismiss',
      'crs:edit',
      'crs:ready',
      'crs:comment',
      'crs:merge',
      'crs:close',
      'members:manage',
      'teams:manage',
    ];
    const sharp = createRequire(path.resolve('package.json'))('sharp');
    const png = (w, h, background = '#e11d48') =>
      sharp({ create: { width: w, height: h, channels: 3, background } })
        .png()
        .toBuffer();
    const rpc = async (method, params, token) => {
      const r = await page.request.post('/mcp', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        data: { jsonrpc: '2.0', id: 1, method, params },
      });
      return { status: r.status(), body: await r.json().catch(() => ({})) };
    };
    const call = async (token, name, args = {}) => {
      const { body } = await rpc('tools/call', { name, arguments: args }, token);
      const text = body.result?.content?.[0]?.text ?? JSON.stringify(body.error ?? body);
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return {
        error: !!body.result?.isError || !!body.error,
        data,
        text: String(text).slice(0, 160),
      };
    };
    const ok = async (token, name, args) => {
      const r = await call(token, name, args);
      expect(!r.error, `${name}: ${r.text}`);
      return r.data;
    };
    const me = async () =>
      (await (await page.request.get(`/api/v1/projects/${pid}/members`)).json()).members.find(
        (m) => m.you,
      );
    // One stranger for every check, so the live app gets one copy fewer per check.
    let other;
    const stranger = async () => {
      if (!other) {
        const p = await newPage();
        other = { page: p, pid: await signIn(p, label('stranger')) };
      }
      return other;
    };
    const menu = page.locator('details.acct.me');
    await check(
      'profile',
      'the account menu opens Profile with Photo, Personal keys and the MCP setup',
      async () => {
        await menu.locator('summary').click();
        await menu.getByRole('link', { name: 'Profile' }).click();
        await page.waitForURL(/\/profile$/);
        await hydrated(page);
        for (const h of ['Photo', 'Personal keys', 'Create a personal key'])
          await page.getByRole('heading', { name: new RegExp(`^${h}`) }).waitFor();
        expect((await page.title()).startsWith('Profile'), `title ${await page.title()}`);
        expect((await page.locator('main').count()) === 1, 'not one main landmark');
      },
    );
    const dialog = page.getByRole('dialog', { name: 'Upload a photo' });
    const fileInput = page.getByLabel('Photo file');
    await check(
      'profile',
      'the photo dialog refuses a GIF and a file over 5 MB with the rule',
      async () => {
        await page.getByRole('button', { name: 'Upload photo' }).click();
        await dialog.waitFor();
        const gif = Buffer.from(
          '47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b',
          'hex',
        );
        await fileInput.setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: gif });
        await dialog
          .getByRole('alert')
          .filter({ hasText: 'Use a PNG, JPEG or WebP under 5 MB.' })
          .waitFor();
        expect(
          await dialog.getByRole('button', { name: 'Save photo' }).isDisabled(),
          'Save on a GIF',
        );
        await fileInput.setInputFiles({
          name: 'big.png',
          mimeType: 'image/png',
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        });
        await dialog.getByRole('alert').waitFor();
        expect(
          await dialog.getByRole('button', { name: 'Save photo' }).isDisabled(),
          'Save on 5 MB + 1',
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
      },
    );
    let photo = null;
    await check(
      'profile',
      'Upload photo: a PNG shows on Profile, in the account menu and on Members',
      async () => {
        await page.getByRole('button', { name: 'Upload photo' }).click();
        await fileInput.setInputFiles({
          name: 'me.png',
          mimeType: 'image/png',
          buffer: await png(640, 480),
        });
        await dialog.locator('.pf-face img').waitFor();
        await dialog.getByRole('button', { name: 'Save photo' }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Remove photo' }).waitFor();
        photo = (await me()).photo;
        expect(photo, 'Members API has no photo for you');
        const r = await page.request.get(photo);
        expect(
          r.status() === 200 && r.headers()['content-type'] === 'image/webp',
          `photo ${r.status()}`,
        );
        expect(await menu.locator('summary img').count(), 'no photo in the account menu');
        await page.goto(`/projects/${pid}/members`);
        await hydrated(page);
        await page.locator(`img[src="${photo}"]`).first().waitFor();
        await page.goto(`/projects/${pid}/profile`);
        await hydrated(page);
      },
    );
    await check('profile', 'a stranger cannot load the photo', async () => {
      expect(photo, 'no photo');
      const r = await (await stranger()).page.request.get(photo);
      expect([403, 404].includes(r.status()), `stranger got ${r.status()}`);
    });
    await check(
      'profile',
      'the server refuses text sent as a PNG and a PNG over 16 megapixels',
      async () => {
        const put = (data) =>
          page.request.put('/api/v1/me/avatar', {
            headers: { ...H, 'Content-Type': 'image/png' },
            data,
          });
        let r = await put(Buffer.from('not an image, only text'));
        let b = await r.json();
        expect(
          r.status() === 400 && /PNG, JPEG or WebP/.test(b.message),
          `text: ${r.status()} ${b.message}`,
        );
        r = await put(await png(4200, 4000));
        b = await r.json();
        expect(
          r.status() === 400 && /megapixels/.test(b.message),
          `16.8 MP: ${r.status()} ${b.message}`,
        );
        if (!live) {
          r = await put(Buffer.alloc(5 * 1024 * 1024 + 1));
          expect(r.status() >= 400 && r.status() < 500, `5 MB + 1: ${r.status()}`);
        }
        expect((await me()).photo === photo, 'a refused upload changed the photo');
      },
    );
    await check('profile', 'Remove photo brings back the initials', async () => {
      await page.getByRole('button', { name: 'Remove photo' }).click();
      // The button reads Removing… until the refresh ends, then leaves.
      await page.getByRole('button', { name: /^Remov/ }).waitFor({ state: 'detached' });
      expect((await me()).photo === null, 'Members API still has a photo');
      expect(
        (await menu.locator('summary img').count()) === 0,
        'the account menu still has a photo',
      );
    });
    let uiKey = '';
    await check('profile', 'Create key shows the secret once; the key is listed', async () => {
      await fillStable(page.getByLabel('Label'), 'QA personal');
      await page.getByRole('button', { name: 'Create key' }).click();
      await page.getByRole('button', { name: 'Copy secret' }).click();
      uiKey = (await page.evaluate(() => navigator.clipboard.readText())).trim();
      expect(/^inv_/.test(uiKey), 'no secret in the clipboard');
      await page
        .getByRole('table', { name: 'Your personal keys' })
        .getByText('QA personal')
        .first()
        .waitFor();
    });
    const minted = await page.request.post('/api/v1/me/keys', {
      headers: H,
      data: { label: 'QA key all', scopes: ALL, idempotencyKey: `qa-key-${run}` },
    });
    const key = (await minted.json().catch(() => ({}))).secret ?? '';
    await check(
      'profile',
      'a personal key says so, lists list_projects, and every tool needs projectId',
      async () => {
        expect(minted.status() === 201 && key, `mint ${minted.status()}`);
        const init = await rpc(
          'initialize',
          {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'qa', version: '1' },
          },
          uiKey,
        );
        expect(
          /personal key/.test(init.body.result?.instructions ?? ''),
          'instructions do not say personal key',
        );
        const tools = (await rpc('tools/list', {}, key)).body.result.tools;
        expect(
          tools.some((t) => t.name === 'list_projects'),
          'no list_projects',
        );
        const loose = tools.filter(
          (t) => t.name !== 'list_projects' && !t.inputSchema.required?.includes('projectId'),
        );
        expect(!loose.length, `projectId optional in ${loose.map((t) => t.name)}`);
        const list = await ok(key, 'list_projects');
        expect(
          list.projects.some((p) => p.id === pid),
          'list_projects misses the project',
        );
        const bare = await call(key, 'get_project');
        expect(bare.error, 'get_project without projectId works');
        const got = await ok(key, 'get_project', { projectId: pid });
        expect(got.projectId === pid, 'no projectId in the answer');
      },
    );
    await check(
      'profile',
      'a personal key reaches a new project of its person and no stranger project',
      async () => {
        const r = await page.request.post('/api/v1/projects', {
          headers: H,
          data: {
            title: `QA second ${run}`,
            clientName: 'QA',
            teams: ['QA team'],
            milestone: null,
          },
        });
        const body = await r.json();
        const second = body.project?.id ?? body.id;
        expect(r.status() === 201 && second, `create project ${r.status()}`);
        expect(
          (await ok(key, 'list_projects')).projects.some((p) => p.id === second),
          'new project missing',
        );
        await ok(key, 'get_tracker', { projectId: second });
        const r2 = await call(key, 'get_project', { projectId: (await stranger()).pid });
        expect(r2.error && r2.data?.code === 'NOT_FOUND', `stranger project: ${r2.text}`);
      },
    );
    await check(
      'profile',
      'a project token has no list_projects and refuses projectId',
      async () => {
        const r = await page.request.post(`/api/v1/projects/${pid}/agent-tokens`, {
          headers: H,
          data: { label: 'qa-project', scopes: ['project:read'], idempotencyKey: `qa-pt-${run}` },
        });
        const token = (await r.json()).secret;
        const tools = (await rpc('tools/list', {}, token)).body.result.tools.map((t) => t.name);
        expect(!tools.includes('list_projects'), 'list_projects listed');
        const lp = await call(token, 'list_projects');
        expect(lp.error && lp.data?.code === 'NOT_FOUND', `list_projects: ${lp.text}`);
        expect((await call(token, 'get_project', { projectId: pid })).error, 'projectId accepted');
      },
    );
    await check(
      'profile',
      'an event added with a key is by its person, with no Agent chip',
      async () => {
        const you = await me();
        await ok(key, 'add_queue_event', {
          projectId: pid,
          kind: 'issue',
          at: '2026-10-09T16:30+07:00',
          text: 'QA key event',
        });
        const ev = (await tracker(page, pid)).queue.events.find((e) => e.text === 'QA key event');
        expect(ev?.by === you.id, `by ${ev?.by}, you ${you.id}`);
        await page.goto(`/projects/${pid}/graph`);
        await hydrated(page);
        await page.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
        await page.locator('.m-card').getByLabel('Name').fill('QA key queue');
        await page.locator('.m-card').getByRole('button', { name: 'Create', exact: true }).click();
        await page.waitForURL(/\/changes\/\d+$/);
        await hydrated(page);
        const card = page.locator('.qc', { hasText: 'QA key event' }).first();
        await card.waitFor();
        const who = await card.locator('.who').innerText();
        expect(who === you.name, `card by ${who}`);
        expect((await card.locator('.bot').count()) === 0, 'Agent chip shows');
      },
    );
    await check(
      'profile',
      'a change merged with a key shows "via key <label>" in History',
      async () => {
        let d = await ok(key, 'create_change_request', {
          projectId: pid,
          title: 'QA key change',
          ops: [{ op: 'rename', a: { workItemId: 'golive', title: 'Go-live date (key)' } }],
        });
        const num = d.changeRequest.num;
        d = await ok(key, 'mark_ready', {
          projectId: pid,
          num,
          expectedRevision: d.changeRequest.revision,
        });
        d = await ok(key, 'merge_change_request', {
          projectId: pid,
          num,
          expectedRevision: d.changeRequest.revision,
        });
        expect(d.changeRequest.status === 'merged', `status ${d.changeRequest.status}`);
        await page.goto(`/projects/${pid}/graph`);
        await hydrated(page);
        await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
        const drawer = page.locator('.drawer', { hasText: 'QA key change' });
        await drawer.getByText('via key QA key all').first().waitFor();
        await page.keyboard.press('Escape');
      },
    );
    await check('profile', 'Revoke ends the personal key at once', async () => {
      await page.goto(`/projects/${pid}/profile`);
      await hydrated(page);
      const row = page.getByRole('row', { name: /QA personal/ });
      await row.getByRole('button', { name: 'Revoke' }).click();
      await page.getByRole('button', { name: 'Confirm revoke' }).click();
      await row.getByText(/Revoked/).waitFor();
      expect((await rpc('tools/list', {}, uiKey)).status === 401, 'the key still works');
    });
    await errorsCheck('profile', page);
    if (other) await other.page.context().close();
  },

  // v0.1.4: the screen changes only on the person's own writes and on Refresh. A second tab of the
  // same person stands in for another person, so this area also runs on the deployed app.
  async fresh() {
    const page = (current = await newPage());
    // The check runs every 5 minutes, so the area moves the page clock instead of waiting.
    await page.clock.install();
    const pid = await signIn(page, label('fresh'));
    const bar = page.locator('.bbar').first();
    const notice = bar.locator('.fresh');
    const toast = page.locator('.tk-toast');
    const chip = bar.locator('.chipx').first();
    let checks = 0;
    let reads = 0;
    page.on('request', (r) => {
      const at = new URL(r.url()).pathname;
      if (at.endsWith('/tracker/version')) checks += 1;
      else if (at.endsWith('/tracker')) reads += 1;
    });
    const other = await page.context().newPage();
    const crs = `/api/v1/projects/${pid}/tracker/crs`;
    const post = (p, at, body) =>
      p.evaluate(
        async ({ at, body }) => {
          const r = await fetch(at, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { status: r.status, body: await r.json() };
        },
        { at, body },
      );
    const first = await tracker(page, pid);
    // Since 0.1.6 the base is empty and Main comes from the merged history, so the seed id is used.
    const itemId = 'secret';
    const rename = (title) => ({ op: 'rename', a: { workItemId: itemId, title } });
    const graph = `/projects/${pid}/graph`;
    // A return to the tab checks at once; the real tab never hides in a headless run.
    const comeBack = () =>
      page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const noticeSays = async (text) => {
      await comeBack();
      await page.waitForFunction(
        (t) =>
          document.querySelector('.bbar .fresh')?.textContent.replace(/\s+/g, ' ').trim() === t,
        `${text} · Refresh`,
        { timeout: 10000 },
      );
    };
    const settle = () => page.waitForTimeout(1000);
    const viewMenu = async () => {
      await bar.locator('summary.vsel').click();
      const text = await bar.locator('.gmenu').innerText();
      await page.keyboard.press('Escape');
      return text;
    };
    let draft = 0;

    await check(
      'fresh',
      'the graph asks for news every 5 minutes with a light read, and never reads the whole tracker',
      async () => {
        await page.goto(graph);
        await hydrated(page);
        checks = 0;
        reads = 0;
        await page.clock.runFor(16_000);
        await settle();
        const early = checks;
        await page.clock.runFor(5 * 60_000);
        await settle();
        const later = checks;
        await page.clock.runFor(5 * 60_000);
        await settle();
        expect(early === 0, `${early} version checks in the first 16 s`);
        expect(later === 1, `${later} version checks in 5 min 16 s`);
        expect(checks === 2, `${checks} version checks in 10 min 16 s`);
        expect(reads === 0, `${reads} full tracker reads`);
        expect((await notice.count()) === 0, 'a notice shows with no news');
        return `0 checks in 16 s, 1 in 5 min, 2 in 10 min, 0 full reads`;
      },
    );

    await check(
      'fresh',
      'a focus after a minute away checks at once, and a shorter absence does not',
      async () => {
        const away = async (ms) => {
          await page.evaluate(() => window.dispatchEvent(new Event('blur')));
          await page.clock.runFor(ms);
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await settle();
        };
        checks = 0;
        await away(30_000);
        const short = checks;
        await away(61_000);
        expect(short === 0, `${short} checks after 30 s away`);
        expect(checks === 1, `${checks} checks after 61 s away`);
      },
    );

    await check(
      'fresh',
      'a change request made in another tab waits: "1 new change request · Refresh", and the screen stays',
      async () => {
        await other.goto(graph);
        await hydrated(other);
        await other.locator('.p-head').getByRole('button', { name: 'New change request' }).click();
        await other.locator('.m-card').getByLabel('Name').fill('QA: a second tab');
        await other.locator('.m-card').getByRole('button', { name: 'Create', exact: true }).click();
        await other.waitForURL(/\/changes\/\d+$/);
        draft = Number(other.url().split('/').pop());
        await noticeSays('1 new change request');
        expect(
          !(await viewMenu()).includes('QA: a second tab'),
          'the view menu changed before Refresh',
        );
        return `#${draft} stays out of the view menu until Refresh`;
      },
    );

    await check(
      'fresh',
      'Refresh shows the news, hides the notice and keeps the open details',
      async () => {
        await page.getByRole('combobox', { name: 'Search work items' }).fill('PG-203');
        await page.keyboard.press('Enter');
        const drawer = page.locator('.drawer');
        await drawer.waitFor();
        const name = await drawer.getAttribute('aria-label');
        await notice.getByRole('button', { name: 'Refresh' }).click();
        await notice.waitFor({ state: 'detached' });
        expect((await drawer.getAttribute('aria-label')) === name, 'the details closed');
        await page.keyboard.press('Escape');
        expect(
          (await viewMenu()).includes('QA: a second tab'),
          'the view menu has no new change request',
        );
      },
    );

    await check(
      'fresh',
      'a merge in another tab names it: "Main changed · Refresh"; Refresh shows it in History',
      async () => {
        const t = await tracker(page, pid);
        let num = t.crs.find((c) => c.status === 'ready')?.num;
        if (!num) {
          num = (await post(page, crs, { title: 'QA: ready', ops: [rename('QA ready')] })).body.num;
          await post(page, `${crs}/${num}/actions`, { action: 'ready' });
        }
        await other.goto(`/projects/${pid}/changes/${num}`);
        await hydrated(other);
        await other
          .locator('.bbar')
          .first()
          .getByRole('button', { name: 'Merge into Main' })
          .click();
        await other.locator('.bbar').first().filter({ hasText: 'Merged into Main' }).waitFor();
        await noticeSays('Main changed');
        await notice.getByRole('button', { name: 'Refresh' }).click();
        await notice.waitFor({ state: 'detached' });
        await page.locator('.p-head').getByRole('button', { name: 'History' }).click();
        const title = t.crs.find((c) => c.num === num)?.title ?? 'QA: ready';
        await page.locator('.drawer, [role="dialog"]').filter({ hasText: title }).first().waitFor();
        await page.keyboard.press('Escape');
        return `#${num} merged in the other tab`;
      },
    );

    await check(
      'fresh',
      'a queue card added in another tab names it: "The Queue changed · Refresh"',
      async () => {
        const r = await post(page, `/api/v1/projects/${pid}/tracker/queue`, {
          kind: 'item',
          fields: {
            title: 'QA: a card from another tab',
            doneBy: first.me.id,
            requestedBy: first.me.id,
            plannedFinish: '2026-11-06',
          },
        });
        expect(r.status === 201, `queue add answered ${r.status}`);
        await noticeSays('The Queue changed');
        await notice.getByRole('button', { name: 'Refresh' }).click();
        await notice.waitFor({ state: 'detached' });
      },
    );

    await check(
      'fresh',
      'on a change request, a change from another tab says "This change request changed"',
      async () => {
        const append = async (title) => {
          const rev = (await tracker(page, pid)).crs.find((c) => c.num === draft).revision;
          const r = await post(other, `${crs}/${draft}/ops`, {
            op: rename(title),
            expectedRevision: rev,
          });
          expect(r.status === 200, `append answered ${r.status}`);
        };
        await append('QA: renamed before');
        await page.goto(`/projects/${pid}/changes/${draft}`);
        await hydrated(page);
        await bar.filter({ hasText: 'You are editing' }).waitFor();
        await bar.filter({ hasText: '1 change' }).waitFor();
        await append('QA: renamed in another tab');
        await noticeSays('This change request changed');
        expect(
          (await changeCount(page)) === 1,
          `the screen shows ${await changeCount(page)} changes before Refresh`,
        );
      },
    );

    await check(
      'fresh',
      'Mark as ready on an old version is refused with a toast that offers Refresh',
      async () => {
        await bar.getByRole('button', { name: 'Mark as ready' }).click();
        await toast.filter({ hasText: `#${draft} changed since you saw it.` }).waitFor();
        expect((await chip.innerText()).trim() === 'Draft', `chip ${await chip.innerText()}`);
        await toast.getByRole('button', { name: 'Refresh' }).click();
        await bar.filter({ hasText: '2 changes' }).waitFor();
        await notice.waitFor({ state: 'detached' });
      },
    );

    await check('fresh', 'an own write shows at once and raises no notice', async () => {
      await bar.getByRole('button', { name: 'Mark as ready' }).click();
      await chip.filter({ hasText: 'Ready to merge' }).waitFor();
      await comeBack();
      await settle();
      expect(
        (await notice.count()) === 0,
        `notice: ${await notice
          .first()
          .innerText()
          .catch(() => '')}`,
      );
    });

    await check(
      'fresh',
      'a hidden tab sends no check, and checks at once when it shows again',
      async () => {
        const show = (state) =>
          page.evaluate((value) => {
            Object.defineProperty(document, 'visibilityState', {
              configurable: true,
              get: () => value,
            });
            document.dispatchEvent(new Event('visibilitychange'));
          }, state);
        await show('hidden');
        checks = 0;
        await page.clock.runFor(10 * 60_000);
        await settle();
        const hidden = checks;
        await show('visible');
        await settle();
        expect(hidden === 0, `${hidden} checks while hidden`);
        expect(checks === 1, `${checks} checks after it showed`);
      },
    );

    await check(
      'fresh',
      '390 px: the notice fits in the bar, with no sideways scroll',
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(graph);
        await hydrated(page);
        await post(other, crs, { title: 'QA: phone news', ops: [rename('QA phone')] });
        await noticeSays('1 new change request');
        const box = await notice.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= 390, `notice at ${JSON.stringify(box)}`);
        expect((await scrollX(page)) <= 0, `scrolls ${await scrollX(page)} px sideways`);
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    );

    await other.close();
    await errorsCheck('fresh', page);
  },

  async visitor() {
    expect(demo, 'visitor needs a server in demo mode and --demo');
    const UA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
    // Follows redirects by hand, so the check sees every Location and every Set-Cookie.
    const hops = async (url, { method = 'GET', headers = {} } = {}) => {
      const ctx = await browser.newContext({ baseURL: base });
      const seen = [];
      let cookie = false;
      try {
        for (let i = 0; i < 6; i++) {
          const r = await ctx.request.fetch(url, { method, headers, maxRedirects: 0 });
          if (r.headers()['set-cookie']) cookie = true;
          seen.push(`${r.status()} ${new URL(url, base).pathname}${new URL(url, base).search}`);
          const next = r.headers()['location'];
          if (!next) break;
          url = next;
        }
      } finally {
        await ctx.close();
      }
      return { last: new URL(url, base), seen, cookie };
    };
    await check(
      'visitor',
      'a link preview, curl, a HEAD and a prefetch get the welcome page and no cookie',
      async () => {
        const html = { Accept: 'text/html' };
        const probes = {
          slack: { headers: { ...html, 'User-Agent': 'Slackbot-LinkExpanding 1.0' } },
          curl: { headers: { ...html, 'User-Agent': 'curl/8.7.1' } },
          head: { method: 'HEAD', headers: { ...html, 'User-Agent': UA } },
          prefetch: { headers: { ...html, 'User-Agent': UA, 'Next-Router-Prefetch': '1' } },
        };
        for (const [name, o] of Object.entries(probes)) {
          const h = await hops('/', o);
          expect(
            h.last.pathname === '/welcome' && !h.cookie,
            `${name}: ${h.seen.join(' → ')} cookie ${h.cookie}`,
          );
        }
      },
    );
    await check(
      'visitor',
      'a browser that drops the cookie stops at the cookie page with no new copy',
      async () => {
        const h = await hops('/api/auth/demo?check=1', {
          headers: { Accept: 'text/html', 'User-Agent': UA },
        });
        expect(
          h.last.pathname === '/welcome' && h.last.search === '?reason=cookies' && !h.cookie,
          h.seen.join(' → '),
        );
        const p = await newPage();
        await p.goto('/welcome?reason=cookies');
        await p.getByRole('heading', { name: 'This browser did not keep the cookie' }).waitFor();
        await p.getByRole('link', { name: 'Open the demo' }).waitFor();
        await p.context().close();
      },
    );
    const page = (current = await newPage());
    let pid;
    await check(
      'visitor',
      'the welcome page: Open the demo opens a new Larkspur copy with no sign-in',
      async () => {
        await page.goto('/welcome');
        await page.getByRole('heading', { name: 'Live demo' }).waitFor();
        await page.getByRole('link', { name: 'Open the demo' }).click();
        await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
        await hydrated(page);
        pid = page.url().split('/')[4];
        await page.getByText('Larkspur').first().waitFor();
      },
    );
    await check('visitor', 'a second visit and a reload keep the same copy', async () => {
      await page.goto('/');
      await page.waitForURL(/\/graph$/);
      await page.reload();
      expect(page.url().split('/')[4] === pid, `${page.url()} is not ${pid}`);
    });
    const menu = page.locator('details.acct.me');
    await check(
      'visitor',
      'the account menu says it is your own copy, with Profile and Start over and no Sign out',
      async () => {
        await hydrated(page);
        await menu.locator('summary').click();
        await menu.getByText('Your own demo copy. Nobody else sees your changes.').waitFor();
        await menu.getByRole('link', { name: 'Profile' }).waitFor();
        await menu.getByRole('button', { name: 'Start over' }).waitFor();
        expect(
          (await menu.getByRole('button', { name: 'Sign out' }).count()) === 0,
          'Sign out shows',
        );
        const said = await menu.locator('summary').getAttribute('aria-label');
        expect(/start over/.test(said), `summary says ${said}`);
        await page.keyboard.press('Escape');
      },
    );
    await check('visitor', 'each page of the copy opens with one main landmark', async () => {
      for (const p of [
        'members',
        'settings/tokens',
        'profile',
        'changes/11',
        'changes/13',
        'graph',
      ]) {
        await page.goto(`/projects/${pid}/${p}`);
        await hydrated(page);
        expect((await page.locator('main').count()) === 1, `${p}: not one main`);
      }
    });
    let other;
    await check(
      'visitor',
      "a new visitor with a link to someone's copy gets a copy of their own",
      async () => {
        other = await newPage();
        await other.goto(`/projects/${pid}/graph`);
        await other.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
        const theirs = other.url().split('/')[4];
        expect(theirs !== pid, 'the new visitor opened the first copy');
      },
    );
    await check('visitor', "a visitor cannot open another visitor's copy", async () => {
      const theirs = other.url().split('/')[4];
      const r = await page.goto(`/projects/${theirs}/graph`);
      expect(r.status() === 404, `status ${r.status()} at ${page.url()}`);
      const api = await page.request.get(`/api/v1/projects/${theirs}/tracker`);
      expect(api.status() === 404, `API ${api.status()}`);
      await other.context().close();
    });
    await check(
      'visitor',
      'Start over opens a new copy, and the old copy is gone from this browser',
      async () => {
        await page.goto(`/projects/${pid}/graph`);
        await hydrated(page);
        await menu.locator('summary').click();
        await menu.getByRole('button', { name: 'Start over' }).click();
        const sure = page.getByRole('dialog').filter({ hasText: 'Start over?' });
        await sure.getByRole('button', { name: 'Start over' }).click();
        await page.waitForURL((u) => /\/graph$/.test(u.pathname) && !u.pathname.includes(pid));
        const fresh = page.url().split('/')[4];
        const r = await page.goto(`/projects/${pid}/graph`);
        expect(r.status() === 404, `old copy: ${r.status()}`);
        pid = fresh;
      },
    );
    await check('visitor', 'Start over from another site is refused', async () => {
      const r = await page.request.post('/api/auth/demo', {
        headers: { Origin: 'https://evil.example' },
        maxRedirects: 0,
      });
      expect(r.status() === 403 && !r.headers()['set-cookie'], `status ${r.status()}`);
    });
    if (!live)
      await check(
        'visitor',
        'the 31st new copy in an hour from one address gets the busy page',
        async () => {
          const headers = {
            Accept: 'text/html',
            'User-Agent': UA,
            'X-Forwarded-For': `203.0.113.${(Date.now() % 200) + 1}`,
          };
          let made = 0;
          let busy = null;
          for (let i = 0; i < 32 && !busy; i++) {
            const ctx = await browser.newContext({ baseURL: base });
            const r = await ctx.request.get('/api/auth/demo', { headers, maxRedirects: 0 });
            const at = r.headers()['location'] ?? '';
            if (/reason=busy/.test(at)) busy = i + 1;
            else if (r.headers()['set-cookie']) made++;
            await ctx.close();
          }
          expect(made === 30 && busy === 31, `made ${made}, busy at ${busy}`);
          const p = await newPage();
          await p.goto('/welcome?reason=busy');
          await p.getByRole('heading', { name: 'Too many new demo copies' }).waitFor();
          expect(
            (await p.getByRole('link', { name: 'Open the demo' }).count()) === 0,
            'Open the demo shows',
          );
          await p.context().close();
        },
      );
    await errorsCheck('visitor', page);
  },
};

/**
 * Cuts from each page's clip the time of the checks that ran on it, in the order the checks ran, so the
 * video is as long as the run. A phone clip sits in the middle of the desktop frame.
 */
async function joinClips() {
  const { spawnSync } = await import('node:child_process');
  const { rmSync } = await import('node:fs');
  for (const c of clips)
    await c.page
      .context()
      .close()
      .catch(() => {});
  for (const c of clips)
    c.raw = await c.page
      .video()
      ?.path()
      .catch(() => null);
  const segments = [];
  for (const e of results) {
    const c = clips[e.clipPage];
    if (!c?.raw || !existsSync(c.raw) || e.clipAt === undefined) continue;
    const from = (e.clipAt - c.at) / 1000;
    const to = (e.clipEnd - c.at) / 1000;
    const last = segments.at(-1);
    if (last && last.clip === c && from - last.to < 1.5) last.to = to;
    else segments.push({ clip: c, from, to, checks: [] });
    segments.at(-1).checks.push(e);
  }
  const parts = [];
  let offset = 0;
  for (const [i, g] of segments.entries()) {
    const part = path.join(videoDir, 'raw', `part-${String(i).padStart(3, '0')}.mp4`);
    const r = spawnSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      g.clip.raw,
      '-ss',
      String(Math.max(0, g.from)),
      '-to',
      String(g.to),
      '-vf',
      'scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0x111827,fps=25,setsar=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '24',
      part,
    ]);
    if (r.status !== 0) continue;
    for (const e of g.checks)
      e.videoAt = Math.round(offset + (e.clipAt - g.clip.at) / 1000 - g.from);
    offset += g.to - Math.max(0, g.from);
    parts.push(part);
  }
  const list = path.join(videoDir, 'raw', 'list.txt');
  writeFileSync(list, parts.map((p) => `file '${path.resolve(p)}'`).join('\n'));
  const file = path.join(videoDir, `qa-${tag || 'local'}.mp4`);
  const r = spawnSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    file,
  ]);
  for (const e of results) {
    if (e.videoAt !== undefined) e.video = path.relative(out, file);
    delete e.clipAt;
    delete e.clipEnd;
    delete e.clipPage;
  }
  if (r.status === 0) rmSync(path.join(videoDir, 'raw'), { recursive: true, force: true });
  console.log(
    r.status === 0
      ? `VIDEO ${file} (${Math.round(offset)} s)`
      : `VIDEO failed; clips stay in ${path.join(videoDir, 'raw')}`,
  );
}

for (const a of areas) {
  console.log(`== ${a}`);
  try {
    await suites[a]();
  } catch (e) {
    results.push({
      area: tag ? `${tag} ${a}` : a,
      name: 'area setup',
      status: 'fail',
      note: String(e.message || e).split('\n')[0],
      shot: null,
      ms: 0,
    });
    console.log(`FAIL ${a}: area setup — ${e.message}`);
  }
}
if (videoDir) await joinClips();
await browser.close();
const failed = results.filter((r) => r.status === 'fail').length;
const file = path.join(out, 'results.json');
const before =
  process.argv.includes('--append') && existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { areas: [], results: [] };
writeFileSync(
  file,
  JSON.stringify(
    {
      base,
      areas: [...before.areas, ...areas.map((a) => (tag ? `${tag} ${a}` : a))],
      at: new Date().toISOString(),
      results: [...before.results, ...results],
    },
    null,
    1,
  ),
);
console.log(
  `\n${results.length} checks, ${results.length - failed} pass, ${failed} fail → ${path.join(out, 'results.json')}`,
);
process.exit(failed ? 1 : 0);
