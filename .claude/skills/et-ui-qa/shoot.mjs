// Usage (from the worktree root, with your own dev server running):
//   node .claude/skills/et-ui-qa/shoot.mjs --base http://localhost:<port> --out <dir> \
//     [--pages graph,members,settings/tokens,changes/2] [--widths 1440,390] [--themes light,dark] [--label qa]
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
const base = arg('base');
const out = arg('out');
if (!base || !out) {
  console.error(
    'usage: shoot.mjs --base <url> --out <dir> [--pages ...] [--widths ...] [--themes ...]',
  );
  process.exit(2);
}
const port = new URL(base).port;
if (['3100', '3200', '3310'].includes(port)) {
  console.error(`port ${port} belongs to the owner; start your own dev server`);
  process.exit(2);
}
const pages = arg('pages', 'graph,members,settings/tokens').split(',');
const widths = arg('widths', '1440,390').split(',').map(Number);
const themes = arg('themes', 'light,dark').split(',');
const label = arg('label', 'qa');
mkdirSync(out, { recursive: true });

// The owner's "never" list that a browser can measure: horizontal scroll, dashed or dotted lines, page errors.
const audit = () => {
  const found = [];
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (overflow > 0) found.push(`horizontal scroll of ${overflow}px`);
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    const name = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const style = s[`border${side}Style`];
      if ((style === 'dashed' || style === 'dotted') && parseFloat(s[`border${side}Width`]) > 0) {
        found.push(`${style} border on ${name}`);
        break;
      }
    }
    if (el instanceof SVGElement && s.strokeDasharray && s.strokeDasharray !== 'none') {
      found.push(`stroke-dasharray on ${name}`);
    }
  }
  return [...new Set(found)].slice(0, 20);
};

const browser = await chromium.launch();
let problems = 0;
for (const theme of themes) {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      colorScheme: theme,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // A failed load also logs a console error without its URL; the response line names it.
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
        errors.push(`console: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
    });
    await page.goto(`${base}/signin?label=${label}`);
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/graph$/);
    const project = new URL(page.url()).pathname.split('/')[2];
    for (const p of pages) {
      await page.goto(`${base}/projects/${project}/${p}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      const file = path.join(out, `${p.replaceAll('/', '-')}-${width}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const found = [...(await page.evaluate(audit)), ...errors.splice(0)];
      problems += found.length;
      console.log(`${found.length ? 'CHECK' : 'ok   '} ${file}`);
      for (const f of found) console.log(`      ${f}`);
    }
    await context.close();
  }
}
await browser.close();
console.log(
  problems ? `${problems} problems found` : 'no measured problems; now look at every image',
);
process.exit(problems ? 1 : 0);
