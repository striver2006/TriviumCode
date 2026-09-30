/**
 * EV-112：审查运行的 CLI 产物落点（计划 `.reviews/EV-112-无副本审查运行载体落点/plan/` r3 §6.1 U3 / U3b / U4 / U6 / U8）。
 *
 * 假入口**按 ZCode 0.16.9 包内取值链**落盘（计划 r3 §1.2）：
 *   - 日志：`ZCODE_LOG_DIR ?? $HOME/.zcode/cli/log`（日志工厂直读环境）；
 *   - rollout / artifacts / workflow：`(ZCODE_STORAGE_DIR ?? $HOME/.zcode)/cli/…`（存储根，经配置层）；
 *   - 会话库：`ZCODE_SESSION_DB_PATH ?? $HOME/.zcode/cli/db/db.sqlite`。
 * `FAKE_CARRIER_MODE` 模拟厂商漂移：`follow` 全采纳；`half` 只认日志键；`store` 只认存储键（代码双审 r1 CODEX-01 那一格）；
 * `ignore` 三键都不认；`none` 什么都不写；`split` 全采纳但启动事件写在前一天的日志文件里（跨午夜，代码双审 r1 CODEX-02）。
 *
 * 测试进程的 `HOME` 钉到临时用户目录（与 zcode-model-selection 同一惯例）：`os.homedir()` 在 POSIX 下读 `$HOME`，
 * 于是「真实 HOME」在用例里就是这个临时目录，反向核与回读退回真实 HOME（变异 M4）都在它上面现形。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  checkZcodeCarriers,
  zcodeAdapter,
  zcodeHomeUnder,
  ZCODE_PERSONAL_PROVIDER_ENV,
} from '../../src/trivium/adapters/zcode.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { readScrubSentinel, scrubSideDir } from '../../src/trivium/scrub.js';
import type { CriticResult } from '../../src/trivium/types.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev112-'));
const SID = 'sess_ev112';
const FAKE_MODEL = 'p/fake-model';
const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join('');

const CARRIER_ENTRY = `
const fs = require('node:fs'), path = require('node:path');
const env = process.env, sid = ${JSON.stringify(SID)};
const mode = env.FAKE_CARRIER_MODE || 'follow';
const homeZ = path.join(env.HOME, '.zcode');
const useLog = mode === 'follow' || mode === 'half' || mode === 'split';
const useStore = mode === 'follow' || mode === 'store' || mode === 'split';
const logDir = useLog && env.ZCODE_LOG_DIR ? env.ZCODE_LOG_DIR : path.join(homeZ, 'cli', 'log');
const storage = useStore && env.ZCODE_STORAGE_DIR ? env.ZCODE_STORAGE_DIR : homeZ;
const db = useStore && env.ZCODE_SESSION_DB_PATH ? env.ZCODE_SESSION_DB_PATH : path.join(homeZ, 'cli', 'db', 'db.sqlite');
const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
if (mode === 'split') {
  // 跨午夜：启动事件（带 context.model）在前一天的文件里，后一天的文件只有别的事件
  put(path.join(logDir, 'zcode-2026-09-24.jsonl'),
    JSON.stringify({ sessionId: sid, event: 'bootstrap.app.startup.runtime_config.completed', context: { model: ${JSON.stringify(FAKE_MODEL)} } }) + '\\n');
  put(path.join(logDir, 'zcode-2026-09-25.jsonl'), JSON.stringify({ sessionId: sid, event: 'turn.completed' }) + '\\n');
} else if (mode !== 'none') {
  put(path.join(logDir, 'zcode-2026-09-25.jsonl'),
    JSON.stringify({ sessionId: sid, event: 'bootstrap.app.startup.runtime_config.completed', context: { model: ${JSON.stringify(FAKE_MODEL)} } }) + '\\n');
}
if (mode !== 'none') {
  put(path.join(storage, 'cli', 'rollout', 'model-io-' + sid + '.jsonl'), '{}\\n');
  put(path.join(storage, 'cli', 'artifacts', sid, 'x.json'), '{}');
  put(path.join(storage, 'cli', 'sessions', sid, 'workflows', 'w.js'), '// wf');
  put(db, 'SQLite format 3');
}
process.stdout.write(JSON.stringify({
  sessionId: sid,
  response: JSON.stringify({ home: env.HOME ?? null, personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null }),
  usage: {}, eventCount: 1,
}) + '\\n');
process.exit(0);
`;

/** 五个载体相对 `.zcode/cli` 的路径（计划 r3 §1.3） */
const CARRIERS = [
  'log/zcode-2026-09-25.jsonl',
  `rollout/model-io-${SID}.jsonl`,
  `artifacts/${SID}/x.json`,
  `sessions/${SID}/workflows/w.js`,
  'db/db.sqlite',
];

const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function runReview(opts: {
  model: string | null;
  withCliConfig: boolean;
  mode: 'follow' | 'half' | 'store' | 'ignore' | 'none' | 'split';
  decoy?: boolean;
}) {
  const root = await tmp();
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, CARRIER_ENTRY, 'utf8');
  await fs.mkdir(path.join(root, 'Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(root, 'Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');

  const userHome = await tmp();
  if (opts.withCliConfig) {
    await fs.mkdir(path.join(userHome, '.zcode/cli'), { recursive: true });
    await fs.writeFile(
      path.join(userHome, '.zcode/cli/config.json'),
      JSON.stringify({ provider: { p: { source: 'custom', models: { 'fake-model': {} } } }, model: { main: FAKE_MODEL } }),
      { encoding: 'utf8', mode: 0o600 },
    );
  }
  // 个人配置在：无副本支照旧注入它（C3 不变）
  await fs.mkdir(path.join(userHome, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(userHome, '.zcode/v2/provider_config.json'), '{}', 'utf8');
  if (opts.decoy) {
    // 诱饵：真实 HOME 下同一 sessionId 的日志与 rollout。回读若退回真实 HOME 就会把它读回来
    const cli = path.join(userHome, '.zcode/cli');
    await fs.mkdir(path.join(cli, 'log'), { recursive: true });
    const decoyLog = path.join(cli, 'log/zcode-decoy.jsonl');
    await fs.writeFile(decoyLog, JSON.stringify({ sessionId: SID, event: 'x', context: { model: 'decoy/model' } }) + '\n');
    // 诱饵日志是「拉起前就在」的历史文件：反向核只扫拉起后改过的文件，它不得被记成本次泄漏
    const hourAgo = new Date(Date.now() - 3_600_000);
    await fs.utimes(decoyLog, hourAgo, hourAgo);
    await fs.mkdir(path.join(cli, 'rollout'), { recursive: true });
    await fs.writeFile(path.join(cli, `rollout/model-io-${SID}.jsonl`), '{}\n');
  }

  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.probed_at = new Date().toISOString();
  cfg.probe.cli.zcode!.entrypoint = entry;
  cfg.probe.cli.zcode!.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit,Bash'];
  cfg.probe.cli.zcode!.response_field = 'response';
  const runDir = await tmp();
  const sideDir = path.join(runDir, 'glm');
  const req = {
    run_id: 'r', topic: 't', stage: 'code' as const, critic: 'glm' as const,
    project_root: root, subject_path: path.join(root, 's.md'), deny_paths: [],
    out_dir: path.join(sideDir, 'out'), brief_path: path.join(root, 'b.md'), brief_text: 'ok',
    model: opts.model, timeout_s: 20, schema_path: path.join(root, 'schema.json'),
    min_tool_calls: 0, min_project_reads: 0, profile_requested: null,
  };
  const saved = { HOME: process.env['HOME'], FAKE_CARRIER_MODE: process.env['FAKE_CARRIER_MODE'] };
  process.env['HOME'] = userHome;
  process.env['FAKE_CARRIER_MODE'] = opts.mode;
  try {
    const result = await zcodeAdapter.run({ cfg, nodePath: process.execPath }, req as never);
    return { result, userHome, sideDir };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function assertLandedInRunDir(sideDir: string, userHome: string) {
  const landed = path.join(zcodeHomeUnder(sideDir), '.zcode/cli');
  for (const rel of CARRIERS) assert.ok(await exists(path.join(landed, rel)), `应落在运行目录：${rel}`);
  for (const rel of CARRIERS) assert.equal(await exists(path.join(userHome, '.zcode/cli', rel)), false, `不得落在真实 HOME：${rel}`);
}

test('U3 无副本·未指定模型：五个载体落进运行目录、真实 HOME 下一个没有；HOME 与个人键照旧；回读读运行目录；自检全 true', async () => {
  const { result, userHome, sideDir } = await runReview({ model: null, withCliConfig: true, mode: 'follow' });
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  const seen = JSON.parse(result.raw_response_text ?? '{}') as Record<string, string | null>;
  assert.equal(seen['home'], userHome, '无副本支不改 HOME');
  assert.equal(seen['personal'], path.join(userHome, '.zcode/v2/provider_config.json'), '无副本支照旧注入个人配置（C3）');
  await assertLandedInRunDir(sideDir, userHome);
  assert.equal(result.model_route, 'global');
  assert.equal('model_override_applied' in result, false, '没有覆盖尝试，字段缺席');
  assert.equal('model_unenforced' in result, false, '没指定模型 ⇒ 无从对照，EV-122 的字段同样缺席');
  assert.equal(result.model_effective, FAKE_MODEL, '生效模型从运行目录的日志读回');
  assert.deepEqual(result.carriers_landed, { log: true, rollout: true, leaked_to_home: { log: false, rollout: false } });
  assert.ok(await exists(path.join(sideDir, 'out', 'rollout.jsonl')), 'rollout 另拷一份进 out_dir');
});

test('U3b 无副本·CLI 什么都没写、真实 HOME 有同一会话的诱饵：回读不碰真实 HOME，自检两项 false、反向核看见泄漏', async () => {
  const { result, sideDir } = await runReview({ model: null, withCliConfig: true, mode: 'none', decoy: true });
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.equal(result.model_effective, null, '诱饵被读回 ⇒ 回读退回了真实 HOME（变异 M4）');
  assert.equal(await exists(path.join(sideDir, 'out', 'rollout.jsonl')), false);
  // 诱饵 rollout 在真实 HOME 的位置 ⇒ rollout 泄漏为 true；诱饵日志是拉起前的历史文件 ⇒ 日志泄漏为 false（扫描面按修改时间限定）
  assert.deepEqual(result.carriers_landed, { log: false, rollout: false, leaked_to_home: { log: false, rollout: true } });
});

test('U4 无副本·副本源缺失（指定了模型）：与 U3 同样落进运行目录', async () => {
  const { result, userHome, sideDir } = await runReview({ model: 'fake-model', withCliConfig: false, mode: 'follow' });
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.equal(result.model_route, 'global');
  await assertLandedInRunDir(sideDir, userHome);
  assert.deepEqual(result.carriers_landed, { log: true, rollout: true, leaked_to_home: { log: false, rollout: false } });
  // 请求 fake-model、回读 p/fake-model：modelId 段相同 ⇒ EV-122 的字段不产出
  assert.equal('model_unenforced' in result, false);
});

test('EV-122 无副本·副本源缺失、回读到的模型与请求不同 ⇒ model_unenforced 产出，requested 是请求原值、cause 为 source_missing', async () => {
  // E2 现场的形态：请求 GLM-5.3，CLI 跑在个人配置默认的模型上（这里是假入口写的 p/fake-model）
  const { result } = await runReview({ model: 'GLM-5.3', withCliConfig: false, mode: 'follow' });
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.equal(result.model_route, 'global');
  assert.equal('model_override_applied' in result, false, '两格互斥');
  // requested 若取 home.qualified（本支恒 null），字段恒缺席（变异 N7）；run() 不接线同样红（变异 N4）
  assert.equal(result.model_unenforced?.requested, 'GLM-5.3');
  assert.equal(result.model_unenforced?.effective, FAKE_MODEL);
  assert.equal(result.model_unenforced?.cause, 'source_missing');
});

test('U6 清扫衔接：无副本支落进运行目录的日志里夹带凭据形态 ⇒ scrubSideDir 就地脱敏并记进哨兵', async () => {
  const { sideDir } = await runReview({ model: null, withCliConfig: true, mode: 'follow' });
  const logFile = path.join(zcodeHomeUnder(sideDir), '.zcode/cli/log/zcode-2026-09-25.jsonl');
  // 计算属性键：fixture-credentials 扫描器按字面形态认密钥赋值，这里是夹具
  await fs.appendFile(logFile, JSON.stringify({ sessionId: SID, text: `experimental_bearer_token = "${FAKE_CRED}"` }) + '\n');
  const out = await scrubSideDir(zcodeAdapter, sideDir, { force: true });
  assert.equal((await fs.readFile(logFile, 'utf8')).includes(FAKE_CRED), false, '落进清扫面 ⇒ 被脱敏');
  const sentinel = await readScrubSentinel(sideDir);
  const rel = path.join('home', '.zcode/cli/log/zcode-2026-09-25.jsonl');
  assert.ok((out.logs_redacted[rel] ?? 0) > 0, `脱敏记录要点名这份日志：${JSON.stringify(out.logs_redacted)}`);
  assert.ok((sentinel?.logs_redacted[rel] ?? 0) > 0, '哨兵里同样记着');
});

test('U8 厂商漂移·三键都不认：产物全回真实 HOME ⇒ 自检两项 false、反向核两项都看见泄漏', async () => {
  const { result } = await runReview({ model: null, withCliConfig: true, mode: 'ignore' });
  assert.deepEqual(result.carriers_landed, { log: false, rollout: false, leaked_to_home: { log: true, rollout: true } });
});

test('U8 厂商漂移·只认日志键（半采纳）：日志进运行目录、rollout 回真实 HOME ⇒ 合取判得出来（变异 M11）', async () => {
  const { result } = await runReview({ model: null, withCliConfig: true, mode: 'half' });
  assert.deepEqual(result.carriers_landed, { log: true, rollout: false, leaked_to_home: { log: false, rollout: true } });
  // 半采纳时生效模型照样读得回：「model_effective 变 null」不是可靠的间接症状（计划 r3 §4.6）
  assert.equal(result.model_effective, FAKE_MODEL);
});

test('U8 厂商漂移·只认存储键（镜像半采纳）：rollout 进运行目录、日志回真实 HOME ⇒ 反向核的日志一项看得见（代码双审 r1 CODEX-01 ≡ GLM-01，变异 M14）', async () => {
  const { result } = await runReview({ model: null, withCliConfig: true, mode: 'store' });
  assert.deepEqual(result.carriers_landed, { log: false, rollout: true, leaked_to_home: { log: true, rollout: false } });
});

test('跨午夜：启动事件在前一天的日志文件里 ⇒ 回读照样读到生效模型，与自检同一个文件集合（代码双审 r1 CODEX-02，变异 M15）', async () => {
  const { result } = await runReview({ model: null, withCliConfig: true, mode: 'split' });
  assert.equal(result.status, 'ok', result.fail_reason ?? '');
  assert.equal(result.model_effective, FAKE_MODEL, '只读最新一个文件会读不到前一天的启动事件');
  assert.deepEqual(result.carriers_landed, { log: true, rollout: true, leaked_to_home: { log: false, rollout: false } });
});

test('checkZcodeCarriers：查全部日志文件（不只最新一个）；副本支（realHome 为 null）不出 leaked_to_home 键', async () => {
  const cli = path.join(await tmp(), '.zcode/cli');
  await fs.mkdir(path.join(cli, 'log'), { recursive: true });
  // 本次会话的行在较早的文件里，较晚的文件属于别的会话（跨午夜形态）
  await fs.writeFile(path.join(cli, 'log/zcode-2026-09-24.jsonl'), JSON.stringify({ sessionId: SID, event: 'x' }) + '\n');
  await fs.writeFile(path.join(cli, 'log/zcode-2026-09-25.jsonl'), JSON.stringify({ sessionId: 'sess_other', event: 'x' }) + '\n');
  assert.deepEqual(await checkZcodeCarriers(cli, SID, null), { log: true, rollout: false });
  // 只是字面出现 sessionId、行里的 sessionId 字段不是它，不算
  await fs.writeFile(path.join(cli, 'log/zcode-2026-09-24.jsonl'), JSON.stringify({ sessionId: 'sess_other', note: SID }) + '\n');
  assert.deepEqual(await checkZcodeCarriers(cli, SID, null), { log: false, rollout: false });
});

// ── 守卫：落点自检的播报（计划 r3 §4.6）──

async function verdictWith(carriers: CriticResult['carriers_landed']) {
  const { judgeSide } = await import('../../src/trivium/guard.js');
  const { failedResult, TOOL_TRACE_CAPABILITY } = await import('../../src/trivium/adapters/base.js');
  const base = failedResult('glm', { status: 'failed', reason: '夹具' });
  const result = carriers === undefined ? base : { ...base, carriers_landed: carriers };
  const req = {
    critic: 'glm' as const, stage: 'code' as const, model: 'GLM-5.3', effort: null,
    brief_text: '', brief_path: '/proj/b.md', subject_path: '/proj/s.md',
    project_root: '/proj', out_dir: '/tmp/out', timeout_s: 60,
    min_tool_calls: 0, min_project_reads: 0, deny_paths: [],
  };
  return judgeSide(defaultConfig(), 'glm', result, null, req as never, {
    degraded: [],
    archiveRootAbs: '/proj/.reviews', projectRoot: '/proj',
    triviumDir: '/proj/.trivium', runRoot: '/tmp/runs',
    capability: TOOL_TRACE_CAPABILITY,
  });
}

async function warningsWith(carriers: CriticResult['carriers_landed']): Promise<string[]> {
  const { renderGuardWarnings } = await import('../../src/trivium/guard.js');
  return renderGuardWarnings({
    sides: { glm: await verdictWith(carriers) }, drift: { changed: false, files: [], related: [] },
    driftAction: 'ok', fingerprintChangedFiles: [], unattributedDriftFiles: [],
  } as never);
}

const LANDING = '运行目录里缺本次会话的';
const LEAK = '写进真实 HOME';

test('守卫：judgeSide 原样透传 carriers_landed；缺席即缺席', async () => {
  assert.deepEqual((await verdictWith({ log: true, rollout: false })).carriersLanded, { log: true, rollout: false });
  assert.equal('carriersLanded' in (await verdictWith(undefined)), false);
});

test('守卫：半采纳（rollout 缺）出落点播报、点名 rollout；泄漏另起一句并点名泄漏的那一类；全 true / 缺席不出声', async () => {
  const half = await warningsWith({ log: true, rollout: false, leaked_to_home: { log: false, rollout: true } });
  const landing = half.filter((n) => n.includes(LANDING));
  assert.equal(landing.length, 1, half.join(' / '));
  assert.ok(landing[0]!.includes('rollout') && !landing[0]!.includes('日志'), '只点名缺的那一项');
  const halfLeak = half.filter((n) => n.includes(LEAK));
  assert.equal(halfLeak.length, 1);
  assert.ok(halfLeak[0]!.includes('rollout（') && !halfLeak[0]!.includes('日志（'), '泄漏句只点名泄漏的那一类');

  // 镜像半采纳（代码双审 r1 CODEX-01 ≡ GLM-01）：日志回落真实 HOME，泄漏句必须点名日志
  const store = await warningsWith({ log: false, rollout: true, leaked_to_home: { log: true, rollout: false } });
  const storeLeak = store.filter((n) => n.includes(LEAK));
  assert.equal(storeLeak.length, 1, store.join(' / '));
  assert.ok(storeLeak[0]!.includes('日志（') && storeLeak[0]!.includes('~/.zcode/cli/log'));

  const none = await warningsWith({ log: false, rollout: false });
  assert.ok(none.some((n) => n.includes(`${LANDING}日志与rollout`)), none.join(' / '));
  assert.equal(none.some((n) => n.includes(LEAK)), false, '副本支没有 leaked_to_home 键，不出泄漏句');

  for (const c of [{ log: true, rollout: true }, { log: true, rollout: true, leaked_to_home: { log: false, rollout: false } }, undefined]) {
    const w = await warningsWith(c);
    assert.equal(w.some((n) => n.includes(LANDING) || n.includes(LEAK)), false, JSON.stringify(c));
  }
});
