#!/usr/bin/env node
/**
 * M10b 第 5 步 · grep 锚差集（计划 r5 §8.5「回溯完整怎么核」的机器判据）。只读仓库，只写本目录 `01-anchors.json`。
 *
 * 论域：`git ls-files` 里的活文档——`doc/**`、仓库根 `README.md` / `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`、`skills/**`、`skills-src/**`、
 * 以及 **`.reviews/README.md`（r5 §8.5：必须在论域内）**；排除冻结材料与只追加的日志：
 * `doc/05_testing/evidence/**`、`doc/05_testing/REPORT_*.md`（历史报告）、`.reviews/` 下除 README 以外的一切（归档）、
 * 演进设计 `doc/02_design/2026-09-13-*`（正文冻结，§14 表单独核）、`doc/02_design/reference/`（09-10 的参考答卷，冻结）、`doc/08_project/BACKLOG.md` 与 `*轮次台账.md`（只追加）、
 * `skills/dual-critic/scripts/**`（构建产物）。
 *
 * 锚模式四族（r5 §8.5：三后缀字面之外，加守卫措辞一族与「两家」字面一族；本步另加「M10b 未完成」与「glm 为 L1」两族）：
 *   pending   —— 「待实施 · M10b」「待 M10b」「仍待 M10b」「M10b 之前」「随 M10b 入口资产收口后补写」
 *   guard     —— 「永真放行」「删掉或改坏」（M10b r5 §5.6 ⑥：「删掉 bin/ 即永真放行」一半不成立）
 *   twoFamily —— 只列两家审核者的后缀枚举：`-gemini.md` 与 `-glm.md` 同行出现而无 `-codex.md`
 *   glmL1     —— 「glm（探针通过时）」「ZCode Hook 探针通过」「glm Driver 拿 L1」
 *   acStatus  —— 验收状态口径：`AC-21` 与「仅子句 ③」或「部分达成」同行（代码双审 r4 CODEX-03 追加：`.reviews/README.md`
 *                第 3 行的 AC-21 状态漏跟，它既不在被审补丁里、前四族也扫不到）
 *
 * 装置自检（代码双审 r4 GLM-02 改）：先对 **HEAD 版本**的同一批文件跑一遍，**每一个锚族**都须有命中，
 * 否则判该族模式或扫描面失效、不输出差集——只查一族时，别的族拼错会呈现 0 → 0 的假干净。
 * 将来某族可以合法归零（例如全量 N 方化之后的 twoFamily），就在 `SELF_CHECK_EXEMPT` 里按族写豁免理由；本轮无豁免。
 *
 *   node doc/05_testing/evidence/m10b-step5-20260926/anchors.mjs
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const git = (args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const include = (f) =>
  (f.startsWith('doc/') || f.startsWith('skills/') || f.startsWith('skills-src/') ||
    ['README.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.reviews/README.md'].includes(f)) &&
  /\.(md|yaml|yml|json|snippet)$/.test(f) &&
  !f.startsWith('doc/05_testing/evidence/') &&
  !/^doc\/05_testing\/REPORT_/.test(f) &&
  !f.startsWith('doc/02_design/2026-09-13-') &&
  !f.startsWith('doc/02_design/reference/') &&
  f !== 'doc/08_project/BACKLOG.md' &&
  !/轮次台账\.md$/.test(f) &&
  !f.startsWith('skills/dual-critic/scripts/');

const FAMILIES = {
  pending: [/待实施\s*·\s*M10b/, /待\s*M10b/, /仍待\s*M10b/, /M10b\s*之前/, /随\s*M10b\s*入口资产收口后补写/],
  guard: [/永真放行/, /删掉或改坏/],
  twoFamily: [/-gemini\.md.*-glm\.md|-glm\.md.*-gemini\.md/],
  glmL1: [/glm`?（探针通过时）/, /ZCode Hook 探针通过/, /glm Driver 拿 L1/],
  // 「AC-21」之后 20 字以内、不跨顿号逗号分号句号出现状态词；只要求同一行会把「AC-21 已达成、AC-22 部分达成」误计
  acStatus: [/AC-21[^、，；。]{0,20}(仅子句\s*③|部分达成)/],
};
/** 自检豁免：族名 → 为什么 HEAD 里可以零命中。本轮为空 */
const SELF_CHECK_EXEMPT = {};
const twoFamilyOk = (line) => /-codex\.md/.test(line);

function scan(text) {
  const hits = {};
  text.split('\n').forEach((line, i) => {
    for (const [fam, res] of Object.entries(FAMILIES)) {
      if (!res.some((re) => re.test(line))) continue;
      if (fam === 'twoFamily' && twoFamilyOk(line)) continue;
      (hits[fam] ??= []).push({ line: i + 1, text: line.trim().slice(0, 200) });
    }
  });
  return hits;
}

const tracked = git(['ls-files']).split('\n').filter(Boolean);
const files = tracked.filter(include);
// 工作区新增、尚未跟踪的文档也要进论域（本步新写的报告不在其中：它在 REPORT_ 排除项里）
const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).filter(include);
const universe = [...new Set([...files, ...untracked])].sort();

const before = {};
const after = {};
for (const f of universe) {
  let head = null;
  try {
    head = git(['show', `HEAD:${f}`]);
  } catch {
    head = null; // 本步新增的文件
  }
  if (head !== null) before[f] = scan(head);
  after[f] = scan(await fs.readFile(path.join(ROOT, f), 'utf8'));
}

const count = (m, fam) => Object.values(m).reduce((n, h) => n + (h[fam]?.length ?? 0), 0);
const headHits = Object.fromEntries(Object.keys(FAMILIES).map((fam) => [fam, count(before, fam)]));
const failedFamilies = Object.keys(FAMILIES).filter((fam) => headHits[fam] === 0 && !(fam in SELF_CHECK_EXEMPT));
const selfCheck = { head_hits: headHits, exempt: SELF_CHECK_EXEMPT, failed: failedFamilies, ok: failedFamilies.length === 0 };
if (!selfCheck.ok) {
  console.error(`装置自检失败：HEAD 版本里这些锚族零命中且未豁免——${failedFamilies.join('、')}；扫描面或模式有误，不输出差集`);
  process.exit(1);
}

const summary = {};
for (const fam of Object.keys(FAMILIES)) summary[fam] = { before: count(before, fam), after: count(after, fam) };
const remaining = {};
for (const [f, h] of Object.entries(after)) if (Object.keys(h).length) remaining[f] = h;

const out = { at: new Date().toISOString(), head: git(['rev-parse', '--short', 'HEAD']).trim(), universe_size: universe.length, selfCheck, summary, remaining };
await fs.writeFile(path.join(HERE, '01-anchors.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ universe_size: out.universe_size, selfCheck, summary }, null, 2));
for (const [f, h] of Object.entries(remaining)) {
  for (const [fam, list] of Object.entries(h)) for (const x of list) console.log(`${fam}\t${f}:${x.line}\t${x.text.slice(0, 110)}`);
}
