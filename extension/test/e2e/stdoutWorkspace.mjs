// E1 全部变更只在 makeWorkspace 新建的临时仓内。清洁 HOME 避免替身读取真实凭据。
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { extensionRoot, makeWorkspace, preparePlan } from './workspace.mjs';
import { seedFakeProbes } from '../../../dist/test/test/helpers/fixture.js';
import { READONLY_INVARIANTS } from '../../../dist/test/src/trivium/probes/claude.js';

const q = x => "'" + x.replaceAll("'", "'\\''") + "'";
export async function stdoutWorkspace(base, name, driver, mode, assets = process.env.TRIVIUM_E1_ASSETS || path.join(extensionRoot, '../skills/dual-critic')) {
  const w = await makeWorkspace(base, name, '准备' + name);
  w.topic = '输出验收' + name; w.driver = driver;
  w.critics = ['claude', 'codex', 'gemini', 'glm'].filter(id => id !== driver);
  w.control = path.join(base, name + '-control');
  await fs.mkdir(w.control);
  const dot = path.join(w.root, '.trivium');
  await seedFakeProbes(w.root);
  const localFile = path.join(dot, 'config.local.yaml');
  const local = YAML.parse(await fs.readFile(localFile, 'utf8'));
  const probes = local.probe.cli;
  const driverBin = path.join(dot, 'bin/test-driver');
  const script = fileURLToPath(new URL('./controlledCritic.cjs', import.meta.url));
  const files = {};
  for (const [id, key] of Object.entries({ gemini: 'agy', glm: 'zcode', codex: 'codex', claude: 'claude' })) {
    const file = id === driver ? driverBin : path.join(dot, 'bin', 'fixture-' + key + (id === 'glm' ? '.cjs' : ''));
    if (id !== driver) {
      const code = id === 'glm' ? "process.argv.splice(2, 0, 'glm'); require(" + JSON.stringify(script) + ");\n"
        : '#!/bin/sh\nexec ' + q(process.execPath) + ' ' + q(script) + ' ' + q(id) + ' "$@"\n';
      await fs.writeFile(file, code, { mode: 0o700 });
    }
    files[id] = file;
    probes[key] = { ...probes[key], entrypoint: file, version: '9.9.9', probed_at: new Date().toISOString() };
  }
  Object.assign(probes.claude, { version_probe: { runner: null, args: ['--version'], extract: null },
    readonly_flags: READONLY_INVARIANTS, strict_mcp_config_applied: true, headless_read_ok: true,
    tool_surface_checked: true, path_deny: { supported: false, rule_syntax: null }, json_schema_ok: false });
  local.profiles.default.claude = { plan: 'fixture-model' };
  await fs.writeFile(localFile, YAML.stringify(local));
  const stage = { plan: 0, code: 0, bug: 0 };
  const config = { schema: 'trivium.config.v2', runtime: { run_root: path.join(base, 'runs') },
    review: { default_critics: w.critics, min_tool_calls: stage, min_project_reads: stage },
    agents: { codex: { profile: null, bin: files.codex }, claude: { profile: null, bin: files.claude } } };
  await fs.writeFile(path.join(dot, 'config.yaml'), YAML.stringify(config));
  const home = path.join(base, name + '-home');
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  await fs.writeFile(path.join(home, '.codex/config.toml'), '');
  w.core = await fs.realpath(path.join(assets, 'scripts/trivium.cjs'));
  const coreSha = createHash('sha256').update(await fs.readFile(w.core)).digest('hex');
  const stub = Object.fromEntries(w.critics.map(id => [id, { mode: 'ok', stdout: mode, findings: 0 }]));
  await fs.writeFile(path.join(dot, 'bin/trivium'), [
    '#!/bin/sh', 'export HOME=' + q(home), 'export CODEX_HOME=' + q(path.join(home, '.codex')),
    'export TRIVIUM_ASSET_ROOT=' + q(assets), 'export TRIVIUM_ENTRY_SCAN_HOME=' + q(home),
    'export TRIVIUM_E1_FIXTURE=' + q(w.control),
    ...(mode === 'controlled' ? ['export NODE_OPTIONS=' + q('--require=' + JSON.stringify(fileURLToPath(new URL('./controlledDisk.cjs', import.meta.url))))] : ['export TRIVIUM_E1_METRICS=' + q(w.control),
      'export NODE_OPTIONS=' + q('--require=' + JSON.stringify(fileURLToPath(new URL('./workerMetrics.cjs', import.meta.url))))]),
    mode === 'controlled' ? 'unset TRIVIUM_STUB_CRITIC' : 'export TRIVIUM_STUB_CRITIC=' + q(JSON.stringify(stub)),
    'if [ "$1" = preflight ]; then set -- "$@" --skip-auth-check; fi',
    'exec ' + q(process.execPath) + ' ' + q(w.core) + ' "$@"', '',
  ].join('\n'), { mode: 0o700 });
  await fs.writeFile(path.join(dot, 'scenario.json'), JSON.stringify({ ...w, critics: w.critics.join(',') }));
  await preparePlan(w.root, w.topic, driver);
  const git = (...args) => execFileSync('git', args, { cwd: w.root });
  git('add', '--', '.trivium/config.yaml');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'E1 fixture');
  return { ...w, coreSha };
}
