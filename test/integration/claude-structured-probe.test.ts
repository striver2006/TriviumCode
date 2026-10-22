/**
 * `probeClaude` 结构化臂端到端：真起假二进制，覆盖 EV-74 计划 §5 用例 1/2/2b。
 *
 * ## 为什么要真起子进程
 *
 * `probeClaude` 此前**零端到端覆盖**（现状表第 8 行：`test/` 下无任何用例 import 它）——
 * 只有它内部复用的 `judge*` 纯函数被单测锁住。`judgeJsonSchema` 的七格互斥已经在
 * `test/unit/claude-events.test.ts` 里用纯函数输入直接断言过；本文件要补的是
 * **纯函数断不到的那一段**：`probeClaude` 真的从注入的资产根读到了契约文件、
 * 把它原样递给 CLI，以及资产根缺失时那一次调用**真的没有发生**——
 * 这几条只有真起子进程、录下真实 argv 才能证实。
 *
 * ## 假二进制怎么定行为
 *
 * `-p` 调用一律按「跑通、吐一句话」处理，**除非**这次调用带 `--json-schema`——
 * 那才是我们关心的结构化臂，行为由 `FAKE_CLAUDE_STRUCTURED_MODE` 决定
 * （`success` / `reject` / `parse-fail` / `missing-key`）。其余各臂（读能力、
 * verbose 负对照、breach、path-deny、EV-44 记忆探测）全部生效于「通用成功响应」
 * （`FAKE_CLAUDE_READ_MODE` 可整体切到失败，见「正对照」用例），
 * 本文件不断言它们的结论，只要求它们不崩溃、不把整个 `probeClaude` 拖挂。
 *
 * 每次 `-p` 调用都往 `FAKE_CLAUDE_ARGV_LOG` 追加一行 JSON，记录本次 argv 是否带
 * `--json-schema` 及其值——这是判别力的唯一来源：伪 bin 不做任何语义解释，
 * 断言全部落在「记录到的调用形态」上。
 *
 * ## 这个装置**不**模拟的形态（代码双审 CODEX-07，如实登记而非留白）
 *
 * 「通用成功响应」对**不带 `--verbose` 的 `stream-json` 调用**也回退 0 + 有事件，
 * 而真实 CLI 在这个形态上是当场拒绝（退 1、零事件、零 API 调用——M0/EV-40 实测，
 * `buildClaudeArgs` 因此无条件硬编码 `--verbose`）。后果是这个装置里
 * `probeStreamVerboseBinding` 的负对照会落 `false`（「厂商已解除绑定」），与真实
 * CLI 相反。本文件不断言 `stream_json_requires_verbose`，所以不受影响；但如果
 * 后来者想拿这个装置去断言它（例如扩展 §5 用例 7 的 `runDoctor` 层测试），
 * 需要先给假二进制补上这条形态，**不能假设「不断言」等于「结论仍然可信」**。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { probeClaude } from '../../src/trivium/probes/claude.js';
import { resolveReviewSchemaPath, defaultConfig, persistProbe, loadCtx } from '../../src/trivium/config.js';
import { runDoctor } from '../../src/trivium/doctor.js';
import { probeClaudeDirectories } from '../../src/trivium/probes/claude-directory.js';
import { ProbeFixtureError } from '../../src/trivium/probes/fixture.js';
import { LaunchBudgetExceeded } from '../../src/trivium/util/exec.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';
import { ASSET_ROOT } from '../helpers/fixture.js';

// doctor / preflight 的共享读取面扫描读空夹具，不读真实家目录（EV-240，计划双审 CODEX-01 / GLM-01）
isolateEntryScanHome();

let work = '';
let fakeBin = '';
let argvLog = '';

before(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-claude-structured-'));

  const script = path.join(work, 'fake-claude.cjs');
  await fs.writeFile(
    script,
    [
      "const fs = require('node:fs');",
      '',
      'const argv = process.argv.slice(2);',
      '',
      "if (argv.includes('--version')) {",
      "  process.stdout.write('9.9.9 (Fake Claude)\\n');",
      '  process.exit(0);',
      '}',
      '',
      'const logPath = process.env.FAKE_CLAUDE_ARGV_LOG;',
      "const hasJsonSchema = argv.includes('--json-schema');",
      "const schemaIdx = argv.indexOf('--json-schema');",
      'const jsonSchemaValue = schemaIdx >= 0 ? argv[schemaIdx + 1] : null;',
      '',
      'function emit(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }',
      '',
      'function finishGeneric() {',
      "  if (process.env.FAKE_CLAUDE_READ_MODE === 'fail') {",
      "    process.stderr.write('error: generic call rejected\\n');",
      '    process.exit(1);',
      '  }',
      "  emit({ type: 'system', subtype: 'init', tools: ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });",
      "  emit({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.001, session_id: 'fake-session' });",
      '  process.exit(0);',
      '}',
      '',
      'process.stdin.resume();',
      "process.stdin.on('end', () => {",
      '  if (logPath) {',
      '    fs.appendFileSync(logPath, JSON.stringify({ hasJsonSchema, jsonSchemaValue }) + "\\n");',
      '  }',
      '  if (!hasJsonSchema) { finishGeneric(); return; }',
      "  const mode = process.env.FAKE_CLAUDE_STRUCTURED_MODE || 'success';",
      "  if (mode === 'reject') {",
      "    process.stderr.write('error: schema rejected by CLI\\n');",
      '    process.exit(1);',
      '  }',
      "  emit({ type: 'system', subtype: 'init', tools: ['Read', 'Grep', 'Glob', 'StructuredOutput'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });",
      "  let text;",
      "  if (mode === 'parse-fail') text = 'not json';",
      "  else if (mode === 'missing-key') text = JSON.stringify({ other: 1 });",
      "  else text = JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'fake summary', findings: [] });",
      "  emit({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.001, session_id: 'fake-session' });",
      '  process.exit(0);',
      '});',
      '',
    ].join('\n'),
  );
  fakeBin = path.join(work, 'claude');
  // **`"$@"` 不能漏**：探针的结构化臂判据要读 argv 里的 `--json-schema`，
  // 缺了参数透传，子进程收到的 argv 永远是空数组（本文件调通前实测踩过一次）。
  await fs.writeFile(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
});

after(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

beforeEach(async () => {
  argvLog = path.join(work, `argv-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env['FAKE_CLAUDE_ARGV_LOG'] = argvLog;
  // 默认通用调用一律成功；需要「读探针失败」场景的用例自己显式覆盖
  process.env['FAKE_CLAUDE_READ_MODE'] = 'ok';
});

async function structuredCalls(): Promise<{ hasJsonSchema: boolean; jsonSchemaValue: string | null }[]> {
  let raw: string;
  try {
    raw = await fs.readFile(argvLog, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { hasJsonSchema: boolean; jsonSchemaValue: string | null });
}

test('用例 1：结构化臂经 readSchemaJson 取 schema——argv 里的内容取自注入路径下的文件', async () => {
  const assetRoot = await fs.mkdtemp(path.join(work, 'asset-'));
  const schemaPath = resolveReviewSchemaPath(assetRoot);
  await fs.mkdir(path.dirname(schemaPath), { recursive: true });
  const marker = `probe1-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(
    schemaPath,
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      'x-test-marker': marker,
    }),
  );

  process.env['FAKE_CLAUDE_STRUCTURED_MODE'] = 'success';
  const { probe } = await probeClaude(fakeBin, { assetRoot });

  const calls = (await structuredCalls()).filter((c) => c.hasJsonSchema);
  assert.equal(calls.length, 1, '结构化臂应当只调用一次');
  const sent = JSON.parse(calls[0]!.jsonSchemaValue!) as Record<string, unknown>;
  assert.equal(sent['x-test-marker'], marker, 'argv 里送出的 schema 内容必须取自注入路径下的文件，不是自己另造一份');
  assert.equal('$schema' in sent, false, 'readSchemaJson 必须剥掉顶层 $schema（stripMetaSchemaRef）');
  assert.equal(probe.json_schema_ok, true);
});

test('用例 2：资产根缺失——字段为 null，notes 含未安装说明且含指路句，结构化臂那一次调用未发生', async () => {
  const missingAssetRoot = await fs.mkdtemp(path.join(work, 'missing-'));
  // 不在这个目录下放 schema/review.v1.json：模拟未安装 dual-critic skill

  const { probe, notes, structuredArmCause } = await probeClaude(fakeBin, { assetRoot: missingAssetRoot });

  assert.equal(probe.json_schema_ok, null);
  assert.equal(structuredArmCause, 'asset-root-missing');
  const note = notes.find((n) => n.includes('未找到审查契约文件'));
  assert.ok(note, `应有一条指出契约文件未找到的 note，实际 notes：${JSON.stringify(notes)}`);
  assert.match(note!, /TRIVIUM_ASSET_ROOT|安装/, 'note 必须含指路句（装哪个 skill / 设哪个环境变量）');

  const calls = (await structuredCalls()).filter((c) => c.hasJsonSchema);
  assert.equal(calls.length, 0, '资产根缺失时结构化臂的那一次调用不应当发生');
});

test('用例 2b：资产根存在（正向对照）——进入实际探测且不产生未安装 note', async () => {
  const assetRoot = await fs.mkdtemp(path.join(work, 'asset-ok-'));
  const schemaPath = resolveReviewSchemaPath(assetRoot);
  await fs.mkdir(path.dirname(schemaPath), { recursive: true });
  await fs.writeFile(schemaPath, JSON.stringify({ type: 'object' }));

  process.env['FAKE_CLAUDE_STRUCTURED_MODE'] = 'success';
  const { probe, notes, structuredArmCause } = await probeClaude(fakeBin, { assetRoot });

  const note = notes.find((n) => n.includes('未找到审查契约文件'));
  assert.equal(note, undefined, '资产根存在时不应产生未安装 note');
  assert.equal(structuredArmCause, 'ok');
  assert.equal(probe.json_schema_ok, true);

  const calls = (await structuredCalls()).filter((c) => c.hasJsonSchema);
  assert.equal(calls.length, 1, '资产根存在时结构化臂应当真的被调用');
});

test('结构化臂三态经真实子进程可达：干净拒绝 ⇒ false/clean-reject，缺键 ⇒ null/model-noncompliant', async () => {
  const assetRoot = await fs.mkdtemp(path.join(work, 'asset-tri-'));
  const schemaPath = resolveReviewSchemaPath(assetRoot);
  await fs.mkdir(path.dirname(schemaPath), { recursive: true });
  await fs.writeFile(schemaPath, JSON.stringify({ type: 'object' }));

  process.env['FAKE_CLAUDE_STRUCTURED_MODE'] = 'reject';
  const rejected = await probeClaude(fakeBin, { assetRoot });
  assert.equal(rejected.probe.json_schema_ok, false);
  assert.equal(rejected.structuredArmCause, 'clean-reject');

  argvLog = path.join(work, `argv-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env['FAKE_CLAUDE_ARGV_LOG'] = argvLog;
  process.env['FAKE_CLAUDE_STRUCTURED_MODE'] = 'missing-key';
  const noncompliant = await probeClaude(fakeBin, { assetRoot });
  assert.equal(noncompliant.probe.json_schema_ok, null);
  assert.equal(noncompliant.structuredArmCause, 'model-noncompliant');
});

test('正对照真的取自读探针的 completed，不是恒真常量（代码双审 CODEX-05）', async () => {
  /*
   * 前面几条用例里读探针（第一次通用调用）恒成功，于是把 probeClaude 里
   * `positiveControlOk: read.completed` 悄悄改成 `positiveControlOk: true`
   * 这类恒真表达式，全部用例仍会绿——判别力缺口正是代码双审 CODEX-05 指出的。
   * 这里让**读探针本身**失败（非 --json-schema 的调用一律退 1 零事件），
   * 而结构化臂自己的调用若被隔离评估会是 success（completed=true、可 parse）。
   * 只有真的读了 `read.completed` 而不是常量，结构化臂才会因正对照不成立
   * 落 null/not-completed；接成恒真常量时这里会得到 true/ok，测试就会红。
   */
  const assetRoot = await fs.mkdtemp(path.join(work, 'asset-pc-'));
  const schemaPath = resolveReviewSchemaPath(assetRoot);
  await fs.mkdir(path.dirname(schemaPath), { recursive: true });
  await fs.writeFile(schemaPath, JSON.stringify({ type: 'object' }));

  process.env['FAKE_CLAUDE_READ_MODE'] = 'fail';
  process.env['FAKE_CLAUDE_STRUCTURED_MODE'] = 'success';
  const { probe, structuredArmCause } = await probeClaude(fakeBin, { assetRoot });

  assert.equal(probe.json_schema_ok, null, '读探针没跑通时，结构化臂的正对照门必须挡住结论');
  assert.equal(structuredArmCause, 'not-completed');

  // 结构化臂那次调用仍然真的发生了（正对照门在 judgeJsonSchema 内部判定，不是跳过调用）
  const calls = (await structuredCalls()).filter((c) => c.hasJsonSchema);
  assert.equal(calls.length, 1, '正对照不成立不代表调用没发生，只代表结论记未测');
});


test('doctor目录后置预期失败不丢主probe：真实假CLI、持久化及重新读取', async () => {
  process.env['FAKE_CLAUDE_STRUCTURED_MODE'] = 'success';
  /*
   * runDoctor 按 resolveAssetRoot() 取契约文件：不钉住就读全局安装副本，安装副本落后于仓库时
   * （EV-247 升 review.v2 后、重装之前）结构化臂整格落 asset-root-missing。钉到仓库内资产根，结论只看本仓构建。
   */
  const prevAssetRoot = process.env['TRIVIUM_ASSET_ROOT'];
  process.env['TRIVIUM_ASSET_ROOT'] = ASSET_ROOT;
  try {
    const cfg = defaultConfig();
    const agent = cfg.agents.claude; assert.ok(agent?.vendor === 'anthropic'); agent.bin = fakeBin;
    let directoryCalls = 0;
    for (const fail of ['create', 'populate', 'append', 'budget', 'caller']) {
      const projectRoot = await scratchDir('trivium-doctor-directory-');
      const triviumDir = path.join(projectRoot, '.trivium'); await fs.mkdir(triviumDir);
      const report = await runDoctor({ projectRoot, triviumDir, config: cfg, only: 'claude', probeBins: { claude: fakeBin },
        modelOverrides: { claude: 'stub/0.0.0' }, claudeDirectoryProbe: async input => {
          directoryCalls++;
          assert.equal(input.cfg.review.sensitive_globs, cfg.review.sensitive_globs);
          if (fail === 'caller') throw Object.assign(Error('expected-route-read'), { code: 'EACCES' });
          return probeClaudeDirectories({ ...input,
            ...(fail === 'create' ? { fixtureFactory: async () => { throw new ProbeFixtureError('main', Error('expected-create'), null); } } : {}),
            ...(fail === 'populate' ? { schemaPath: '/missing-schema-for-directory-probe' } : {}),
            invoke: async () => {
              if (fail === 'budget') throw new LaunchBudgetExceeded({ limit: 0, used: 0, launches: [], exhausted: true });
              throw Object.assign(Error('expected-append'), { code: 'EACCES' });
            },
          });
        } });
      const p = report.probe.cli.claude!;
      assert.equal(p.version, '9.9.9'); assert.equal(p.json_schema_ok, true);
      assert.deepEqual(p.directory_deny_verified, {});
      assert.equal(p.directory_deny_fingerprint, null); assert.equal(p.directory_deny_probed_at, null);
      assert.equal(p.directory_deny_sensitive_globs_sha256, null); assert.equal(p.directory_deny_shape, null);
      assert.ok(report.directoryEvidence?.failure); assert.equal(report.directoryEvidence?.cleanup, null);
      await persistProbe(triviumDir, report.probe);
      const reloaded = await loadCtx({ cwd: projectRoot, allowUninitialized: true });
      assert.equal(reloaded.config.probe.cli.claude?.json_schema_ok, true);
      assert.deepEqual(reloaded.config.probe.cli.claude?.directory_deny_verified, {});
    }
    assert.equal(directoryCalls, 5);
    const unknownRoot = await scratchDir('trivium-doctor-directory-internal-');
    const unknownDir = path.join(unknownRoot, '.trivium'); await fs.mkdir(unknownDir);
    await assert.rejects(runDoctor({ projectRoot: unknownRoot, triviumDir: unknownDir, config: cfg,
      only: 'claude', probeBins: { claude: fakeBin }, modelOverrides: { claude: 'stub/0.0.0' },
      claudeDirectoryProbe: async () => { throw new TypeError('undefined-internal-error'); } }), TypeError);
  } finally {
    if (prevAssetRoot === undefined) delete process.env['TRIVIUM_ASSET_ROOT'];
    else process.env['TRIVIUM_ASSET_ROOT'] = prevAssetRoot;
  }
});
