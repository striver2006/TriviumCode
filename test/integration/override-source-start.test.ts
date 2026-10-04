/**
 * EV-123：`review --start` 按**当轮入选侧**复查副本源，结果随返回值交给 skill。
 *
 * 必须走真实子进程：`--start` 的适配器表来自 `prepareRun` 里的 `resolveAdapters(realAdapters())`，
 * 跨进程注入只有 `TRIVIUM_STUB_CRITIC` 一条通道（r2 双审 CODEX-01 ≡ GLM-04）。
 * 所以桩按注入配置实现 `modelOverrideSource`，全桩运行、零配额。
 * 子进程 HOME 钉到 mkdtemp：路径才能以 `~/` 展示，也不碰开发机真实的副本源。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ASSET_ROOT, BUNDLE, bundleMissing, bundleSkipReason, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { STUB_ENV_VAR, encodeStubConfig, type StubConfig } from '../../src/trivium/adapters/stub.js';
import { run } from '../../src/trivium/util/exec.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '副本源复查';

async function tmpHome(populate: boolean): Promise<string> {
  const home = await fs.realpath(await scratchDir('trivium-ovr-home-'));
  if (populate) {
    await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
    await fs.writeFile(path.join(home, '.zcode/cli/config.json'), '{}\n');
  }
  return home;
}

function cliAt(root: string, home: string, args: string[], stub: StubConfig) {
  return run(process.execPath, [BUNDLE, ...args], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, [STUB_ENV_VAR]: encodeStubConfig(stub), HOME: home },
    timeoutMs: 120_000,
  });
}

/** glm 桩声明自己靠副本做覆盖，副本源取临时 HOME 下的标准位置 */
const stubFor = (home: string): StubConfig => ({
  gemini: { mode: 'ok' },
  glm: { mode: 'ok', modelOverrideSource: path.join(home, '.zcode/cli/config.json') },
});

type StartJson = { run_id: string; warnings?: { name: string; detail: string }[] };

/** 跑 `--start`，再把运行等完、别让 worker 留在后台 */
async function start(populate: boolean, extra: string[] = [], json = true) {
  const fx = await makeFixture({ topic: TOPIC });
  const home = await tmpHome(populate);
  const stub = stubFor(home);
  const args = ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', ...extra, ...(json ? ['--json'] : [])];
  const r = await cliAt(fx.root, home, args, stub);
  assert.equal(r.code, EXIT.OK, `--start 失败：\n${r.stdout}\n${r.stderr}`);
  const runId = json
    ? (JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson).run_id
    : /已启动运行 (\S+)（/.exec(r.stdout)![1]!;
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cliAt(fx.root, home, ['review', '--wait', runId, '--timeout', '20'], stub)).code ?? EXIT.FAIL;
  }
  return { r, home };
}

test('--start：入选侧的副本源不在 ⇒ warnings 恰一项，路径以 ~/ 展示', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { r, home } = await start(false);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson;
  assert.ok(Array.isArray(js.warnings), `warnings 键必须恒在：\n${r.stdout}`);
  assert.equal(js.warnings!.length, 1, JSON.stringify(js.warnings));
  const [w] = js.warnings!;
  assert.match(w!.name, /模型覆盖副本源$/);
  assert.ok(w!.detail.includes('~/.zcode/cli/config.json'), w!.detail);
  assert.ok(!w!.detail.includes(home), '不得带出 HOME 的绝对路径');
});

test('--start：副本源在 ⇒ warnings 为空数组（键仍在）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { r } = await start(true);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson;
  assert.deepEqual(js.warnings, []);
});

test('--start：按当轮入选侧查——没选 glm 就不出项，即使它的副本源不在', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { r } = await start(false, ['--critics', 'gemini']);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson;
  assert.deepEqual(js.warnings, []);
});

test('--start 人读输出：副本源不在时打印警告行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { r } = await start(false, [], false);
  assert.match(r.stdout, /^ {2}⚠️ glm 侧做模型覆盖要读的副本源 ~\/\.zcode\/cli\/config\.json 不在/m, r.stdout);
});
