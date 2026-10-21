// Lists every user-facing control, dialog, page, API route and MCP tool in the source, and marks the ones that
// no script of this skill touches. Run from a checkout root:
//   node .claude/skills/et-qa/scripts/inventory.mjs [--out <dir>] [--covered <extra file>...]
// Writes <out>/inventory.json and prints the uncovered items; they are the exploratory to-do list of a full QA.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.resolve('package.json'));
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const extra = args.flatMap((a, i) => (args[i - 1] === '--covered' ? [a] : []));

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// An input is named by its label; a placeholder or a title next to an aria-label names nothing new.
const LABEL_ATTRS = new Set(['aria-label', 'label']);
const ROLES = /^(button|tab|menuitem|radio|checkbox|switch|option|link|combobox|textbox|dialog)$/;
const CONTROL_TAGS = new Set(['button', 'a', 'Link', 'summary', 'select', 'input', 'textarea']);
const items = [];
const add = (kind, text, file) => {
  const t = text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  // A template keeps its fixed head ("Hide ${name}" → "Hide "); a head this short says nothing.
  if (t.length < 3 || !/[A-Za-z]{2}/.test(t)) return;
  items.push({ kind, text: t, file: path.relative('.', file) });
};
const literal = (node) => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literal(node.expression);
  if (ts.isTemplateExpression(node)) return node.head.text;
  return null;
};
const textOf = (el) =>
  el.children
    .map((c) => (ts.isJsxText(c) ? c.getText() : ts.isJsxElement(c) ? textOf(c) : ''))
    .join(' ');

for (const file of [...walk('src/components'), ...walk('src/app')].filter((f) =>
  f.endsWith('.tsx'),
)) {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = open.tagName.getText();
      const role = open.attributes.properties
        .filter((a) => ts.isJsxAttribute(a) && a.name.getText() === 'role')
        .map((a) => literal(a.initializer))[0];
      const interactive = CONTROL_TAGS.has(tag) || (role && ROLES.test(role));
      for (const a of open.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText();
        const value = literal(a.initializer);
        if (value == null) continue;
        if (name === 'title' && /Frame|Modal|Dialog/.test(tag)) add('dialog', value, file);
        else if (LABEL_ATTRS.has(name) && interactive) add('control', value, file);
      }
      if (ts.isJsxElement(node) && CONTROL_TAGS.has(tag)) add('control', textOf(node), file);
    }
    // Some SVG rows build their props with button(`…`), not with a JSX attribute.
    if (ts.isCallExpression(node) && node.expression.getText() === 'button' && node.arguments[0]) {
      const v = literal(node.arguments[0]);
      if (v) add('control', v, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

for (const file of walk('src/app').filter((f) => f.endsWith('page.tsx')))
  add(
    'page',
    '/' + path.dirname(path.relative('src/app', file)).replace(/\([^)]*\)\/?/g, ''),
    file,
  );
for (const file of walk('src/app/api').filter((f) => f.endsWith('route.ts'))) {
  const methods = [
    ...readFileSync(file, 'utf8').matchAll(
      /export (?:const|(?:async )?function) (GET|HEAD|POST|PATCH|PUT|DELETE)\b/g,
    ),
  ].map((m) => m[1]);
  const route = '/' + path.dirname(path.relative('src/app', file)).replace(/\[projectId\]/, '<id>');
  for (const m of methods)
    items.push({ kind: 'api', text: `${m} ${route}`, file: path.relative('.', file) });
}
const tools = existsSync('src/server/mcp/tools.ts')
  ? readFileSync('src/server/mcp/tools.ts', 'utf8')
  : '';
// A tool is a tool(...) call or, like list_projects, an object with its own name.
for (const m of tools.matchAll(/\b(?:tool|crTool)\(\s*'([a-z_]+)'|^\s*name: '([a-z_]+)',$/gm))
  add('mcp', m[1] ?? m[2], 'src/server/mcp/tools.ts');

const seen = new Set();
const unique = items.filter((i) => {
  const k = `${i.kind}|${i.text}`;
  return seen.has(k) ? false : seen.add(k);
});

const covered = [
  ...readdirSync(here)
    .filter((f) => /\.(mjs|sh)$/.test(f) && f !== 'inventory.mjs')
    .map((f) => path.join(here, f)),
  ...extra,
]
  .filter(existsSync)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const apiCovered = (text) => {
  const [method, route] = text.split(' ');
  const tail = route.replace('/api/v1/projects/<id>', '').replace(/\[[^\]]+\]/g, '[^/\'"`]+');
  return new RegExp(
    `${method}[^\\n]{0,160}${tail.replace(/\//g, '\\/')}(?![a-z/])|${tail.replace(/\//g, '\\/')}(?![a-z/])[^\\n]{0,160}${method}`,
    'i',
  ).test(covered);
};
const lower = covered.toLowerCase();
// The api area of checks.mjs walks every route file, so each route there is covered by construction.
const sweepsApi = covered.includes("walk('src/app/api/v1')");
const isCovered = (i) => {
  if (i.kind === 'api') return sweepsApi || apiCovered(i.text);
  if (i.kind === 'page')
    return covered.includes(i.text.split('/[')[0].split('/').pop() || '/signin');
  const key = i.text
    .replace(/\s*[:(#].*$/, '')
    .trim()
    .toLowerCase();
  return lower.includes(i.text.toLowerCase()) || (key.length > 3 && lower.includes(key));
};
// coverage.md names what a person checks by hand ("Manual") and what local mode cannot reach.
const plan = { manual: new Set(), na: new Set(), script: new Set() };
const planFile = path.join(here, '..', 'coverage.md');
if (existsSync(planFile)) {
  let section = null;
  for (const line of readFileSync(planFile, 'utf8').split('\n')) {
    if (line.startsWith('## '))
      section = /manual/i.test(line)
        ? 'manual'
        : /not testable/i.test(line)
          ? 'na'
          : /pattern/i.test(line)
            ? 'script'
            : null;
    const m = line.match(/^- `([^`]+)`/);
    if (section && m) plan[section].add(m[1]);
  }
}
for (const i of unique)
  i.covered =
    isCovered(i) || plan.script.has(i.text)
      ? 'script'
      : plan.manual.has(i.text)
        ? 'manual'
        : plan.na.has(i.text)
          ? 'n/a'
          : false;

const byKind = {};
for (const i of unique) {
  byKind[i.kind] ??= { total: 0, script: 0, manual: 0, 'n/a': 0 };
  byKind[i.kind].total += 1;
  if (i.covered) byKind[i.kind][i.covered] += 1;
}
if (out)
  writeFileSync(
    path.join(out, 'inventory.json'),
    JSON.stringify({ byKind, items: unique }, null, 1),
  );
for (const [k, v] of Object.entries(byKind))
  console.log(
    `${k.padEnd(8)} ${v.total} total: ${v.script} by script, ${v.manual} manual, ${v['n/a']} n/a`,
  );
const list = (title, test) => {
  const rows = unique.filter(test);
  console.log(`\n${title} (${rows.length}):`);
  for (const i of rows) console.log(`- [${i.kind}] ${i.text}  (${i.file})`);
};
list('Manual: test these by hand', (i) => i.covered === 'manual');
list(
  'Uncovered: new or missed; test by hand and add a check or a coverage.md entry',
  (i) => !i.covered,
);
const stale = [...plan.manual, ...plan.na, ...plan.script].filter(
  (t) => !unique.some((i) => i.text === t),
);
if (stale.length)
  console.log(`\ncoverage.md names controls that no longer exist: ${stale.join(' | ')}`);
