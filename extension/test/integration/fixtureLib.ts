/**
 * 集成测试夹具库（node 环境，脚本与测试两侧共用）。
 *
 * 构造一个「已 init 的 TriviumCode 工作区」的最小替身：
 * - .trivium/bin/trivium：可编程桩 CLI（按子命令回放 responses.json）；
 * - .trivium/config.yaml + config.local.yaml（probe 段带锚点别名，形状对齐真实文件）；
 * - .trivium/state.json 与运行根下的 run 目录（status.json / worker.log）；
 * - 假 TUI 两件：可执行 sh 版（direct 模式）与非可执行 .cjs 版（shellCommand 模式）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

export interface Fixture {
  /** 工作区根（作为 VS Code 第一个文件夹打开） */
  root: string;
  /** 运行根（config 指向） */
  runRoot: string;
  /** 预置 run 目录 */
  runDir: string;
  runId: string;
  /** direct 模式假 TUI 的输出文件 */
  tuiDirectOut: string;
  /** shellCommand 模式假 CLI 的输出文件 */
  tuiScriptOut: string;
  /** 桩 responses 映射文件 */
  stubResponses: string;
  /** 更新桩应答（重写 responses.json） */
  setStubResponses(map: Record<string, unknown>): Promise<void>;
  /** 写 state.json（原子替换，模拟编排器） */
  writeState(gates: Record<string, unknown>): Promise<void>;
  /** 写 status.json */
  writeStatus(obj: Record<string, unknown>): Promise<void>;
}

const STUB_CLI = String.raw`#!/usr/bin/env node
// 可编程桩：按「子命令」回放 .trivium/stub/responses.json 的应答（集成测试专用）。
// 每次调用把 argv 原子写入 .trivium/stub/last-args.json，供测试断言旗标透传（CLAUDE-03）。
const fs = require('fs');
const path = require('path');
const root = process.cwd();
try {
  const tmp = path.join(root, '.trivium', 'stub', 'last-args.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(process.argv.slice(2)));
  fs.renameSync(tmp, path.join(root, '.trivium', 'stub', 'last-args.json'));
} catch {}
let map = {};
try { map = JSON.parse(fs.readFileSync(path.join(root, '.trivium', 'stub', 'responses.json'), 'utf8')); } catch {}
const argv = process.argv.slice(2);
const key = (argv[0] === 'topic' || argv[0] === 'review') && argv[1] ? argv[0] + ' ' + argv[1] : argv[0];
const r = map[key] || { code: 64, json: { ok: false, error: 'stub 未配置: ' + key } };
if (r.json !== undefined) console.log(JSON.stringify(r.json));
else if (r.stdout) process.stdout.write(r.stdout);
process.exit(r.code === undefined ? 0 : r.code);
`;

const FAKE_TUI_SH = (outPath: string) => String.raw`#!/bin/sh
# 假 TUI（direct 模式）：把收到的每一行追加到输出文件
while IFS= read -r line; do
  printf '%s\n' "$line" >> ${JSON.stringify(outPath)}
done
`;

const FAKE_CLI_CJS = String.raw`// 假 CLI（shellCommand 模式）：非可执行 .cjs，须由解释器启动。
// 模拟真实交互 TUI：开 raw mode（真实四家 CLI 均如此）——否则 macOS 终端
// ICANON 的 MAX_CANON=255 行缓冲会吞掉长行注入（D8 矩阵关注点）。
const fs = require('fs');
const path = require('path');
const out = fs.readFileSync(path.join(__dirname, 'out-path.txt'), 'utf8').trim();
fs.appendFileSync(out, 'NODE-STARTED\n');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d.replace(/\r/g, '\n'); // raw mode 下回车是 \r，统一按行归一
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    fs.appendFileSync(out, 'LINE:' + buf.slice(0, i) + '\n');
    buf = buf.slice(i + 1);
  }
});
setInterval(() => {}, 1000); // 保活（模拟交互 CLI）
`;

export async function buildFixture(runId = '20261106T000000Z'): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'trivium-ext-fx-'));
  const runRoot = await fs.mkdtemp(path.join(tmpdir(), 'trivium-ext-runs-'));
  // 桶名对齐真机语义 <工作区名>-<hash8>（cockpit 归属校验按工作区名过滤）
  const bucket = `${path.basename(root)}-ab12cd34`;
  const runDir = path.join(runRoot, bucket, runId);
  await fs.mkdir(path.join(root, '.trivium', 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, '.trivium', 'stub'), { recursive: true });
  await fs.mkdir(path.join(root, 'fake-bin'), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });

  // 桩 wrapper
  const stubPath = path.join(root, '.trivium', 'bin', 'trivium');
  await fs.writeFile(stubPath, STUB_CLI, { mode: 0o755 });

  // config.yaml（run_root 指向临时运行根）
  await fs.writeFile(
    path.join(root, '.trivium', 'config.yaml'),
    [
      'schema: trivium.config.v2',
      'archive_root: .reviews',
      'runtime:',
      `  run_root: ${runRoot}`,
      'review:',
      '  default_critics: [claude, gemini, codex]',
      '  heartbeat_stale_s: 120',
      'profiles:',
      '  default:',
      '    claude: { plan: stub-claude-m, code: stub-claude-m, bug: stub-claude-m }',
      '    gemini: { plan: stub-gemini-m, code: stub-gemini-m, bug: stub-gemini-m }',
      '    codex: { plan: stub-codex-m, code: stub-codex-m, bug: stub-codex-m }',
      'verify:',
      '  build: [npm run build]',
      '  test: [npm test]',
      '',
    ].join('\n'),
  );

  // config.local.yaml：probe 段带锚点别名（对齐真实形态）
  const tuiDirectOut = path.join(root, 'fake-bin', 'tui-direct.out');
  const tuiScriptOut = path.join(root, 'fake-bin', 'tui-script.out');
  await fs.writeFile(
    path.join(root, '.trivium', 'config.local.yaml'),
    [
      'probe:',
      '  generated_at: 2026-11-06T00:00:00.000Z',
      '  auth:',
      '    claude: &auth_ok',
      '      checked_at: 2026-11-06T00:00:00.000Z',
      '      ok: true',
      '    gemini: *auth_ok',
      '    codex: *auth_ok',
      '  cli:',
      '    claude:',
      '      entrypoint: ' + JSON.stringify(path.join(root, 'fake-bin', 'fake-tui.sh')),
      '      version: 9.9.9-stub',
      '      version_probe: &vp',
      '        runner: null',
      "        args: ['--version']",
      "        extract: '(\\\\d+\\\\.\\\\d+\\\\.\\\\d+)'",
      '      probed_at: 2026-11-06T00:00:00.000Z',
      '    codex:',
      '      entrypoint: /usr/local/bin/codex-stub',
      '      version: 0.0.0-stub',
      '      version_probe: *vp',
      '      probed_at: 2026-11-06T00:00:00.000Z',
      '    agy:',
      '      entrypoint: /usr/local/bin/agy-stub',
      '      version: 0.0.0-stub',
      '      version_probe: *vp',
      '      probed_at: 2026-11-06T00:00:00.000Z',
      '    zcode:',
      '      entrypoint: ' + JSON.stringify(path.join(root, 'fake-bin', 'fake-cli.cjs')),
      '      version: 0.0.0-stub',
      '      version_probe: *vp',
      '      probed_at: 2026-11-06T00:00:00.000Z',
      '',
    ].join('\n'),
  );

  // 假 TUI：direct（可执行 sh）与 shellCommand（非可执行 .cjs）
  await fs.writeFile(path.join(root, 'fake-bin', 'fake-tui.sh'), FAKE_TUI_SH(tuiDirectOut), { mode: 0o755 });
  const scriptDir = path.join(root, 'fake-bin');
  await fs.writeFile(path.join(scriptDir, 'fake-cli.cjs'), FAKE_CLI_CJS, { mode: 0o644 });
  await fs.writeFile(path.join(scriptDir, 'out-path.txt'), `${tuiScriptOut}\n`);

  // 初始 state.json：一条活跃 + 两条历史残留（CLAUDE-04 场景）
  const statePath = path.join(root, '.trivium', 'state.json');
  await writeStateFile(statePath, {
    'DemoTopic/plan': { topic: 'DemoTopic', stage: 'plan', state: 'running', run_id: runId, since: '2026-11-06T00:00:00.000Z', session_id: null },
    '历史A/code': { topic: '历史A', stage: 'code', state: 'approved', run_id: '20200101T000000Z', since: '2020-01-01T00:00:00.000Z', session_id: null },
    '历史B/plan': { topic: '历史B', stage: 'plan', state: 'abandoned', run_id: null, since: '2020-01-01T00:00:00.000Z', session_id: null },
  });

  // 初始 status.json / worker.log
  await writeStatusFile(path.join(runDir, 'status.json'), {
    schema: 'trivium.status.v1',
    run_id: runId,
    topic: 'DemoTopic',
    stage: 'plan',
    phase: 'running',
    heartbeat_at: new Date().toISOString(),
    sides: { claude: { state: 'running', model: 'stub-m', attempt: 1, elapsed_s: 0, cli: null } },
    artifacts: [],
    exit_code: null,
    message: null,
  });
  await fs.writeFile(path.join(runDir, 'worker.log'), '· 桩 worker 日志第一行\n');

  const stubResponses = path.join(root, '.trivium', 'stub', 'responses.json');
  const setStubResponses = async (map: Record<string, unknown>) => {
    await fs.writeFile(stubResponses, JSON.stringify(map, null, 2));
  };

  return {
    root,
    runRoot,
    runDir,
    runId,
    tuiDirectOut,
    tuiScriptOut,
    stubResponses,
    setStubResponses,
    writeState: (gates) => writeStateFile(statePath, gates),
    writeStatus: (obj) => writeStatusFile(path.join(runDir, 'status.json'), obj),
  };
}

async function writeStateFile(p: string, gates: Record<string, unknown>): Promise<void> {
  await atomicWrite(p, JSON.stringify({ schema: 'trivium.state.v1', updated_at: new Date().toISOString(), gates }, null, 2));
}

async function writeStatusFile(p: string, obj: Record<string, unknown>): Promise<void> {
  await atomicWrite(p, JSON.stringify(obj, null, 2));
}

/** 原子替换（模拟编排器写法：临时文件 + rename） */
async function atomicWrite(p: string, text: string): Promise<void> {
  const tmp = `${p}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, p);
}

/** 轮询等待条件成立（集成测试的时序协调） */
export async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 15_000, everyMs = 150): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitFor 超时（${timeoutMs}ms）`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
