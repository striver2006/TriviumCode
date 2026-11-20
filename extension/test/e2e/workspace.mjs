// 夹具共用真实编排器和核心预检探针夹具。所有运行、VS Code 配置、归档均在临时目录。
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { seedFakeProbes } from '../../../dist/test/test/helpers/fixture.js';

export const extensionRoot = fileURLToPath(new URL('../../', import.meta.url));
const assets = path.resolve(extensionRoot, '../skills/dual-critic');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export async function makeWorkspace(base, name, topic, realDriver = null, slowTimeout = false) {
  const root = path.join(base, name);
  const dot = path.join(root, '.trivium');
  await fs.mkdir(path.join(dot, 'bin'), { recursive: true });
  const driverId = realDriver?.id ?? 'claude';
  const focus = realDriver ? '核对 README 计划。先回复 P4ACK 后紧接 437 加 38 的结果。只用本夹具的 .trivium/bin/trivium 和桩审核者，到人工审批前停止。' : '检查说明文件';
  await fs.writeFile(path.join(dot, 'scenario.json'), JSON.stringify({ topic, focus }));
  await fs.writeFile(path.join(dot, 'config.yaml'), YAML.stringify({
    schema: 'trivium.config.v2', runtime: { run_root: path.join(base, 'runs') },
    review: { default_critics: ['gemini', 'glm'] },
    agents: { codex: { profile: null } },
  }));
  await seedFakeProbes(root);
  const local = path.join(dot, 'config.local.yaml');
  const config = YAML.parse(await fs.readFile(local, 'utf8'));
  delete config.probe.cli.codex;
  const driver = path.join(dot, 'bin', 'test-driver');
  config.probe.cli.claude = {
    entrypoint: driver, version: '9.9.9', probed_at: new Date().toISOString(),
    version_probe: { runner: null, args: ['--version'], extract: null },
  };
  if (realDriver) {
    const key = { claude: 'claude', codex: 'codex', gemini: 'agy', glm: 'zcode' }[driverId];
    config.probe.cli[key] = { ...config.probe.cli[key], ...realDriver.probe };
  }
  await fs.writeFile(local, YAML.stringify(config));
  await fs.writeFile(driver, '#!/bin/sh\nif [ "$1" = --version ]; then echo 9.9.9; exit 0; fi\nexec ' +
    quote(process.execPath) + ' ' + quote(path.resolve(extensionRoot, 'test/e2e/driver.cjs')) + '\n', { mode: 0o755 });
  const critics = Object.fromEntries(['gemini', 'glm', 'claude', 'codex'].map(id => [id, { mode: 'ok', findings: 1 }]));
  if (slowTimeout) critics.gemini = { mode: 'hang_cli', sleepS: 12 };
  const stub = JSON.stringify(critics);
  await fs.writeFile(path.join(dot, 'bin/trivium'), [
    '#!/bin/sh', 'export TRIVIUM_ASSET_ROOT=' + quote(assets), 'export TRIVIUM_STUB_CRITIC=' + quote(stub),
    'export TRIVIUM_ENTRY_SCAN_HOME=' + quote(base),
    // 模拟审核者没有真实账号。预检保留其余真实检查，显式跳过厂商凭据探活。
    'if [ "$1" = preflight ]; then set -- "$@" --skip-auth-check; fi',
    'exec "' + process.execPath + '" "' + path.join(assets, 'scripts/trivium.cjs') + '" "$@"', '',
  ].join('\n'), { mode: 0o755 });
  await fs.writeFile(path.join(dot, 'state.json'), JSON.stringify({ schema: 'trivium.state.v1', gates: {} }));
  await fs.writeFile(path.join(root, 'README.md'), '# 临时验收工作区\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.trivium/start.json\n.trivium/relay.txt\n.trivium/state.json\n.trivium/lock/\n');
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '-q');
  git('add', '--', 'README.md', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  await preparePlan(root, topic, driverId);
  return { root, topic, focus };
}

// 在已信任的同一夹具中可为下一次真机采样准备新主题，保留原运行与闸门。
export async function preparePlan(root, topic, driverId) {
  execFileSync(path.join(root, '.trivium/bin/trivium'), ['topic', 'claim', '--topic', topic, '--stage', 'plan', '--driver', driverId, '--json'], { cwd: root });
  const plan = path.join(root, '.reviews', topic, 'plan');
  await fs.mkdir(plan, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(plan, date + '-' + topic + '-' + driverId + '.md'), '# 确认 README 中的验收说明\n', { flag: 'wx' });
}
