import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { planInstall } from '../../src/install.js';
import { ENTRY_SKILL_NAMES, RESIDUE_DIR_NAMES, RUNTIME_ROOT_NAME } from '../../src/trivium/entry-collisions.js';
import { ENTRY_OUT_DIR } from '../../src/entry-render.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';

/*
 * 两个打包产物用的是同一份实现，不是各抄一份（EV-240 方案 A，M12 批次 5；计划 r2 §2.4 / §4 U4）。
 *
 * 三条证据：①两份产物都带 esbuild 给共享模块打的模块标记；②安装器源码里不再有判定实现；
 * ③`src/trivium/` 不反向依赖安装器（计划双审 AGY-04）。另对账编排器侧的入口名单。
 */

const MARK = '// src/trivium/entry-collisions.ts';
const BUNDLES = ['dist/install.cjs', 'skills/dual-critic/scripts/trivium.cjs'];

test('U4 两份打包产物都含共享模块（同一个源文件的模块标记）', { skip: BUNDLES.some((b) => !existsSync(path.join(REPO_ROOT, b))) && '先 npm run build' }, async () => {
  for (const b of BUNDLES) {
    const text = await fs.readFile(path.join(REPO_ROOT, b), 'utf8');
    assert.ok(text.includes(MARK), `${b} 里找不到 ${MARK}`);
    assert.equal(text.split('async function isOurEntry(').length - 1, 1, `${b} 里 isOurEntry 应恰有一份实现`);
    assert.equal(text.split('async function scanEntryCollisions(').length - 1, 1, `${b} 里判定核心应恰有一份实现`);
  }
});

test('U4 安装器源码里没有判定实现，只经共享模块调用', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/install.ts'), 'utf8');
  assert.ok(!/function\s+isOurEntry\s*\(/.test(src), 'install.ts 不得再定义 isOurEntry');
  assert.ok(!src.includes("kind: ours ? 'foreign-entry' : 'third-party'"), 'install.ts 不得再有判定循环');
  assert.ok(src.includes("from './trivium/entry-collisions.js'"), 'install.ts 要从共享模块取判定');
});

test('U4 src/trivium/ 不 import 安装器或入口渲染（编排器不反向依赖安装器）', async () => {
  const offenders: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.ts')) {
        const text = await fs.readFile(p, 'utf8');
        if (/from\s+'(\.\.\/)+(install|entry-render)\.js'/.test(text)) offenders.push(path.relative(REPO_ROOT, p));
      }
    }
  };
  await walk(path.join(REPO_ROOT, 'src/trivium'));
  assert.deepEqual(offenders, []);
});

test('U4 名单对账：ENTRY_SKILL_NAMES = 命令契约 name 全集 = 安装器给每一家算出的名单', async () => {
  const dir = path.join(REPO_ROOT, 'skills-src/commands');
  const contractNames: string[] = [];
  for (const f of await fs.readdir(dir)) {
    if (!f.endsWith('.contract.md')) continue;
    const m = /^---\nname: (\S+)\n/.exec(await fs.readFile(path.join(dir, f), 'utf8'));
    assert.ok(m, `${f} 的 front-matter 首键应为 name`);
    contractNames.push(m[1]!);
  }
  const expected = [...ENTRY_SKILL_NAMES].sort();
  assert.deepEqual([...contractNames].sort(), expected, '改了命令要同步 entry-collisions.ts 的 ENTRY_SKILL_NAMES');

  const home = await scratchDir('trivium-ecol-plan-');
  const plan = await planInstall(REPO_ROOT, { home, env: {} });
  assert.ok(plan.targets.length > 0);
  for (const t of plan.targets) {
    assert.deepEqual(t.sources.map((s) => s.name).sort(), expected, `${t.agent} 的安装名单与编排器侧不一致`);
  }
});

// ─────────────── 共享根残留（主题 M12-共享根残留检测，计划 r2 §4 U6） ───────────────

test('U6 两份产物里运行时身份行与残留拷贝判据各恰有一份实现；安装器源码不再自带身份行', { skip: BUNDLES.some((b) => !existsSync(path.join(REPO_ROOT, b))) && '先 npm run build' }, async () => {
  for (const b of BUNDLES) {
    const text = await fs.readFile(path.join(REPO_ROOT, b), 'utf8');
    assert.equal(text.split('async function hasRuntimeIdentity(').length - 1, 1, `${b} 里 hasRuntimeIdentity 应恰有一份实现`);
    assert.equal(text.split('async function isResidueCopy(').length - 1, 1, `${b} 里 isResidueCopy 应恰有一份实现`);
  }
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/install.ts'), 'utf8');
  assert.ok(!src.includes('RUNTIME_IDENTITY'), 'install.ts 不得再定义运行时身份行');
  assert.ok(!src.includes("readFile(path.join(dir, 'SKILL.md')"), 'install.ts 不得再自读 SKILL.md 判身份');
});

test('U6 名单对账：RESIDUE_DIR_NAMES / RUNTIME_ROOT_NAME 与安装器从 ENTRY_OUT_DIR 派生的值一致', () => {
  const runtimeName = path.basename(path.dirname(ENTRY_OUT_DIR));
  assert.equal(RUNTIME_ROOT_NAME, runtimeName);
  assert.deepEqual([...RESIDUE_DIR_NAMES], [runtimeName, path.basename(ENTRY_OUT_DIR)]);
});
