#!/usr/bin/env node
/**
 * 「MCP执行工具调用检测」（EV-188）改前 / 改后判定对照（计划 r2 §3.1，零配额）。
 *
 * 旧构建：`git archive 6aee012` 解到 mkdtemp，`node_modules` 软链本仓工作树（不联网、不 npm ci），在归档里
 * `node scripts/build.mjs --with-tests`；新构建：本仓工作树的 `dist/test`（先 `node scripts/build.mjs --with-tests`）。
 *
 * 同一份三样本（`test/helpers/zcode-mcp-samples.ts` 的 `roundSample`：执行型 / 名单外 / 无 MCP，取新树编译产物生成一次，
 * 两份构建喂同一批文件）分别经各自构建的 `zcodeAdapter.run`（假 `zcode.cjs` 按 0.16.9 取值链把样本落进运行目录）
 * → `judgeRun` → `renderGuardWarnings`。断言：
 *   - 改前：执行型与名单外两样本都放行（`readonlyBreach: false`、无 `untrusted`、`tool_calls` 无 `mcp`）——复现缺口；
 *   - 改后：执行型判失守、写事件点名 `mcp__node_repl__js`；名单外记证据不可信、点名工具、不失守；
 *   - 无 MCP 样本：改前改后 `tool_calls` / `write_events` / 告警逐字相同；
 *   - 两份 bundle 的 sha256 不同；旧树与工作树的 package.json / package-lock.json 逐字节相同。
 *
 * 真实历史样本回放（计划双审 CODEX-03）：取一次真实运行的 glm 侧日志与 rollout 原件（只读、不拷进仓库），
 * 喂两份构建的纯解析函数，记改前 / 改后的 MCP 写事件条数与工具名。原件不在时**软跳过**、写「已跳过：原件不在」。
 *
 * 用法（在仓库根）：node acceptance.mjs [输出 JSON 路径] [回放用的运行目录（缺省 run 20261001T092816Z 的 glm 侧）]
 * 清理：只删本脚本 mkdtemp 返回的目录（R1）。
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE = '6aee012';
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const REPLAY = process.argv[3] ?? path.join(os.homedir(), '.trivium/runs/TriviumCode-2217d505/20261001T092816Z/glm');
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const made = [];
const tmp = async (prefix) => {
  const d = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
};
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` —— ${detail}` : ''}`);
};

const SAMPLE_ENTRY = (sid) => `
const fs = require('node:fs'), path = require('node:path');
const env = process.env, sid = ${JSON.stringify(sid)};
const homeZ = path.join(env.HOME, '.zcode');
const logDir = env.ZCODE_LOG_DIR || path.join(homeZ, 'cli', 'log');
const storage = env.ZCODE_STORAGE_DIR || homeZ;
const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const src = env.FAKE_SAMPLE_DIR;
put(path.join(logDir, 'zcode-2026-10-01.jsonl'), fs.readFileSync(path.join(src, 'log.jsonl'), 'utf8'));
put(path.join(storage, 'cli', 'rollout', 'model-io-' + sid + '.jsonl'), fs.readFileSync(path.join(src, 'rollout.jsonl'), 'utf8'));
process.stdout.write(JSON.stringify({ sessionId: sid, response: '{}', usage: {}, eventCount: 1 }) + '\\n');
process.exit(0);
`;

async function loadBuild(tree) {
  const m = (rel) => import(pathToFileURL(path.join(tree, 'dist/test/src/trivium', rel)).href);
  return {
    zcode: await m('adapters/zcode.js'),
    trace: await m('adapters/zcode-trace.js'),
    guard: await m('guard.js'),
    config: await m('config.js'),
    git: await m('util/git.js'),
  };
}

/** 一份构建、一种样本：假入口落样本 → 适配器组装 → judgeRun → 告警 */
async function runSample(b, files, sid) {
  const root = await tmp('trivium-ev188acc-proj-');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  for (const f of ['src/a.ts', 'src/b.ts', 'README.md', 's.md']) await fs.writeFile(path.join(root, f), `// ${f}\n`);
  await b.git.initFixtureRepo(root);
  const before = await b.git.workTreeHash(root);
  const app = await tmp('trivium-ev188acc-app-');
  const entry = path.join(app, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, SAMPLE_ENTRY(sid));
  await fs.mkdir(path.join(app, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(app, 'Resources/config/provider/zcode-builtin.json'), '{}');
  const sampleDir = await tmp('trivium-ev188acc-sample-');
  await fs.writeFile(path.join(sampleDir, 'log.jsonl'), files.log(root));
  await fs.writeFile(path.join(sampleDir, 'rollout.jsonl'), files.rollout(root));
  const cfg = b.config.defaultConfig();
  cfg.probe.cli.zcode.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode.entrypoint = entry;
  cfg.probe.cli.zcode.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit,Bash'];
  cfg.probe.cli.zcode.response_field = 'response';
  const sideDir = path.join(await tmp('trivium-ev188acc-run-'), 'glm');
  const req = {
    run_id: 'r', topic: 't', stage: 'plan', critic: 'glm', project_root: root, subject_path: path.join(root, 's.md'), deny_paths: [],
    out_dir: path.join(sideDir, 'out'), brief_path: path.join(root, 'b.md'), brief_text: 'ok', model: null, timeout_s: 20,
    schema_path: path.join(root, 'schema.json'), min_tool_calls: 0, min_project_reads: 0, profile_requested: null,
  };
  const saved = { HOME: process.env.HOME, FAKE_SAMPLE_DIR: process.env.FAKE_SAMPLE_DIR };
  process.env.HOME = await tmp('trivium-ev188acc-home-');
  process.env.FAKE_SAMPLE_DIR = sampleDir;
  let result;
  try {
    result = await b.zcode.zcodeAdapter.run({ cfg, nodePath: process.execPath }, req);
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const verdict = await b.guard.judgeRun({
    cfg, degraded: {}, projectRoot: root, archiveRootAbs: path.join(root, '.reviews'), archiveRootRel: '.reviews',
    before: { gitHead: null, treeHash: before, dirty: false, subjectSha256: 'S', subjectPath: req.subject_path, denyPaths: [], diffText: null, takenAt: 'now' },
    afterTreeHash: await b.git.workTreeHash(root), afterSubjectSha256: 'S', relatedPaths: [],
    results: { glm: result }, reviews: { glm: null }, requests: { glm: req }, capabilities: { glm: b.zcode.zcodeAdapter.capability },
  });
  // 告警里的临时路径归一化，便于改前改后逐字比
  const norm = (s) => s.split(root).join('〈proj〉');
  return {
    status: result.status,
    tool_calls: result.tool_calls,
    write_events: result.write_events.map(norm),
    mcp_untrusted_tools: result.mcp_untrusted_tools ?? null,
    readonlyBreach: verdict.readonlyBreach,
    untrusted: verdict.sides.glm?.verification?.untrusted ?? null,
    warnings: b.guard.renderGuardWarnings(verdict).map(norm),
  };
}

async function main() {
  // ── 前置：旧树 ──
  const old = await tmp('trivium-ev188acc-old-');
  execFileSync('sh', ['-c', `git archive ${BASE} | tar -x -C "${old}"`], { cwd: ROOT });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'));
  execFileSync('git', ['diff', '--quiet', BASE, '--', 'package.json', 'package-lock.json'], { cwd: ROOT });
  check('旧树与工作树的 package.json / package-lock.json 逐字节相同', true);
  execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: old, stdio: 'ignore' });
  const shaOld = await sha(path.join(old, 'skills/dual-critic/scripts/trivium.cjs'));
  const shaNew = await sha(path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'));
  check('两份 bundle 的 sha256 不同', shaOld !== shaNew, `${shaOld} / ${shaNew}`);

  const builds = { old: await loadBuild(old), new: await loadBuild(ROOT) };
  const samples = await import(pathToFileURL(path.join(ROOT, 'dist/test/test/helpers/zcode-mcp-samples.js')).href);
  const kinds = ['exec', 'untrusted', 'none'];
  const out = {};
  for (const [label, b] of Object.entries(builds)) {
    out[label] = {};
    for (const k of kinds) {
      out[label][k] = await runSample(b, {
        log: (root) => samples.roundSample(k, root).log,
        rollout: (root) => samples.roundSample(k, root).rollout,
      }, samples.SAMPLE_SID);
    }
  }

  // ── 改前：两种样本都放行 ──
  for (const k of ['exec', 'untrusted']) {
    const o = out.old[k];
    check(`改前 ${k}：放行（不失守、无不可信、无 mcp 键）`, o.status === 'ok' && !o.readonlyBreach && o.untrusted === null && !('mcp' in o.tool_calls) && o.write_events.length === 0, JSON.stringify(o));
  }
  // ── 改后：一档失守、一档不可信 ──
  const ne = out.new.exec;
  check('改后 exec：判只读失守、写事件点名 mcp__node_repl__js、mcp=1',
    ne.readonlyBreach && ne.write_events.length === 1 && ne.write_events[0].startsWith('MCP:mcp__node_repl__js(') && ne.tool_calls.mcp === 1 && ne.untrusted === null,
    JSON.stringify(ne));
  check('改后 exec：告警有失守段与 MCP 补句', ne.warnings[0]?.startsWith('只读失守：') && ne.warnings.some((w) => w.includes('`MCP:` 开头的是 MCP 执行型工具调用')), JSON.stringify(ne.warnings));
  const nu = out.new.untrusted;
  check('改后 untrusted：记证据不可信并点名、不失守、mcp=1',
    !nu.readonlyBreach && JSON.stringify(nu.untrusted) === JSON.stringify({ cause: 'mcp-call', tools: ['mcp__zread__read_file'] }) && nu.tool_calls.mcp === 1 && nu.write_events.length === 0,
    JSON.stringify(nu));
  check('改后 untrusted：告警一行点名工具', nu.warnings.some((w) => w.startsWith('glm 侧证据不可信（MCP 调用）') && w.includes('mcp__zread__read_file')), JSON.stringify(nu.warnings));
  // ── 无 MCP：逐字相同 ──
  check('无 MCP 样本：改前改后 tool_calls / write_events / 告警逐字相同',
    JSON.stringify(out.old.none.tool_calls) === JSON.stringify(out.new.none.tool_calls)
      && JSON.stringify(out.old.none.write_events) === JSON.stringify(out.new.none.write_events)
      && JSON.stringify(out.old.none.warnings) === JSON.stringify(out.new.none.warnings),
    JSON.stringify({ old: out.old.none, new: out.new.none }));

  // ── 真实历史样本回放（软跳过） ──
  let replay;
  const roFile = path.join(REPLAY, 'out/rollout.jsonl');
  const logDir = path.join(REPLAY, 'home/.zcode/cli/log');
  if (!existsSync(roFile) || !existsSync(logDir)) {
    replay = { skipped: `已跳过：原件不在（${REPLAY}）` };
    console.log(`- 回放${replay.skipped}`);
  } else {
    const roText = await fs.readFile(roFile, 'utf8');
    const logText = (await Promise.all((await fs.readdir(logDir)).filter((f) => f.endsWith('.jsonl')).sort().map((f) => fs.readFile(path.join(logDir, f), 'utf8')))).join('\n');
    const per = {};
    for (const [label, b] of Object.entries(builds)) {
      const ro = b.trace.parseZcodeRollout(roText);
      const lg = b.trace.parseZcodeTrace(logText, null);
      let writes = [...new Set([...lg.writeEvents, ...ro.writeEvents])];
      let mcp = null;
      if (typeof b.trace.summarizeZcodeMcp === 'function') {
        const s = b.trace.summarizeZcodeMcp(ro.toolCalls, lg.mcpCalls, lg.mcpCallIds);
        writes = [...new Set([...writes, ...s.execEvents])];
        mcp = { total: s.total, byTool: s.byTool, sources: s.sources, untrustedTools: s.untrustedTools };
      }
      // 只记条数与工具名，不落参数原文
      per[label] = { writeEvents: writes.length, mcpWriteEvents: writes.filter((w) => w.startsWith('MCP:')).length, toolNames: [...new Set(writes.map((w) => w.split('(')[0]))], mcp };
    }
    replay = { run: REPLAY, ...per };
    check('回放：改前 MCP 写事件 0 条', per.old.mcpWriteEvents === 0, JSON.stringify(per.old));
    check('回放：改后 MCP 写事件 7 条、计数 7', per.new.mcpWriteEvents === 7 && per.new.mcp?.total === 7, JSON.stringify(per.new));
  }

  const readout = {
    base: BASE, sha256: { old: shaOld, new: shaNew }, results: out, replay,
    passed: checks.filter((c) => c.ok).length, total: checks.length, checks,
  };
  if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
  console.log(`${readout.passed}/${readout.total}`);
  if (readout.passed !== readout.total) process.exitCode = 1;
}

try {
  await main();
} finally {
  for (const d of made) await fs.rm(d, { recursive: true, force: true });
}
