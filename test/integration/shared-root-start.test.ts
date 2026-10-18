/**
 * `review --start` 的告警复查补上共享读取面一项（EV-246，计划 r2 §2.2、§2.3 U6）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。扫描家目录经 `TRIVIUM_ENTRY_SCAN_HOME` 指到本文件自己的夹具：
 * 摆了同名入口的「脏」家目录与空家目录各一份。口径与预检 ④⁵ 同一个函数：只看当轮 Driver ∪ 入选审核者里
 * 登记了额外读取根的家；只告警、不阻断；结尾的场合词是「本次运行」。共享根没有问题时 warnings 与此前逐项相同。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today, type Fixture } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { AGENTS, DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { ENTRY_SCAN_HOME_ENV } from '../../src/trivium/entry-collisions.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const NAME = '共享读取面同名入口';

type Warning = { name: string; detail: string };
type StartJson = { run_id: string; worker_pid?: number; warnings: Warning[] };
const parse = <T>(stdout: string): T => JSON.parse(extractJsonCandidate(stdout)!.json) as T;

/** 读共享根的家与不读的家（由注册表派生，不写死 id） */
const READERS = AGENTS.filter((a) => a.entrySkillExtraReadRoots.length > 0).map((a) => a.id);
const NON_READERS = AGENTS.filter((a) => a.entrySkillExtraReadRoots.length === 0).map((a) => a.id);
const SHARED_REL = AGENTS.find((a) => a.entrySkillExtraReadRoots.length > 0)!.entrySkillExtraReadRoots[0]!;

/** 一个摆了别家同名入口的扫描家目录 */
async function dirtyHome(): Promise<string> {
  const home = await scratchDir('trivium-start-escan-dirty-');
  await fs.mkdir(path.join(home, SHARED_REL, 'dual-approve'), { recursive: true });
  await fs.writeFile(path.join(home, SHARED_REL, 'dual-approve/SKILL.md'), '---\nname: dual-approve\n---\n别家的\n');
  return home;
}

const startArgs = (topic: string, ...extra: string[]) =>
  ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', ...extra];

/** `--start` 之后把运行等到终态，别让 worker 留在后台 */
async function finish(fx: Fixture, runId: string): Promise<void> {
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], STUB)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${runId} 没有成功收尾（退 ${code}）`);
}

async function startJson(fx: Fixture, topic: string, home: string, ...extra: string[]): Promise<StartJson> {
  const r = await cli(fx.root, [...startArgs(topic, ...extra), '--json'], STUB, 120_000, { [ENTRY_SCAN_HOME_ENV]: home });
  assert.equal(r.code, EXIT.OK, `--start 失败：\n${r.stdout}\n${r.stderr}`);
  const js = parse<StartJson>(r.stdout);
  await finish(fx, js.run_id);
  return js;
}

test('S1 脏家目录 + 缺省入选（含读共享根的家）⇒ 恰一项「共享读取面同名入口」，结尾是「本次运行」，worker 照常拉起', { skip }, async () => {
  assert.ok(READERS.length > 0 && NON_READERS.length > 0, '注册表里要同时有读与不读共享根的家');
  const topic = 'srs-default';
  const fx = await makeFixture({ topic });
  const js = await startJson(fx, topic, await dirtyHome());
  assert.equal(typeof js.worker_pid, 'number', '只告警、不阻断');
  assert.equal(js.warnings.length, 1, JSON.stringify(js.warnings));
  const [w] = js.warnings;
  assert.equal(w!.name, NAME);
  assert.ok(w!.detail.startsWith(`⚠️ 共享读取面 ~/${SHARED_REL} 有 1 个同名入口，本轮的 `), w!.detail);
  assert.ok(w!.detail.endsWith('跑 doctor 看完整清单与出口（不影响本次运行）'), w!.detail);
  assert.ok(!w!.detail.includes('预检'), '--start 里不该说「不影响本次预检」');
});

test('S2 人读模式：同一行照样打印', { skip }, async () => {
  const topic = 'srs-human';
  const fx = await makeFixture({ topic });
  const r = await cli(fx.root, startArgs(topic), STUB, 120_000, { [ENTRY_SCAN_HOME_ENV]: await dirtyHome() });
  assert.equal(r.code, EXIT.OK, `${r.stdout}\n${r.stderr}`);
  const runId = /已启动运行 (\S+)（/.exec(r.stdout)![1]!;
  assert.match(r.stdout, /\n {2}⚠️ 共享读取面 .*（不影响本次运行）\n/);
  await finish(fx, runId);
});

test('S3 只看本轮相关的家：Driver 与入选审核者都不读共享根 ⇒ 脏家目录也不出这一项', { skip }, async () => {
  assert.ok(!READERS.includes(DEFAULT_DRIVER), '本格前提：缺省 Driver 不读共享根');
  const critic = NON_READERS.find((id) => id !== DEFAULT_DRIVER && id in STUB)!;
  assert.ok(critic, '要有一家不读共享根、又有桩的审核者');
  const topic = 'srs-irrelevant';
  const fx = await makeFixture({ topic });
  const js = await startJson(fx, topic, await dirtyHome(), '--critics', critic);
  assert.deepEqual(js.warnings, []);
});

test('S4 Driver 读共享根、入选审核者都不读 ⇒ 仍出这一项（口径含当轮 Driver）', { skip }, async () => {
  const driver = READERS.find((id) => id in STUB)!;
  const critic = NON_READERS.find((id) => id !== driver && id in STUB)!;
  assert.ok(driver && critic, '要有一家读共享根的 Driver 与一家不读的审核者');
  const topic = 'srs-driver';
  const fx = await makeFixture({ topic });
  // 换了 Driver 就要补一份它的原稿（被审对象按当轮 Driver 的后缀定位）
  await fs.writeFile(path.join(fx.stageDir, `${today()}-${topic}-${driver}.md`), '# 待审计划\n\n换 Driver 的原稿。\n');
  const js = await startJson(fx, topic, await dirtyHome(), '--driver', driver, '--critics', critic);
  assert.deepEqual(js.warnings.map((w) => w.name), [NAME], JSON.stringify(js.warnings));
});

test('S5 空家目录 ⇒ warnings 为空数组（与改前逐项相同）', { skip }, async () => {
  const topic = 'srs-clean';
  const fx = await makeFixture({ topic });
  const js = await startJson(fx, topic, await scratchDir('trivium-start-escan-clean-'));
  assert.deepEqual(js.warnings, []);
});

/** 一份 glm 侧审查件：对 gemini 侧是禁读（对端审查件），用来造出「必读清单剔除」一项（照 mustread-deny A1 的夹具） */
async function writePeerReview(abs: string, topic: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(
    abs,
    ['---', 'schema: trivium.review.v1', `topic: ${topic}`, 'stage: plan', 'role: glm', 'verdict: approve', '---', '', '# 审查', ''].join('\n'),
  );
}

test('S6 位置：与失联阈值、必读清单剔除同时出现时，排在复查项之后、剔除条目之前', { skip }, async () => {
  const topic = 'srs-order';
  const fx = await makeFixture({ topic, draft: false, extraReview: ['heartbeat_stale_s: 2'] });
  await fs.appendFile(path.join(fx.root, '.trivium/config.yaml'), 'archive_root: doc/reviews\n');
  const stageDir = path.join(fx.root, 'doc/reviews', topic, 'plan');
  const peer = `doc/reviews/${topic}/plan/${today()}-${topic}-glm.md`;
  await writePeerReview(path.join(fx.root, peer), topic);
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-claude.md`), `# 待审计划\n\n参考 ${peer} 与 src/a.ts。\n`);

  const r = await cli(fx.root, [...startArgs(topic), '--json'], STUB, 120_000, { [ENTRY_SCAN_HOME_ENV]: await dirtyHome() });
  assert.equal(r.code, EXIT.OK, `${r.stdout}\n${r.stderr}`);
  const js = parse<StartJson>(r.stdout);
  // 2 s 阈值下 --wait 会判失联：不等，直接 --cancel 收尾（照 heartbeat-threshold-warning 的做法）
  const c = await cli(fx.root, ['review', '--cancel', js.run_id], STUB);
  assert.equal(c.code, EXIT.OK, `${c.stdout}\n${c.stderr}`);
  assert.deepEqual(js.warnings.map((w) => w.name), ['失联阈值', NAME, '必读清单剔除'], JSON.stringify(js.warnings));
});
