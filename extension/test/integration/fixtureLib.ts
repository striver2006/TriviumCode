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

/** Phase 3：可编程桩源码导出（gateApproval/dispositionDesk 替换 Phase2 夹具的占位 wrapper 用） */
export const STUB_CLI_SRC = STUB_CLI;

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

// ═══════════════════════ Phase 2（FR-6/FR-7）夹具 ═══════════════════════

/** Phase 2 夹具：源文件 + _meta 审查工件 + changes.diff（git 冻结基线）+ task.json + run_root */
export interface Phase2Fixture {
  root: string;
  runRoot: string;
  /** 基线提交 sha（changes.diff 的 # head） */
  gitSha: string;
  /** 主 run（_meta 归档齐全） */
  run2Id: string;
  /** 辅 run（无 _meta 归档，探测 run_root 定位） */
  run1Id: string;
  /** 归档缺失 run 的目录（run_root 下） */
  run1Dir: string;
  metaDir: string;
  /** 第二主题（纯归档、无活跃闸门）：历史回放卡/竞态用例（CLAUDE-04/CODEX-02/07） */
  archiveTopic: string;
  archiveTopicMetaDir: string;
  archiveTopicRunId: string;
  /** 原子写 _meta 下文件（模拟编排器落盘；触发 metaWatch） */
  writeMeta(name: string, text: string): Promise<void>;
}

const SAMPLE_TS = [
  'function sample() {',
  '  const pool = [1, 2];',
  '  const size = pool.length === 1 ? 1 : 2;',
  '  return size;',
  '}',
  '// marker line 6',
  'export const a = 7;',
  'export const b = 8;',
  'export const c = 9;',
  'export const d = 10;',
  'export const e = 11;',
  'export const f = 12;',
  'export const g = 13;',
  'export const h = 14;',
  'export const i = 15;',
  'export const j = 16;',
  'export const k = 17;',
  'export const l = 18;',
  'export const m = 19;',
  'export {};',
].join('\n');

function reviewDoc(critic: string, verdict: string, findings: Array<Record<string, string>>): string {
  return JSON.stringify({ schema: 'trivium.review.v2', verdict, summary: `${critic} 总判断`, findings }, null, 2);
}

function findingOf(id: string, severity: string, location: string, problem: string, evidence: string): Record<string, string> {
  return { id, severity, layer: 'code', kind: 'correctness', location, problem, evidence, suggestion: '修一下', confidence: 'high' };
}

export async function buildPhase2Fixture(): Promise<Phase2Fixture> {
  const { execSync } = await import('node:child_process');
  const root = await fs.mkdtemp(path.join(tmpdir(), 'trivium-p2-fx-'));
  const runRoot = await fs.mkdtemp(path.join(tmpdir(), 'trivium-p2-runs-'));
  const bucket = `${path.basename(root)}-ab12cd34`;
  const run2Id = '20261106T000005Z';
  const run1Id = '20261106T000001Z';
  const run1Dir = path.join(runRoot, bucket, run1Id);

  // 源文件（B0 基线版）：sample.ts / gone.ts / drifting.ts / stale.ts
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'sample.ts'), SAMPLE_TS + '\n');
  await fs.writeFile(path.join(root, 'src', 'gone.ts'), 'gone line1\ngone line2\n');
  await fs.writeFile(path.join(root, 'src', 'drifting.ts'), 'drift base\nline2\n');
  await fs.writeFile(path.join(root, 'src', 'stale.ts'), 'stale base\n');

  // git 基线提交（B0）：被审 base 的冻结身份来源；同时留 .baseline 快照
  // 供测试伪 git API（toGitUri → `${fsPath}.baseline`）读取
  const git = (args: string): string => execSync(`git ${args}`, { cwd: root, encoding: 'utf8' }).trim();
  git('init -q');
  git("config user.email t@t");
  git("config user.name t");
  git('add src/sample.ts src/gone.ts src/drifting.ts src/stale.ts');
  git('commit -q -m baseline');
  const gitSha = git('rev-parse HEAD');
  for (const f of ['sample.ts', 'drifting.ts', 'stale.ts', 'gone.ts']) {
    await fs.copyFile(path.join(root, 'src', f), path.join(root, 'src', `${f}.baseline`));
  }

  // 工作区（送审时点 B1）：sample 第 6 行真实改动（第 3 行锚文本保留）、
  // drifting 改内容、stale 改内容（B1''）、gone 删除、added 新增
  await fs.writeFile(path.join(root, 'src', 'sample.ts'), SAMPLE_TS.replace('// marker line 6', '// marker line 6 (sent)') + '\n');
  await fs.writeFile(path.join(root, 'src', 'drifting.ts'), 'drift sent\nline2\n');
  await fs.writeFile(path.join(root, 'src', 'stale.ts'), 'stale sent\n');
  await fs.rm(path.join(root, 'src', 'gone.ts'));
  await fs.writeFile(path.join(root, 'src', 'added.ts'), 'added content\n');
  git('add -N src/added.ts'); // intent-to-add：让 git diff 包含新增文件

  // .reviews/<主题>/<阶段>/_meta 归档
  const metaDir = path.join(root, '.reviews', 'DemoTopic', 'code', '_meta');
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(
    path.join(metaDir, `review-claude-${run2Id}.json`),
    reviewDoc('claude', 'pass-after-changes', [
      findingOf('C-01', 'blocker', 'src/sample.ts:2-4', '区间问题', '证据一'),
      findingOf('C-02', 'major', 'src/sample.ts:3', '同行问题', '证据二'),
      findingOf('C-03', 'minor', 'src/sample.ts:999', '越界无锚问题', '证据三'),  // 无反引号锚 → out-of-range
      findingOf('C-04', 'nit', 'plan §2.1', '文档引用', '证据四'),               // doc → listOnly
    ]),
  );
  await fs.writeFile(
    path.join(metaDir, `review-gemini-${run2Id}.json`),
    reviewDoc('gemini', 'pass', [
      findingOf('G-01', 'minor', 'src/sample.ts:3', '同层问题', '证据五'),
      findingOf('G-02', 'major', 'src/sample.ts:9999', '越界有锚问题', '确认 `pool.length === 1` 的分支'), // nearby
    ]),
  );
  await fs.writeFile(
    path.join(metaDir, `review-codex-${run2Id}.json`),
    reviewDoc('codex', 'reject', [
      findingOf('X-01', 'nit', 'src/sample.ts:2-3,5-6', '逗号多区间', '证据六'),
      findingOf('X-02', 'minor', 'src/gone-missing.ts:1', '文件缺失', '证据七'),
      findingOf('X-03', 'minor', '../outside.ts:1', '路径越界', '证据八'),
      findingOf('X-04', 'major', 'src/stale.ts:1', '送审后漂移演示', '证据九'),
      findingOf('X-05', 'major', 'src/drifting.ts:1', '送审一致演示', '证据十'),
      findingOf('X-06', 'major', 'src/gone.ts:1', '删除文件 Diff 入口演示', '证据十一'),
    ]),
  );
  await fs.writeFile(
    path.join(metaDir, `run-${run2Id}.json`),
    JSON.stringify({ schema: 'trivium.run.v3', run_id: run2Id, topic: 'DemoTopic', stage: 'code', rerun_index: 1, driver: 'glm', critics_selected: ['claude', 'gemini', 'codex'], started_at: '2026-11-06T00:00:05.000Z', finished_at: '2026-11-06T00:10:00.000Z' }, null, 2),
  );
  // changes.diff：**真实 git diff**（B0 → 工作区 B1）生成——hunks 与基线/工作区
  // 自洽（CLAUDE-02 送审内容重建的前提）；stale.ts 段在生成后使工作区再改（B2''）
  const realDiff = execSync('git diff', { cwd: root, encoding: 'utf8' });
  const diffFileCount = (realDiff.match(/^diff --git /gm) ?? []).length;
  await fs.writeFile(
    path.join(metaDir, `changes-${run2Id}.diff`),
    [
      '# trivium changes.diff',
      `# run_id: ${run2Id}`,
      '# base: HEAD',
      `# head: ${gitSha}`,
      `# files: ${diffFileCount}`,
      ...realDiff.split('\n').map((l) => (l.startsWith('#') ? `#${l}` : l)),
      '',
    ].join('\n'),
  );
  // 送审后工作区再改 stale.ts → 回放时静态一致性 mismatch（CLAUDE-02/03 用例）
  await fs.writeFile(path.join(root, 'src', 'stale.ts'), 'stale now (edited after send)\n');

  // task.json：run2（归档齐全）+ run1（归档缺失 → 探测 run_root）
  await fs.writeFile(
    path.join(root, '.reviews', 'DemoTopic', 'task.json'),
    JSON.stringify({
      schema: 'trivium.task.v1',
      topic: 'DemoTopic',
      created_at: '2026-11-06T00:00:01.000Z',
      updated_at: '2026-11-06T00:10:00.000Z',
      runs: [
        { run_id: run1Id, stage: 'plan', rerun_index: 1, status: 'success', review_mode: 'full', started_at: '2026-11-06T00:00:01.000Z', driver: 'glm' },
        { run_id: run2Id, stage: 'code', rerun_index: 1, status: 'success', review_mode: 'full', started_at: '2026-11-06T00:00:05.000Z', driver: 'glm' },
      ],
      gate: { stage: null, state: 'idle', since: null, run_id: null },
      approvals: [], degradations: [], disputed: false, disputes: [], drivers: { plan: { driver: 'glm' }, code: { driver: 'glm' } },
    }, null, 2),
  );

  // run_root：本仓桶 run1 目录（归档缺失场景的探测目标）+ 他仓撞号桶
  await fs.mkdir(run1Dir, { recursive: true });
  await fs.writeFile(path.join(run1Dir, 'status.json'), JSON.stringify({
    schema: 'trivium.status.v1', run_id: run1Id, topic: 'DemoTopic', stage: 'plan', phase: 'success',
    heartbeat_at: '2026-11-06T00:01:00.000Z', sides: {}, artifacts: [], exit_code: 0, message: null,
  }, null, 2));
  const alienBucket = path.join(runRoot, `OtherRepo-${'zz99'}`);
  await fs.mkdir(path.join(alienBucket, run1Id), { recursive: true });
  await fs.writeFile(path.join(alienBucket, run1Id, 'status.json'), JSON.stringify({ run_id: run1Id, topic: 'OtherTopic' }, null, 2));
  const run2Dir = path.join(runRoot, bucket, run2Id);
  await fs.mkdir(run2Dir, { recursive: true });
  await fs.writeFile(path.join(run2Dir, 'status.json'), JSON.stringify({
    schema: 'trivium.status.v1', run_id: run2Id, topic: 'DemoTopic', stage: 'code', phase: 'success',
    heartbeat_at: '2026-11-06T00:10:00.000Z',
    sides: { claude: { state: 'ok', model: 'stub-m', attempt: 1, elapsed_s: 10, cli: null } },
    artifacts: [], exit_code: 0, message: null,
  }, null, 2));

  // .trivium：驾驶舱发现链最小面（config.run_root + state.json 活跃闸门 + 空桩 wrapper）
  await fs.mkdir(path.join(root, '.trivium', 'bin'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium', 'config.yaml'), [
    'schema: trivium.config.v2',
    'archive_root: .reviews',
    'runtime:',
    `  run_root: ${runRoot}`,
    '',
  ].join('\n'));
  await fs.writeFile(path.join(root, '.trivium', 'bin', 'trivium'), '#!/bin/sh\nexit 64\n', { mode: 0o755 });
  await atomicWrite(path.join(root, '.trivium', 'state.json'), JSON.stringify({
    schema: 'trivium.state.v1',
    updated_at: '2026-11-06T00:10:00.000Z',
    gates: { 'DemoTopic/code': { topic: 'DemoTopic', stage: 'code', state: 'running', run_id: run2Id, since: '2026-11-06T00:00:05.000Z', session_id: null } },
  }, null, 2));

  // 第二主题 ArchiveTopic：纯归档（code 阶段工件齐全、无活跃闸门、run_root 无目录）
  // ——历史回放卡（CLAUDE-04/CODEX-07）与摄取竞态（CODEX-02）用例
  const archiveTopic = 'ArchiveTopic';
  const archiveRunId = '20261106T000003Z';
  const archiveMetaDir = path.join(root, '.reviews', archiveTopic, 'code', '_meta');
  await fs.mkdir(archiveMetaDir, { recursive: true });
  await fs.writeFile(
    path.join(root, '.reviews', archiveTopic, 'task.json'),
    JSON.stringify({
      schema: 'trivium.task.v1', topic: archiveTopic,
      created_at: '2026-11-06T00:00:03.000Z', updated_at: '2026-11-06T00:09:00.000Z',
      runs: [{ run_id: archiveRunId, stage: 'code', rerun_index: 1, status: 'success', review_mode: 'full', started_at: '2026-11-06T00:00:03.000Z', driver: 'claude' }],
      gate: { stage: null, state: 'idle', since: null, run_id: null }, approvals: [], degradations: [], disputed: false, disputes: [], drivers: { code: { driver: 'claude' } },
    }, null, 2),
  );
  await fs.writeFile(
    path.join(archiveMetaDir, `run-${archiveRunId}.json`),
    JSON.stringify({ schema: 'trivium.run.v3', run_id: archiveRunId, topic: archiveTopic, stage: 'code', rerun_index: 1, driver: 'claude', critics_selected: ['gemini'], started_at: '2026-11-06T00:00:03.000Z' }, null, 2),
  );
  await fs.writeFile(
    path.join(archiveMetaDir, `review-gemini-${archiveRunId}.json`),
    reviewDoc('gemini', 'pass', [findingOf('AG2-01', 'minor', 'src/sample.ts:7', '归档主题意见', '归档证据')]),
  );
  await fs.writeFile(
    path.join(archiveMetaDir, `changes-${archiveRunId}.diff`),
    ['', '# trivium changes.diff', `# run_id: ${archiveRunId}`, '# base: HEAD', `# head: ${gitSha}`, '# files: 1', '#   src/sample.ts', ''].join('\n'),
  );

  const writeMeta = async (name: string, text: string): Promise<void> => {
    await atomicWrite(path.join(metaDir, name), text);
  };
  return { root, runRoot, gitSha, run2Id, run1Id, run1Dir, metaDir, archiveTopic, archiveTopicMetaDir: archiveMetaDir, archiveTopicRunId: archiveRunId, writeMeta };
}
