import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { install, uninstall, planInstall, parseInstallArgs, syncDir, InstallConflictError, type InstallEnv } from '../../src/install.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { AGENTS, agentById, entrySkillRootOf } from '../../src/trivium/agents/registry.js';
import { resolveAssetRoot } from '../../src/trivium/asset-root.js';
import { codexHomeOf } from '../../src/trivium/adapters/codex-home.js';
import { ENTRY_OUT_DIR } from '../../src/entry-render.js';
import { scratchDir } from '../helpers/scratch.js';

/*
 * 安装器（M10b 第 2 步起多目标；计划 r2 §3.2、r5 §5.4 / §5.5、r9 §2.1、r10 §2.1 / §2.2）。
 *
 * **全部用例注入临时 home**（r2 §3.2.3）：新安装器会写 `~/.codex`、`~/.zcode`、`~/.gemini`，
 * 而「家根不存在即跳过」意味着开发机形态决定测试走哪条分支——不注入就既不可复现、又会写真实用户目录。
 * 仓库副本取**真实渲染产物**（拷 `skills/` 与载体适配层），不手搓假 SKILL.md：
 * 下面的性质判据要对真实形状成立，不是对一个恰好过得去的夹具成立。
 */

/** 本产品的 7 条入口命令（r10 §2.1 顶层计数判据） */
const ENTRY_NAMES = [
  'dual-abandon', 'dual-approve', 'dual-review-bug', 'dual-review-code', 'dual-review-plan', 'dual-run', 'dual-status',
];

async function fakeRepo(): Promise<string> {
  const root = await scratchDir('trivium-install-repo-');
  // 上一次构建的打包产物不拷：它可能不存在（未 build），也可能很大；这里放一个占位
  await fs.cp(path.join(REPO_ROOT, 'skills'), path.join(root, 'skills'), {
    recursive: true,
    filter: (src) => !src.endsWith('.cjs'),
  });
  await fs.cp(path.join(REPO_ROOT, 'skills-src/carriers'), path.join(root, 'skills-src/carriers'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills/dual-critic/scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills/dual-critic/scripts/trivium.cjs'), '// bundle');
  return root;
}

/** 临时 home：四家家根都建好（除非 `missing` 点名），`CODEX_HOME` 不设 */
async function fakeHome(missing: readonly string[] = []): Promise<InstallEnv> {
  const home = await scratchDir('trivium-install-home-');
  for (const a of AGENTS) {
    if (missing.includes(a.id)) continue;
    await fs.mkdir(path.join(home, a.entrySkillRoot.homeRel), { recursive: true });
  }
  return { home, env: {} };
}

const skillsRootOf = (ie: InstallEnv, id: string): string => entrySkillRootOf(agentById(id)!, ie.home, ie.env).skillsRoot;

/** 目录下所有 SKILL.md 相对该目录的深度（`dual-run/SKILL.md` 深度 1） */
async function skillDepths(dir: string, base = ''): Promise<{ rel: string; depth: number }[]> {
  const out: { rel: string; depth: number }[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await skillDepths(path.join(dir, e.name), rel)));
    else if (e.name === 'SKILL.md') out.push({ rel, depth: rel.split('/').length - 1 });
  }
  return out;
}

const topDirs = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();

test('四家目标 + 运行时根：任何目标根下都没有深度 ≥ 2 的 SKILL.md；另三家恰 7 个入口，claude 7 个 + 运行时', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const r = await install(root, ie);
  const plan = await planInstall(root, ie);

  const roots = [...plan.targets.map((t) => t.skillsRoot), plan.runtimeRoot];
  assert.equal(roots.length, 5);
  for (const dir of roots) {
    const deep = (await skillDepths(dir)).filter((s) => s.depth >= 2);
    assert.deepEqual(deep, [], `${dir} 下出现了嵌套的 SKILL.md（codex 会递归枚举它们）`);
  }
  for (const t of plan.targets) {
    const dirs = await topDirs(t.skillsRoot);
    if (t.layout === 'top') {
      assert.deepEqual(dirs, [...ENTRY_NAMES, path.basename(plan.runtimeRoot)].sort(), `${t.agent} 目标根`);
    } else {
      assert.deepEqual(dirs, ENTRY_NAMES, `${t.agent} 目标根须恰有 7 个入口目录`);
      // 装的是自家那份渲染产物，不是别家的
      const got = await fs.readFile(path.join(t.skillsRoot, 'dual-run/SKILL.md'), 'utf8');
      const want = await fs.readFile(path.join(root, ENTRY_OUT_DIR, t.agent, 'dual-run/SKILL.md'), 'utf8');
      assert.equal(got, want, `${t.agent} 装错了载体的产物`);
    }
  }
  assert.ok(r.targets.every((t) => t.status === 'installed'), JSON.stringify(r.targets));
  await fs.access(path.join(plan.runtimeRoot, 'scripts/trivium.cjs'));
  assert.equal(r.agentInstalled, plan.agentTarget);
});

test('运行时根与编排器同源取值：TRIVIUM_ASSET_ROOT 设了就落那边，claude 根下不再有运行时', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const elsewhere = await scratchDir('trivium-install-asset-');
  const env = { TRIVIUM_ASSET_ROOT: path.join(elsewhere, 'rt') };
  const r = await install(root, { home: ie.home, env });
  assert.equal(r.runtime.dir, resolveAssetRoot(undefined, env, ie.home));
  await fs.access(path.join(elsewhere, 'rt/scripts/trivium.cjs'));
  await assert.rejects(fs.access(path.join(skillsRootOf(ie, 'claude'), 'dual-critic')));
});

test('codex 的 skill 根走 CODEX_HOME，与 codexHomeOf() 同口径', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const codexHome = await scratchDir('trivium-install-codexhome-');
  const env = { CODEX_HOME: codexHome };
  await install(root, { home: ie.home, env });
  const codex = agentById('codex')!;
  await fs.access(path.join(codexHome, 'skills/dual-run/SKILL.md'));
  await assert.rejects(fs.access(path.join(ie.home, '.codex/skills/dual-run')), '设了 CODEX_HOME 就不该再装进 ~/.codex');
  // 与适配器的 codexHomeOf 同口径（设与不设两种）；它只认 os.homedir()，所以按真实 home 比对路径拼法，不落盘
  for (const e of [env, {}]) {
    assert.equal(entrySkillRootOf(codex, os.homedir(), e).skillsRoot, path.join(codexHomeOf(e), 'skills'));
  }
});

test('家根不存在的那一家跳过并写明原因；运行时根照装，并提示跨产品副作用', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome(['claude', 'glm']);
  const r = await install(root, ie);
  const skipped = r.targets.filter((t) => t.status === 'skipped').map((t) => t.agent).sort();
  assert.deepEqual(skipped, ['claude', 'glm']);
  assert.ok(r.targets.filter((t) => t.status === 'skipped').every((t) => /未检测到/.test(t.reason ?? '')));
  await fs.access(path.join(r.runtime.dir, 'scripts/trivium.cjs'));
  await assert.rejects(fs.access(path.join(ie.home, '.zcode')), '跳过的那一家不得被创建家根');
  assert.ok(r.notes.some((n) => /跨产品副作用/.test(n)), JSON.stringify(r.notes));
});

test('--targets：只装点名的几家，运行时根照装；点名的家根不存在则整次失败', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome(['gemini']);
  const r = await install(root, ie, { only: ['claude'] });
  assert.deepEqual(r.targets.filter((t) => t.status === 'installed').map((t) => t.agent), ['claude']);
  await assert.rejects(fs.access(path.join(skillsRootOf(ie, 'codex'), 'dual-run')));
  await fs.access(path.join(r.runtime.dir, 'scripts/trivium.cjs'));
  // 没有 Antigravity 的家根：只读审查 Agent 定义不装，也不凭空建出 ~/.gemini（否则下一次安装会误判本机装了 agy）
  assert.equal(r.agentInstalled, null);
  await assert.rejects(fs.access(path.join(ie.home, '.gemini')));
  await assert.rejects(install(root, ie, { only: ['gemini'] }), InstallConflictError);
});

test('残留检测：目标根顶层有 entry/ 或 dual-critic/ ⇒ 安装失败、列出路径、一个文件都不写、不删残留', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const codexRoot = skillsRootOf(ie, 'codex');
  const planted = path.join(codexRoot, 'entry/x/dual-zzz/SKILL.md');
  await fs.mkdir(path.dirname(planted), { recursive: true });
  await fs.writeFile(planted, 'legacy');
  await fs.mkdir(path.join(skillsRootOf(ie, 'gemini'), 'dual-critic'), { recursive: true });

  await assert.rejects(install(root, ie), (e: Error) => {
    assert.ok(e instanceof InstallConflictError);
    assert.match(e.message, new RegExp(path.join(codexRoot, 'entry').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(e.message, /dual-critic/);
    assert.match(e.message, /一个文件都没有写/);
    return true;
  });
  assert.equal(await fs.readFile(planted, 'utf8'), 'legacy', '残留必须原样保留');
  const plan = await planInstall(root, ie);
  await assert.rejects(fs.access(plan.runtimeRoot), '检查不过时不得先写运行时根');
  await assert.rejects(fs.access(path.join(codexRoot, 'dual-run')));
});

test('查重名按完整读取面：~/.agents/skills 里的同名第三方 skill 与自家入口都判冲突，不覆盖', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const shared = path.join(ie.home, '.agents/skills');
  await fs.mkdir(path.join(shared, 'dual-run'), { recursive: true });
  await fs.writeFile(path.join(shared, 'dual-run/SKILL.md'), '---\nname: dual-run\ndescription: 用户自己的\n---\n');
  await fs.cp(path.join(root, ENTRY_OUT_DIR, 'glm/dual-status'), path.join(shared, 'dual-status'), { recursive: true });

  await assert.rejects(install(root, ie), (e: Error) => {
    assert.ok(e instanceof InstallConflictError);
    const kinds = new Set(e.problems.map((p) => `${p.kind}:${path.basename(p.path)}`));
    assert.ok(kinds.has('third-party:dual-run'), JSON.stringify(e.problems));
    assert.ok(kinds.has('foreign-entry:dual-status'), JSON.stringify(e.problems));
    // codex 与 zcode 都读 ~/.agents/skills，两家各报一次；agy 与 claude 不读
    assert.deepEqual([...new Set(e.problems.map((p) => p.agent))].sort(), ['codex', 'glm']);
    return true;
  });
  assert.match(await fs.readFile(path.join(shared, 'dual-run/SKILL.md'), 'utf8'), /用户自己的/);
});

test('安装根里的同名：自家的升级覆盖，别人的判冲突', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  await install(root, ie);
  await install(root, ie); // 自家同名：第二次照常通过
  const zroot = skillsRootOf(ie, 'glm');
  await fs.writeFile(path.join(zroot, 'dual-run/SKILL.md'), '---\nname: dual-run\n---\n别人的\n');
  await assert.rejects(install(root, ie), /不是本产品/);
});

test('没有构建产物就拒绝安装，而不是装出一套没有 CLI 的 skill', async () => {
  const root = await fakeRepo();
  await fs.rm(path.join(root, 'skills/dual-critic/scripts/trivium.cjs'));
  const ie = await fakeHome();
  await assert.rejects(install(root, ie), /npm run build/);
});

test('升级：目标里源已不存在的文件被裁剪，运行时根里的 entry/ 也裁掉；用户目录里的其它 skill 不动', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const r0 = await install(root, ie);
  const rt = r0.runtime.dir;
  await fs.writeFile(path.join(rt, 'OLD.md'), 'old');
  await fs.mkdir(path.join(rt, 'entry/codex/dual-run'), { recursive: true });
  await fs.writeFile(path.join(rt, 'entry/codex/dual-run/SKILL.md'), 'old');
  const claudeRoot = skillsRootOf(ie, 'claude');
  await fs.mkdir(path.join(claudeRoot, 'my-own-skill'), { recursive: true });
  await fs.writeFile(path.join(claudeRoot, 'my-own-skill/SKILL.md'), 'mine');

  const r = await install(root, ie);
  assert.ok(r.removed.some((p) => p.endsWith('dual-critic/OLD.md')), JSON.stringify(r.removed));
  assert.ok(r.removed.some((p) => p.endsWith(path.join('dual-critic', 'entry'))), '运行时根里的 entry/ 要裁掉');
  await assert.rejects(fs.access(path.join(rt, 'entry')));
  await fs.access(path.join(claudeRoot, 'my-own-skill/SKILL.md'));
});

test('卸载：各家入口、运行时根、Agent 定义都删掉；别人的同名与其它 skill 不碰；再跑一次不报错', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const r0 = await install(root, ie);
  const claudeRoot = skillsRootOf(ie, 'claude');
  await fs.mkdir(path.join(claudeRoot, 'my-own-skill'), { recursive: true });
  await fs.writeFile(path.join(claudeRoot, 'my-own-skill/SKILL.md'), 'mine');

  const r = await uninstall(root, ie);
  assert.equal(r.removed.length, 4 * ENTRY_NAMES.length + 2, JSON.stringify(r.removed));
  await assert.rejects(fs.access(r0.runtime.dir));
  for (const a of AGENTS) await assert.rejects(fs.access(path.join(skillsRootOf(ie, a.id), 'dual-run')));
  await fs.access(path.join(claudeRoot, 'my-own-skill/SKILL.md'));
  assert.ok(r.notes.some((n) => n.includes('.trivium/')), '要告诉用户项目内的东西没动');
  assert.deepEqual((await uninstall(root, ie)).removed, []);
});

/*
 * 运行时根的身份判定（代码双审 CODEX-01 / GLM-01 / GLM-02）。
 * 它是唯一由环境变量决定路径的目标，文档又教人把 TRIVIUM_ASSET_ROOT 指向工作树——
 * 下面几格就是那条路径上会发生的事。
 */

/** 目录下全部文件的相对路径（排序），用来断言「一个字节都没动」的前后对比 */
async function listTree(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listTree(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

for (const [label, sub] of [
  ['运行时源本身（src===dst）', 'skills/dual-critic'],
  ['运行时源的父目录', 'skills'],
] as const) {
  test(`TRIVIUM_ASSET_ROOT 指向仓库里的${label}：安装拒绝、卸载不删，仓库一个文件都不少`, async () => {
    const root = await fakeRepo();
    const ie = await fakeHome();
    const env = { TRIVIUM_ASSET_ROOT: path.join(root, sub) };
    const before = await listTree(path.join(root, 'skills'));
    assert.ok(before.some((f) => f.startsWith('dual-critic/entry/')), '夹具里要有 entry/ 渲染产物，否则这格测不到裁剪');

    await assert.rejects(install(root, { home: ie.home, env }), (e: Error) => {
      assert.ok(e instanceof InstallConflictError);
      assert.deepEqual(e.problems.map((p) => p.kind), ['runtime-overlap']);
      assert.match(e.message, /运行时根/);
      return true;
    });
    const r = await uninstall(root, { home: ie.home, env });
    assert.ok(!r.removed.includes(env.TRIVIUM_ASSET_ROOT), JSON.stringify(r.removed));
    assert.ok(r.notes.some((n) => n.includes('与本仓库重叠')), JSON.stringify(r.notes));
    assert.deepEqual(await listTree(path.join(root, 'skills')), before);
  });
}

test('TRIVIUM_ASSET_ROOT 指向仓库的上级目录（把仓库包在里面）：判为重叠而不是外来目录', async () => {
  /*
   * 重叠是双向判的；这一格钉住「仓库在运行时根之内」那个方向（r2 变异 I9）。
   * 只调安装（检查不过即抛、不写盘），**不调卸载**：目标是 os.tmpdir()，不给任何删除路径机会。
   */
  const root = await fakeRepo();
  const ie = await fakeHome();
  await assert.rejects(install(root, { home: ie.home, env: { TRIVIUM_ASSET_ROOT: path.dirname(root) } }), (e: Error) => {
    assert.ok(e instanceof InstallConflictError);
    assert.deepEqual(e.problems.map((p) => p.kind), ['runtime-overlap']);
    return true;
  });
});

test('syncDir 源与目标同路径：什么都不做，顶层 exclude 掉的目录不会被当孤儿裁掉', async () => {
  const dir = await scratchDir('trivium-install-same-');
  await fs.mkdir(path.join(dir, 'entry/x'), { recursive: true });
  await fs.writeFile(path.join(dir, 'entry/x/SKILL.md'), 'kept');
  await fs.writeFile(path.join(dir, 'a.md'), 'a');
  const before = await listTree(dir);
  const r = await syncDir(dir, dir, new Set(['entry']));
  assert.deepEqual(r, { copied: 0, removed: [] });
  assert.deepEqual(await listTree(dir), before);
});

test('TRIVIUM_ASSET_ROOT 指向一个有内容、却不是本产品运行时的目录：安装拒绝、卸载不删，内容原样', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const foreign = await scratchDir('trivium-install-foreign-');
  await fs.writeFile(path.join(foreign, 'notes.md'), '用户自己的');
  await fs.mkdir(path.join(foreign, 'sub'));
  await fs.writeFile(path.join(foreign, 'sub/SKILL.md'), '---\nname: sub\n---\n');
  const env = { TRIVIUM_ASSET_ROOT: foreign };

  await assert.rejects(install(root, { home: ie.home, env }), (e: Error) => {
    assert.ok(e instanceof InstallConflictError);
    assert.deepEqual(e.problems.map((p) => p.kind), ['runtime-foreign']);
    return true;
  });
  // 检查不过时一个文件都不写：各家入口也不能先装进去
  await assert.rejects(fs.access(path.join(skillsRootOf(ie, 'claude'), 'dual-run')));
  const r = await uninstall(root, { home: ie.home, env });
  assert.ok(!r.removed.includes(foreign));
  assert.ok(r.notes.some((n) => n.includes('不是本产品的运行时根')), JSON.stringify(r.notes));
  assert.deepEqual(await listTree(foreign), ['notes.md', 'sub/SKILL.md']);
});

test('运行时根的放行格：不存在、空目录、被打断的上一次安装（只落了 SKILL.md）都照装', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const base = await scratchDir('trivium-install-rtok-');
  const empty = path.join(base, 'empty');
  await fs.mkdir(empty);
  const partial = path.join(base, 'partial');
  await fs.mkdir(partial);
  await fs.copyFile(path.join(root, 'skills/dual-critic/SKILL.md'), path.join(partial, 'SKILL.md'));

  for (const dir of [path.join(base, 'absent'), empty, partial]) {
    const r = await install(root, { home: ie.home, env: { TRIVIUM_ASSET_ROOT: dir } });
    await fs.access(path.join(r.runtime.dir, 'scripts/trivium.cjs'));
  }
});

test('运行时根换了位置、缺省位置留着旧运行时：提示，不删、不阻断（代码双审 r2 CODEX-05）', async () => {
  const root = await fakeRepo();
  const ie = await fakeHome();
  const r0 = await install(root, ie);
  const before = await listTree(r0.runtime.dir);
  assert.ok(!r0.notes.some((n) => n.includes('缺省位置')), '运行时根就在缺省位置时不该提示');

  const elsewhere = await scratchDir('trivium-install-moved-');
  const r = await install(root, { home: ie.home, env: { TRIVIUM_ASSET_ROOT: path.join(elsewhere, 'rt') } });
  assert.ok(r.notes.some((n) => n.includes('缺省位置') && n.includes(r0.runtime.dir)), JSON.stringify(r.notes));
  assert.deepEqual(await listTree(r0.runtime.dir), before, '缺省位置的旧副本必须原样保留');
});

test('命令行只认 --targets 与 --uninstall：拼错、多余、卸载时带 --targets 一律报错，不静默忽略', () => {
  assert.deepEqual(parseInstallArgs([]), { mode: 'install' });
  assert.deepEqual(parseInstallArgs(['--targets', 'claude,glm']), { mode: 'install', only: ['claude', 'glm'] });
  assert.deepEqual(parseInstallArgs(['--uninstall']), { mode: 'uninstall' });
  assert.throws(() => parseInstallArgs(['--target', 'claude']), /不认识的参数「--target」/);
  assert.throws(() => parseInstallArgs(['extra']), /不认识的参数「extra」/);
  assert.throws(() => parseInstallArgs(['--uninstall', '--targets', 'claude']), /只对安装有效/);
  assert.throws(() => parseInstallArgs(['--targets', 'claude', '--uninstall']), /只对安装有效/);
  assert.throws(() => parseInstallArgs(['--targets']), /取值不合法/);
  assert.throws(() => parseInstallArgs(['--targets', 'nobody']), /取值不合法/);
  assert.throws(() => parseInstallArgs(['--targets', 'claude', '--targets', 'glm']), /写了多次/);
});
