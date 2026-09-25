#!/usr/bin/env node
/**
 * M10b r5 §7.3 兼容验收（J3）：claude 轮（code 阶段）的 `.reviews/` 布局、文件名、`_meta` 形状与 settings.json Hook 段，
 * 与 M9 留痕比对，差异逐条对照白名单。
 *
 * 对照源：
 *   · M9 留痕：本仓 `.reviews/M9-Grep命中计入读取面/code/`（M9 收口前最后一个 claude Driver code 轮，第 2 轮 run 20260919T154710Z）；
 *   · M9 settings Hook 段：用 M9 基线 CLI 在 mkdtemp 目录里跑 `init` 生成（与当前 `init` 同口径，不取本仓手工维护的 settings）；
 *   · 本轮：夹具 `.reviews/限流器重构/code/` 与夹具 `.claude/settings.json`。
 * 只读两处归档，只写本目录 `04-j3-compare.json` 与 mkdtemp 目录（不删除，路径写进输出）。
 *
 *   node j3-compare.mjs <fixture> <run_id>
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const [fixture, runId] = process.argv.slice(2);
if (!fixture || !runId) {
  console.error('用法：node j3-compare.mjs <fixture> <run_id>');
  process.exit(64);
}
const reg = JSON.parse(await fs.readFile(path.join(HERE, '..', 'm10b-m9-baseline-20260925', 'baseline-registration.json'), 'utf8'));

/*
 * 对照源取 M9 收口前**最后一个** claude code 轮。第一次运行取了 `M9-Driver旗标全链路与选侧收口` r3（20260918T231928Z），
 * 它审的正是引入 `driver_enabled` / `critics.<id>.override_reason` 的 `3686058` 本身、运行时这两个字段还不存在，
 * 不代表 M9 终态，于是把这两项误报成「M10 新增」；改取下面这一轮（M9 code 轮按 started_at 排序的最后一行）。
 */
const M9_TOPIC = 'M9-Grep命中计入读取面';
const M9_RUN = '20260919T154710Z';
const M9_ROUND = 2;
const m9Dir = path.join(REPO, '.reviews', M9_TOPIC, 'code');
const T = '限流器重构';
const curDir = path.join(fixture, '.reviews', T, 'code');

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

/** 递归取 JSON 键路径；数组元素并为 [] ，对象型 map（critics 等以审核者 id 为键）把键归一为 <id> */
const ID_KEYED = new Set(['critics', 'models', 'sides', 'drivers']);
function keyPaths(v, prefix = '', out = new Set()) {
  if (Array.isArray(v)) {
    out.add(`${prefix}[]`);
    for (const x of v) keyPaths(x, `${prefix}[]`, out);
  } else if (v && typeof v === 'object') {
    const last = prefix.split('.').pop();
    for (const [k, x] of Object.entries(v)) {
      const kk = ID_KEYED.has(last) ? '<id>' : k;
      const p = prefix ? `${prefix}.${kk}` : kk;
      out.add(p);
      keyPaths(x, p, out);
    }
  }
  return out;
}
function diffKeys(a, b) {
  const A = keyPaths(a);
  const B = keyPaths(b);
  return { only_m9: [...A].filter((k) => !B.has(k)).sort(), only_cur: [...B].filter((k) => !A.has(k)).sort() };
}

/** 文件名归一：日期、主题、run_id、审核者 id 换成占位符 */
const CRITICS = ['codex', 'gemini', 'glm'];
function normName(n, topic) {
  let s = n.replaceAll(topic, '<topic>').replace(/\d{4}-\d{2}-\d{2}/g, '<date>').replace(/\d{8}T\d{6}Z/g, '<run>').replace(/-r\d+-/g, '-r<N>-');
  for (const c of CRITICS) s = s.replace(new RegExp(`-${c}(?=[.-])`, 'g'), '-<critic>');
  return s;
}
/** 只取指定轮次（rerun_index = round，≥ 2 时文件名带 -r<round>-）的顶层文件与该 run 的 _meta 文件 */
async function layout(dir, topic, runFilter, round) {
  const top = (await fs.readdir(dir)).sort();
  const meta = (await fs.readdir(path.join(dir, '_meta'))).sort();
  const topRound = top.filter((n) => n.endsWith('.md') && (round === 1 ? !/-r\d+-/.test(n) : n.includes(`-r${round}-`)));
  const metaRun = meta.filter((n) => !/\d{8}T\d{6}Z/.test(n) || n.includes(runFilter));
  return { round, top: [...new Set(topRound.map((n) => normName(n, topic)))].sort(), meta: [...new Set(metaRun.map((n) => normName(n, topic)))].sort() };
}

// ── 1. 布局与文件名 ──
const m9Layout = await layout(m9Dir, M9_TOPIC, M9_RUN, M9_ROUND);
const curLayout = await layout(curDir, T, runId, 2);
const setDiff = (a, b) => a.filter((x) => !b.includes(x));
const layoutDiff = {
  top_only_m9: setDiff(m9Layout.top, curLayout.top),
  top_only_cur: setDiff(curLayout.top, m9Layout.top),
  meta_only_m9: setDiff(m9Layout.meta, curLayout.meta),
  meta_only_cur: setDiff(curLayout.meta, m9Layout.meta),
};

// ── 2. _meta 形状 ──
const m9Run = await readJson(path.join(m9Dir, '_meta', `run-${M9_RUN}.json`));
const curRun = await readJson(path.join(curDir, '_meta', `run-${runId}.json`));
const m9Review = await readJson(path.join(m9Dir, '_meta', `review-codex-${M9_RUN}.json`));
const curReview = await readJson(path.join(curDir, '_meta', `review-codex-${runId}.json`));
const m9Task = await readJson(path.join(REPO, '.reviews', M9_TOPIC, 'task.json'));
const curTask = await readJson(path.join(fixture, '.reviews', T, 'task.json'));

const runDiff = diffKeys(m9Run, curRun);
const reviewDiff = diffKeys(m9Review, curReview);
const taskDiff = diffKeys(m9Task, curTask);

// ── 3. settings.json Hook 段 ──
const m9InitDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'm10b-s4r2-m9init-')));
spawnSync('git', ['init', '-q'], { cwd: m9InitDir });
/*
 * 不传 TRIVIUM_ASSET_ROOT（连空串也不传）：第一次运行传了空串，M9 init 把它当资产根、找不到 Hook 模板，
 * 静默没写 .claude/settings.json（该次的 mkdtemp 目录登记在输出的 m9.discarded_init_dirs）。
 */
const initEnv = { ...process.env };
delete initEnv.TRIVIUM_ASSET_ROOT;
const initRes = spawnSync(process.execPath, [reg.cli_path, 'init'], { cwd: m9InitDir, encoding: 'utf8', env: initEnv });
const m9Settings = await readJson(path.join(m9InitDir, '.claude', 'settings.json')).catch(() => null);
const curSettings = await readJson(path.join(fixture, '.claude', 'settings.json'));
const hookEvents = (s) => Object.fromEntries(Object.entries(s?.hooks ?? {}).map(([ev, arr]) => [ev, arr.map((e) => ({ matcher: e.matcher ?? null, commands: (e.hooks ?? []).map((h) => h.command), timeouts: (e.hooks ?? []).map((h) => h.timeout ?? null) }))]));
const m9Hooks = hookEvents(m9Settings);
const curHooks = hookEvents(curSettings);
const hookDiff = [];
for (const ev of new Set([...Object.keys(m9Hooks), ...Object.keys(curHooks)])) {
  const a = JSON.stringify(m9Hooks[ev] ?? null);
  const b = JSON.stringify(curHooks[ev] ?? null);
  if (a !== b) hookDiff.push({ event: ev, m9: m9Hooks[ev] ?? null, cur: curHooks[ev] ?? null });
}

// ── 4. 白名单取值 ──
const artifacts = curRun.artifacts ?? [];
const whitelistValues = {
  driver_guard_level: { expect: 'L1', got: curRun.driver_guard_level ?? null, ok: curRun.driver_guard_level === 'L1' },
  task_drivers_code: { expect: '不出现（命令 C 不认领）', got: curTask.drivers?.code ?? null, ok: curTask.drivers?.code === undefined },
  artifacts_no_draft_entry: {
    expect: 'code 轮无原稿条目',
    got: artifacts.map((a) => a.path ?? a).filter((p) => /-claude\.md$/.test(p)),
    ok: !artifacts.some((a) => /-claude\.md$/.test(a.path ?? a)),
  },
  gate_warnings: { expect: '照 r2（原稿不在保护集：code 轮无原稿，不应出现）', got: curRun.gate?.warnings ?? null },
  snapshot: { got: curRun.snapshot ?? null },
};

const out = {
  at: new Date().toISOString(),
  m9: {
    topic: M9_TOPIC,
    run: M9_RUN,
    dir: path.relative(REPO, m9Dir),
    baseline_cli: reg.cli_path,
    init_dir: m9InitDir,
    init_exit: initRes.status,
    init_stdout_tail: (initRes.stdout ?? '').split('\n').slice(-15),
    init_stderr_tail: (initRes.stderr ?? '').split('\n').slice(-10),
    settings_found: m9Settings !== null,
    discarded_init_dirs: ['/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/m10b-s4r2-m9init-EwYAxQ'],
  },
  cur: { fixture, topic: T, run: runId },
  layout: { m9: m9Layout, cur: curLayout, diff: layoutDiff },
  run_json_keys: runDiff,
  review_json_keys: reviewDiff,
  task_json_keys: taskDiff,
  settings_hook_diff: hookDiff,
  whitelist_values: whitelistValues,
};
await fs.writeFile(path.join(HERE, '04-j3-compare.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ layoutDiff, runDiff, reviewDiff, taskDiff, hookDiffEvents: hookDiff.map((h) => h.event), whitelistValues, m9_init_exit: initRes.status }, null, 2));
