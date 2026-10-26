/** 真子进程只运行本地假CLI；不使用厂商身份或配额。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { scratchDir } from '../helpers/scratch.js';
import { ASSET_ROOT } from '../helpers/fixture.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { buildDenySettings, claudeAdapter, claudeDirectoryFingerprint, claudeSensitiveGlobsHash,
  CLAUDE_DIRECTORY_SHAPE } from '../../src/trivium/adapters/claude.js';
import { resolveClaudeRoute } from '../../src/trivium/adapters/claude-route.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import type { CriticRequest } from '../../src/trivium/types.js';

// WIN_FILE_SKIP（Windows 移植）：shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）');
} else {

test('生产适配器大集合经过目录投影实际递入argv/stdin；失败出口仍有投影与规模', async () => {
  const root = await scratchDir('trivium-directory-adapter-');
  const capture = path.join(root, 'capture.json');
  const bin = path.join(root, 'fake-cli');
  await fs.writeFile(bin, `#!${process.execPath}\n` + [
    'const fs=require("node:fs");let stdin="";process.stdin.on("data",x=>stdin+=x);',
    'process.stdin.on("end",()=>{const argv=process.argv.slice(2);',
    `fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({argv,stdin}));`,
    'const model=argv[argv.indexOf("--model")+1];',
    'console.log(JSON.stringify({type:"system",subtype:"init",model,tools:["Read","Grep","Glob"],cwd:process.cwd()}));',
    'if(model==="timeout"){setInterval(()=>{},1000);return;}if(model==="failure"){process.exit(1);}',
    'console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:JSON.stringify({schema:"trivium.review.v1",verdict:"approve",summary:"stub",findings:[]})}));});',
  ].join('\n'), { mode: 0o700 });
  const cfg = defaultConfig();
  const agent = cfg.agents.claude; assert.ok(agent?.vendor === 'anthropic'); agent.bin = bin;
  const probe = cfg.probe.cli.claude!;
  Object.assign(probe, { entrypoint: bin, version: 'stub/0.0.0', probed_at: new Date().toISOString(), readonly_flags: [...READONLY_INVARIANTS],
    json_schema_ok: true, path_deny: { supported: true, rule_syntax: 'Read(./evidence/ascii_root/nested/deep/calls/**)', file_shape_verified: true },
    directory_deny_verified: { Read: true, Grep: true, Glob: true }, directory_deny_probed_at: new Date().toISOString() });
  cfg.review.sensitive_globs = ['evidence/ascii_root/nested/deep/calls/**'];
  probe.directory_deny_sensitive_globs_sha256 = claudeSensitiveGlobsHash(cfg.review.sensitive_globs);
  probe.directory_deny_shape = CLAUDE_DIRECTORY_SHAPE;
  probe.directory_deny_fingerprint = await claudeDirectoryFingerprint(resolveClaudeRoute(cfg, null, probe.version), probe.version);
  const deny = Array.from({ length: 4000 }, (_, i) => `evidence/ascii_root/nested/deep/calls/archive-${i}/长文件名-${i}.json`);
  assert.ok(buildDenySettings(deny, ['Read', 'Grep', 'Glob'], { sampleTool: 'Read', relPrefix: './' }).bytes > 1048576);
  const req: CriticRequest = { run_id: 'stub', topic: 'directory', stage: 'code', critic: 'claude', project_root: root,
    subject_path: path.join(root, 'subject'), deny_paths: deny, out_dir: path.join(root, 'success'), brief_path: '/unused', brief_text: '完整BRIEF经stdin',
    model: 'stub/0.0.0', timeout_s: 10, schema_path: path.join(ASSET_ROOT, 'schema/review.v1.json'),
    min_tool_calls: 0, min_project_reads: 0, profile_requested: null, tier: null, tier_source: null };
  for (const model of ['stub/0.0.0', 'failure', 'timeout']) {
    const outDir = path.join(root, model.replaceAll('/', '-'));
    const result = await claudeAdapter.run({ cfg, nodePath: process.execPath }, { ...req, model, out_dir: outDir, timeout_s: model === 'timeout' ? 0.15 : 10 });
    const captured = JSON.parse(await fs.readFile(capture, 'utf8'));
    assert.equal(captured.stdin, req.brief_text);
    const settings = captured.argv[captured.argv.indexOf('--settings') + 1];
    assert.ok(JSON.parse(settings).permissions.deny.includes('Read(./evidence/ascii_root/nested/deep/calls/**)'));
    assert.equal(result.deny_bytes, Buffer.byteLength(settings, 'utf8'));
    assert.equal(result.deny_rule_count, 6);
    const trace = JSON.parse(await fs.readFile(path.join(outDir, 'trace.json'), 'utf8'));
    assert.deepEqual(trace.denySettings.projection.compressedTools, ['Read', 'Grep', 'Glob']);
    assert.equal(trace.denySettings.projection.originalCount, deny.length);
    // AC-20 回读留痕（EV-258）：三键恒在；该假 CLI 不吐 assistant 事件，没有回报值可比
    assert.deepEqual(Object.keys(trace.modelReadback).sort(), ['consistent', 'init', 'reported']);
    if (model === 'stub/0.0.0') {
      assert.deepEqual(trace.modelReadback, { init: 'stub/0.0.0', reported: [], consistent: null });
      assert.equal(result.model_effective, trace.modelReadback.init, 'trace.json 的 init 须与回读的生效模型一致');
    }
    assert.equal(result.process_started, true);
    if (model !== 'stub/0.0.0') assert.equal(result.peer_deny_applied, false);
  }
  await fs.chmod(bin, 0o600);
  const result = await claudeAdapter.run({ cfg, nodePath: process.execPath }, { ...req, out_dir: path.join(root, 'spawn-failure') });
  assert.equal(result.process_started, false);
  assert.equal(result.peer_deny_applied, false);
  assert.equal(result.deny_rule_count, 6);
  const spawnFailureTrace = JSON.parse(await fs.readFile(path.join(root, 'spawn-failure/trace.json'), 'utf8'));
  assert.equal(spawnFailureTrace.denySettings.ruleCount, 6);
  // 入口不可执行时 run 层返回 spawned:false、走正常落盘路径：事件流为空，留痕三键都是「没有」
  assert.deepEqual(spawnFailureTrace.modelReadback, { init: null, reported: [], consistent: null });
  await fs.chmod(bin, 0o700);
  probe.directory_deny_shape = 'ascii-root1-4-depth0-2-v1';
  const oldShapeOut = path.join(root, 'old-v1-shape');
  const oldShape = await claudeAdapter.run({ cfg, nodePath: process.execPath }, { ...req, deny_paths: [deny[0]!], out_dir: oldShapeOut });
  assert.equal(oldShape.process_started, true);
  const oldShapeTrace = JSON.parse(await fs.readFile(path.join(oldShapeOut, 'trace.json'), 'utf8'));
  assert.deepEqual(oldShapeTrace.denySettings.projection.compressedTools, []);
  assert.equal(oldShapeTrace.denySettings.directoryGuard.observedFingerprint, null);
  probe.directory_deny_shape = CLAUDE_DIRECTORY_SHAPE;
  cfg.review.sensitive_globs.push('other/**');
  const changedOut = path.join(root, 'project-config-changed');
  const changed = await claudeAdapter.run({ cfg, nodePath: process.execPath }, { ...req, deny_paths: [deny[0]!], out_dir: changedOut });
  assert.equal(changed.process_started, true);
  const changedTrace = JSON.parse(await fs.readFile(path.join(changedOut, 'trace.json'), 'utf8'));
  assert.deepEqual(changedTrace.denySettings.projection.compressedTools, []);
  assert.deepEqual(changedTrace.denySettings.directoryGuard.consumed, {});
  assert.equal(changedTrace.denySettings.directoryGuard.observedFingerprint, null);
  assert.ok(changedTrace.denySettings.directoryGuard.recordedProjectHash !== changedTrace.denySettings.directoryGuard.observedProjectHash);
});

}
