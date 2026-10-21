// The owner demo video: a new owner creates a project, invites people, plans work in a change request and merges it.
// Run from the QA worktree root (ffmpeg turns the .webm into .mp4 afterwards):
//   node .claude/skills/et-qa/scripts/demo.mjs --base http://localhost:<port> --out <dir> [--label demo-owner]
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(
  pathToFileURL(path.resolve('node_modules/@playwright/test/index.mjs')).href
);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base');
const OUT = arg('out');
// Local sign-in labels allow a-z, 0-9 and "-" only.
const LABEL = arg('label', `demo-owner-${Date.now().toString(36)}`);
if (!BASE || !OUT) {
  console.error('usage: demo.mjs --base <url> --out <dir> [--label name]');
  process.exit(2);
}
const SHOTS = OUT + '/shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ slowMo: 40 });
const ctx = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
  recordVideo: { dir: OUT + '/raw', size: { width: 1440, height: 900 } },
});
const problems = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200));
});

await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById('qa-cursor')) return;
    const c = document.createElement('div');
    c.id = 'qa-cursor';
    c.style.cssText =
      'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,196,0,.45);border:2px solid #d97706;pointer-events:none;left:-50px;top:-50px;transition:transform .12s';
    document.documentElement.appendChild(c);
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
    const cap = document.createElement('div');
    cap.id = 'qa-caption';
    cap.style.cssText =
      'position:fixed;z-index:2147483646;left:50%;bottom:64px;transform:translateX(-50%);max-width:900px;padding:10px 18px;border-radius:10px;background:rgba(17,24,39,.88);color:#fff;font:600 17px/1.4 system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.25)';
    cap.textContent = sessionStorage.getItem('qa-caption') || '';
    cap.style.display = cap.textContent ? 'block' : 'none';
    document.documentElement.appendChild(cap);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install);
  else install();
});

let n = 0;
let peopleGap = false;
const pause = (ms = 900) => page.waitForTimeout(ms);
async function say(text, ms = 1600) {
  await page.evaluate((t) => {
    sessionStorage.setItem('qa-caption', t);
    const cap = document.getElementById('qa-caption');
    if (cap) {
      cap.textContent = t;
      cap.style.display = 'block';
    }
  }, text);
  await pause(ms);
}
async function shot(name) {
  n += 1;
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}-${name}.png` });
}
async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
}
async function click(locator) {
  await moveTo(locator);
  await pause(250);
  await locator.click();
}
/**
 * Picks the first option whose text passes `test`, in a native select or the app's Select combobox.
 * Answers the option text, or null with the list left open for the viewer when nothing passes.
 */
async function choose(field, test) {
  if ((await field.evaluate((e) => e.tagName)) === 'SELECT') {
    const label = (await field.locator('option').allInnerTexts()).find(test);
    if (label) await field.selectOption({ label });
    return label ?? null;
  }
  await click(field);
  const list = page.locator(`[id="${await field.getAttribute('aria-controls')}"]`);
  const opts = list.getByRole('option');
  const texts = (await opts.allInnerTexts()).map((t) => t.trim());
  const i = texts.findIndex(test);
  if (i < 0) return null;
  await click(opts.nth(i));
  return texts[i];
}
async function type(locator, text) {
  await click(locator);
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 35 });
}
const hydrated = () => page.getByRole('button', { name: 'Collapse sidebar' }).waitFor();
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
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  });
}
async function drag(from, to) {
  await to.scrollIntoViewIfNeeded().catch(() => {});
  await from.scrollIntoViewIfNeeded();
  const a = await visible(from);
  const b = await visible(to);
  await page.mouse.move(a.x, a.y, { steps: 15 });
  await pause(300);
  await page.mouse.down();
  await page.mouse.move(a.x + 8, a.y + 8, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 40 });
  await pause(300);
  await page.mouse.up();
}
const toast = page.locator('.tk-toast');
const bar = page.locator('.bbar').first();
const head = page.locator('.p-head');
const lane = (i) => page.locator('svg.pg rect.lane-drop').nth(i);
const row = (title) => page.locator(`svg.pg [data-loop][aria-label^="${title}"]`);

try {
  await page.goto(`/signin?label=${LABEL}`);
  await say('Demo: chủ dự án dùng Promise Graph từ đầu đến cuối', 2200);
  await say('Bước 1. Đăng nhập', 900);
  await click(page.getByRole('button', { name: /continue/i }).first());
  await page.waitForURL(/\/graph$/);
  await hydrated();
  await say('Lần đầu đăng nhập, app tạo sẵn dự án mẫu Larkspur để xem thử', 2400);
  await shot('larkspur-sandbox');

  await say('Bước 2. Tạo dự án mới: menu dự án → + New project');
  const sw = page.locator('details.proj-switch');
  await click(sw.locator('summary'));
  await click(sw.getByRole('button', { name: '+ New project' }));
  const create = page.getByRole('dialog', { name: 'New project' });
  await type(create.getByLabel('Project name'), 'Website relaunch');
  await type(create.getByLabel('Client'), 'Acme Coffee');
  await say('Chọn các team: bỏ Product và Operations, thêm Marketing', 1200);
  await click(create.getByRole('button', { name: 'Remove Product' }));
  await click(create.getByRole('button', { name: 'Remove Operations' }));
  const addTeam = create.getByLabel('Add a team');
  await type(addTeam, 'Marketing');
  await addTeam.press('Enter');
  await pause(500);
  await say('Thêm milestone đầu tiên: Beta launch, ngày 6 Nov 2026', 1200);
  await type(create.getByLabel('First milestone (optional)'), 'Beta launch');
  await type(create.getByLabel('Milestone date'), '6 Nov 2026');
  await create.getByLabel('Milestone date').press('Tab');
  await shot('new-project-dialog');
  await pause(600);
  const larkspur = page.url();
  await click(create.getByRole('button', { name: 'Create project' }));
  await page.waitForURL((u) => u.href !== larkspur && /\/graph$/.test(u.pathname));
  await hydrated();
  const graphUrl = page.url();
  const projectId = graphUrl.split('/')[4];
  await say('Dự án mới có các team và milestone Beta launch. Graph còn trống.', 2200);
  await shot('empty-project');

  await say('Bước 3. Thêm người vào dự án: mở trang Members');
  await click(
    page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Members' }),
  );
  await page.waitForURL(/members$/);
  await hydrated();
  await pause(600);
  const invite = page.getByRole('form', { name: 'Invite a person' });
  for (const email of ['an.designer@local.test', 'binh.dev@local.test', 'chi.qa@local.test']) {
    await type(invite.getByLabel('Email'), email);
    await click(invite.getByRole('button', { name: 'Invite' }));
    await toast.filter({ hasText: email }).waitFor();
    await pause(500);
  }
  await say('Người được mời vào dự án khi họ đăng nhập bằng đúng email đó', 1800);
  await say('Cho Bình quyền Merge change requests', 1000);
  await click(page.getByLabel('Merge change requests: binh.dev@local.test'));
  await toast.filter({ hasText: 'Merge change requests on' }).waitFor();
  await pause(600);
  await say('Gán người và lead cho từng team', 1000);
  const teamPeople = [
    ['Design', 'an.designer'],
    ['Engineering', 'binh.dev'],
    ['QA', 'chi.qa'],
  ];
  for (const [team, who] of teamPeople) {
    await click(page.getByRole('button', { name: `Edit ${team}`, exact: true }));
    const ed = page.getByRole('dialog', { name: `Edit ${team}` });
    const person = ed.locator('label, li, tr, .pick-row, div').filter({ hasText: who }).last();
    await click(ed.getByRole('checkbox', { name: new RegExp(who) }));
    const radios = ed.getByRole('radio', { name: 'Lead' });
    const names = await ed
      .getByRole('checkbox')
      .evaluateAll((l) => l.map((x) => x.closest('label,li,div')?.innerText || ''));
    const idx = names.findIndex((t) => t.includes(who));
    if (idx >= 0) await click(radios.nth(idx));
    void person;
    await click(ed.getByRole('button', { name: 'Save' }));
    await toast.filter({ hasText: `Saved ${team}` }).waitFor();
    await pause(400);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await shot('members');
  await say('Trang Members: quyền của từng người và lead của từng team', 2000);

  await say('Bước 4. Main chỉ đọc. Mọi thay đổi đi qua một change request.', 1800);
  await click(
    page.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Graph' }),
  );
  await page.waitForURL(/graph$/);
  await hydrated();
  await pause(800);
  await click(head.getByRole('button', { name: 'New change request' }));
  const named = page.getByRole('dialog', { name: 'New change request' });
  await type(named.getByLabel('Name'), 'Plan the beta launch');
  await click(named.getByRole('button', { name: 'Create', exact: true }));
  await page.waitForURL(/\/changes\/1$/);
  await hydrated();
  await pause(800);
  await say('Change request #1 mở ở chế độ sửa, có Queue bên trái', 1800);

  await say('Bước 5. Thêm work item vào Queue bằng nút Add', 1200);
  const items = [
    {
      name: 'Homepage design',
      note: 'New look for the home page',
      by: 'an.designer',
      due: '24 Oct 2026',
      lane: 0,
    },
    {
      name: 'Build the homepage',
      note: 'Next.js page from the design',
      by: 'binh.dev',
      due: '31 Oct 2026',
      lane: 1,
      from: 'Homepage design',
    },
    {
      name: 'Test the homepage',
      note: 'Desktop and phone checks',
      by: 'chi.qa',
      due: '4 Nov 2026',
      lane: 2,
      from: 'Build the homepage',
    },
    {
      name: 'Launch email to customers',
      note: 'Announce the beta',
      by: null,
      due: '6 Nov 2026',
      lane: 3,
    },
  ];
  for (const it of items) {
    const addBtn = page.locator('.cr-side').getByRole('button', { name: 'Add', exact: true });
    const emptyAdd = page.locator('.empty').getByRole('button', { name: 'Add a work item' });
    if (await emptyAdd.count()) await click(emptyAdd);
    else await click(addBtn);
    const add = page.getByRole('dialog', { name: 'Add to the queue' });
    const wiTab = add.getByRole('button', { name: 'Work item', exact: true });
    if (await wiTab.count()) await click(wiTab);
    await type(add.getByLabel('Name'), it.name);
    await type(add.getByLabel('Note'), it.note);
    if (it.by) {
      const doneBy = add.getByLabel('Done by', { exact: true }).first();
      const label = await choose(doneBy, (o) => o.includes(it.by));
      if (!label) {
        peopleGap = true;
        await say(`Lỗi QA: ô Done by không có ${it.by}, người vừa được mời`, 2600);
        await page.keyboard.press('Escape');
      }
    }
    await type(add.getByLabel('Planned finish'), it.due);
    await add.getByLabel('Planned finish').press('Tab');
    await pause(300);
    await click(add.getByRole('button', { name: 'Add work item' }));
    await toast.filter({ hasText: 'Added to the queue' }).waitFor();
    await pause(500);
  }
  await shot('queue-work-items');
  await say('Kéo từng work item từ Queue thả vào team', 1500);
  for (const it of items) {
    const card = page.locator('[data-qitem]', { hasText: it.name });
    await drag(card, lane(it.lane));
    await toast.filter({ hasText: `${it.name}: placed` }).waitFor();
    await pause(700);
  }
  await shot('placed-work-items');
  await say('Nối việc giữa các team: Build the homepage nhận việc từ Homepage design', 1800);
  for (const it of items.filter((x) => x.from)) {
    await click(row(it.name));
    const d = page.locator('.drawer');
    await d.getByLabel('Add to Leads from').waitFor();
    await choose(d.getByLabel('Add to Leads from').first(), (o) => o === it.from);
    await toast.filter({ hasText: 'leads from changed' }).waitFor();
    await pause(900);
    await page.keyboard.press('Escape');
  }
  await shot('handoffs');

  await say('Bước 6. Ghi lại event: bấm + ở cuối dòng để thêm event', 1600);
  const plus = page.locator(`svg.pg [data-plus]`).first();
  await click(
    page.getByRole('button', { name: 'Add an event to Homepage design' }).first().or(plus).first(),
  );
  let ev = page.getByRole('dialog', { name: 'Add an event' });
  await click(ev.getByRole('button', { name: 'Meeting', exact: true }));
  await type(ev.getByRole('textbox').first(), 'Kick-off with Acme: they want a warmer look.');
  await click(ev.getByRole('button', { name: 'Add event' }));
  await toast.filter({ hasText: 'added' }).waitFor();
  await pause(900);
  await page.keyboard.press('Escape');
  await say('Hoặc thêm event vào Queue rồi kéo lên dòng work item', 1500);
  await click(page.locator('.cr-side').getByRole('button', { name: /^Queue/ }));
  await click(page.locator('.cr-side').getByRole('button', { name: 'Add', exact: true }));
  const addQ = page.getByRole('dialog', { name: 'Add to the queue' });
  await click(addQ.getByRole('button', { name: 'Event', exact: true }));
  await click(addQ.getByRole('button', { name: 'Decision', exact: true }));
  await type(addQ.getByRole('textbox').first(), 'Acme picked design option B.');
  await click(addQ.getByRole('button', { name: 'Add event' }));
  await toast.filter({ hasText: 'Added to the queue' }).waitFor();
  await pause(500);
  await click(page.locator('.cr-side').getByRole('button', { name: /^Events/ }));
  await drag(
    page.locator('[data-qevent]', { hasText: 'Acme picked design option B' }),
    row('Homepage design'),
  );
  await toast.filter({ hasText: 'Decision' }).waitFor();
  await pause(1000);
  await page.keyboard.press('Escape');
  await shot('events');

  await say('Bước 7. Tạo milestone mới: + New milestone trên dòng milestone', 1600);
  await click(page.getByRole('button', { name: /New milestone/ }).first());
  const ms = page.getByRole('dialog', { name: 'New milestone' });
  await type(ms.getByLabel('Name'), 'Design sign-off');
  await type(ms.getByLabel('Planned date'), '27 Oct 2026');
  await ms.getByLabel('Planned date').press('Tab');
  await type(ms.getByLabel('Time (optional)'), '17:00');
  await ms.getByLabel('Time (optional)').press('Tab');
  await click(ms.getByRole('checkbox', { name: /Homepage design/ }));
  await pause(400);
  await shot('new-milestone');
  await click(ms.getByRole('button', { name: 'Create milestone' }));
  await toast.filter({ hasText: 'Design sign-off: added' }).waitFor();
  await pause(1200);
  await say('Gắn các work item còn lại vào milestone Beta launch trong bảng chi tiết', 1600);
  for (const title of ['Build the homepage', 'Test the homepage', 'Launch email to customers']) {
    await click(row(title));
    const d = page.locator('.drawer');
    await d.getByLabel('Milestone').waitFor();
    await choose(d.getByLabel('Milestone').first(), (o) => o.startsWith('Beta launch'));
    await toast.filter({ hasText: 'milestone changed' }).waitFor();
    await pause(600);
    await page.keyboard.press('Escape');
  }
  await shot('milestones');

  await say('Bước 8. Dời ngày: mỗi lần dời phải ghi lý do, app giữ lịch sử', 1700);
  const search = page.getByRole('combobox', { name: 'Search work items' });
  await type(search, 'Build the');
  await pause(500);
  await page.keyboard.press('Enter');
  const drawer = page.locator('.drawer');
  await drawer.getByLabel('Planned finish').waitFor();
  await type(drawer.getByLabel('Planned finish'), '3 Nov 2026');
  await drawer.getByLabel('Planned finish').press('Tab');
  await type(
    drawer.getByLabel(/Why does the date move/),
    'The design review adds two days of changes.',
  );
  await shot('date-move-reason');
  await click(drawer.getByRole('button', { name: 'Move the date' }));
  await toast.filter({ hasText: 'planned finish moved' }).waitFor();
  await pause(800);
  await click(drawer.getByRole('button', { name: /Date moves/ }));
  await pause(1500);
  await shot('date-moves');
  await page.keyboard.press('Escape');

  await say('Bước 9. Xem lại các thay đổi, so sánh Before / After', 1500);
  await click(page.locator('.cr-side').getByRole('button', { name: /^Changes/ }));
  await pause(1200);
  await click(page.getByRole('button', { name: 'Before', exact: true }));
  await pause(1300);
  await click(page.getByRole('button', { name: 'After', exact: true }));
  await pause(1000);
  await shot('changes-list');
  await say('Mark as ready khóa change request để chờ merge', 1300);
  await click(bar.getByRole('button', { name: 'Mark as ready' }));
  await toast.filter({ hasText: 'is ready' }).waitFor();
  await pause(1000);
  await say('Chủ dự án có quyền Merge: bấm Merge into Main', 1300);
  await click(bar.getByRole('button', { name: 'Merge into Main' }));
  await bar.filter({ hasText: 'Merged into Main' }).waitFor();
  await pause(1200);
  await shot('merged');

  await say('Bước 10. Main hiện kế hoạch đã merge', 1300);
  await page.goto(graphUrl);
  await hydrated();
  await pause(1500);
  const fit = page.getByRole('button', { name: 'Fit to width' });
  if (await fit.isEnabled()) await click(fit);
  await pause(1200);
  await shot('main-after-merge');
  await say('History ghi lại mỗi lần merge vào Main', 1300);
  await click(head.getByRole('button', { name: 'History' }));
  await pause(2000);
  await shot('history');
  await page.keyboard.press('Escape');
  await say('Bấm vào một dòng để xem chi tiết work item', 1200);
  await page
    .locator('.drawer')
    .waitFor({ state: 'detached' })
    .catch(() => {});
  const lbl = page.locator('svg.pg-side [data-rowlabel]', { hasText: 'Homepage design' }).first();
  const target = (await lbl.count()) ? lbl : row('Homepage design');
  const c = await visible(target);
  await page.mouse.move(c.x, c.y, { steps: 18 });
  await page.mouse.click(c.x, c.y);
  await pause(2200);
  await shot('details');
  await page.keyboard.press('Escape');
  await say('Bộ lọc: ví dụ chỉ xem team Engineering', 1200);
  await click(page.locator('summary[aria-label^=Filters]'));
  const fp = page.getByRole('group', { name: 'Filter the graph' });
  await click(fp.getByRole('checkbox', { name: 'Engineering', exact: true }));
  await pause(1500);
  await click(fp.getByRole('button', { name: 'Clear filters' }));
  await page.keyboard.press('Escape');
  await pause(600);
  await say('Đổi giao diện sáng / tối trong menu tài khoản', 1200);
  await click(page.locator('details.acct summary'));
  await click(
    page
      .getByRole('button', { name: 'Dark' })
      .or(page.getByRole('radio', { name: 'Dark' }))
      .first(),
  );
  await pause(1800);
  await shot('dark');
  if (!(await page.locator('details.acct').evaluate((d) => d.open)))
    await click(page.locator('details.acct summary'));
  await click(
    page
      .getByRole('button', { name: 'Light' })
      .or(page.getByRole('radio', { name: 'Light' }))
      .first(),
  );
  await page.keyboard.press('Escape');
  await say('Hết demo. Agent của bạn cũng có thể thêm event vào Queue qua MCP (Settings).', 2600);
  console.log(JSON.stringify({ ok: true, projectId, peopleGap, problems }));
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
  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = video ? await video.path() : null;
  if (webm) {
    const mp4 = path.join(OUT, 'demo-chu-du-an.mp4');
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      webm,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '22',
      '-movflags',
      '+faststart',
      mp4,
    ]);
    if (r.status === 0) {
      const { rmSync } = await import('node:fs');
      rmSync(path.join(OUT, 'raw'), { recursive: true, force: true });
      console.log(`VIDEO ${mp4}`);
    } else console.log(`VIDEO ${webm} (ffmpeg failed or missing; keep the .webm)`);
  } else console.log('VIDEO none');
}
