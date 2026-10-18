import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  ENTRY_PROBLEM_LABELS, ENTRY_SKILL_NAMES, SHARED_ROOT_EXIT_HINT, describeSharedRootProblems, entryScanEnv,
  ENTRY_SCAN_HOME_ENV, isOurEntry, scanEntryCollisions, sharedReadRootTargets, summarizeSharedRootProblems,
  RESIDUE_DIR_NAMES, RUNTIME_ROOT_NAME, hasRuntimeIdentity, isResidueCopy, selfRuntimeRoot,
} from '../../src/trivium/entry-collisions.js';
import { resolveAssetRoot } from '../../src/trivium/asset-root.js';
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

// ─────────────── 共享根残留（主题 M12-共享根残留检测，计划 r2 §4 U1～U4） ───────────────

/** 10-16 形态的运行时根拷贝：身份行 + `schema/` + `scripts/`，不含 `entry/`（只摆骨架，不拷真实产物） */
async function plantRuntimeCopy(dir: string, opts: { schema?: boolean; entry?: boolean } = {}): Promise<void> {
  await plant(dir, `---\nname: ${RUNTIME_ROOT_NAME}\ndescription: x\n---\n`);
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
  if (opts.schema !== false) await fs.mkdir(path.join(dir, 'schema'), { recursive: true });
  if (opts.entry) await plant(path.join(dir, 'entry', 'codex', 'dual-run'), ourSkill('dual-run'));
}

test('U1 isResidueCopy：运行时根拷贝（身份行 + schema/）或含入口子树才判真，别家同名一律判假', async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const d = (n: string): string => path.join(home, n);

  await plantRuntimeCopy(d('rt-1016')); // ① 10-16 形态
  await plant(path.join(d('entry-copy'), 'codex', 'dual-run'), ourSkill('dual-run')); // ② entry 子树拷贝
  await plant(path.join(d('rt-no-md'), 'entry', 'glm', 'dual-status'), ourSkill('dual-status')); // ③ 无 SKILL.md、带 entry/
  await plant(d('other-entry'), '---\nname: entry\ndescription: 别家的\n---\n'); // ④ 别家 entry skill
  await plant(path.join(d('other-entry-sub'), 'x', 'dual-run'), '---\nname: dual-run\n---\n别家的\n'); // ⑤ 同布局但不调 wrapper
  await plantRuntimeCopy(d('rt-no-schema'), { schema: false }); // ⑥ 身份行对、缺 schema/
  await fs.writeFile(d('a-file'), 'x'); // ⑦ 普通文件

  assert.equal(await isResidueCopy(d('rt-1016')), true, '① 10-16 形态');
  assert.equal(await isResidueCopy(d('entry-copy')), true, '② entry/〈载体〉/〈入口〉');
  assert.equal(await isResidueCopy(d('rt-no-md')), true, '③ 无 SKILL.md、带 entry 子树');
  assert.equal(await isResidueCopy(d('other-entry')), false, '④ 别家 entry skill');
  assert.equal(await isResidueCopy(d('other-entry-sub')), false, '⑤ 子树里的同名 skill 不调 wrapper');
  assert.equal(await isResidueCopy(d('rt-no-schema')), false, '⑥ 缺 schema/');
  assert.equal(await isResidueCopy(d('a-file')), false, '⑦ 普通文件');
  assert.equal(await isResidueCopy(d('missing')), false, '⑧ 不存在：判假、不抛');

  // ⑨ 不传 entryNames 时按 ENTRY_SKILL_NAMES 认；传了只认传入的名字
  assert.equal(await isResidueCopy(d('entry-copy'), ['dual-status']), false);
  assert.equal(await isResidueCopy(d('entry-copy'), ['dual-run']), true);

  // 身份行判据要求 front-matter 起始
  await plant(d('rt-late'), `前言\n---\nname: ${RUNTIME_ROOT_NAME}\n---\n`);
  await fs.mkdir(path.join(d('rt-late'), 'schema'));
  assert.equal(await hasRuntimeIdentity(d('rt-late'), RUNTIME_ROOT_NAME), false);
  assert.equal(await isResidueCopy(d('rt-late')), false);
});

test('U1 isResidueCopy：不可读的子目录当「否」、不抛', { skip: process.getuid?.() === 0 }, async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const locked = path.join(home, 'entry');
  await plant(path.join(locked, 'codex', 'dual-run'), ourSkill('dual-run'));
  await fs.chmod(locked, 0o000);
  try {
    assert.equal(await isResidueCopy(locked), false);
  } finally {
    await fs.chmod(locked, 0o755);
  }
});

test('U2 scanEntryCollisions：共享根残留只在额外读取根按内容判，次序在安装根残留之后、同名入口之前', async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const install = path.join(home, 'inst');
  const shared = path.join(home, 'shared');
  await plant(path.join(install, 'dual-critic'), null); // 安装根残留：见名即判
  await plant(path.join(install, 'entry'), '---\nname: entry\n---\n'); // 安装根里的别家 entry：照旧判 residue
  await plantRuntimeCopy(path.join(shared, 'dual-critic')); // 共享根残留
  await plant(path.join(shared, 'entry'), '---\nname: entry\n---\n'); // 共享根别家 entry：不判
  await plant(path.join(shared, 'dual-run'), ourSkill('dual-run')); // 同名入口

  const base = {
    agent: 'codex' as const, skillsRoot: install, readRoots: [install, shared],
    names: ['dual-run'], residueNames: ['dual-critic', 'entry'],
  };
  // ①②③
  assert.deepEqual(await scanEntryCollisions([{ ...base, sharedResidueNames: ['dual-critic', 'entry'] }]), [
    { agent: 'codex', kind: 'residue', path: path.join(install, 'dual-critic') },
    { agent: 'codex', kind: 'residue', path: path.join(install, 'entry') },
    { agent: 'codex', kind: 'shared-residue', path: path.join(shared, 'dual-critic') },
    { agent: 'codex', kind: 'foreign-entry', path: path.join(shared, 'dual-run') },
  ]);
  // ③ 安装根里摆本产品的运行时拷贝：只出 residue，不出 shared-residue
  await fs.rm(path.join(install, 'dual-critic'), { recursive: true });
  await plantRuntimeCopy(path.join(install, 'dual-critic'));
  const onlyInstall = await scanEntryCollisions([{ ...base, readRoots: [install], sharedResidueNames: ['dual-critic'] }]);
  assert.deepEqual(onlyInstall.map((p) => p.kind), ['residue', 'residue']);

  // ⑤⑥ 空名单与不带字段：共享根残留不查，结果相同
  const empty = await scanEntryCollisions([{ ...base, sharedResidueNames: [] }]);
  const absent = await scanEntryCollisions([base]);
  assert.deepEqual(absent, empty);
  assert.ok(!empty.some((p) => p.kind === 'shared-residue'));
});

test('U2 scanEntryCollisions：豁免按真实路径比对（经软链、未规范化写法都认）', async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const shared = path.join(home, 'shared');
  const rt = path.join(shared, 'dual-critic');
  await plantRuntimeCopy(rt);
  const link = path.join(home, 'rt-link');
  await fs.symlink(rt, link);
  const target = (exemptPaths: string[]) => ({
    agent: 'glm' as const, skillsRoot: path.join(home, 'inst'), readRoots: [shared],
    names: ENTRY_SKILL_NAMES, residueNames: [], sharedResidueNames: RESIDUE_DIR_NAMES, exemptPaths,
  });
  // scratchDir 在 macOS 上是 /var/… 软链路径，真实路径是 /private/var/…
  const real = await fs.realpath(rt);
  for (const ex of [real, link, path.join(shared, 'x', '..', 'dual-critic')]) {
    assert.deepEqual(await scanEntryCollisions([target([ex])]), [], `豁免写法 ${ex}`);
  }
  assert.equal((await scanEntryCollisions([target([path.join(home, 'elsewhere')])])).length, 1, '豁免别处不影响');
});

test('U3 sharedReadRootTargets：查共享根残留、豁免按扫描环境求值的运行时根与自身所在的运行时根', async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const targets = sharedReadRootTargets(AGENTS, { home, env: {} }, null);
  assert.ok(targets.length > 0);
  for (const t of targets) {
    assert.deepEqual(t.sharedResidueNames, RESIDUE_DIR_NAMES);
    assert.deepEqual(t.residueNames, []);
    assert.deepEqual(t.exemptPaths, [resolveAssetRoot(undefined, {}, home)], 'self 为 null 时只有一项');
  }
  const shared = targets[0]!.readRoots[0]!;
  const rt = path.join(shared, RUNTIME_ROOT_NAME);
  await plantRuntimeCopy(rt);
  assert.equal((await scanEntryCollisions(targets)).filter((p) => p.kind === 'shared-residue').length, targets.length);

  // 设了 TRIVIUM_ASSET_ROOT 指向它：不判
  const viaEnv = sharedReadRootTargets(AGENTS, { home, env: { TRIVIUM_ASSET_ROOT: rt } }, null);
  assert.deepEqual(await scanEntryCollisions(viaEnv), []);
  // 变量不设、但当前进程自身就跑在它里面（计划双审 GLM-02）：同样不判
  const viaSelf = sharedReadRootTargets(AGENTS, { home, env: {} }, rt);
  assert.deepEqual(viaSelf[0]!.exemptPaths, [resolveAssetRoot(undefined, {}, home), rt]);
  assert.deepEqual(await scanEntryCollisions(viaSelf), []);
});

test('U3 selfRuntimeRoot：只认 〈根〉/scripts/trivium.cjs', () => {
  assert.equal(selfRuntimeRoot('/a/b/dual-critic/scripts/trivium.cjs'), '/a/b/dual-critic');
  assert.equal(selfRuntimeRoot('/a/b/dual-critic/bin/trivium.cjs'), null);
  assert.equal(selfRuntimeRoot('/a/b/scripts/other.cjs'), null);
  assert.equal(selfRuntimeRoot(undefined), null);
  assert.equal(selfRuntimeRoot(), null, '测试进程的 argv[1] 不是编排器产物');
});

test('U4 渲染：只有同名入口时与 M12 批次 5 的文案逐字相同（不混入残留段与残留计数）', async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const targets = sharedReadRootTargets(AGENTS, { home, env: {} }, null);
  const root = targets[0]!.readRoots[0]!;
  const rel = displayHomePath(root, home);
  await plant(path.join(root, 'dual-run'), ourSkill('dual-run'));
  const problems = await scanEntryCollisions(targets);
  const who = targets.map((t) => agentById(t.agent)!.display).join('、');
  // 期望文案照批次 5（a0c3a609）的渲染原样写死
  assert.equal(describeSharedRootProblems(problems, home), [
    '共享读取面里有 1 个同名入口（这些根会被多家 CLI 读到：同名时 Codex 的显式调用会失效、ZCode 两份都进模型清单，' +
      '而且它带的 --driver 可能是别家）：',
    `  · ${rel}/dual-run  ${ENTRY_PROBLEM_LABELS['foreign-entry']}（${who} 会读到）`,
    `  ${SHARED_ROOT_EXIT_HINT}`,
  ].join('\n'));
  assert.equal(
    summarizeSharedRootProblems(problems, home),
    `⚠️ 共享读取面 ${rel} 有 1 个同名入口，本轮的 ${who} 会读到；跑 doctor 看完整清单与出口（不影响本次预检）`,
  );
});

test('U4 渲染：只有残留、残留加同名入口；出口只出现一次，preflight 恒一行', async () => {
  const home = await scratchDir('trivium-ecol-res-');
  const targets = sharedReadRootTargets(AGENTS, { home, env: {} }, null);
  const root = targets[0]!.readRoots[0]!;
  const rel = displayHomePath(root, home);
  await plantRuntimeCopy(path.join(root, 'dual-critic'));
  await plant(path.join(root, 'entry', 'gemini', 'dual-run'), ourSkill('dual-run'));

  const onlyResidue = await scanEntryCollisions(targets);
  const text = describeSharedRootProblems(onlyResidue, home)!;
  assert.match(text, /^共享读取面里有 2 份本产品的历史拷贝/);
  assert.ok(!text.includes('同名入口'), text);
  assert.ok(text.includes(`· ${rel}/dual-critic  ${ENTRY_PROBLEM_LABELS['shared-residue']}`), text);
  assert.ok(text.includes(`· ${rel}/entry  ${ENTRY_PROBLEM_LABELS['shared-residue']}`), text);
  assert.ok(text.endsWith(SHARED_ROOT_EXIT_HINT), text);
  assert.equal(text.split(SHARED_ROOT_EXIT_HINT).length - 1, 1);
  assert.ok(!text.includes(home), text);
  const line = summarizeSharedRootProblems(onlyResidue, home)!;
  assert.ok(!line.includes('\n'));
  assert.ok(line.includes('有 2 份本产品的历史拷贝，'), line);
  assert.ok(!line.includes('同名入口'), line);

  await plant(path.join(root, 'dual-status'), '---\nname: dual-status\n---\n');
  const mixed = await scanEntryCollisions(targets);
  const both = describeSharedRootProblems(mixed, home)!;
  const iEntries = both.indexOf('共享读取面里有 1 个同名入口');
  const iResidue = both.indexOf('共享读取面里有 2 份本产品的历史拷贝');
  assert.ok(iEntries === 0 && iResidue > iEntries, both);
  assert.equal(both.split(SHARED_ROOT_EXIT_HINT).length - 1, 1);
  const mixedLine = summarizeSharedRootProblems(mixed, home)!;
  assert.ok(mixedLine.includes('有 1 个同名入口、2 份本产品的历史拷贝，'), mixedLine);
  assert.ok(!mixedLine.includes('\n'));
});
