/**
 * M10a 第 5 步段二（纪律 6 回溯）的 grep 锚差集自检（计划 `.reviews/M10a-第5步/plan/…-r2-claude.md` §4.2 第二层）。
 *
 * 先例：`doc/05_testing/evidence/m9-step7-20260920/grep-anchors.md`。
 * 七条锚各扫一类「M10a 落地后可能失实」的现状句；命中逐条人读归类（已改准 / 史实不改 / 非现状断言 / 残余待办），
 * 结论写在同目录 `grep-anchors.md`。
 *
 * 用法（**仓库根执行**，否则退非零、不写任何文件）：
 *   node doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs before          # 改动前（已跑过，不可复现）
 *   node doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs after           # 改动后
 *   node doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs readme-at-head  # 只扫 HEAD 版本的 .reviews/README.md
 *
 * 论域：`*.md` / `*.snippet` / `src/**\/*.ts`（后者只读注释与文案，本步不改代码），外加**归档根下的 `.reviews/README.md` 一份**。
 * 排除：node_modules、dist、.git、`doc/02_design/reference/`（调研答卷，冻结）、
 * `doc/05_testing/REPORT_*` 与 `doc/05_testing/evidence/`（历史报告与留痕，冻结）、
 * `.reviews/` 下除根级 `README.md` 外的全部归档件（冻结）。
 *
 * ## 代码双审 r7 的两处修正
 *
 * - **CODEX-01 ≡ GLM-01**：初版对目录求 `excluded('.reviews/')`，恒为真，整棵归档子树不下潜，
 *   那条「README 例外」永远到不了——第二层核法恰好对被审补丁唯一剔除的那份文件失明，而证据件还声称它在论域内。
 *   现在 `.reviews/` 单独处理：进入，但只收根级 `README.md`，子目录一律不下潜。
 *   初版的 `before` 输出已不可复现，这份文件的改动前计数改由 `readme-at-head` 从 `git show HEAD:` 取。
 * - **CODEX-02**：输出目录改用 `fileURLToPath`（`URL.pathname` 在路径含空格或非 ASCII 时是百分号编码）；
 *   开头断言工作目录是仓库根，否则从别处执行会静默扫错树、写出一份看起来正常的错证据。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
if (!existsSync(path.join(ROOT, 'package.json')) || !existsSync(path.join(ROOT, '.reviews'))) {
  console.error(`工作目录不是仓库根（缺 package.json 或 .reviews/）：${ROOT}\n请在仓库根执行，本次不写任何文件。`);
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = new Set(['before', 'after', 'readme-at-head']);
const phase = process.argv[2];
if (!MODES.has(phase)) {
  console.error(`用法：grep-anchors.mjs before | after | readme-at-head（收到：${phase ?? '（空）'}）`);
  process.exit(2);
}

const ANCHORS = [
  { id: 'B1', desc: '未拆分的 M10（后不跟 a / b / 数字）', re: /M10(?![ab0-9])/ },
  { id: 'B2', desc: 'driverEnabled / 唯一启用 / 尚未启用为 Driver / 只校验「已登记」', re: /driverEnabled|唯一启用|尚未启用为 Driver|只校验「已登记」/ },
  { id: 'B3', desc: 'Claude 系 / 非 Claude / claude-* / heterogeneous: false', re: /Claude ?系|非 ?Claude|claude-\*|heterogeneous: false/ },
  { id: 'B4', desc: '唯一来源是 / 回落缺省 Driver / 零留痕', re: /唯一来源是|回落缺省 ?Driver|零留痕/ },
  { id: 'B5', desc: '提交锚 / 不可变 / verify-', re: /提交锚|不可变|verify-/ },
  { id: 'B6', desc: 'approve 与复核 / 确认码同行', re: /approve.*(?:复核|确认码)|(?:复核|确认码).*approve/ },
  { id: 'B7', desc: '后缀枚举（*-gemini.md、-glm.md、角色 = …、gemini/glm、gemini | glm）', re: /\*-gemini\.md|-glm\.md|角色 = |gemini\/glm|gemini \| glm/ },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
function excluded(rel) {
  if (rel.startsWith('doc/02_design/reference/')) return true;
  if (rel.startsWith('doc/05_testing/evidence/')) return true;
  if (/^doc\/05_testing\/REPORT_/.test(rel)) return true;
  return false;
}
function inScope(rel) {
  if (rel.endsWith('.md') || rel.endsWith('.snippet')) return true;
  return rel.startsWith('src/') && rel.endsWith('.ts');
}

/** 取待扫的 {rel, text} 列表 */
function collect() {
  if (phase === 'readme-at-head') {
    const text = execFileSync('git', ['show', 'HEAD:.reviews/README.md'], { cwd: ROOT, encoding: 'utf8' });
    return [{ rel: '.reviews/README.md@HEAD', text }];
  }
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (statSync(abs).isDirectory()) {
        if (rel === '.reviews') {
          // 归档根：只收根级 README.md，不下潜任何子目录（各主题归档件冻结）
          const readme = path.join(abs, 'README.md');
          if (existsSync(readme)) files.push('.reviews/README.md');
          continue;
        }
        if (!excluded(rel + '/')) walk(abs);
        continue;
      }
      if (inScope(rel) && !excluded(rel)) files.push(rel);
    }
  })(ROOT);
  return [...new Set(files)].sort().map((rel) => ({ rel, text: readFileSync(path.join(ROOT, rel), 'utf8') }));
}

const docs = collect();
const out = [];
const counts = {};
for (const a of ANCHORS) {
  let n = 0;
  out.push(`## ${a.id} ${a.desc}`);
  for (const { rel, text } of docs) {
    text.split('\n').forEach((line, i) => {
      const m = a.re.exec(line);
      if (!m) return;
      n++;
      const at = m.index;
      const win = line.slice(Math.max(0, at - 50), at + 70).replace(/\s+/g, ' ');
      out.push(`${rel}:${i + 1}: …${win}…`);
    });
  }
  counts[a.id] = n;
  out.push(`（${a.id} 共 ${n} 处）`, '');
}
out.unshift(`# grep 锚（${phase}）`, '', `计数：${JSON.stringify(counts)}`, `论域文件数：${docs.length}`, '');
writeFileSync(path.join(HERE, `grep-anchors.${phase}.txt`), out.join('\n') + '\n');
console.log(`${phase}：${JSON.stringify(counts)}，论域 ${docs.length} 个文件`);
