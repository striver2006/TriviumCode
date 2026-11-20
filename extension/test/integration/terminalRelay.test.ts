/**
 * 终端协同（FR-5）：direct / shellCommand 两种拉起 + 注入通道保真（fake TUI
 * 字节级，CODEX-05 的自动化层）+ 身份键复用。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { TerminalRelay, terminalKey, type LaunchOptions } from '../../src/launch/terminalRelay';
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

  test('GLM 两种入口在含空格路径收到相同日志环境、工作目录和独立参数', async () => {
    const { root } = await fxPaths();
    const dir = await fs.mkdtemp(pathJoin(root, 'glm tui '));
    const node = await realNodePath();
    assert.ok(node);
    const script = pathJoin(dir, 'test tui.cjs');
    const direct = pathJoin(dir, 'zcode');
    await fs.writeFile(script, 'require("node:fs").writeFileSync(process.env.ZCODE_LOG_DIR + "/seen.json", JSON.stringify({argv:process.argv.slice(1),cwd:process.cwd(),node:process.execPath})); setInterval(()=>{}, 5000)');
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    await fs.writeFile(direct, '#!/bin/sh\nexec ' + quote(node) + ' ' + quote(script) + ' "$@"', {mode:0o755});
    const relay = new TerminalRelay(dir);
    const logs = new Set<string>();
    try {
      for (const mode of ['direct','shellCommand'] as const) {
        const opts: LaunchOptions = {agentId:'glm', display:'ZCode', topic:mode, entry:'A', cwd:root,
          launchMode:mode, entrypoint:mode === 'direct' ? direct : script, nodePath:node, waitForZcodeTurn:true};
        const s = await relay.ensureSession(opts);
        try {
          const log = s.turns!.dir;
          logs.add(log);
          const out = pathJoin(log, 'seen.json');
          await waitFor(async () => (await outFileText(out)).length > 0, 20_000);
          const seen = JSON.parse(await fs.readFile(out,'utf8'));
          assert.deepEqual(seen.argv, [script]);
          assert.equal(await fs.realpath(seen.node), await fs.realpath(node));
          assert.equal(await fs.realpath(seen.cwd), await fs.realpath(root));
          const reused = await relay.ensureSession({...opts, entrypoint:'改动后的配置'});
          assert.equal(reused.launch.entrypoint, opts.entrypoint);
        } finally { s.terminal.dispose(); }
      }
      assert.equal(logs.size, 2);
    } finally { relay.dispose(); }
  });

  test('首条输入等独立启动事件，超时与关闭不注入，普通入口沿用延迟', async () => {
    const { root, tuiScriptOut } = await fxPaths();
    const nodePath = await realNodePath();
    assert.ok(nodePath);
    const logRoot = await fs.mkdtemp(pathJoin(root, 'startup '));
    const relay = new TerminalRelay(logRoot, 800);
    const opts: LaunchOptions = {agentId:'glm', display:'ZCode', topic:'首启', entry:'A',
      entrypoint:pathJoin(root,'fake-bin','fake-cli.cjs'), cwd:root, nodePath,
      launchMode:'shellCommand', waitForStartup:true, waitForZcodeTurn:true};
    const settings = {readyDelayMs:0,sendMode:'execute' as const,segmentBytes:512};
    try {
      const s = await relay.ensureSession(opts);
      const sent = relay.injectText(s,'启动标记文本',settings,0,true);
      assert.ok(s.injecting);
      await new Promise(r=>setTimeout(r,300));
      assert.equal((await outFileText(tuiScriptOut)).includes('启动标记文本'),false);
      await fs.writeFile(pathJoin(s.turns!.dir,'zcode-2026-11-20.jsonl'),
        '{"module":"bootstrap","event":"bootstrap.app.startup.completed"}\n');
      assert.ok(await sent);
      await waitFor(async ()=>(await outFileText(tuiScriptOut)).includes('启动标记文本'),8000);
      assert.ok(s.entrySent);
      const cold = await relay.ensureSession({...opts,topic:'超时'});
      await assert.rejects(relay.injectText(cold,'错误重发',settings,0,true),/重新注入/);
      assert.equal(cold.entrySent,false);
      assert.equal(cold.injecting,false);
      const closed = relay.injectText(cold,'关闭前',settings,0,true);
      cold.terminal.dispose();
      assert.equal(await closed,false);
      const ordinary = await relay.ensureSession({...opts, topic:'旧脚本',source:'探针',waitForStartup:false});
      assert.ok(await relay.injectText(ordinary,'旧脚本入口',settings,250,true));
      const other = await relay.ensureSession({...opts, agentId:'claude',topic:'其他主攻',waitForZcodeTurn:false});
      assert.equal(other.turns,undefined);
      assert.equal((other.terminal.creationOptions as import('vscode').TerminalOptions).env?.ZCODE_LOG_DIR,undefined);
      for (const done of [s,ordinary,other]) done.terminal.dispose();
    } finally { relay.dispose(); }
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
