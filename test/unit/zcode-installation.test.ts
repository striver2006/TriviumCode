import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { scratchDir } from '../helpers/scratch.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { probeReadonlyFlags, probeZcode, probeZcodeEntry } from '../../src/trivium/probes/zcode.js';
import { zcodeAdapter, zcodeHomeEnv, zcodeProviderConfigPaths } from '../../src/trivium/adapters/zcode.js';
import { reviewEntry, standaloneCommand, standalonePackage } from '../../extension/src/launch/zcodeInstallation.js';

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

test('含 $HOME / %USERPROFILE% 的包装器在 standalonePackage 与 reviewEntry 中可定位 runtime 包', async () => {
  const root = await fs.realpath(await scratchDir('trivium-zwrap-core-'));
  const localBin = path.join(root, '.local/bin');
  const runtimeRoot = path.join(root, '.zcode/runtime/current');
  const mjs = path.join(runtimeRoot, 'bin/zcode.mjs');
  const cjs = path.join(runtimeRoot, 'agent/zcode.cjs');
  await fs.mkdir(localBin, { recursive: true });
  await fs.mkdir(path.dirname(mjs), { recursive: true });
  await fs.mkdir(path.dirname(cjs), { recursive: true });
  await fs.writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify({ name: 'zcode-runtime', version: '4.0.0' }));
  await fs.writeFile(mjs, '');
  await fs.writeFile(cjs, agent);

  const shShim = path.join(localBin, 'zcode');
  const cmdShim = path.join(localBin, 'zcode.cmd');
  await fs.writeFile(shShim, '#!/usr/bin/env sh\nexec node "$HOME/.zcode/runtime/current/bin/zcode.mjs" "$@"\n', { mode: 0o755 });
  await fs.writeFile(cmdShim, '@echo off\r\nnode "%USERPROFILE%\\.zcode\\runtime\\current\\bin\\zcode.mjs" %*\r\n');

  assert.deepEqual(standalonePackage(shShim, root), { root: runtimeRoot, version: '4.0.0' });
  assert.deepEqual(standalonePackage(cmdShim, root), { root: runtimeRoot, version: '4.0.0' });
  assert.equal(reviewEntry(null, { home: root, searchDirs: [], desktopEntries: [] }), cjs);
});

test('zcodeHomeEnv 与 probeReadonlyFlags 在 win32 下同步隔离 USERPROFILE 并保持零配额停点', async () => {
  const iso = zcodeHomeEnv('/tmp/ziso');
  assert.equal(iso.HOME, '/tmp/ziso');
  if (process.platform === 'win32') {
    assert.equal(iso.USERPROFILE, '/tmp/ziso');
    assert.equal('HOMEDRIVE' in iso && iso.HOMEDRIVE, undefined);
    assert.equal('HOMEPATH' in iso && iso.HOMEPATH, undefined);
  }

  const root = await fs.realpath(await scratchDir('trivium-zhome-iso-'));
  const fakeEntry = path.join(root, 'fake-zcode.cjs');
  const realHome = os.homedir();
  await fs.writeFile(
    fakeEntry,
    [
      'const os = require("node:os");',
      'const env = process.env;',
      'const argv = process.argv.slice(2);',
      `const realHome = ${JSON.stringify(realHome)};`,
      'if (!env.HOME || env.HOME === realHome) { process.stderr.write("HOME not isolated\\n"); process.exit(2); }',
      'if (process.platform === "win32" && (env.USERPROFILE !== env.HOME || env.USERPROFILE === realHome || os.homedir() !== env.HOME)) {',
      '  process.stderr.write("USERPROFILE not isolated\\n"); process.exit(2);',
      '}',
      'for (const f of ["--max-turns", "--settings"]) {',
      '  if (argv.includes(f)) { process.stderr.write("Unknown option \'" + f + "\'.\\n"); process.exit(1); }',
      '}',
      'process.stderr.write("Error: Select a model before sending a message (traceId: fake)\\n");',
      'process.exit(1);',
    ].join('\n'),
  );

  const res = await probeReadonlyFlags(fakeEntry, process.execPath, root);
  assert.deepEqual(res.zeroExit, []);
  assert.deepEqual(res.indeterminate, []);
  assert.ok(res.accepted.includes('--mode plan'));
  assert.ok(res.accepted.includes('--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash'));
  assert.ok(res.rejected.includes('--max-turns 40'));
  assert.ok(res.rejected.includes('--settings /nonexistent-probe-settings.json'));
});
