// Builds <out>/bao-cao-qa.html from the files a QA run leaves in <out>, and <out>/../index.html for all runs:
//   results.json (checks.mjs), inventory.json (inventory.mjs), findings.json and manual.json (you write them),
//   gates.txt (run-gates.sh), demo/ (demo.mjs), shots/ (shoot.mjs), explore/ (your screenshots).
//   node .claude/skills/et-qa/scripts/report.mjs --out <dir> --scope "<scope>" --ref "<branch @ sha>" --summary "<text>"
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = arg('out');
if (!out) {
  console.error('usage: report.mjs --out <dir> [--scope text] [--ref text]');
  process.exit(2);
}
const scope = arg('scope', 'full');
const ref = arg('ref', '');
const read = (f, fallback) => {
  const p = path.join(out, f);
  return existsSync(p) ? readFileSync(p, 'utf8') : fallback;
};
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const pngs = (dir) =>
  existsSync(path.join(out, dir))
    ? readdirSync(path.join(out, dir))
        .filter((f) => f.endsWith('.png'))
        .sort()
        .map((f) => `${dir}/${f}`)
    : [];

const results = JSON.parse(read('results.json', '{"results":[]}')).results;
const findings = JSON.parse(read('findings.json', '[]'));
const gates = read('gates.txt', '');
const inventory = JSON.parse(read('inventory.json', 'null'));
const manual = JSON.parse(read('manual.json', '[]'));
const video = [
  'tour/demo-day-du-tinh-nang.mp4',
  'demo/demo-chu-du-an.mp4',
  'demo-chu-du-an.mp4',
].find((f) => existsSync(path.join(out, f)));
const chapters = JSON.parse(read('tour/chapters.json', '[]'));
// checks.mjs --video names its file in each result it recorded.
const qaVideo = results.find((r) => r.video && existsSync(path.join(out, r.video)))?.video;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const seek = (id, s) =>
  `<button class="seek" type="button" data-video="${id}" data-seek="${Math.floor(s)}">▶ ${clock(s)}</button>`;
const SEV = { high: ['HIGH', 'Cao'], medium: ['MED', 'Trung bình'], low: ['LOW', 'Thấp'] };
const count = (s) => findings.filter((f) => f.severity === s).length;
const failed = results.filter((r) => r.status === 'fail').length;
const vitest = gates.match(/Tests\s+(\d+) passed/)?.[1];
// Vitest also prints "Test Files N passed (N)", so read the Playwright count after the e2e line only.
const e2e = gates.match(/\be2e\b[^\n]*\n\s*(\d+) passed/)?.[1];
const gateVerdict = gates ? (/RESULT: PASS/.test(gates) ? 'PASS' : 'FAIL') : null;

const kpi = (v, l) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
const figure = (src, cap) =>
  `<figure><a href="${esc(src)}"><img loading="lazy" src="${esc(src)}" alt="${esc(cap)}"></a><figcaption>${esc(cap)}</figcaption></figure>`;

const byArea = {};
for (const r of results) (byArea[r.area] ??= []).push(r);
const areaRows = Object.entries(byArea)
  .map(([a, rs]) => {
    const f = rs.filter((r) => r.status === 'fail').length;
    return `<tr><td>${esc(a)}</td><td>${rs.length}</td><td>${rs.length - f}</td><td>${f ? `<span class="tag HIGH">${f}</span>` : '0'}</td></tr>`;
  })
  .join('');
const checkRows = results
  .map(
    (r) =>
      `<tr><td>${esc(r.area)}</td><td>${esc(r.name)}</td><td><span class="tag ${r.status === 'pass' ? 'PASS' : 'HIGH'}">${r.status === 'pass' ? 'PASS' : 'FAIL'}</span></td><td>${esc(r.note)}${r.shot ? ` · <a href="${esc(r.shot)}">ảnh</a>` : ''}${qaVideo && r.videoAt !== undefined ? ` · ${seek('qa-video', r.videoAt)}` : ''}</td></tr>`,
  )
  .join('');

const bug = (f) => {
  const [cls, vi] = SEV[f.severity] ?? SEV.low;
  const rows = [
    ['Tái hiện', f.repro],
    ['Bằng chứng', f.evidence],
    ['Đề xuất', f.fix],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
    .join('');
  const shots = (f.shots ?? [])
    .map((s) => `<a href="${esc(s)}">${esc(path.basename(s))}</a>`)
    .join(', ');
  return `<div class="bug"><h3><span class="tag ${cls}">${esc(f.id)} · ${vi}</span> ${esc(f.title)}</h3><p>${esc(f.detail)}</p><dl>${rows}${shots ? `<dt>Ảnh</dt><dd>${shots}</dd>` : ''}</dl></div>`;
};
const order = { high: 0, medium: 1, low: 2 };
const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

const KIND_VI = {
  control: 'Nút và ô nhập',
  dialog: 'Hộp thoại',
  page: 'Trang',
  api: 'API',
  mcp: 'Tool MCP',
};
const coverage = inventory
  ? `<h2>Độ phủ</h2><div class="wide"><table><tr><th>Loại</th><th>Tổng</th><th>Script test</th><th>Test tay</th><th>Không test được ở local</th></tr>${Object.entries(
      inventory.byKind,
    )
      .map(
        ([k, v]) =>
          `<tr><td>${KIND_VI[k] ?? k}</td><td>${v.total}</td><td>${v.script}</td><td>${v.manual}</td><td>${v['n/a']}</td></tr>`,
      )
      .join('')}</table></div>${
      manual.length
        ? `<h3 style="margin-top:20px">Kết quả test tay</h3><div class="wide"><table><tr><th>Control</th><th>Kết quả</th><th>Ghi chú</th></tr>${manual
            .map(
              (m) =>
                `<tr><td>${esc(m.text)}</td><td><span class="tag ${m.result === 'pass' ? 'PASS' : m.result === 'fail' ? 'HIGH' : 'LOW'}">${esc(m.result)}</span></td><td>${esc(m.note)}</td></tr>`,
            )
            .join('')}</table></div>`
        : ''
    }`
  : '';
const demoShots = [...pngs('tour/shots'), ...pngs('demo/shots')];
const exploreShots = pngs('explore');
const sweepShots = pngs('shots');

const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo QA Promise Graph</title>
<style>
:root{--bg:#fbfbfa;--surface:#fff;--ink:#1c1d1f;--ink-2:#5b5f66;--line:#e4e4e1;--accent:#2563eb;--high:#c2410c;--high-bg:#fff1e8;--med:#a16207;--med-bg:#fef9e7;--low:#475569;--low-bg:#f1f5f9;--ok:#15803d;--ok-bg:#ecfdf3;--code:#f4f4f2}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111214;--surface:#191a1d;--ink:#ececec;--ink-2:#a1a5ad;--line:#2b2d31;--accent:#7aa2ff;--high:#fb923c;--high-bg:#2a1a10;--med:#facc15;--med-bg:#26210c;--low:#cbd5e1;--low-bg:#1e2430;--ok:#4ade80;--ok-bg:#0f2418;--code:#23252a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 80px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:16px;margin:0 0 6px}
.sub{color:var(--ink-2);margin:0 0 24px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:24px}.kpi span{color:var(--ink-2);font-size:13px}
video{width:100%;border-radius:10px;border:1px solid var(--line);background:#000}
.wide{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--ink-2);font-size:13px}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}
.HIGH{color:var(--high);background:var(--high-bg)}.MED{color:var(--med);background:var(--med-bg)}.LOW{color:var(--low);background:var(--low-bg)}.PASS{color:var(--ok);background:var(--ok-bg)}
.bug{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 12px}.bug p{margin:6px 0}
.bug dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:8px 0 0;font-size:14px}.bug dt{color:var(--ink-2)}.bug dd{margin:0}
code,pre{background:var(--code);border-radius:4px;font-size:13px}pre{padding:10px;overflow-x:auto}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
figure{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}figure img{display:block;width:100%;height:auto}
figcaption{padding:6px 10px;font-size:13px;color:var(--ink-2)}a{color:var(--accent)}
.seek{border:1px solid var(--line);background:var(--surface);color:var(--accent);border-radius:6px;padding:0 6px;font:inherit;font-size:13px;cursor:pointer}
.chapters{display:flex;flex-wrap:wrap;gap:6px 10px;margin:10px 0 0;padding:0;list-style:none;font-size:14px}
@media (max-width:600px){.bug dl{grid-template-columns:1fr}h1{font-size:23px}}
</style></head><body><main>
<h1>Báo cáo QA: Promise Graph</h1>
<p class="sub">Ngày: ${new Date().toLocaleDateString('vi-VN')} · Quy mô: <code>${esc(scope)}</code>${ref ? ` · Bản test: <code>${esc(ref)}</code>` : ''}</p>
<div class="kpis">
${kpi(count('high'), 'lỗi mức cao')}${kpi(count('medium'), 'lỗi mức trung bình')}${kpi(count('low'), 'lỗi mức thấp')}
${results.length ? kpi(`${results.length - failed}/${results.length}`, 'check tự động pass') : ''}
${vitest ? kpi(vitest, 'test Vitest pass') : ''}${e2e ? kpi(e2e, 'test Playwright pass') : ''}
</div>
${arg('summary') ? `<h2>Kết luận</h2><p>${esc(arg('summary'))}</p>` : ''}
${video ? `<h2>Video demo</h2><video id="demo-video" controls preload="metadata" src="${video}"></video>${chapters.length ? `<ul class="chapters">${chapters.map((c) => `<li>${seek('demo-video', c.at)} ${esc(c.title)}</li>`).join('')}</ul>` : ''}<p class="sub">File: <code>${video}</code></p>` : ''}
${qaVideo ? `<h2>Video của lượt QA</h2><p>Mỗi check hiện tên ở cuối màn hình, rồi ✓ khi đạt. Nút ▶ trong bảng chi tiết mở video tại check đó.</p><video id="qa-video" controls preload="metadata" src="${qaVideo}"></video><p class="sub">File: <code>${qaVideo}</code></p>` : ''}
${sorted.length ? `<h2>Lỗi tìm thấy</h2>${sorted.map(bug).join('')}` : '<h2>Lỗi tìm thấy</h2><p>Không có lỗi.</p>'}
${coverage}
${
  results.length
    ? `<h2>Check tự động theo khu vực</h2><div class="wide"><table><tr><th>Khu vực</th><th>Số check</th><th>Pass</th><th>Fail</th></tr>${areaRows}</table></div>
<h3 style="margin-top:20px">Chi tiết</h3><div class="wide"><table><tr><th>Khu vực</th><th>Check</th><th>Kết quả</th><th>Ghi chú</th></tr>${checkRows}</table></div>`
    : ''
}
${gates ? `<h2>Gate tự động ${gateVerdict ? `<span class="tag ${gateVerdict === 'PASS' ? 'PASS' : 'HIGH'}">${gateVerdict}</span>` : ''}</h2><pre>${esc(gates)}</pre>` : ''}
${demoShots.length ? `<h2>Ảnh của video demo</h2><div class="shots">${demoShots.map((s) => figure(s, path.basename(s, '.png'))).join('')}</div>` : ''}
${exploreShots.length ? `<h2>Ảnh test thăm dò</h2><div class="shots">${exploreShots.map((s) => figure(s, path.basename(s, '.png'))).join('')}</div>` : ''}
${sweepShots.length ? `<h2>Ảnh light / dark, 1440 / 390 px</h2><div class="shots">${sweepShots.map((s) => figure(s, path.basename(s, '.png'))).join('')}</div>` : ''}
</main><script>
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-seek]');
  if (!b) return;
  const v = document.getElementById(b.dataset.video);
  v.currentTime = Number(b.dataset.seek);
  v.scrollIntoView({ block: 'center' });
  v.play();
});
</script></body></html>`;
// --index-only rebuilds the list of runs and leaves a report that a person wrote by hand as it is.
const indexOnly = process.argv.includes('--index-only');
if (!indexOnly) writeFileSync(path.join(out, 'bao-cao-qa.html'), html);
if (!indexOnly)
  writeFileSync(
    path.join(out, 'run.json'),
    JSON.stringify({
      at: new Date().toISOString(),
      scope,
      ref,
      high: count('high'),
      medium: count('medium'),
      low: count('low'),
      checks: results.length,
      failed,
      video: !!(video || qaVideo),
    }),
  );

// Each run has its own folder, so the parent folder gets a list of every run, newest first.
const root = path.dirname(path.resolve(out));
const runs = readdirSync(root)
  .filter((d) => existsSync(path.join(root, d, 'bao-cao-qa.html')))
  .map((d) => {
    const meta = existsSync(path.join(root, d, 'run.json'))
      ? JSON.parse(readFileSync(path.join(root, d, 'run.json'), 'utf8'))
      : {};
    return { d, ...meta };
  })
  .sort((a, b) => String(b.at ?? b.d).localeCompare(String(a.at ?? a.d)));
const rowsHtml = runs
  .map(
    (r) =>
      `<tr><td><a href="${esc(r.d)}/bao-cao-qa.html">${esc(r.d)}</a></td><td>${esc(r.scope ?? '')}</td><td>${esc(r.ref ?? '')}</td><td>${r.high ?? '?'} / ${r.medium ?? '?'} / ${r.low ?? '?'}</td><td>${r.checks ? `${r.checks - r.failed}/${r.checks}` : ''}</td><td>${r.video ? 'có' : ''}</td></tr>`,
  )
  .join('');
writeFileSync(
  path.join(root, 'index.html'),
  html
    .replace(
      /<main>[\s\S]*<\/main>/,
      `<main><h1>Các lần chạy QA</h1><p class="sub">Mới nhất ở trên. Mỗi lần chạy có thư mục riêng.</p><div class="wide"><table><tr><th>Thư mục</th><th>Quy mô</th><th>Bản test</th><th>Lỗi cao / TB / thấp</th><th>Check pass</th><th>Video</th></tr>${rowsHtml}</table></div></main>`,
    )
    .replace('<title>Báo cáo QA Promise Graph</title>', '<title>Các lần chạy QA</title>'),
);
console.log(
  indexOnly
    ? `index: ${path.join(root, 'index.html')} (${runs.length} runs)`
    : `report: ${path.join(out, 'bao-cao-qa.html')} (${findings.length} findings, ${results.length} checks); index: ${path.join(root, 'index.html')}`,
);
