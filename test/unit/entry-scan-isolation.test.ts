import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runDoctor } from '../../src/trivium/doctor.js';
import { TRIVIUM_DIR, defaultConfig } from '../../src/trivium/config.js';
import { AGENTS } from '../../src/trivium/agents/registry.js';
import { ENTRY_SCAN_HOME_ENV } from '../../src/trivium/entry-collisions.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';

isolateEntryScanHome();

/*
 * 测试不读真实家目录的共享读取面（EV-240，M12 批次 5；计划双审 CODEX-01 / GLM-01，计划 r2 §4 U8、U9）。
 *
 * doctor 的扫描与 `--only` 无关、preflight 的扫描排在多数只告警项之后，凡能跑到 `runDoctor` / `runPreflight`
 * 的旧用例都会顺带扫一次；EV-246 起 `review --start`（`startRun`）派生前也扫一次，论域随之并入。隔离靠单一来源（`entryScanEnv()`）+ 两个测试侧入口，本文件守住两件事：
 * U8 名单对账——没走隔离的调用方当场红；U9 读源证明——设了变量，读的就是变量指的那个目录。
 */

async function listTestFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listTestFiles(p)));
    else if (e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * 不经 `cli()`、自己 spawn 打包产物跑 doctor / preflight 的文件，逐个登记理由。新出现的未登记即红。
 * （提到命令名但不真正执行它的，例如只校验参数形态的启动器用例，也登记在这里。）
 */
const SPAWN_REVIEWED: Readonly<Record<string, string>> = {
  'test/integration/selftest.test.ts': '`doctor --selftest` 走 selftestCommand，不进 runDoctor，跑不到扫描',
  'test/integration/stub-agent-kit.test.ts': 'cliIn 显式设 HOME 为夹具家目录，os.homedir() 即夹具',
  'test/unit/agent-access-task-launch.test.ts': '只校验静默启动器的参数形态，产品 spawn 计数断言为 0',
  'test/unit/agent-access-recovery.test.ts': '只把 preflight 写进 argv 交给形态校验器，不执行',
  'test/integration/access-v3.test.ts': '自己 spawn 的只有 gate hook-pre-commit；preflight 都经 cli()',
  // ↓ EV-246 起 `review --start` 也扫共享读取面，论域并入 '--start' 后新命中的四个文件
  'test/integration/override-source-start.test.ts': 'cliAt 显式设 HOME 为夹具家目录，os.homedir() 即夹具',
  'test/integration/code-stage.test.ts': '自己 spawn 的只有 gate hook-pre-commit；--start 都经 cli()',
  'test/integration/bug-stage.test.ts': '自己 spawn 的只有 gate hook-pre-write；--start 都经 cli()',
  'test/integration/gate-loop.test.ts': '自己 spawn 的是 gate 钩子、approve 与同步 review（不扫描）；--start 都经 cli()',
};

/*
 * 「直调」的判据宁宽勿窄（代码三审 GLM-02）：静态导入或解构动态导入了 `runDoctor` / `runPreflight`
 * （含 `as` 改名——名字出现在花括号里即算），或出现对它们的调用，任一成立就要求文件调了 `isolateEntryScanHome()`。
 * 仍是按源码文本的启发式，已知够不到的形态：把模块整体导入后经属性访问调用（`m.runDoctor(…)` 之外的拼名）、
 * 经变量拼出命令名再 spawn 打包产物。这两类的兜底是 `cli()` 缺省隔离与单一来源 `entryScanEnv()`。
 */
const IMPORTS_ENTRY = [
  /import\s*\{[^}]*\b(runDoctor|runPreflight|startRun)\b[^}]*\}\s*from/,
  /\{[^}]*\b(runDoctor|runPreflight|startRun)\b[^}]*\}\s*=\s*await\s+import\(/,
  /\b(runDoctor|runPreflight|startRun)\s*\(/,
];

test('U8 对账：直调 runDoctor / runPreflight 的测试文件都调了 isolateEntryScanHome()；cli() 缺省设隔离变量', async () => {
  const files = await listTestFiles(path.join(REPO_ROOT, 'test'));
  const missing: string[] = [];
  const unreviewedSpawn: string[] = [];
  for (const f of files) {
    const rel = path.relative(REPO_ROOT, f).split(path.sep).join('/');
    const text = await fs.readFile(f, 'utf8');
    if (IMPORTS_ENTRY.some((re) => re.test(text)) && !text.includes('isolateEntryScanHome()')) missing.push(rel);
    const spawnsBundle = /\[\s*(BUNDLE|k\.bundle)\s*,/.test(text) || /spawnSync\(/.test(text);
    if (spawnsBundle && /'(doctor|preflight|--start)'/.test(text) && !(rel in SPAWN_REVIEWED)) unreviewedSpawn.push(rel);
  }
  assert.deepEqual(missing, [], '这些文件直调了 doctor / preflight 却没钉扫描家目录');
  assert.deepEqual(unreviewedSpawn, [], '这些文件自己 spawn 了 doctor / preflight：要么改走 cli()，要么登记理由');

  const fixture = await fs.readFile(path.join(REPO_ROOT, 'test/helpers/fixture.ts'), 'utf8');
  assert.match(fixture, /\[ENTRY_SCAN_HOME_ENV\]: emptyEntryScanHome\(\)/, 'cli() 的缺省环境要把扫描家目录钉到空夹具');
});

test('U9 读源证明：变量指向摆了同名入口的夹具 ⇒ 告警里的路径落在夹具里；指向空夹具 ⇒ 无告警', async () => {
  const saved = process.env[ENTRY_SCAN_HOME_ENV];
  const root = await scratchDir('trivium-escan-proj-');
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });
  const dirty = await scratchDir('trivium-escan-dirty-');
  const rel = AGENTS.find((a) => a.entrySkillExtraReadRoots.length > 0)!.entrySkillExtraReadRoots[0]!;
  await fs.mkdir(path.join(dirty, rel, 'dual-approve'), { recursive: true });
  await fs.writeFile(path.join(dirty, rel, 'dual-approve/SKILL.md'), '---\nname: dual-approve\n---\n');
  try {
    process.env[ENTRY_SCAN_HOME_ENV] = dirty;
    const hit = await runDoctor({ config: defaultConfig(), projectRoot: root, triviumDir, only: 'env', skipModelCalls: true });
    const w = hit.warnings.find((x) => x.startsWith('共享读取面'));
    assert.ok(w, '变量指向的夹具里有同名入口，必须报');
    assert.ok(w.includes(`~/${rel}/dual-approve`), w);

    process.env[ENTRY_SCAN_HOME_ENV] = await scratchDir('trivium-escan-clean-');
    const none = await runDoctor({ config: defaultConfig(), projectRoot: root, triviumDir, only: 'env', skipModelCalls: true });
    assert.equal(none.warnings.some((x) => x.startsWith('共享读取面')), false);
  } finally {
    if (saved === undefined) delete process.env[ENTRY_SCAN_HOME_ENV];
    else process.env[ENTRY_SCAN_HOME_ENV] = saved;
  }
});
