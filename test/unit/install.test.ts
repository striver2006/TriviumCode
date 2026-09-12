import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { install, uninstall, defaultTargets } from '../../src/install.js';

/*
 * 安装器原先零测试（审核 M15 / M21）：无卸载路径，copyDir 只覆盖不裁剪，
 * 升级后被重命名/删除的 SKILL.md 会残留并继续被 Claude Code 加载。
 */

async function fakeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-install-repo-'));
  await fs.mkdir(path.join(root, 'skills/dual-critic/scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills/dual-critic/agents'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills/dual-run'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills/dual-critic/scripts/trivium.cjs'), '// bundle');
  await fs.writeFile(path.join(root, 'skills/dual-critic/SKILL.md'), '# critic');
  await fs.writeFile(path.join(root, 'skills/dual-critic/agents/trivium-critic.md'), '# agent');
  await fs.writeFile(path.join(root, 'skills/dual-run/SKILL.md'), '# run');
  return root;
}

async function fakeHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-install-home-'));
  return { home, targets: defaultTargets(home) };
}

test('安装：skills 与只读 Agent 定义落到用户目录', async () => {
  const root = await fakeRepo();
  const { targets } = await fakeHome();
  const r = await install(root, targets);
  assert.equal(r.installed.length, 2);
  await fs.access(path.join(targets.skillsTarget, 'dual-critic/scripts/trivium.cjs'));
  await fs.access(path.join(targets.skillsTarget, 'dual-run/SKILL.md'));
  assert.equal(r.agentInstalled, targets.agentTarget);
  await fs.access(targets.agentTarget);
});

test('没有构建产物就拒绝安装，而不是装出一套没有 CLI 的 skill', async () => {
  const root = await fakeRepo();
  await fs.rm(path.join(root, 'skills/dual-critic/scripts/trivium.cjs'));
  const { targets } = await fakeHome();
  await assert.rejects(install(root, targets), /npm run build/);
});

test('升级：目标里源已不存在的文件被裁剪，用户目录里的其它 skill 不动', async () => {
  const root = await fakeRepo();
  const { targets } = await fakeHome();
  await install(root, targets);
  // 模拟旧版残留：一个已被重命名掉的 SKILL、一个旧 prompts 文件；以及用户自己的别的 skill
  await fs.writeFile(path.join(targets.skillsTarget, 'dual-critic/OLD.md'), 'old');
  await fs.mkdir(path.join(targets.skillsTarget, 'dual-critic/prompts'), { recursive: true });
  await fs.writeFile(path.join(targets.skillsTarget, 'dual-critic/prompts/legacy.md'), 'old');
  await fs.mkdir(path.join(targets.skillsTarget, 'my-own-skill'), { recursive: true });
  await fs.writeFile(path.join(targets.skillsTarget, 'my-own-skill/SKILL.md'), 'mine');

  const r = await install(root, targets);
  assert.ok(r.removed.some((p) => p.endsWith('dual-critic/OLD.md')), JSON.stringify(r.removed));
  assert.ok(r.removed.some((p) => p.endsWith('dual-critic/prompts')), '整个孤儿目录也要裁掉');
  await assert.rejects(fs.access(path.join(targets.skillsTarget, 'dual-critic/OLD.md')));
  await fs.access(path.join(targets.skillsTarget, 'my-own-skill/SKILL.md'));
});

test('卸载：只删我们装的 skill 目录与 Agent 定义，别的不碰', async () => {
  const root = await fakeRepo();
  const { targets } = await fakeHome();
  await install(root, targets);
  await fs.mkdir(path.join(targets.skillsTarget, 'my-own-skill'), { recursive: true });
  await fs.writeFile(path.join(targets.skillsTarget, 'my-own-skill/SKILL.md'), 'mine');

  const r = await uninstall(root, targets);
  assert.equal(r.removed.length, 3, JSON.stringify(r.removed));
  await assert.rejects(fs.access(path.join(targets.skillsTarget, 'dual-critic')));
  await assert.rejects(fs.access(path.join(targets.skillsTarget, 'dual-run')));
  await assert.rejects(fs.access(targets.agentTarget));
  await fs.access(path.join(targets.skillsTarget, 'my-own-skill/SKILL.md'));
  assert.ok(r.notes.some((n) => n.includes('.trivium/')), '要告诉用户项目内的东西没动');
});

test('卸载是幂等的：再跑一次不报错', async () => {
  const root = await fakeRepo();
  const { targets } = await fakeHome();
  await install(root, targets);
  await uninstall(root, targets);
  const r = await uninstall(root, targets);
  assert.deepEqual(r.removed, []);
});
