// EV-252 变异验证（自动校准播报与照抄计划 r2 第二节第 5 步）：M1～M7 逐条变异 → 构建 / 渲染 → 跑目标用例 → 逐字节恢复。
// 用法：在仓库根执行 `node doc/05_testing/evidence/recalibrate-announce-20261023/mutation-run.mjs <输出 JSON 路径>`
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const P = (rel) => path.join(ROOT, rel);
const sha = (rel) => createHash('sha256').update(readFileSync(P(rel))).digest('hex');

const PREFLIGHT = 'src/trivium/preflight.ts';
const PARTIAL = 'skills-src/partials/preflight/recalibrate.md';
const CODEX_RUN = 'skills/dual-critic/entry/codex/dual-run/SKILL.md';
const UNIT = 'dist/test/test/unit/preflight-recalibrate.test.js';
const CONTRACT = 'dist/test/test/contract/skill-recalibrate.test.js';
const INTEG = 'dist/test/test/integration/doctor-deadline-cli.test.js';

const ENTRY_FILES = execFileSync('git', ['ls-files', 'skills'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('SKILL.md'));
const snapshot = () => Object.fromEntries([PREFLIGHT, PARTIAL, ...ENTRY_FILES].map((f) => [f, sha(f)]));

const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const buildTests = () => node(['scripts/build.mjs', '--tests-only']);
const buildBundles = () => node(['scripts/build.mjs']);
const render = () => node(['scripts/build.mjs', '--render-only']);

function runTests(files, pattern) {
  const r = node(['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...files]);
  const out = r.stdout + r.stderr;
  const num = (k) => Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1] ?? NaN);
  const failed = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i);
  return { tests: num('tests'), pass: num('pass'), fail: num('fail'), failed, ...(r.status !== 0 ? { excerpt: out.split('\n').filter((l) => /^\s*(✖|not ok|error:|AssertionError|Error)/.test(l)).slice(0, 12) } : {}) };
}

function mutate(rel, from, to) {
  const src = readFileSync(P(rel), 'utf8');
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${rel}：变异锚点出现 ${n} 次（应为 1）：${from.slice(0, 60)}`);
  writeFileSync(P(rel), src.replace(from, to));
  return src;
}

const ANN_BEFORE = "    announce_before: `预检退 69，以下失败项可由 doctor 重新校准：${failed.map((c) => c.name).join('、')}；`\n"
  + '      + `将依次在前台跑 ${invocations.length} 次 doctor（每次至多 ${deadlineS} 秒），会消耗少量配额。`,\n';
const GATE = '   **在这句话出现在对话里之前，不得发起任何 doctor 调用。**\n';

const MUTATIONS = [
  { id: 'M1', what: 'buildRecalibration 去掉 announce_before', kind: 'src', rel: PREFLIGHT, from: ANN_BEFORE, to: '', run: [[UNIT]] },
  { id: 'M2', what: '键序：announce_before 挪到 invocations 之后', kind: 'src+bundle', rel: PREFLIGHT,
    from: `${ANN_BEFORE}    invocations,\n`, to: `    invocations,\n${ANN_BEFORE}`, run: [[UNIT], [[INTEG], 'I5']] },
  { id: 'M3', what: '片段：闸门句挪到调用细则之后', kind: 'partial', rel: PARTIAL, from: GATE, to: '',
    extra: { from: '3. 全部跑完后', to: `${GATE}3. 全部跑完后` }, run: [[CONTRACT]] },
  { id: 'M4', what: '只改 codex 载体 dual-run 一份产物（不经渲染）', kind: 'entry', rel: CODEX_RUN, from: '每家数十 KB', to: '每家几十 KB', run: [[CONTRACT]] },
  { id: 'M5', what: '片段：删「前后不加任何东西」', kind: 'partial', rel: PARTIAL, from: '**前后不加任何东西**：', to: '', run: [[CONTRACT]] },
  { id: 'M6', what: 'buildRecalibration 去掉 announce_after_pass', kind: 'src', rel: PREFLIGHT, from: '    announce_after_pass: RECAL_ANNOUNCE_AFTER_PASS,\n', to: '', run: [[UNIT]] },
  { id: 'M7', what: '片段：定性句原文改一个字', kind: 'partial', rel: PARTIAL, from: '已自动校准后通过。」**', to: '已自动校准并通过。」**', run: [[CONTRACT]] },
  // 代码审 GLM-01 补
  { id: 'M8', what: '片段：删「args 的各项也不改、不增删」', kind: 'partial', rel: PARTIAL, from: '；`args` 的各项也不改、不增删。', to: '。', run: [[CONTRACT]] },
  { id: 'M9', what: '片段：删回落句的「同样先发后调」', kind: 'partial', rel: PARTIAL, from: '自拟，同样先发后调。', to: '自拟。', run: [[CONTRACT]] },
];

const before = snapshot();
const only = process.argv[3]?.split(',');
const results = [];
for (const m of MUTATIONS.filter((x) => !only || only.includes(x.id))) {
  const orig = mutate(m.rel, m.from, m.to);
  if (m.extra) mutate(m.rel, m.extra.from, m.extra.to);
  try {
    if (m.kind === 'partial') render();
    if (m.kind.startsWith('src')) buildTests();
    if (m.kind === 'src+bundle') buildBundles();
    const runs = m.run.map(([files, pattern]) => [[files].flat(), pattern]).map(([files, pattern]) => ({ files, pattern: pattern ?? null, ...runTests(files, pattern) }));
    results.push({ id: m.id, what: m.what, red: runs.some((r) => r.fail > 0), runs });
  } finally {
    writeFileSync(P(m.rel), orig);
    if (m.kind === 'partial') render();
    if (m.kind.startsWith('src')) buildTests();
    if (m.kind === 'src+bundle') buildBundles();
  }
}
const after = snapshot();
const drift = Object.keys(before).filter((f) => before[f] !== after[f]);
const report = { generated_at: new Date().toISOString(), all_red: results.every((r) => r.red), restored: drift.length === 0, drift, results };
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ all_red: report.all_red, restored: report.restored, drift, red: results.map((r) => `${r.id}:${r.red}`) }));
