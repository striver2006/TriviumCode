#!/usr/bin/env node
/**
 * EV-125 零配额验收（计划 r2 §4.3）：E1 解析、E2 预检、E3 渲染产物，另跑 doctor --selftest。
 *
 * **不碰真实 HOME**（r2 CODEX-01）：不跑 `install:local`，直接用 `npm run build` 产出在仓库内的
 * `skills/dual-critic/scripts/trivium.cjs`；资产根经 `TRIVIUM_ASSET_ROOT` 指向工作树，只作用于本脚本派生的子进程。
 * 预检带 `--skip-auth-check`，不发起任何模型调用。
 *
 * 读数写进同目录 `01-readout.json`（原始输出）与终端摘要；会话里的命令不带重定向，输出由脚本自己写。
 * 用法：node doc/05_testing/evidence/ev125-acceptance-20260925/run.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const ENV = { ...process.env, TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic') };

async function cli(args) {
  try {
    const r = await run(process.execPath, [CLI, ...args], { cwd: ROOT, env: ENV, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** stdout 里可能先有几行人读提示，取最后一个完整 JSON 对象 */
function lastJson(s) {
  const i = s.indexOf('\n{');
  const start = s.startsWith('{') ? 0 : i >= 0 ? i + 1 : -1;
  if (start < 0) return null;
  try { return JSON.parse(s.slice(start)); } catch { return null; }
}

const results = [];
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };
const raw = {};

const lsReviews = async () => (await fs.readdir(path.join(ROOT, '.reviews'))).sort();

// ── E1 解析 ──
const before = await lsReviews();
const e1 = await cli([
  'topic', 'resolve', '--stage', 'all', '--json', '--',
  '任意目标', '--topic', 'EV-125-E1', '--driver', 'codex',
  '--critics', 'claude,glm', '--model-claude', 'm-x', '--allow-single',
]);
raw.e1 = e1;
const j1 = lastJson(e1.stdout);
check('E1-a 退出码', e1.code === 0, `code=${e1.code}`);
check('E1-b critics', JSON.stringify(j1?.critics) === JSON.stringify(['claude', 'glm']), `critics=${JSON.stringify(j1?.critics)}`);
check('E1-c models', j1?.models?.claude === 'm-x', `models=${JSON.stringify(j1?.models)}`);
check('E1-d allow_single', j1?.allow_single === true, `allow_single=${j1?.allow_single}`);
check('E1-e only 置空', j1?.only === null, `only=${JSON.stringify(j1?.only)}`);
check('E1-f driver', j1?.driver === 'codex', `driver=${j1?.driver}`);

const e1b = await cli([
  'topic', 'resolve', '--stage', 'all', '--json', '--',
  '任意目标', '--topic', 'EV-125-E1', '--driver', 'claude', '--critics', 'claude',
]);
raw.e1b = e1b;
check('E1-g 含当轮 Driver 退 64', e1b.code === 64, `code=${e1b.code}；${(e1b.stderr || e1b.stdout).split('\n').find((l) => l.trim()) ?? ''}`);
check('E1-h 不是已撤销的旗标拒绝', !/命令 A（全流程）不接受/.test(e1b.stderr + e1b.stdout), '报错里没有「命令 A（全流程）不接受」');

const after = await lsReviews();
check('E1-i 纯只读', JSON.stringify(before) === JSON.stringify(after), `.reviews 目录项前后均为 ${after.length} 个`);

// ── E2 预检 ──
const e2 = await cli(['preflight', '--stage', 'all', '--driver', 'codex', '--critics', 'claude,glm', '--skip-auth-check', '--json']);
raw.e2 = e2;
const j2 = lastJson(e2.stdout);
check('E2-a 退出码', e2.code === 0, `code=${e2.code}；ok=${j2?.ok}`);
const slug = j2?.checks?.find((c) => c.name === '模型 slug 合法');
check('E2-b slug 覆盖三个阶段 × 两侧', /3 个阶段 × 2 侧/.test(slug?.detail ?? ''), `detail=${slug?.detail}`);
const ro = j2?.checks?.find((c) => c.name === '只读能力可用');
check('E2-c 只读能力只报入选两侧', /Claude Code/.test(ro?.detail ?? '') && /ZCode/.test(ro?.detail ?? '') && !/Antigravity/.test(ro?.detail ?? ''), `detail=${ro?.detail}`);

// ── E2b 预检的完整形态（代码双审 CODEX-01）：S0.6 模板里的三样同传 ──
// `default` 是本仓 config.yaml 的 active_profile；`GLM-5.3` 是本仓 glm 侧在该档位下的生效模型
const e2b = await cli([
  'preflight', '--stage', 'all', '--driver', 'codex', '--critics', 'claude,glm',
  '--profile', 'default', '--model-glm', 'GLM-5.3', '--skip-auth-check', '--json',
]);
raw.e2b = e2b;
const j2b = lastJson(e2b.stdout);
check('E2b-a 三样同传退 0', e2b.code === 0 && j2b?.ok === true, `code=${e2b.code}；ok=${j2b?.ok}`);
const slugB = j2b?.checks?.find((c) => c.name === '模型 slug 合法');
check('E2b-b slug 仍覆盖三个阶段 × 两侧', /3 个阶段 × 2 侧/.test(slugB?.detail ?? ''), `detail=${slugB?.detail}`);
// 反向格：给没入选的一家指定模型 ⇒ 预检同样退 64（与 review --start 同一判定）
const e2c = await cli([
  'preflight', '--stage', 'all', '--driver', 'codex', '--critics', 'claude,glm',
  '--model-gemini', 'x', '--skip-auth-check', '--json',
]);
raw.e2c = e2c;
check('E2b-c 未入选一家的模型覆盖退 64', e2c.code === 64, `code=${e2c.code}；${(e2c.stderr || e2c.stdout).split('\n').find((l) => /入选/.test(l)) ?? ''}`);

// ── E3 渲染产物 ──
const products = {
  claude: 'skills/dual-run/SKILL.md',
  codex: 'skills/dual-critic/entry/codex/dual-run/SKILL.md',
  gemini: 'skills/dual-critic/entry/gemini/dual-run/SKILL.md',
  glm: 'skills/dual-critic/entry/glm/dual-run/SKILL.md',
};
raw.e3 = {};
for (const [agent, rel] of Object.entries(products)) {
  const md = await fs.readFile(path.join(ROOT, rel), 'utf8');
  const hint = md.split('\n').find((l) => l.startsWith('argument-hint:') || l.includes('参数写法：`')) ?? '';
  raw.e3[agent] = hint;
  const models = [...hint.matchAll(/--model-([a-z]+)/g)].map((m) => m[1]);
  const want = ['claude', 'codex', 'gemini', 'glm'].filter((x) => x !== agent);
  check(`E3-${agent} 模型槽位`, JSON.stringify(models) === JSON.stringify(want), `--model-* = ${models.join(',')}`);
  check(`E3-${agent} 选侧旗标`, /--critics <id,…>/.test(hint) && /--only [a-z|]+/.test(hint) && /--allow-single/.test(hint), '含 --critics / --only / --allow-single');
  const resolveAt = md.indexOf('TV topic resolve --stage all');
  const pre = md.split('\n').find((l) => l.includes('TV preflight --stage all')) ?? '';
  check(`E3-${agent} 先解析后预检`, resolveAt >= 0 && resolveAt < md.indexOf(pre) && /--critics /.test(pre), pre.trim());
}

// ── doctor --selftest ──
const st = await cli(['doctor', '--selftest']);
raw.selftest = st;
const tail = (st.stdout + st.stderr).trim().split('\n').slice(-1)[0] ?? '';
check('selftest', st.code === 0, `code=${st.code}；${tail}`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed} / ${results.length} 成立`);
await fs.writeFile(path.join(HERE, '01-readout.json'), JSON.stringify({ at: new Date().toISOString(), results, raw }, null, 2) + '\n', 'utf8');
process.exit(passed === results.length ? 0 : 1);
