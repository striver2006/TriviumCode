/**
 * 四家真实 CLI 启动冒烟（D8′ 矩阵第一行自动化；CODEX-07 预算：每载体 1 次启动，
 * 零模型调用——只启动不注入内容）。
 *
 * 验证：direct（claude/codex/agy）与 shellCommand（zcode 经解释器）两条拉起
 * 路径在真实 entrypoint 上成立，且会话存活（TUI 未立即退出）。
 * 不验证注入语义（终端输出无稳定 API；由 fakeTUI 字节级测试覆盖）。
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { TerminalRelay } from '../../src/launch/terminalRelay';
import { parseWrapperNodePath } from '../../src/launch/carriers';
import { fxPaths } from '../integration/testHelper';

/** 从本仓真实 wrapper 解析 node 绝对路径 */
function realNode(): string | null {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  try {
    return parseWrapperNodePath(readFileSync(path.join(repoRoot, '.trivium', 'bin', 'trivium'), 'utf8'));
  } catch {
    return null;
  }
}

async function aliveAfter(ms: number, term: vscode.Terminal): Promise<boolean> {
  await new Promise((r) => setTimeout(r, ms));
  return term.exitStatus === undefined;
}

suite('真机启动冒烟（四家，零模型调用）', function () {
  this.timeout(120_000);

  const cases: { agent: 'claude' | 'codex' | 'gemini' | 'glm'; mode: 'direct' | 'shellCommand' }[] = [
    { agent: 'claude', mode: 'direct' },
    { agent: 'codex', mode: 'direct' },
    { agent: 'gemini', mode: 'direct' },
    { agent: 'glm', mode: 'shellCommand' },
  ];

  for (const c of cases) {
    test(`${c.agent}：${c.mode} 拉起存活`, async function () {
      const p = await fxPaths();
      // 从本机真实 probe 段取 entrypoint（夹具 probe 是假的，真机冒烟读真文件）
      const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
      const YAML = (await import('yaml')).default;
      const local = YAML.parse(readFileSync(path.join(repoRoot, '.trivium', 'config.local.yaml'), 'utf8')) as {
        probe?: { cli?: Record<string, { entrypoint?: string }> };
      };
      const cliKey = c.agent === 'gemini' ? 'agy' : c.agent === 'glm' ? 'zcode' : c.agent;
      const entrypoint = local.probe?.cli?.[cliKey]?.entrypoint;
      if (!entrypoint) {
        this.skip();
        return;
      }
      await fs.access(entrypoint); // 探针结论里的入口应真实存在
      const relay = new TerminalRelay();
      try {
        const session = await relay.ensureSession({
          agentId: c.agent,
          display: c.agent,
          topic: `真机冒烟-${Date.now()}`,
          entry: 'A',
          entrypoint,
          launchMode: c.mode,
          cwd: p.root,
          nodePath: realNode(),
        });
        assert.ok(await aliveAfter(6_000, session.terminal), `${c.agent} 会话 6s 内即退出（拉起或启动命令失败）`);
      } finally {
        relay.dispose();
      }
    });
  }
});
