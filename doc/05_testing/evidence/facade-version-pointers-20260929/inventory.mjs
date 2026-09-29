// 盘点（计划 r2 §2）：在起点提交 79d2ed4 上复现三轮检索与全局规则实测，结果写 inventory-79d2ed4.txt。
// 论域：79d2ed4 的已跟踪文件，排除 .reviews/<主题>/ 下的留痕与 doc/05_testing/evidence/。
// 用法：node doc/05_testing/evidence/facade-version-pointers-20260929/inventory.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BASE, HERE, baseCandidates, baseRead, checkPrereqs, loadHelper } from './lib.mjs';

checkPrereqs();
const h = await loadHelper();
const read = baseRead();
const all = baseCandidates();
const inScope = all
  .filter((f) => !(f.startsWith('.reviews/') && f.split('/').length > 2))
  .filter((f) => !f.includes('/evidence/'))
  .filter((f) => !/\.(png|jpg|gif|ico)$/.test(f) && f !== 'package-lock.json');

const rounds = [
  ['R1 文档名 + 版本号', /(设计|PRD|LLD|MANUAL|手册|QUICKSTART|PROTOCOL|RUNBOOK|CASE|GUIDE)[^|\n]{0,6}v[0-9]+\.[0-9]+/],
  ['R2 任意版本号', /\bv[0-9]+\.[0-9]+(\.[0-9]+)?\b/],
  ['R3a 链接后跟版本号', /(\]\([^)]*\)|\.md`?)\s*[（(]?\*{0,2}v[0-9]+\.[0-9]+/],
  ['R3b 依据 / 见 / 本版 / 截至 / 当前 + 版本号', /(依据|见|本版|截至|当前|最新)[^。\n]{0,40}v[0-9]+\.[0-9]+/],
];
const out = [`# 盘点：${BASE}（论域 ${inScope.length} 个已跟踪文件）`, ''];
for (const [name, re] of rounds) {
  const hits = [];
  for (const f of inScope) {
    const t = read(f);
    if (t === null) continue;
    t.split('\n').forEach((l, i) => {
      if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.slice(0, 200)}`);
    });
  }
  const perFile = new Map();
  for (const x of hits) {
    const f = x.slice(0, x.indexOf(':'));
    perFile.set(f, (perFile.get(f) ?? 0) + 1);
  }
  out.push(`## ${name}：${hits.length} 行，${perFile.size} 个文件`, '');
  for (const [f, n] of [...perFile].sort((a, b) => b[1] - a[1])) out.push(`- ${n}\t${f}`);
  out.push('');
  if (name.startsWith('R3')) {
    out.push('```', ...hits.filter((x) => !/REPORT_|BACKLOG/.test(x)), '```', '');
  }
}

const corpus = h.facadeCorpus(all);
const global = h.scanGlobalRules(corpus, read);
out.push(`## 全局规则实测（门面论域 ${corpus.length} 份）：${global.length} 处`, '', '```', h.formatProblems(global), '```', '');
out.push('门面论域：', '', ...corpus.map((f) => `- ${f}`), '');

const target = path.join(HERE, `inventory-${BASE}.txt`);
writeFileSync(target, out.join('\n'));
console.log(`写出 ${path.basename(target)}：${rounds.length} 轮检索、全局规则 ${global.length} 处、论域 ${corpus.length} 份`);
