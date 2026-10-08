/**
 * config v1 内存迁移的**告警通道与次数**（设计 17.2「config v1 输入 → 内存迁移」一行、13.1.1 方框；BACKLOG EV-233）。
 *
 * 迁移本身与行为等价由 `test/unit/config-migrate.test.ts` 守着；这里只钉那一行剩下的三点：
 * 告警走 stderr、每次 CLI 调用恰一条、`--json` 的 stdout 仍只有单个 JSON。
 * 三点只在真实进程里才看得见——同一条命令若多加载一次配置、或告警改走 stdout，
 * 单元层调 `loadCtx` 测不出来，而 skill 读 `--json` 输出的协议会当场坏掉。所以走打包产物。
 *
 * 两个源都是 v1 时仍只一条（`loadConfig` 合并成一条，审查意见 GLM-07）；v2 基线零条，
 * 免得「恰一条」的计数在文案改了之后变成恒假的空转。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, seedFakeProbes } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { CONFIG_SCHEMA_ID_V1 } from '../../src/trivium/config.js';

const TOPIC = '迁移告警通道';
/** `loadConfig` 告警头的固定前缀（只有 config schema 一类迁移时） */
const HEAD = `检测到 ${CONFIG_SCHEMA_ID_V1} 形态的配置`;

const count = (s: string, needle: string): number => s.split(needle).length - 1;

/** 把夹具的共享配置改成 v1 形态：带 v1 schema 标识与旧名 `critics` 段，其余键不动 */
async function sharedToV1(root: string): Promise<string> {
  const p = path.join(root, '.trivium', 'config.yaml');
  const body = await fs.readFile(p, 'utf8');
  await fs.writeFile(
    p,
    [`schema: ${CONFIG_SCHEMA_ID_V1}`, body.trimEnd(), 'critics:', '  gemini:', '    vendor: antigravity', '  glm:', '    vendor: zcode', ''].join('\n'),
    'utf8',
  );
  return p;
}

/** 本机层写一个 v1 覆盖片段（无 schema 键，靠旧名 `allow_single_flag` 识别为 v1） */
async function localToV1(root: string): Promise<string> {
  const p = path.join(root, '.trivium', 'config.local.yaml');
  await fs.writeFile(p, ['review:', '  allow_single_flag: true', ''].join('\n'), 'utf8');
  return p;
}

const resolveArgs = ['topic', 'resolve', '--stage', 'plan', '--json', '--', '做个功能', '--topic', TOPIC, '--focus', 'x'];
const preflightArgs = ['preflight', '--stage', 'plan', '--critics', 'gemini', '--skip-auth-check', '--json'];

/** stdout 整体就是一个 JSON：不经候选抽取，直接整段解析 */
function assertSingleJson(stdout: string): void {
  assert.doesNotThrow(() => JSON.parse(stdout), `stdout 应只有单个 JSON，实际：\n${stdout}`);
  assert.equal(count(stdout, HEAD), 0, '迁移告警不得出现在 stdout');
}

test('M1 共享配置是 v1：topic resolve --json 的 stderr 恰一条迁移告警，stdout 只有单个 JSON', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const shared = await sharedToV1(fx.root);
  const r = await cli(fx.root, resolveArgs);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  assertSingleJson(r.stdout);
  assert.equal(count(r.stderr, HEAD), 1, r.stderr);
  assert.ok(r.stderr.includes(shared), `告警应点名共享配置文件：\n${r.stderr}`);
});

test('M2 共享与本机两层都是 v1：仍只一条告警、两个文件都点名（topic resolve 与 preflight 各一次）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const shared = await sharedToV1(fx.root);
  const local = await localToV1(fx.root);
  // 预检要探针结论：seedFakeProbes 保留本机层已有的键，只写 probe 段
  await seedFakeProbes(fx.root);

  for (const args of [resolveArgs, preflightArgs]) {
    const r = await cli(fx.root, args, null, 180_000);
    const label = args.slice(0, 2).join(' ');
    assert.equal(r.code, EXIT.OK, `${label}：\n${r.stdout}${r.stderr}`);
    assertSingleJson(r.stdout);
    assert.equal(count(r.stderr, HEAD), 1, `${label}：\n${r.stderr}`);
    assert.ok(r.stderr.includes(shared) && r.stderr.includes(local), `${label}：两个源应合并在同一条告警里：\n${r.stderr}`);
  }
});

test('M3 基线：v2 配置不出迁移告警（守住 M1 / M2 的计数不是空转）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const r = await cli(fx.root, resolveArgs);
  assert.equal(r.code, EXIT.OK, r.stdout + r.stderr);
  assertSingleJson(r.stdout);
  assert.equal(count(r.stderr, HEAD), 0, r.stderr);
  assert.equal(count(r.stderr, '已在内存中'), 0, r.stderr);
});
