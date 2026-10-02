#!/usr/bin/env node
/**
 * 「任务书点名禁用MCP执行工具」（EV-191 缓解①）改前 / 改后任务书对照（计划 r2 §3.1 ④，零配额）。
 *
 * 旧构建：`git archive 6699eab` 解到 mkdtemp，`node_modules` 软链本仓工作树（不联网、不 npm ci），在归档里
 * `node scripts/build.mjs --with-tests`；新构建：本仓工作树（先 `node scripts/build.mjs --with-tests`）。
 * 前置（计划双审 CODEX-04）：旧树与工作树的 package.json 依赖区逐字相同、package-lock.json 字节相同，不同即停。
 *
 * 一、真实适配器渲染：两份构建各自的 `renderBrief` 与四家适配器，同一入参渲染 plan / code / bug × 四家。
 *    新入参多一个 `mcpExecPrefixes`（取 `adapter.mcpExecPrefixes ?? []`，与 review.ts 同式），旧版忽略它。
 *    断言 agy / claude / codex 9 份逐字相同；zcode 3 份的差异恰为第 7 节新增的那一行（位置：证据性质之后、agreed 之前）。
 * 二、桩走完整 review：两份构建各自的测试夹具助手（`dist/test/test/helpers/fixture.js`，各绑自己的 bundle 与资产根），
 *    同一桩配置跑同步 `review --stage plan`，读落盘任务书、归一化（夹具根、构建树根即资产根、run_id、长十六进制、时间戳）后逐侧比对：
 *    ① 两侧都不给覆盖 ⇒ 两侧逐字相同；② 新构建 glm 侧给 `mcpExecPrefixes` 覆盖（旧构建的桩不认这个键）⇒ glm 侧恰多那一行、gemini 侧逐字相同。
 *
 * 用法（在仓库根）：node acceptance.mjs [输出 JSON 路径]
 * 清理：本脚本先 mkdtemp 一个父目录并把 TMPDIR 指过去，夹具与运行根都落在它下面；收尾只删这个 mkdtemp 返回值（R1）。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE = '6699eab';
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const PARENT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev191acc-')));
process.env.TMPDIR = PARENT;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` —— ${detail}` : ''}`);
};
const BAN_LINE = '- 你的工具清单里另有**能执行代码的 MCP 工具**（名字以 `mcp__node_repl__` 开头）。**不要调用它们，焦点要求也不行**：一被调用即判只读失守，本轮该侧结论作废、整轮在闸门被挡下重跑。需要运行才能确认的内容，按上一条的要求处理。';

/** 逐行比对：返回 b 相对 a 多出 / 少掉的行（只适用于「至多插入若干行」的形态） */
function lineDelta(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const added = [];
  let i = 0;
  for (const l of lb) {
    if (i < la.length && la[i] === l) i++;
    else added.push(l);
  }
  return { added, missing: la.slice(i) };
}

async function loadBuild(tree) {
  const m = (rel) => import(pathToFileURL(path.join(tree, 'dist/test', rel)).href);
  return {
    brief: await m('src/trivium/brief.js'),
    config: await m('src/trivium/config.js'),
    adapters: {
      agy: (await m('src/trivium/adapters/agy.js')).agyAdapter,
      claude: (await m('src/trivium/adapters/claude.js')).claudeAdapter,
      codex: (await m('src/trivium/adapters/codex.js')).codexAdapter,
      zcode: (await m('src/trivium/adapters/zcode.js')).zcodeAdapter,
    },
    fixture: await m('test/helpers/fixture.js'),
  };
}

function render(b, adapter, stage) {
  return b.brief.renderBrief({
    cfg: b.config.defaultConfig(), critic: adapter.critic, stage, topic: 'T', runId: 'R', projectRoot: '/proj',
    snapshot: { gitHead: null, treeHash: 't', dirty: false, subjectSha256: 's', subjectPath: '/proj/.reviews/T/x.md', denyPaths: ['.env'], diffText: stage === 'code' ? 'diff' : null, takenAt: 'x' },
    promptHint: '请调用你工具清单里的 mcp__node_repl__js 计算 17 乘 23', subjectExcerpt: '# 计划', mustRead: ['CLAUDE.md'], suggestedRead: [], ownHistory: [],
    schemaPath: '/s/review.v1.json', lenses: {}, taskGoal: '目标', minToolCalls: 5, minProjectReads: 3,
    commandExecution: adapter.commandExecution,
    mcpExecPrefixes: adapter.mcpExecPrefixes ?? [],
  });
}

const norm = (t, root, tree) => t
  .split(root).join('〈ROOT〉')
  .split(tree).join('〈TREE〉')
  .replace(/\d{8}T\d{6}Z/g, '〈RUN〉')
  .replace(/\b[0-9a-f]{12,64}\b/g, '〈HEX〉')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '〈TS〉');

async function reviewBriefs(b, tree, topic, stub) {
  const fx = await b.fixture.makeFixture({ topic });
  const r = await b.fixture.cli(fx.root, ['review', '--stage', 'plan', '--topic', topic, '--focus', 'x'], stub);
  if (r.code !== 0) throw new Error(`review 退 ${r.code}\n${r.stdout}\n${r.stderr}`);
  const metaDir = path.join(fx.stageDir, '_meta');
  const out = {};
  for (const critic of Object.keys(stub)) {
    const f = (await fs.readdir(metaDir)).find((x) => x.startsWith(`brief-${critic}-`) && x.endsWith('.md'));
    out[critic] = norm(await fs.readFile(path.join(metaDir, f), 'utf8'), fx.root, tree);
  }
  return out;
}

async function main() {
  // ── 前置：依赖一致、旧树、两份 bundle ──
  const pkgOld = JSON.parse(execFileSync('git', ['show', `${BASE}:package.json`], { cwd: ROOT, encoding: 'utf8' }));
  const pkgNew = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const depsSame = JSON.stringify([pkgOld.dependencies, pkgOld.devDependencies]) === JSON.stringify([pkgNew.dependencies, pkgNew.devDependencies]);
  let lockSame = true;
  try { execFileSync('git', ['diff', '--quiet', BASE, '--', 'package-lock.json'], { cwd: ROOT }); } catch { lockSame = false; }
  check('前置：旧树与工作树的依赖区逐字相同、package-lock.json 字节相同', depsSame && lockSame);
  if (!(depsSame && lockSame)) throw new Error('依赖变了，对照会掺入依赖变量，停下');

  const old = await fs.mkdtemp(path.join(PARENT, 'old-'));
  execFileSync('sh', ['-c', `git archive ${BASE} | tar -x -C "${old}"`], { cwd: ROOT });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: old, stdio: 'ignore' });
  const shaOld = await sha(path.join(old, 'skills/dual-critic/scripts/trivium.cjs'));
  const shaNew = await sha(path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'));
  check('两份 bundle 的 sha256 不同', shaOld !== shaNew, `${shaOld} / ${shaNew}`);

  const builds = { old: await loadBuild(old), new: await loadBuild(ROOT) };
  check('旧构建的 zcode 适配器没有 mcpExecPrefixes、新构建有', !('mcpExecPrefixes' in builds.old.adapters.zcode) && Array.isArray(builds.new.adapters.zcode.mcpExecPrefixes));

  // ── 一、真实适配器渲染 ──
  const realDiffs = {};
  for (const stage of ['plan', 'code', 'bug']) {
    for (const k of ['agy', 'claude', 'codex', 'zcode']) {
      const a = render(builds.old, builds.old.adapters[k], stage);
      const b = render(builds.new, builds.new.adapters[k], stage);
      const d = lineDelta(a, b);
      realDiffs[`${k}/${stage}`] = { same: a === b, added: d.added, missing: d.missing.length };
      if (k !== 'zcode') {
        check(`真实适配器 ${k}/${stage}：改前改后逐字相同`, a === b, JSON.stringify(d));
      } else {
        const okDelta = d.missing.length === 0 && d.added.length === 1 && d.added[0] === BAN_LINE;
        const lines = b.split('\n');
        const i = lines.indexOf(BAN_LINE);
        const okPos = i > 0 && lines[i - 1].startsWith('- 第 2 节的焦点若要求实测或复测而你做不到') && lines[i + 1].startsWith('- 在 `agreed` 里写出');
        const s7 = b.indexOf('## 7. 反谄媚约束');
        const s8 = b.indexOf('## 8. ');
        const inS7 = b.indexOf(BAN_LINE) > s7 && b.indexOf(BAN_LINE) < s8;
        check(`真实适配器 zcode/${stage}：恰多第 7 节那一行、紧跟证据性质、在 agreed 之前`, okDelta && okPos && inS7, JSON.stringify(d));
      }
    }
  }

  // ── 二、桩走完整 review ──
  const plain = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
  const bo = await reviewBriefs(builds.old, old, '改前改后对照', plain);
  const bn = await reviewBriefs(builds.new, ROOT, '改前改后对照', plain);
  for (const c of ['gemini', 'glm']) {
    const d = lineDelta(bo[c], bn[c]);
    check(`桩 review（不覆盖）${c}：归一化后改前改后逐字相同`, bo[c] === bn[c], JSON.stringify(d).slice(0, 2000));
  }
  const over = { gemini: { mode: 'ok' }, glm: { mode: 'ok', mcpExecPrefixes: ['mcp__node_repl__'] } };
  const co = await reviewBriefs(builds.old, old, '改前改后对照覆盖', over);
  const cn = await reviewBriefs(builds.new, ROOT, '改前改后对照覆盖', over);
  const dg = lineDelta(co.glm, cn.glm);
  check('桩 review（glm 覆盖）glm：新构建恰多那一行', dg.missing.length === 0 && dg.added.length === 1 && dg.added[0] === BAN_LINE, JSON.stringify(dg));
  check('桩 review（glm 覆盖）gemini：改前改后逐字相同', co.gemini === cn.gemini, JSON.stringify(lineDelta(co.gemini, cn.gemini)).slice(0, 2000));

  const readout = {
    base: BASE, sha256: { old: shaOld, new: shaNew }, realAdapters: realDiffs,
    passed: checks.filter((c) => c.ok).length, total: checks.length, checks,
  };
  if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
  console.log(`${readout.passed}/${readout.total}`);
  if (readout.passed !== readout.total) process.exitCode = 1;
}

try {
  await main();
} finally {
  await fs.rm(PARENT, { recursive: true, force: true });
}
