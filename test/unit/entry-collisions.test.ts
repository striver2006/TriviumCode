import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ENTRY_PROBLEM_LABELS, ENTRY_SKILL_NAMES, SHARED_ROOT_EXIT_HINT, describeSharedRootProblems, entryScanEnv,
  ENTRY_SCAN_HOME_ENV, isOurEntry, scanEntryCollisions, sharedReadRootTargets, summarizeSharedRootProblems,
} from '../../src/trivium/entry-collisions.js';
import { AGENTS, agentById, entrySkillRootOf } from '../../src/trivium/agents/registry.js';
import { displayHomePath } from '../../src/trivium/util/fsx.js';
import { scratchDir } from '../helpers/scratch.js';

/*
 * 读取面同名入口检测的共享实现（EV-240 方案 A，M12 批次 5；计划 r2 §2.1 / §4 U1、U2）。
 * 家目录一律是 `scratchDir` 的夹具，不读真实家目录。
 */

const ourSkill = (name: string): string =>
  `---\nname: ${name}\ndescription: x\n---\n\n跑 \`./.trivium/bin/trivium review --start …\`\n`;

async function plant(dir: string, md: string | null): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  if (md !== null) await fs.writeFile(path.join(dir, 'SKILL.md'), md);
}

test('U1 isOurEntry：名字对得上且调用 wrapper 才判真；名字不符、缺 wrapper、读不到都判假', async () => {
  const home = await scratchDir('trivium-ecol-');
  const d = path.join(home, 'x');
  await plant(path.join(d, 'ok'), ourSkill('dual-run'));
  await plant(path.join(d, 'wrong-name'), ourSkill('dual-status'));
  await plant(path.join(d, 'no-wrapper'), '---\nname: dual-run\n---\n别人的\n');
  await plant(path.join(d, 'no-md'), null);
  assert.equal(await isOurEntry(path.join(d, 'ok'), 'dual-run'), true);
  assert.equal(await isOurEntry(path.join(d, 'wrong-name'), 'dual-run'), false);
  assert.equal(await isOurEntry(path.join(d, 'no-wrapper'), 'dual-run'), false);
  assert.equal(await isOurEntry(path.join(d, 'no-md'), 'dual-run'), false);
});

test('U1 scanEntryCollisions：三类判定与次序（残留在前、再按名单 × 读取根），安装根里的自家同名放行', async () => {
  const home = await scratchDir('trivium-ecol-');
  const install = path.join(home, 'inst');
  const shared = path.join(home, 'shared');
  await plant(path.join(install, 'dual-critic'), null); // 残留
  await plant(path.join(install, 'dual-run'), ourSkill('dual-run')); // 安装根里的自家：放行
  await plant(path.join(install, 'dual-status'), '---\nname: dual-status\n---\n'); // 安装根里的别家：third-party
  await plant(path.join(shared, 'dual-run'), ourSkill('dual-run')); // 共享根里的自家：foreign-entry
  await plant(path.join(shared, 'dual-approve'), '---\nname: dual-approve\n---\n'); // 共享根里的别家：third-party

  const problems = await scanEntryCollisions([{
    agent: 'codex', skillsRoot: install, readRoots: [install, shared],
    names: ['dual-approve', 'dual-run', 'dual-status'], residueNames: ['dual-critic', 'entry'],
  }]);
  assert.deepEqual(problems, [
    { agent: 'codex', kind: 'residue', path: path.join(install, 'dual-critic') },
    { agent: 'codex', kind: 'third-party', path: path.join(shared, 'dual-approve') },
    { agent: 'codex', kind: 'foreign-entry', path: path.join(shared, 'dual-run') },
    { agent: 'codex', kind: 'third-party', path: path.join(install, 'dual-status') },
  ]);

  // 不查残留的目标（安装器的 top 布局、共享读取面）：同一个家里的残留不报
  const noResidue = await scanEntryCollisions([{
    agent: 'codex', skillsRoot: install, readRoots: [install], names: [], residueNames: [],
  }]);
  assert.deepEqual(noResidue, []);
});

test('U2 sharedReadRootTargets：只出登记了额外读取根的家，读取根只含额外根，不查残留；CODEX_HOME 不影响共享根', async () => {
  const home = await scratchDir('trivium-ecol-');
  const codexHome = await scratchDir('trivium-ecol-ch-');
  const targets = sharedReadRootTargets(AGENTS, { home, env: { CODEX_HOME: codexHome } });
  const withExtra = AGENTS.filter((a) => a.entrySkillExtraReadRoots.length > 0).map((a) => a.id);
  assert.ok(withExtra.length > 0, '注册表里至少有一家登记了额外读取根');
  assert.deepEqual(targets.map((t) => t.agent), withExtra);
  for (const t of targets) {
    const a = agentById(t.agent)!;
    assert.deepEqual(t.readRoots, a.entrySkillExtraReadRoots.map((r) => path.join(home, r)));
    assert.equal(t.skillsRoot, entrySkillRootOf(a, home, { CODEX_HOME: codexHome }).skillsRoot);
    assert.ok(!t.readRoots.includes(t.skillsRoot), '安装根不在扫描面里');
    assert.deepEqual(t.residueNames, []);
    assert.deepEqual(t.names, ENTRY_SKILL_NAMES);
  }
  // 共享根里的 dual-critic 拷贝不判（与安装器口径一致，计划 r2 T-3 / §7）
  for (const r of new Set(targets.flatMap((t) => t.readRoots))) await plant(path.join(r, 'dual-critic'), null);
  assert.deepEqual(await scanEntryCollisions(targets), []);
});

test('U2 渲染：按路径归并、~ 折叠到扫描所用的家目录、带出口；preflight 一行；无问题返回 null', async () => {
  const home = await scratchDir('trivium-ecol-');
  const targets = sharedReadRootTargets(AGENTS, { home, env: {} });
  const root = targets[0]!.readRoots[0]!;
  await plant(path.join(root, 'dual-run'), ourSkill('dual-run'));
  await plant(path.join(root, 'dual-status'), '---\nname: dual-status\n---\n');
  const problems = await scanEntryCollisions(targets);
  // 共享根被几家读到，同一个目录就报几次
  assert.equal(problems.length, 2 * targets.length);

  const text = describeSharedRootProblems(problems, home)!;
  const rel = displayHomePath(root, home);
  assert.ok(rel.startsWith('~/'), rel);
  assert.ok(!text.includes(home), `不得露出夹具的绝对路径：${text}`);
  assert.match(text, /^共享读取面里有 2 个同名入口/);
  assert.ok(text.includes(`· ${rel}/dual-run  ${ENTRY_PROBLEM_LABELS['foreign-entry']}`), text);
  assert.ok(text.includes(`· ${rel}/dual-status  ${ENTRY_PROBLEM_LABELS['third-party']}`), text);
  for (const t of targets) assert.ok(text.includes(agentById(t.agent)!.display), text);
  assert.ok(text.endsWith(SHARED_ROOT_EXIT_HINT), text);

  const line = summarizeSharedRootProblems(problems, home)!;
  assert.ok(!line.includes('\n'), '预检只给一行');
  assert.ok(line.startsWith('⚠️ 共享读取面 ~/'), line);
  assert.ok(line.includes('2 个同名入口'), line);
  assert.ok(!line.includes(home), line);

  assert.equal(describeSharedRootProblems([], home), null);
  assert.equal(summarizeSharedRootProblems([], home), null);
});

test('U2 entryScanEnv：注入口优先，其次环境变量，最后 os.homedir()', () => {
  const saved = process.env[ENTRY_SCAN_HOME_ENV];
  try {
    process.env[ENTRY_SCAN_HOME_ENV] = '/from-env';
    assert.equal(entryScanEnv({ home: '/inject', env: {} }).home, '/inject');
    assert.equal(entryScanEnv().home, '/from-env');
    process.env[ENTRY_SCAN_HOME_ENV] = '';
    assert.notEqual(entryScanEnv().home, '', '空值不算设置');
  } finally {
    if (saved === undefined) delete process.env[ENTRY_SCAN_HOME_ENV];
    else process.env[ENTRY_SCAN_HOME_ENV] = saved;
  }
});

test('U2 displayHomePath：不传 home 时行为同原来；传 home 时按它折叠', () => {
  assert.equal(displayHomePath('/a/b/c', '/a'), '~/b/c');
  assert.equal(displayHomePath('/x/y', '/a'), '/x/y');
  assert.equal(displayHomePath('/a', '/a'), '/a', '家目录本身不折叠（原行为）');
});
