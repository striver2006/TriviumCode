import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { IS_WIN, SH } from '../helpers/platform.js';

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
  const root = await scratchDir('trivium-guard-');
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
    // SH：POSIX 为 /bin/sh，win32 为 Git for Windows 的 sh.exe（Claude Code 在 Windows 上也以它执行 hook）
    await run(SH, ['-c', command], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd }, windowsHide: true });
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
  // noexec 格依赖 chmod 执行位语义（win32 无对应物，MSYS noacl 挂载下 test -x 恒真）——只在 POSIX 跑
  const states = (IS_WIN ? ['missing'] : ['missing', 'noexec']) as Array<'missing' | 'noexec'>;
  for (const wrapper of states) {
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
  const states = (IS_WIN ? ['missing', 'ok'] : ['missing', 'noexec', 'ok']) as Array<'missing' | 'noexec' | 'ok'>;
  for (const wrapper of states) {
    const root = await fakeProject({ initialized: true, wrapper });
    assert.equal(await sh(cmd!, root), 0, `session-start（wrapper=${wrapper}）不该阻断`);
  }
});

// ─────────────── Windows 渲染形态（ISSUE-09③）的实跑契约 ───────────────

/**
 * Claude Code 在 Windows 上执行 shell 形态 hook 的载体是 Git Bash，**找不到时回退 PowerShell**
 * （官方 Hooks 文档；验收 four-agent-win 的 ISSUE-09：Git 装在自定义路径时 `sh -c` 解析不到 sh、
 * hook 失败即放行）。`trivium init` 因此在 Windows 合并时把命令重渲染为
 * `powershell -NoProfile -EncodedCommand <b64>; exit $LASTEXITCODE`。
 *
 * 这里**实跑渲染后的命令串**（不是文本匹配——引号、展开与退出码链只有真跑才作数），两个载体各跑一遍：
 *   - sh（Git Bash）：Windows 上 Claude 找得到 Git Bash 时的载体；
 *   - powershell -Command：找不到 Git Bash 时的回退形态（外层 -Command 会把内层原生命令的
 *     非零退出码重映射为 1，本机实测——`exit $LASTEXITCODE` 尾句就是为它存在的）。
 * 语义矩阵与上面 sh 形态的契约逐一对应。POSIX 不渲染（跳过）。
 */
const winRendered = async (): Promise<Map<string, string>> => {
  const { loadHookSource, renderHookEvents } = await import('../../src/trivium/hook-config.js');
  const source = await loadHookSource(path.join(REPO_ROOT, 'skills/dual-critic/hooks/hooks.json'));
  assert.ok(source, '读不到仓库的 hooks.json');
  const events = renderHookEvents('claude-settings', source, '.claude/settings.json');
  const out = new Map<string, string>();
  for (const entries of Object.values(events)) {
    for (const entry of entries) {
      for (const h of entry.hooks) {
        // gate hook-<name> 藏在 base64 体内，命令串表面只有 powershell -EncodedCommand——解出来识别
        const b64 = /EncodedCommand "([^"]+)"/.exec(h.command)?.[1];
        const script = b64 ? Buffer.from(b64, 'base64').toString('utf16le') : h.command;
        const name = /gate hook-([a-z-]+)/.exec(script)?.[1];
        if (name) out.set(name, h.command);
      }
    }
  }
  return out;
};

/** Windows 契约的假项目：.cmd 形态 wrapper（init 在 Windows 双写的入口） */
async function fakeWinProject(opts: { initialized: boolean; wrapperExit?: number | 'missing' }): Promise<string> {
  const root = await scratchDir('trivium-guard-win-');
  await fs.mkdir(path.join(root, '.trivium/bin'), { recursive: true });
  if (opts.initialized) await fs.writeFile(path.join(root, '.trivium/config.yaml'), 'schema: trivium.config.v1\n');
  if (opts.wrapperExit !== 'missing') {
    // cmd 批处理按系统代码页解析，注释只用 ASCII（win32 实测坑，见 init.ts 的 .cmd 生成）
    await fs.writeFile(path.join(root, '.trivium/bin/trivium.cmd'), `@echo off\r\nexit /b ${opts.wrapperExit ?? 0}\r\n`);
  }
  return root;
}

async function runInShells(cmd: string, cwd: string): Promise<{ sh: number; ps: number }> {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: cwd };
  const via = async (bin: string, args: string[]): Promise<number> => {
    try {
      await run(bin, args, { cwd, env, windowsHide: true });
      return 0;
    } catch (e) {
      return (e as { code?: number }).code ?? -1;
    }
  };
  const shCode = await via(SH, ['-c', cmd]);
  const psCode = await via('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
  return { sh: shCode, ps: psCode };
}

test('ISSUE-09③：Windows 渲染形态在 Git Bash 与 PowerShell 回退两个载体下守卫语义成立', { skip: !IS_WIN && 'POSIX 不做 Windows 形态渲染（源保持 sh 形态）' }, async () => {
  const cmds = await winRendered();
  for (const name of [...BLOCKING, 'session-start']) {
    assert.ok(cmds.get(name), `Windows 渲染缺少 hook-${name}`);
  }

  // ① wrapper 就位、判定放行（wrapper exit 0）→ 0
  let root = await fakeWinProject({ initialized: true, wrapperExit: 0 });
  for (const name of [...BLOCKING, 'session-start']) {
    const r = await runInShells(cmds.get(name)!, root);
    assert.equal(r.sh, 0, `hook-${name}（wrapper ok / Git Bash 载体）应放行`);
    assert.equal(r.ps, 0, `hook-${name}（wrapper ok / PowerShell 回退载体）应放行`);
  }

  // ② wrapper 就位、判定拦截（wrapper exit 2）→ 2——外层 powershell -Command 的重映射（非零→1）必须被尾句纠正
  root = await fakeWinProject({ initialized: true, wrapperExit: 2 });
  for (const name of BLOCKING) {
    const r = await runInShells(cmds.get(name)!, root);
    assert.equal(r.sh, 2, `hook-${name}（wrapper 退 2 / Git Bash 载体）必须把 2 传出去`);
    assert.equal(r.ps, 2, `hook-${name}（wrapper 退 2 / PowerShell 回退载体）必须把 2 传出去——exit $LASTEXITCODE 尾句缺失时这里会变成 1`);
  }

  // ③ 已初始化但 wrapper 没了 → 拦截型 2、session-start 0
  root = await fakeWinProject({ initialized: true, wrapperExit: 'missing' });
  for (const name of BLOCKING) {
    const r = await runInShells(cmds.get(name)!, root);
    assert.equal(r.sh, 2, `hook-${name}（护栏被破坏 / Git Bash）必须拦截，不得永真放行`);
    assert.equal(r.ps, 2, `hook-${name}（护栏被破坏 / PowerShell 回退）必须拦截`);
  }
  const ss = await runInShells(cmds.get('session-start')!, root);
  assert.equal(ss.sh, 0, 'session-start（wrapper 缺席 / Git Bash）不阻断');
  assert.equal(ss.ps, 0, 'session-start（wrapper 缺席 / PowerShell 回退）不阻断');

  // ④ 未初始化（协作者克隆后没跑 init）→ 一律静默 0
  root = await fakeWinProject({ initialized: false, wrapperExit: 'missing' });
  for (const name of [...BLOCKING, 'session-start']) {
    const r = await runInShells(cmds.get(name)!, root);
    assert.equal(r.sh, 0, `hook-${name}（未初始化 / Git Bash）应静默放行`);
    assert.equal(r.ps, 0, `hook-${name}（未初始化 / PowerShell 回退）应静默放行`);
  }
});
