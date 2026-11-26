import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveGlmInteractive } from '../../src/launch/glmInteractive';
import { standaloneCommand, wrappedLauncher } from '../../src/launch/zcodeInstallation';

test('GLM 主攻入口优先级、独立解释器、兼容探针与错误提示', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'GLM paths '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'real package.mjs');
  const wrapper = path.join(root, 'trivium');
  const direct = path.join(root, 'official zcode');
  const shim = path.join(root, 'zcode');
  await writeFile(script, '');
  await writeFile(direct, '#!/bin/sh\n', { mode: 0o755 });
  await writeFile(wrapper, 'exec "' + process.execPath + '" "/a/trivium.cjs" "$@"');
  const provider = {builtin_file: '/builtin', personal_file: '/personal'};
  const cli = {entrypoint: script, version_probe: {runner: 'node'}, provider_config: provider};
  const o = {trusted: true, wrapper, searchDirs: [root], cli};
  const original = JSON.stringify(cli);
  const legacy = await resolveGlmInteractive(o);
  assert.equal(legacy.source, '探针');
  assert.equal(legacy.nodePath, process.execPath);
  assert.equal(legacy.scriptEnv?.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, '/personal');
  await symlink(script, shim);
  const found = await resolveGlmInteractive(o);
  assert.equal(found.source, '自动发现');
  assert.ok(found.entrypoint.endsWith('real package.mjs'));
  assert.equal(found.scriptEnv, undefined);
  assert.deepEqual(await resolveGlmInteractive({...o, configuredPath: direct, configuredNode: '脚本专用'}),
    {source:'设置', entrypoint:direct, launchMode:'direct', waitForStartup:false});
  const explicit = await resolveGlmInteractive({...o, configuredPath:script, configuredNode:process.execPath});
  assert.equal(explicit.nodePath, process.execPath);
  assert.equal(explicit.source, '设置');
  assert.equal(explicit.scriptEnv, undefined);
  for (const bad of ['zcode', root, path.join(root, 'missing')]) {
    await assert.rejects(resolveGlmInteractive({...o, configuredPath:bad}), /glmInteractivePath/);
  }
  if (process.platform !== 'win32') {
    await chmod(direct, 0o644);
    await assert.rejects(resolveGlmInteractive({...o, configuredPath:direct}), /glmInteractivePath/);
  }
  await assert.rejects(resolveGlmInteractive({...o, configuredNode:root}), /glmNodePath/);
  await assert.rejects(resolveGlmInteractive({...o, trusted:false}), /可信/);
  assert.equal(JSON.stringify(cli), original, '驾驶舱解析只读共享探针');

  const runner = path.join(root, 'probe node');
  await symlink(process.execPath, runner);
  const withRunner = {...cli, version_probe:{runner}};
  const fromProbe = await resolveGlmInteractive({...o, cli:withRunner, searchDirs:['', 'relative']});
  assert.equal(fromProbe.nodePath, runner);
  await assert.rejects(resolveGlmInteractive({...o, configuredNode:script}), /glmNodePath/);
  await assert.rejects(resolveGlmInteractive({...o, wrapper:'missing'}), /glmNodePath/);
  await assert.rejects(resolveGlmInteractive({...o, cli:undefined, searchDirs:['', 'relative']}), /未找到/);

  const binDir = path.join(root, '发行包/bin');
  const standalone = path.join(binDir, 'zcode.mjs');
  await mkdir(binDir, {recursive:true});
  await writeFile(standalone, '');
  await writeFile(path.resolve(binDir,'../package.json'), JSON.stringify({name:'zcode-runtime',version:'3.18.2'}));
  const compatible = await resolveGlmInteractive({...o, searchDirs:[], cli:{...cli, entrypoint:standalone}});
  assert.equal(compatible.waitForStartup,true);
  await writeFile(direct, '#!/usr/bin/env sh\nexec node "' + standalone + '" "$@"\n', {mode:0o755});
  await chmod(direct,0o755);
  assert.equal((await resolveGlmInteractive({...o, configuredPath:direct})).waitForStartup,true);
  const desktop = path.join(root, 'ZCode.app/Contents/Resources/glm/zcode.cjs');
  await mkdir(path.dirname(desktop), {recursive:true});
  await writeFile(desktop, 'import("@zcode/tui")');
  await rm(shim);
  await symlink(desktop, shim);
  await assert.rejects(resolveGlmInteractive(o), /缺少 @zcode\/tui/);
  await assert.rejects(resolveGlmInteractive({...o, cli:undefined}), /缺少 @zcode\/tui/);
  await assert.rejects(resolveGlmInteractive({...o, configuredPath:desktop}), /缺少 @zcode\/tui/);
  await mkdir(path.join(path.dirname(desktop), 'node_modules/@zcode/tui'), {recursive:true});
  assert.equal((await resolveGlmInteractive(o)).source, '自动发现');
});

test('wrappedLauncher 与 resolveGlmInteractive 解析含 $HOME / %USERPROFILE% 的包装器', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'trivium-zwrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localBin = path.join(root, '.local/bin');
  const runtimeBin = path.join(root, '.zcode/runtime/current/bin');
  await mkdir(localBin, { recursive: true });
  await mkdir(runtimeBin, { recursive: true });
  const mjs = path.join(runtimeBin, 'zcode.mjs');
  await writeFile(mjs, '');
  await writeFile(path.join(root, '.zcode/runtime/current/package.json'), JSON.stringify({ name: 'zcode-runtime', version: '4.0.0' }));
  const shShim = path.join(localBin, 'zcode');
  const cmdShim = path.join(localBin, 'zcode.cmd');
  await writeFile(shShim, '#!/usr/bin/env sh\nexec node "$HOME/.zcode/runtime/current/bin/zcode.mjs" "$@"\n', { mode: 0o755 });
  await writeFile(cmdShim, '@echo off\r\nnode "%USERPROFILE%\\.zcode\\runtime\\current\\bin\\zcode.mjs" %*\r\n');

  assert.equal(wrappedLauncher(shShim, root), mjs);
  assert.equal(wrappedLauncher(cmdShim, root), mjs);

  if (process.platform === 'win32') {
    assert.equal(standaloneCommand({ home: root }), mjs);
    const wrapper = path.join(root, 'trivium');
    await writeFile(wrapper, `exec "${process.execPath}" "/a/trivium.cjs" "$@"`);
    for (const configuredPath of [shShim, cmdShim]) {
      const resolved = await resolveGlmInteractive({
        trusted: true,
        wrapper,
        home: root,
        searchDirs: [],
        configuredPath,
        configuredNode: process.execPath,
      });
      assert.equal(resolved.launchMode, 'shellCommand');
      assert.equal(resolved.entrypoint, mjs);
      assert.equal(resolved.nodePath, process.execPath);
      assert.equal(resolved.waitForStartup, true);
    }
  }
});
