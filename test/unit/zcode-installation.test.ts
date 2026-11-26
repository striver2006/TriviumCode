import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { scratchDir } from '../helpers/scratch.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { probeZcode, probeZcodeEntry } from '../../src/trivium/probes/zcode.js';
import { zcodeAdapter, zcodeProviderConfigPaths } from '../../src/trivium/adapters/zcode.js';
import { reviewEntry, standaloneCommand } from '../../extension/src/launch/zcodeInstallation.js';

const version = '0.18.0';
const agent = "if(process.argv[2]==='version') console.log('Agent 0.18.0'); else {console.error('无法判定能力'); process.exitCode=2;}";

test('独立包、桌面包、并存与显式入口按实际文件选择', async () => {
  const root = await fs.realpath(await scratchDir('trivium-zinstall-'));
  const pkg = path.join(root, '有 空格的独立包');
  const standalone = path.join(pkg, 'agent/zcode.cjs');
  const launcher = path.join(pkg, 'bin/zcode.mjs');
  const desktop = path.join(root, 'ZCode.app/Contents/Resources/glm/zcode.cjs');
  const search = { home: root, searchDirs: [], desktopEntries: [desktop] };
  assert.equal(reviewEntry(null, search), undefined);
  await fs.mkdir(path.dirname(desktop), { recursive: true });
  await fs.writeFile(desktop, agent);
  assert.equal(reviewEntry(null, search), desktop);
  assert.equal(standaloneCommand(search), undefined);
  const install = path.join(root, '.zcode/runtime/current/bin/zcode.mjs');
  await fs.mkdir(path.dirname(install), { recursive: true });
  await fs.mkdir(path.dirname(standalone), { recursive: true });
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'zcode-runtime', version: '9.8.7' }));
  await fs.writeFile(launcher, '');
  await fs.writeFile(standalone, agent);
  await fs.symlink(launcher, install, 'file');
  assert.equal(standaloneCommand(search), install);
  assert.equal(reviewEntry(null, search), standalone);
  assert.equal(reviewEntry(null, { ...search, desktopEntries: [] }), standalone);
  assert.deepEqual(await probeZcodeEntry(null, process.execPath, search), { entry: standalone, version });
  assert.equal(reviewEntry(desktop, search), desktop);
  assert.equal(reviewEntry(launcher, search), launcher);
  for (const entry of [launcher, standalone]) {
    assert.equal((await zcodeProviderConfigPaths(entry)).builtin, path.join(pkg, 'agent/provider/zcode-builtin.json'));
  }
  assert.match((await zcodeProviderConfigPaths(desktop)).builtin, /config[/\\]provider[/\\]zcode-builtin.json$/);
  const missing = path.join(root, '指定但不存在.cjs');
  assert.ok((await probeZcodeEntry(missing, process.execPath, search)).error?.includes(missing));
  await fs.writeFile(standalone, "console.error('broken installation'); process.exit(3)");
  const failed = await probeZcodeEntry(null, process.execPath, search);
  assert.equal(failed.entry, standalone);
  assert.match(failed.error!, /broken installation/);
  await fs.unlink(standalone);
  assert.throws(() => reviewEntry(null, search), /agent[/\\]zcode.cjs/);
});

test('同 Agent 版本切换入口再做静态 doctor，旧的能力、模型与路径结论全部失效', async () => {
  const root = await fs.realpath(await scratchDir('trivium-zswitch-'));
  const a = path.join(root, '旧.cjs'), b = path.join(root, '新.cjs');
  for (const entry of [a, b]) await fs.writeFile(entry, agent);
  const cfg = defaultConfig();
  cfg.agents.glm = { vendor: 'zcode', entry: b };
  const old = cfg.probe.cli.zcode!;
  Object.assign(old, { entrypoint: a, version, probed_at: new Date().toISOString(), response_field: 'response',
    readonly_flags: ['--disallowed-tools Write'], model_override: 'config_copy', model_id_form: 'previous/model',
    runtime_selection: 'honored', scratch_paths: ['before'], path_deny: { ...old.path_deny, supported: true } });
  const ctx = { cfg, nodePath: process.execPath };
  const stale = zcodeAdapter.availability(ctx);
  assert.equal(stale.ok, false);
  assert.ok(stale.reason?.includes(a) && stale.reason.includes(b));
  const { probe } = await probeZcode(b, process.execPath, { existing: old, skipModelCalls: true, cliConfigPath: path.join(root, 'missing') });
  assert.equal(probe.version, old.version);
  assert.equal(probe.entrypoint, b);
  assert.equal(probe.response_field, null);
  assert.equal(probe.model_id_form, null);
  assert.equal(probe.model_override, null);
  assert.equal(probe.runtime_selection ?? null, null);
  assert.equal(probe.path_deny.supported, null);
  assert.deepEqual(probe.scratch_paths, []);
  assert.deepEqual(probe.readonly_flags, []);
  cfg.probe.cli.zcode = probe;
  assert.equal(zcodeAdapter.availability(ctx).ok, false);
});

test('显式可执行启动器直接执行并定位包装目标的 provider', { skip: process.platform === 'win32' }, async () => {
  const root = await fs.realpath(await scratchDir('trivium-zshim-'));
  const bin = path.join(root, 'bin'), exe = path.join(root, 'zcode');
  const mjs = path.join(bin, 'zcode.mjs');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"zcode-runtime","version":"8.0.1"}');
  await fs.writeFile(mjs, agent);
  await fs.writeFile(exe, '#!/bin/sh\nexec "' + process.execPath + '" "' + mjs + '" "$@"\n', { mode: 0o755 });
  // 故意给不存在的审核 Node。直接启动器自行选择解释器。
  const result = await probeZcodeEntry(exe, '/missing-node');
  assert.deepEqual(result, { entry: exe, version });
  assert.equal((await zcodeProviderConfigPaths(exe)).builtin, path.join(root, 'agent/provider/zcode-builtin.json'));
});
