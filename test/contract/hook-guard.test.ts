import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../helpers/fixture.js';

const run = promisify(execFile);

/**
 * Hook 守卫契约：wrapper 缺失时**不得一律放行**（审查意见 AGY-03）。
 *
 * `.claude/settings.json` 里每条 Hook 外面都包着一层存在性守卫。它原本写作
 * `test -x "$W" || exit 0`——协作者克隆仓库还没跑 init 时静默放行，这是对的；
 * 但它同时意味着一条 `rm -rf .trivium/bin` 或 `chmod -x .trivium/bin/trivium`
 * 就能让四个拦截型 Hook 全部永真放行，**整套闸门被一次性解除且悄无声息**。
 *
 * 正确姿态是区分两种情形，本测试实跑那段 shell 守住它：
 *   · 没有 config.yaml  → 项目从未初始化，exit 0
 *   · 有 config.yaml 但 wrapper 没了 → 护栏被破坏，exit 2
 *
 * 断言实跑而非文本匹配：这段 shell 的分支、短路与 exec 语义只有真跑才作数。
 */

interface HookEntry {
  hooks: { command: string }[];
  matcher?: string;
}

function loadHookCommands(): Map<string, string> {
  const raw = readFileSync(
    path.join(REPO_ROOT, 'skills/dual-critic/hooks/hooks.json'),
    'utf8',
  );
  const parsed = JSON.parse(raw) as { hooks: Record<string, HookEntry[]> };
  const out = new Map<string, string>();
  for (const entries of Object.values(parsed.hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        const name = /gate hook-([a-z-]+)/.exec(h.command)?.[1];
        if (name) out.set(name, h.command);
      }
    }
  }
  return out;
}

/** 拦截型 Hook：判定不了就必须拦。session-start 只注入待办，不在此列 */
const BLOCKING = ['pre-write', 'pre-bash', 'pre-commit', 'stop'];

async function fakeProject(opts: { initialized: boolean; wrapper: 'ok' | 'missing' | 'noexec' }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-guard-'));
  await fs.mkdir(path.join(root, '.trivium/bin'), { recursive: true });
  if (opts.initialized) await fs.writeFile(path.join(root, '.trivium/config.yaml'), 'schema: trivium.config.v1\n');
  if (opts.wrapper !== 'missing') {
    const w = path.join(root, '.trivium/bin/trivium');
    await fs.writeFile(w, '#!/bin/sh\nexit 0\n');
    await fs.chmod(w, opts.wrapper === 'ok' ? 0o755 : 0o644);
  }
  return root;
}

async function sh(command: string, cwd: string): Promise<number> {
  try {
    await run('sh', ['-c', command], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
    return 0;
  } catch (e) {
    return (e as { code?: number }).code ?? -1;
  }
}

test('未初始化的项目（无 config.yaml）：守卫静默放行，不打扰协作者', async () => {
  const cmds = loadHookCommands();
  const root = await fakeProject({ initialized: false, wrapper: 'missing' });
  for (const name of BLOCKING) {
    const cmd = cmds.get(name);
    assert.ok(cmd, `hooks.json 缺少 hook-${name}`);
    assert.equal(await sh(cmd, root), 0, `hook-${name} 在未初始化项目里应 exit 0`);
  }
});

test('AGY-03：已初始化但 wrapper 被删或去掉执行位 → 拦截型 Hook 必须 exit 2，不得永真放行', async () => {
  const cmds = loadHookCommands();
  for (const wrapper of ['missing', 'noexec'] as const) {
    const root = await fakeProject({ initialized: true, wrapper });
    for (const name of BLOCKING) {
      const cmd = cmds.get(name)!;
      assert.equal(
        await sh(cmd, root),
        2,
        `hook-${name}（wrapper=${wrapper}）必须拦截：一律 exit 0 等于删掉 bin 就能解除全部闸门`,
      );
    }
  }
});

test('wrapper 就位时守卫把判定交给编排器本身', async () => {
  const cmds = loadHookCommands();
  const root = await fakeProject({ initialized: true, wrapper: 'ok' });
  for (const name of BLOCKING) {
    assert.equal(await sh(cmds.get(name)!, root), 0, `hook-${name} 应 exec 到 wrapper（本例 wrapper 返回 0）`);
  }
});

test('GLM-02：hook-pre-commit 不得靠前缀型 if 过滤（sh -c 包裹的提交会整个漏掉）', () => {
  const raw = readFileSync(path.join(REPO_ROOT, 'skills/dual-critic/hooks/hooks.json'), 'utf8');
  const parsed = JSON.parse(raw) as { hooks: Record<string, HookEntry[]> };
  for (const entries of Object.values(parsed.hooks)) {
    for (const entry of entries as (HookEntry & { hooks: { command: string; if?: string }[] })[]) {
      for (const h of entry.hooks) {
        if (!/gate hook-pre-commit/.test(h.command)) continue;
        assert.equal(
          h.if,
          undefined,
          'if 是前缀匹配：`sh -c \'git commit …\'` 不以 git commit 开头，Hook 根本不触发，' +
            '裁决期提交拦截与留痕完整性校验会被一起跳过。过滤必须留在 looksLikeCommit 里做。',
        );
      }
    }
  }
});

test('session-start 不是拦截型：任何情形都不得阻断会话', async () => {
  const cmds = loadHookCommands();
  const cmd = cmds.get('session-start');
  assert.ok(cmd);
  for (const wrapper of ['missing', 'noexec', 'ok'] as const) {
    const root = await fakeProject({ initialized: true, wrapper });
    assert.equal(await sh(cmd, root), 0, `session-start（wrapper=${wrapper}）不该阻断`);
  }
});
