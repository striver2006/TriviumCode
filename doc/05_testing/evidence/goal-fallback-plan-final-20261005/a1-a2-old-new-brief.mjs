// A1 / A2 · 新旧构建任务书逐字比对（目标回退取计划定稿计划 r2 §4.3，EV-212）。
//
// 把基线提交的源码树导出到 mkdtemp 目录、软链 node_modules、就地 `node scripts/build.mjs` 编出旧 bundle
// （照 EV-210 a1-old-new-brief.mjs 的配方，计划双审 CODEX-01）；新旧两份 bundle 都直接 node 调，记 sha256 并断言不同。
// 每个场景造**两个同形的全新夹具实例**，一个给旧构建、一个给新构建（计划双审 GLM-03），比较前断言两侧第 4 段
// 没有本主题己方历史文档；全部场景都不带 --goal、任务文件无目标，第 4 段的任务目标只能来自第三级。
//
// - A1 缺省执笔方（代码 / bug 各一）：归一化后逐字相同。
// - A2 计划 codex、代码 / bug 阶段 claude：旧构建无任务目标行、新构建有；去掉这一行后归一化逐字相同。
//
// 用法：node doc/05_testing/evidence/goal-fallback-plan-final-20261005/a1-a2-old-new-brief.mjs [基线，缺省 7b643b0]
// 前提：新构建已就绪（node scripts/build.mjs --with-tests）。
// 删除只认本脚本 mkdtemp 的返回值，且先断言它在系统临时目录下（never-run-scrub R1 / R5）；夹具由 scratchDir 在进程退出时删。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? '7b643b0';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { makeFixture, today } = await import(pathToFileURL(path.join(REPO, 'dist/test/test/helpers/fixture.js')).href);
const { encodeStubConfig, STUB_ENV_VAR } = await import(pathToFileURL(path.join(REPO, 'dist/test/src/trivium/adapters/stub.js')).href);

const STUB = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const STUB3 = { codex: { mode: 'ok' }, gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退 ${r.status}：\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** 一侧构建：bundle 与资产根 */
const side = (tree) => ({ bundle: path.join(tree, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(tree, 'skills/dual-critic') });

function runCli(build, root, args, stub) {
  const env = { ...process.env, TRIVIUM_ASSET_ROOT: build.assets };
  if (stub) env[STUB_ENV_VAR] = encodeStubConfig(stub);
  else delete env[STUB_ENV_VAR];
  return spawnSync(process.execPath, [build.bundle, ...args], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 << 20 });
}

function startAndFinish(build, root, args, stub) {
  const r = runCli(build, root, ['review', '--start', ...args, '--json'], stub);
  if (r.status !== 0) throw new Error(`--start 退 ${r.status}：\n${r.stdout}\n${r.stderr}`);
  const runId = /"run_id":\s*"([^"]+)"/.exec(r.stdout)[1];
  let code = 3;
  for (let i = 0; i < 12 && code === 3; i++) code = runCli(build, root, ['review', '--wait', runId, '--timeout', '20'], stub).status;
  if (code !== 0) throw new Error(`运行 ${runId} 没有成功收尾（退 ${code}）`);
  return runId;
}

const section4 = (b) => b.slice(b.indexOf('## 4. '), b.indexOf('## 5. '));
const GOAL_RE = /^任务目标：.*\n/m;

/**
 * 归一化：资产根（各构建自己的 schema 路径）、夹具父目录（含仓库根与同级的运行根）、run_id、ISO 时间戳、
 * 十六进制摘要（git 提交、树哈希、sha256 各实例不同）。资产根两种写法都替（旧树在 /var 软链下、未 realpath）。
 */
function normalize(text, root, assets) {
  return text
    .split(realpathSync(assets)).join('〈ASSETS〉')
    .split(assets).join('〈ASSETS〉')
    .split(path.dirname(root)).join('〈FX〉')
    .replace(/\d{8}T\d{6}Z/g, '〈RUN〉')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '〈TS〉')
    .replace(/\b[0-9a-f]{40,64}\b/g, '〈HEX〉')
    .replace(/\b[0-9a-f]{7,12}\b/g, '〈SHORT〉');
}

/** 按场景造夹具：planDriver 非空时先声明计划阶段（早于写计划文件），bug 阶段预置根因原稿，代码阶段改一个源文件 */
async function fixtureFor(build, sc) {
  const fx = await makeFixture(sc.stage === 'bug' ? { topic: sc.topic, draftStage: 'bug' } : { topic: sc.topic, draft: false });
  if (sc.planDriver) {
    const r = runCli(build, fx.root, ['topic', 'claim', '--topic', sc.topic, '--stage', 'plan', '--driver', sc.planDriver, '--json'], null);
    if (r.status !== 0) throw new Error(`topic claim 退 ${r.status}：${r.stderr}`);
  }
  const dir = path.join(fx.archiveRoot, sc.topic, 'plan');
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(sc.planFiles)) await fs.writeFile(path.join(dir, name), body);
  if (sc.stage === 'code') await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
  return fx;
}

const d = today();
const SCENARIOS = [
  { name: 'A1 · 缺省执笔方 · 代码阶段', kind: 'A1', stage: 'code', topic: 'tgp-a1c', planDriver: null, critics: ['gemini', 'glm'], stub: STUB,
    args: ['--entry', 'C', '--stage', 'code', '--focus', 'x'],
    planFiles: { [`${d}-tgp-a1c-claude.md`]: '# claude 原稿标题\n', [`${d}-tgp-a1c-r2-claude.md`]: '# claude 定稿标题\n' } },
  { name: 'A1 · 缺省执笔方 · bug 阶段', kind: 'A1', stage: 'bug', topic: 'tgp-a1b', planDriver: null, critics: ['gemini', 'glm'], stub: STUB,
    args: ['--entry', 'D', '--stage', 'bug', '--focus', 'x'],
    planFiles: { [`${d}-tgp-a1b-claude.md`]: '# claude 原稿标题\n', [`${d}-tgp-a1b-r2-claude.md`]: '# claude 定稿标题\n' } },
  { name: 'A2 · 计划 codex · 代码阶段 claude', kind: 'A2', stage: 'code', topic: 'tgp-a2c', planDriver: 'codex', critics: ['codex', 'gemini', 'glm'], stub: STUB3,
    args: ['--entry', 'C', '--stage', 'code', '--focus', 'x', '--driver', 'claude', '--critics', 'codex,gemini,glm'],
    planFiles: { [`${d}-tgp-a2c-codex.md`]: '# codex 原稿标题\n', [`${d}-tgp-a2c-r2-codex.md`]: '# codex 定稿标题\n' } },
  { name: 'A2 · 计划 codex · bug 阶段 claude', kind: 'A2', stage: 'bug', topic: 'tgp-a2b', planDriver: 'codex', critics: ['gemini', 'glm'], stub: STUB,
    args: ['--entry', 'D', '--stage', 'bug', '--focus', 'x'],
    planFiles: { [`${d}-tgp-a2b-codex.md`]: '# codex 原稿标题\n', [`${d}-tgp-a2b-r2-codex.md`]: '# codex 定稿标题\n' } },
];

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-a12-'));
const TMP_ROOT = realpathSync(os.tmpdir());
let failed = 0;
const results = [];
try {
  if (!realpathSync(tmp).startsWith(TMP_ROOT + path.sep)) throw new Error(`临时目录不在系统临时目录下：${tmp}`);
  const oldTree = path.join(tmp, 'old');
  await fs.mkdir(oldTree);
  const tarball = path.join(tmp, 'old.tar');
  sh('git', ['-C', REPO, 'archive', '--format=tar', '-o', tarball, BASE]);
  sh('tar', ['-xf', tarball, '-C', oldTree]);
  await fs.symlink(path.join(REPO, 'node_modules'), path.join(oldTree, 'node_modules'));
  sh(process.execPath, ['scripts/build.mjs'], { cwd: oldTree });

  const OLD = side(oldTree);
  const NEW = side(REPO);
  const bundles = { old: sha256(OLD.bundle), new: sha256(NEW.bundle) };
  if (bundles.old === bundles.new) throw new Error('新旧 bundle 的 sha256 相同：比对没有意义');

  for (const sc of SCENARIOS) {
    const briefs = {};
    for (const [label, build] of [['old', OLD], ['new', NEW]]) {
      const fx = await fixtureFor(build, sc);
      const runId = startAndFinish(build, fx.root, [...sc.args, '--topic', sc.topic], sc.stub);
      briefs[label] = {};
      for (const c of sc.critics) {
        const raw = await fs.readFile(path.join(fx.archiveRoot, sc.topic, sc.stage, '_meta', `brief-${c}-${runId}.md`), 'utf8');
        const s4 = section4(raw);
        // GLM-03：全新实例，第 4 段不该有本主题己方历史文档
        if (s4.includes(`.reviews/${sc.topic}/${sc.stage}/`)) throw new Error(`${sc.name}/${label}/${c}：第 4 段出现了己方历史文档`);
        briefs[label][c] = normalize(raw, fx.root, build.assets);
      }
    }
    for (const c of sc.critics) {
      const o = briefs.old[c];
      const n = briefs.new[c];
      const oldGoal = GOAL_RE.exec(o)?.[0] ?? null;
      const newGoal = GOAL_RE.exec(n)?.[0] ?? null;
      let ok;
      let note;
      if (sc.kind === 'A1') {
        ok = o === n;
        note = ok ? `逐字相同（任务目标行：${JSON.stringify(newGoal)}）` : '不同';
      } else {
        ok = oldGoal === null && newGoal === '任务目标：codex 定稿标题\n' && o === n.replace(GOAL_RE, '');
        note = `旧：${JSON.stringify(oldGoal)}；新：${JSON.stringify(newGoal)}；去掉该行后${o === n.replace(GOAL_RE, '') ? '逐字相同' : '不同'}`;
      }
      if (!ok) {
        failed++;
        console.error(`== ${sc.name} / ${c} 不符，归一化后差异：`);
        const ol = o.split('\n');
        const nl = n.split('\n');
        for (let i = 0; i < Math.max(ol.length, nl.length); i++) {
          if (ol[i] !== nl[i]) console.error(`  第 ${i + 1} 行\n    旧：${ol[i]}\n    新：${nl[i]}`);
        }
      }
      results.push({ case: sc.name, critic: c, ok, note, bytes: Buffer.byteLength(n) });
    }
  }
  console.log(JSON.stringify({ base: BASE, bundles, results, failed }, null, 2));
} finally {
  if (!realpathSync(tmp).startsWith(TMP_ROOT + path.sep)) throw new Error(`拒绝删除系统临时目录之外的路径：${tmp}`);
  await fs.rm(tmp, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
