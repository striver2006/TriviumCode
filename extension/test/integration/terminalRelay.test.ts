/**
 * 终端协同（FR-5）：direct / shellCommand 两种拉起 + 注入通道保真（fake TUI
 * 字节级，CODEX-05 的自动化层）+ 身份键复用。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { TerminalRelay, terminalKey } from '../../src/launch/terminalRelay';
import { waitFor, fxPaths } from './testHelper';

async function outFileText(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

suite('终端协同（FR-5）', function () {
  this.timeout(60_000);

  test('direct 模式：可执行 entrypoint 直启 + execute 注入通道保真', async () => {
    const p = await fxPaths();
    const relay = new TerminalRelay();
    try {
      const session = await relay.ensureSession({
        agentId: 'claude', display: 'Claude Code', topic: '通道保真', entry: 'A',
        entrypoint: pathJoin(p.root, 'fake-bin', 'fake-tui.sh'),
        launchMode: 'direct', cwd: p.root,
      });
      const text = '/dual-run 通道保真：中文 + 引号" x" + $HOME + `bt`';
      await relay.injectText(session, text, { readyDelayMs: 300, sendMode: 'execute', segmentBytes: 512 }, 200);
      await waitFor(async () => (await outFileText(p.tuiDirectOut)).includes('通道保真'), 20_000);
      const got = await outFileText(p.tuiDirectOut);
      assert.ok(got.includes(text), `TUI 收到的内容应逐字包含注入文本（实际：${got.slice(0, 200)}）`);
    } finally {
      relay.dispose();
    }
  });

  test('shellCommand 模式：.cjs 由解释器启动 + 长文分段注入保真', async () => {
    const p = await fxPaths();
    const relay = new TerminalRelay();
    try {
      const session = await relay.ensureSession({
        agentId: 'glm', display: 'ZCode', topic: '分段保真', entry: 'A',
        entrypoint: pathJoin(p.root, 'fake-bin', 'fake-cli.cjs'),
        launchMode: 'shellCommand', cwd: p.root,
        // 测试宿主 process.execPath 是 VS Code 主程序（新版叫 Code 不叫 Electron），
        // 不能当解释器；一律从本仓 wrapper 解析真实 node 绝对路径（AGY-02 兜底链同款）
        nodePath: (await realNodePath()) ?? 'node',
      });
      // 长正文（>512B 触发分段），段间 80ms；manual 模式不回车 → TUI 按行收不到？分段不含 \n，收不到行
      // → 用 execute：最后一段补回车，TUI 收到完整一行
      const long = `/skill dual-run ${'长'.repeat(400)} 尾标记END`;
      await relay.injectText(session, long, { readyDelayMs: 800, sendMode: 'execute', segmentBytes: 256 }, 400);
      await waitFor(async () => (await outFileText(p.tuiScriptOut)).includes('尾标记END'), 25_000);
      const lines = (await outFileText(p.tuiScriptOut))
        .split('\n')
        .filter((l) => l.startsWith('LINE:'))
        .map((l) => l.slice('LINE:'.length));
      assert.equal(lines.length, 1, '整条注入应恰为一行');
      assert.equal(lines[0], long, '分段注入后 TUI 收到的整行应与注入文本逐字一致');
    } finally {
      relay.dispose();
    }
  });

  test('身份键：同键复用、异键不串', async () => {
    const p = await fxPaths();
    const relay = new TerminalRelay();
    try {
      const s1 = await relay.ensureSession({
        agentId: 'claude', display: 'C', topic: 'T1', entry: 'A',
        entrypoint: pathJoin(p.root, 'fake-bin', 'fake-tui.sh'), launchMode: 'direct', cwd: p.root,
      });
      const s2 = await relay.ensureSession({
        agentId: 'claude', display: 'C', topic: 'T1', entry: 'A',
        entrypoint: pathJoin(p.root, 'fake-bin', 'fake-tui.sh'), launchMode: 'direct', cwd: p.root,
      });
      assert.equal(s1, s2, '同 agent|topic|entry 应复用会话');
      const s3 = await relay.ensureSession({
        agentId: 'claude', display: 'C', topic: 'T2', entry: 'A',
        entrypoint: pathJoin(p.root, 'fake-bin', 'fake-tui.sh'), launchMode: 'direct', cwd: p.root,
      });
      assert.notEqual(s1, s3, '不同主题应新开会话（CLAUDE-07）');
      assert.equal(terminalKey('claude', 'T1', 'A'), 'claude|T1|A');
    } finally {
      relay.dispose();
    }
  });

  test('脚本进程退出时释放原终端，等待就绪的注入报告未送达', async () => {
    const p = await fxPaths();
    const script = pathJoin(p.root, 'fake-bin', 'exit.cjs');
    await fs.writeFile(script, 'process.exit(0)');
    const relay = new TerminalRelay();
    try {
      const session = await relay.ensureSession({
        agentId: 'glm', display: 'ZCode', topic: '启动即退出', entry: 'B',
        entrypoint: script, launchMode: 'shellCommand', cwd: p.root, nodePath: await realNodePath() ?? 'node',
      });
      await waitFor(() => !relay.find(session.key), 20_000);
      assert.equal(await relay.injectText(session, '测试输入', {
        readyDelayMs: 0, sendMode: 'execute', segmentBytes: 512,
      }, 0), false);
    } finally {
      relay.dispose();
    }
  });

  test('续话中继：第二段文本送达同一 TUI', async () => {
    const p = await fxPaths();
    const relay = new TerminalRelay();
    try {
      const session = await relay.ensureSession({
        agentId: 'claude', display: 'C', topic: '续话', entry: 'A',
        entrypoint: pathJoin(p.root, 'fake-bin', 'fake-tui.sh'), launchMode: 'direct', cwd: p.root,
      });
      await relay.relay(session, '第二段：请继续', { readyDelayMs: 0, sendMode: 'split', segmentBytes: 512 });
      await waitFor(async () => (await outFileText(p.tuiDirectOut)).includes('第二段：请继续'), 20_000);
    } finally {
      relay.dispose();
    }
  });
});

function pathJoin(...parts: string[]): string {
  return parts.join('/');
}

/** 测试宿主是 Electron 时，从本仓真实 wrapper 解析 node 绝对路径（AGY-02 兜底链） */
async function realNodePath(): Promise<string | null> {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  // out-test/test/integration → extension → 仓根
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  try {
    const wrapper = readFileSync(path.join(repoRoot, '.trivium', 'bin', 'trivium'), 'utf8');
    const m = /exec\s+"([^"]+)"\s+"[^"]*trivium/.exec(wrapper);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
