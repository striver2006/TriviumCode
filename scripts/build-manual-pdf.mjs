/**
 * 《完整手册》PDF 生成（1.2.9 起固化为脚本；此前各版为临时汇编）。
 *
 * 组成：封面 + 四部分——①安装部署（部署手册）②日常使用（使用手册）
 * ③命令与配置详参（MANUAL_user 字段参考）④1.2.x 增补篇（scripts/manual-supplement.md，
 * 事实口径与 Bug 清单 §3 同源，发版时随批更新）。
 *
 * 渲染：marked 转 HTML + Edge 无头 `--print-to-pdf`（1.2.7/1.2.8 的临时管线同一路数）。
 * 依赖 marked（devDependencies，仅本脚本用，不进产品与发布包）。
 *
 * 用法：node scripts/build-manual-pdf.mjs [--out <pdf路径>]
 * 输出缺省 releases/TriviumCode-<版本>-完整手册.pdf；已有同名文件不覆盖（与 package-release 同口径）。
 */
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let out = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1] && !args[i + 1].startsWith('--')) out = path.resolve(args[++i]);
  else throw new Error('用法：node scripts/build-manual-pdf.mjs [--out <pdf路径>]');
}
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!out) out = path.join(root, 'releases', `TriviumCode-${pkg.version}-完整手册.pdf`);
try { await fs.lstat(out); throw new Error(`不覆盖已有发布物：${out}`); }
catch (e) { if (e.code !== 'ENOENT') throw e; }

// Edge 标准安装路径（先 x86 后 x64）；找不到时给明确指引
const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
let edge = null;
for (const c of edgeCandidates) { try { await fs.access(c); edge = c; break; } catch { /* 下一个 */ } }
if (!edge) throw new Error('找不到 Microsoft Edge（msedge.exe）。本脚本用其无头模式渲染 PDF，请在标准路径安装 Edge 或改造本脚本指路。');

const parts = [
  { title: '第一部分 · 安装部署', file: 'doc/06_deployment/部署手册.md' },
  { title: '第二部分 · 日常使用', file: 'doc/07_manuals/使用手册.md' },
  { title: '第三部分 · 命令与配置详参', file: 'doc/07_manuals/MANUAL_user.md' },
  { title: '第四部分 · 1.2.x 增补篇', file: 'scripts/manual-supplement.md' },
];
const today = new Date().toISOString().slice(0, 10);
const css = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
         font-size: 10.5pt; line-height: 1.7; color: #1a1a1a; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 .6em; padding-bottom: .25em; border-bottom: 2px solid #2b6cb0; }
  h2 { font-size: 13pt; margin: 1.6em 0 .5em; padding-bottom: .2em; border-bottom: 1px solid #d0d7de; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 1.2em 0 .4em; page-break-after: avoid; }
  p { margin: .5em 0; }
  table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.5pt; page-break-inside: auto; }
  th, td { border: 1px solid #c8cdd4; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f4f7; }
  tr { page-break-inside: avoid; }
  code { font-family: Consolas, 'Microsoft YaHei', monospace; font-size: 9pt; background: #f5f7f9;
         padding: 1px 4px; border-radius: 3px; overflow-wrap: break-word; word-break: normal; }
  pre { background: #f5f7f9; border: 1px solid #e2e6ea; border-radius: 4px; padding: 10px 12px;
        overflow: hidden; }
  /* 长 pre 允许跨页：整块 avoid 会把大块推到下页、留下大片空白（视觉验收 p8 实测） */
  pre code { background: none; padding: 0; white-space: pre-wrap; word-break: break-all; }
  blockquote { margin: .8em 0; padding: .3em 1em; border-left: 4px solid #2b6cb0; background: #f6f9fc; color: #333;
               page-break-inside: avoid; }
  a { color: #2b6cb0; text-decoration: none; }
  .cover { text-align: center; padding-top: 70mm; page-break-after: always; }
  .cover .name { font-size: 26pt; font-weight: 700; letter-spacing: .1em; }
  .cover .ver { font-size: 15pt; margin-top: 14mm; color: #2b6cb0; }
  .cover .date { font-size: 11pt; margin-top: 6mm; color: #666; }
  .cover .parts { margin-top: 24mm; font-size: 11pt; line-height: 2.2; color: #444; }
  .part { page-break-before: always; }
  .part-title { font-size: 14pt; font-weight: 700; color: #2b6cb0; margin: 0 0 1em; }
`;
const cover = `<div class="cover">
  <div class="name">TriviumCode 完整手册</div>
  <div class="ver">版本 ${pkg.version}</div>
  <div class="date">${today}</div>
  <div class="parts">${parts.map((p) => p.title).join('<br>')}</div>
</div>`;
const bodyParts = [];
for (const p of parts) {
  const md = await fs.readFile(path.join(root, p.file), 'utf8');
  bodyParts.push(`<section class="part"><div class="part-title">${p.title}</div>${marked.parse(md)}</section>`);
}
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>TriviumCode ${pkg.version} 完整手册</title><style>${css}</style></head>
<body>${cover}${bodyParts.join('\n')}</body></html>`;

const tmpHtml = path.join(os.tmpdir(), `trivium-manual-${pkg.version}.html`);
await fs.writeFile(tmpHtml, html, 'utf8');
try {
  execFileSync(edge, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${out}`, pathToFileURL(tmpHtml).href,
  ], { stdio: 'pipe', timeout: 120_000 });
  const pdf = await fs.readFile(out);
  // 页数：统计未压缩页对象（/Type /Page 且非 /Pages）；统计失败不阻塞，仅少报一个字段
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length || null;
  await fs.mkdir(path.dirname(out), { recursive: true });
  console.log(JSON.stringify({ file: out, bytes: pdf.length, pages, version: pkg.version }, null, 2));
} finally {
  await fs.rm(tmpHtml, { force: true });
}
