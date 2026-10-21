// A long-lived headless browser for exploratory clicks. Start it in the background from the QA worktree root:
//   node .claude/skills/et-qa/scripts/driver.mjs --base http://localhost:<port> [--port 3499]
// Then send JavaScript to it with drive.sh. The body runs as an async function of (page, state, newCtx, browser).
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(
  pathToFileURL(path.resolve('node_modules/@playwright/test/index.mjs')).href
);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('base');
const port = Number(arg('port', '3499'));
if (!base) {
  console.error('usage: driver.mjs --base <url> [--port 3499]');
  process.exit(2);
}
const NOISE = /was preloaded using link preload|Download the React DevTools/;
const browser = await chromium.launch();
const state = { contexts: {}, logs: [] };
async function newCtx(name, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    baseURL: base,
    ...opts,
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const hook = (p) => {
    p.on('pageerror', (e) => state.logs.push(`[${name}] pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text()))
        state.logs.push(`[${name}] console: ${m.text().slice(0, 300)}`);
    });
    p.on('response', (r) => {
      if (r.status() >= 400)
        state.logs.push(
          `[${name}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(base, '')}`,
        );
    });
  };
  ctx.on('page', hook);
  const page = await ctx.newPage();
  state.contexts[name] = { ctx, page };
  return page;
}
await newCtx('main');
const AsyncFunction = (async () => {}).constructor;
const server = http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const out = {};
    try {
      out.result = await new AsyncFunction('page', 'state', 'newCtx', 'browser', body)(
        state.contexts.main.page,
        state,
        newCtx,
        browser,
      );
    } catch (e) {
      out.error = String((e && e.stack) || e)
        .split('\n')
        .slice(0, 4)
        .join('\n');
    }
    out.logs = state.logs.splice(0);
    res.end(JSON.stringify(out, null, 1));
  })
  .listen(port, '127.0.0.1', () => console.log(`driver ready on ${port}`));
// A plain kill must free the port: close the browser and the server, then exit.
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, async () => {
    server.close();
    await browser.close().catch(() => {});
    process.exit(0);
  });
