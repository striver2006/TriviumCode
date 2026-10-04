/**
 * 运行目录凭据抹除的三层（BACKLOG EV-20）：载体整删、自有目录后验扫描（模型 I/O 日志改就地脱敏）、
 * 编排器日志就地脱敏；告警与错误分档；哨兵的幂等语义。
 * 挂载点（runner / worker_lost / cancel / 清扫）各自的用例在别处。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { scrubCodexHome } from '../../src/trivium/adapters/codex-home.js';
import { scrubZcodeHome } from '../../src/trivium/adapters/zcode.js';
import { TOOL_TRACE_CAPABILITY, failedResult, type CriticAdapter } from '../../src/trivium/adapters/base.js';
import {
  SCRUB_SENTINEL, clearScrubSentinel, describeScrubFailure, readScrubSentinel,
  scanAndRemoveSecrets, scrubDidWork, scrubRunDir, scrubSideDir, sentinelSettled,
} from '../../src/trivium/scrub.js';
import { scratchDir } from '../helpers/scratch.js';

/**
 * 假凭据：形态与真实一致（高熵），值是编造的。
 * **运行时拼接、常量不叫 token**：本文件会进送审包，归档侧的密钥扫描扫的是 diff 原文，
 * 一行 `TOKEN = '<32 位高熵串>'` 本身就命中赋值形态规则，会拒绝冻结（它是对的）。
 */
const FAKE_CRED = ['Qx7mZp2L', 'k9Rt4Wv1', 'Ab3Cd5Ef', '7Gh9Jk2M'].join('');
const HEX32 = '0123456789abcdef'.repeat(2);
const TOML = `model = "qwen3.8-max"\n[model_providers.qwen]\nexperimental_bearer_token = "${FAKE_CRED}"\nbase_url = "https://example.invalid/v1"\n`;
/** 模型 I/O 日志里的一行：token 经 JSON 转义 */
const IO_LINE = `{"type":"response_item","payload":{"text":"experimental_bearer_token = \\"${FAKE_CRED}\\""}}\n`;

const tmp = () => scratchDir('trivium-scrub-');
const write = async (p: string, s: string | Buffer) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, s);
};
const gone = async (p: string) => assert.rejects(fs.access(p), `${path.basename(p)} 应已删除`);
const kept = async (p: string) => fs.access(p);
const clean = async (p: string) => assert.ok(!(await fs.readFile(p, 'utf8')).includes(FAKE_CRED), `${path.basename(p)} 里的 token 必须被抹`);

// ── codex 侧 ──

test('scrubCodexHome：三份载体整删；sessions/ 就地脱敏不删；cache/ plugins/ 不扫；其余命中即删', async () => {
  const dir = await tmp();
  const home = path.join(dir, 'codexhome');
  await write(path.join(home, 'config.toml'), TOML);
  await write(path.join(home, 'qwen.config.toml'), TOML);
  await write(path.join(home, 'auth.json'), `{"OPENAI_API_KEY":"sk-proj-${FAKE_CRED}${FAKE_CRED}"}`);
  await write(path.join(home, 'models-qwen.json'), '{"models":[]}');
  const session = path.join(home, 'sessions/2026/09/17/rollout-x.jsonl');
  await write(session, `{"type":"session_meta","payload":{"session_id":"T1","model_provider":"qwen"}}\n${IO_LINE}`);
  await write(path.join(home, 'cache/remote_plugin_catalog/big.json'), `{"leak":"token = \\"${FAKE_CRED}\\""}`);
  await write(path.join(home, 'plugins/x/index.js'), `const k = "token = '${FAKE_CRED}'";`);
  await write(path.join(home, 'fakehome/.cache/leak.txt'), `token = "${FAKE_CRED}"`);

  const r = await scrubCodexHome(home);
  assert.deepEqual(r.deleted.sort(), ['codexhome/auth.json', 'codexhome/config.toml', 'codexhome/qwen.config.toml']);
  await gone(path.join(home, 'auth.json'));
  await gone(path.join(home, 'config.toml'));
  await gone(path.join(home, 'qwen.config.toml'));
  await kept(path.join(home, 'models-qwen.json'));

  // sessions/：文件还在、token 没了、首行 session_meta 原样（生效模型的回读来源）
  await kept(session);
  await clean(session);
  assert.ok((await fs.readFile(session, 'utf8')).startsWith('{"type":"session_meta"'), '脱敏不得破坏首行结构');
  assert.equal(r.redacted[path.join('codexhome', 'sessions/2026/09/17/rollout-x.jsonl')], 1);

  // cache/ plugins/：不碰（里面的假 token 还在，证明确实没扫）
  await kept(path.join(home, 'cache/remote_plugin_catalog/big.json'));
  assert.ok((await fs.readFile(path.join(home, 'plugins/x/index.js'), 'utf8')).includes(FAKE_CRED));

  await gone(path.join(home, 'fakehome/.cache/leak.txt'));
  assert.deepEqual(r.removedOnHit, [path.join('codexhome', 'fakehome/.cache/leak.txt')]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);

  // 幂等：再来一次什么都不删、不抛
  const again = await scrubCodexHome(home);
  assert.deepEqual(again.deleted, []);
  assert.deepEqual(again.removedOnHit, []);
  assert.deepEqual(again.redacted, {});
});

test('scrubCodexHome：目录不存在返回空结果，不抛', async () => {
  const r = await scrubCodexHome(path.join(await tmp(), 'nope'));
  assert.deepEqual(r, {
    deleted: [], unscannableDeleted: [], scanned: 0, removedOnHit: [],
    redacted: {}, warnings: [], skipped: 0, errors: [],
  });
});

// ── zcode 侧（计划双审三侧同时逮到的阻断：这一侧原稿以为没有副本）──

test('scrubZcodeHome：config.json 副本整删；rollout/ log/ 就地脱敏；plugins/ db/ 不扫；其余命中即删', async () => {
  const dir = await tmp();
  const home = path.join(dir, 'home');
  const cli = path.join(home, '.zcode/cli');
  await write(path.join(cli, 'config.json'), `{"provider":{"k":{"apiKey":"${HEX32}.${FAKE_CRED.slice(0, 16)}"}}}`);
  await write(path.join(cli, 'rollout/model-io-sess_1.jsonl'), IO_LINE);
  await write(path.join(cli, 'log/zcode-1.jsonl'), IO_LINE);
  await write(path.join(cli, 'plugins/cache/x/lib.js'), `apiKey: ${HEX32}.${FAKE_CRED.slice(0, 16)}`);
  await write(path.join(cli, 'db/db.sqlite'), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from(FAKE_CRED)]));
  await write(path.join(cli, 'leak.log'), `apiKey: ${HEX32}.${FAKE_CRED.slice(0, 16)}`);
  await write(path.join(home, '.zcode/settings.json'), '{"theme":"dark"}');

  const r = await scrubZcodeHome(home);
  assert.deepEqual(r.deleted, [path.join('home', '.zcode/cli', 'config.json')]);
  await gone(path.join(cli, 'config.json'));
  await kept(path.join(cli, 'rollout/model-io-sess_1.jsonl'));
  await clean(path.join(cli, 'rollout/model-io-sess_1.jsonl'));
  await kept(path.join(cli, 'log/zcode-1.jsonl'));
  await clean(path.join(cli, 'log/zcode-1.jsonl'));
  assert.equal(Object.keys(r.redacted).length, 2);
  assert.ok((await fs.readFile(path.join(cli, 'plugins/cache/x/lib.js'), 'utf8')).includes(FAKE_CRED.slice(0, 16)), 'plugins/ 不扫：文件与内容都原样');
  await kept(path.join(cli, 'db/db.sqlite'));
  await gone(path.join(cli, 'leak.log'));
  await kept(path.join(home, '.zcode/settings.json'));
  assert.equal(r.removedOnHit.length, 1);
  assert.deepEqual(r.errors, []);
});

// ── 通用扫描 ──

test('scanAndRemoveSecrets：exclude 按相对路径前缀排除，软链不读，论域内的二进制整删（EV-36）', async () => {
  const root = await tmp();
  const blob = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`token = "${FAKE_CRED}"`)]);
  await write(path.join(root, 'keep/x.txt'), `token = "${FAKE_CRED}"`);
  await write(path.join(root, 'keep/kept.bin'), blob);
  await write(path.join(root, 'scan/y.txt'), `token = "${FAKE_CRED}"`);
  await write(path.join(root, 'clean.txt'), 'nothing here');
  await write(path.join(root, 'blob.bin'), blob);
  await fs.symlink(path.join(root, 'scan/y.txt'), path.join(root, 'link.txt'));

  const r = await scanAndRemoveSecrets(root, { exclude: ['keep'] });

  await kept(path.join(root, 'keep/x.txt'));
  await kept(path.join(root, 'keep/kept.bin'), );
  await gone(path.join(root, 'scan/y.txt'));
  await kept(path.join(root, 'clean.txt'));
  // 论域本就是「命中即删」，对判不了的东西保留是自相矛盾——按 fail-closed 删
  await gone(path.join(root, 'blob.bin'));
  assert.deepEqual(r.removed, [path.join('scan', 'y.txt')]);
  assert.deepEqual(r.unscannableRemoved, ['blob.bin'], '扫不进去而删的记在另一格，与「命中而删」分开');
  assert.equal(r.scanned, 2, '软链与二进制不计入扫描');
  assert.equal(r.skipped, 0, '删掉了就不是「跳过」——否则 complete 永远为假');
  assert.deepEqual(r.warnings, []);
});

test('scanAndRemoveSecrets：redactUnder 下的二进制仍只跳过不删——那几棵是回读来源', async () => {
  const root = await tmp();
  await write(path.join(root, 'io/blob.bin'), Buffer.concat([Buffer.from([0, 1]), Buffer.from('x')]));

  const r = await scanAndRemoveSecrets(root, { redactUnder: ['io'] });

  await kept(path.join(root, 'io/blob.bin'), );
  assert.deepEqual(r.unscannableRemoved, []);
  assert.equal(r.skipped, 1, '仍未脱敏，仍不能据此收工');
  assert.ok(r.warnings.some((w) => w.includes('回读面')), `要说清为什么不删：${JSON.stringify(r.warnings)}`);
});

test('scanAndRemoveSecrets：超过上限的文件只记告警不记错误（CODEX-02）；redactUnder 下命中改脱敏', async () => {
  const root = await tmp();
  await write(path.join(root, 'big.json'), 'x'.repeat(2048));
  await write(path.join(root, 'io/a.jsonl'), IO_LINE);
  const r = await scanAndRemoveSecrets(root, { sizeCap: 1024, redactUnder: ['io'] });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /超大文件 big\.json/);
  assert.deepEqual(r.errors, []);
  await kept(path.join(root, 'io/a.jsonl'));
  await clean(path.join(root, 'io/a.jsonl'));
  assert.equal(r.redacted[path.join('io', 'a.jsonl')], 1);
  assert.deepEqual(r.removed, []);
});

// ── 侧级抹除与哨兵 ──

function stubAdapter(over: Partial<CriticAdapter> = {}): CriticAdapter {
  return {
    critic: 'glm',
    capability: TOOL_TRACE_CAPABILITY, commandExecution: 'none',
    availability: () => ({ ok: true }),
    async run() { return failedResult('glm', { status: 'failed', reason: 'unused' }); },
    ...over,
  };
}

test('scrubSideDir：载体 + 日志脱敏（含 out/ 与 rollout.jsonl）+ 哨兵；非 force 第二次按哨兵跳过，force 照跑', async () => {
  const side = await tmp();
  await write(path.join(side, 'home/creds.json'), `{"k":"${FAKE_CRED}"}`);
  await write(path.join(side, 'stdout.jsonl'), `{"item":{"aggregated_output":"experimental_bearer_token = \\"${FAKE_CRED}\\""}}\n{"type":"turn.completed"}\n`);
  await write(path.join(side, 'trace.json'), JSON.stringify({ commands: [`cat x # token = "${FAKE_CRED}"`] }));
  // 适配器真正写日志的位置是 <侧>/out/（req.out_dir）；zcode 还会拷一份 rollout.jsonl（GLM-01）
  await write(path.join(side, 'out/stdout.jsonl'), `{"item":{"aggregated_output":"experimental_bearer_token = \\"${FAKE_CRED}\\""}}\n`);
  await write(path.join(side, 'out/rollout.jsonl'), IO_LINE);
  await write(path.join(side, 'out/review.json'), `{"leak":"token = \\"${FAKE_CRED}\\""}`);

  let calls = 0;
  const adapter = stubAdapter({
    async scrubRunDir(dir) {
      calls++;
      const carrier = path.join(dir, 'home/creds.json');
      const had = await fs.access(carrier).then(() => true, () => false);
      await fs.rm(carrier, { force: true });
      return { deleted: had ? ['home/creds.json'] : [], unscannableDeleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: [] };
    },
  });

  const first = await scrubSideDir(adapter, side);
  assert.equal(first.ok, true);
  assert.equal(first.adapter_scrub, true);
  assert.deepEqual(first.carriers_deleted, ['home/creds.json']);
  assert.equal(first.logs_redacted['stdout.jsonl'], 1);
  assert.equal(first.logs_redacted['trace.json'], 1);
  assert.equal(first.logs_redacted[path.join('out', 'stdout.jsonl')], 1);
  assert.equal(first.logs_redacted[path.join('out', 'rollout.jsonl')], 1, 'zcode 拷进 out/ 的模型 I/O 副本也要脱敏');
  assert.equal(first.skipped, undefined);
  assert.ok(scrubDidWork(first));

  await clean(path.join(side, 'stdout.jsonl'));
  assert.ok((await fs.readFile(path.join(side, 'stdout.jsonl'), 'utf8')).includes('turn.completed'), '其余行原样');
  const trace = await fs.readFile(path.join(side, 'trace.json'), 'utf8');
  assert.ok(!trace.includes(FAKE_CRED));
  assert.doesNotThrow(() => JSON.parse(trace), '脱敏只动字符串值内部，JSON 结构不变');
  await clean(path.join(side, 'out/rollout.jsonl'));
  assert.ok((await fs.readFile(path.join(side, 'out/review.json'), 'utf8')).includes(FAKE_CRED), 'out/ 里只脱敏日志，审查结果不碰：归档侧另有 assertNoSecrets');

  const sentinel = await readScrubSentinel(side);
  assert.equal(sentinel?.ok, true);

  const second = await scrubSideDir(adapter, side);
  assert.equal(second.skipped, 'already-scrubbed');
  assert.equal(calls, 1, '哨兵已记 ok，非 force 不再调适配器');

  const third = await scrubSideDir(adapter, side, { force: true });
  assert.equal(third.skipped, undefined);
  assert.equal(calls, 2, 'force 无条件重跑——runner 的每次尝试走这条');
  assert.ok(!scrubDidWork(third), '第二次 force 什么都没抹到：不算做了事');
});

test('scrubSideDir：侧目录不存在 → skipped no-side-dir，不写哨兵（runner 单测的假路径）', async () => {
  const dir = path.join(await tmp(), 'absent');
  const r = await scrubSideDir(stubAdapter(), dir);
  assert.equal(r.skipped, 'no-side-dir');
  assert.equal(r.ok, true);
  await gone(path.join(dir, SCRUB_SENTINEL));
  await assert.doesNotReject(clearScrubSentinel(dir));
});

test('scrubSideDir：适配器没有 scrubRunDir → adapter_scrub false，日志照样脱敏', async () => {
  const side = await tmp();
  await write(path.join(side, 'out/stdout.json'), `{"response":"token = \\"${FAKE_CRED}\\""}`);
  const r = await scrubSideDir(stubAdapter(), side);
  assert.equal(r.adapter_scrub, false, '「没得抹」要如实记，不冒充抹过');
  assert.equal(r.logs_redacted[path.join('out', 'stdout.json')], 1);
  assert.equal(r.ok, true);
});

test('scrubSideDir：跳过了目标就不算扫完——complete:false 让清扫下次还来（AGY-02）', async () => {
  const side = await tmp();
  await write(path.join(side, 'out/stdout.jsonl'), 'x'.repeat(4096));
  const first = await scrubSideDir(stubAdapter(), side, { force: true, sizeCap: 1024 });
  assert.equal(first.ok, true, '跳过超大文件不是错误：载体已删净，不该在待办里报失败');
  assert.equal(first.complete, false, '但也没扫完：那份日志仍未脱敏');

  // 关键：`ok:true` 但 `complete:false` 的哨兵**不**满足「已处理」，非 force 的清扫仍会再来
  const again = await scrubSideDir(stubAdapter(), side, { sizeCap: 1024 });
  assert.equal(again.skipped, undefined, 'complete:false 时不得判 already-scrubbed');

  // 扫得完的一侧才判「已处理」
  const clean2 = await tmp();
  await write(path.join(clean2, 'out/stdout.jsonl'), '{}\n');
  const done = await scrubSideDir(stubAdapter(), clean2, { force: true });
  assert.equal(done.complete, true);
  assert.equal((await scrubSideDir(stubAdapter(), clean2)).skipped, 'already-scrubbed');
});

test('scrubSideDir：论域内的二进制被整删，complete 因此为真（GLM-05 的告警口径经 EV-36 升级）', async () => {
  const side = await tmp();
  await write(path.join(side, 'home/blob.bin'), Buffer.concat([Buffer.from([0, 1]), Buffer.from(`token = "${FAKE_CRED}"`)]));
  const r = await scrubSideDir(stubAdapter({
    async scrubRunDir(dir) {
      const scan = await scanAndRemoveSecrets(path.join(dir, 'home'));
      return {
        deleted: [], unscannableDeleted: scan.unscannableRemoved, scanned: scan.scanned,
        removedOnHit: scan.removed, redacted: {}, warnings: scan.warnings, skipped: scan.skipped, errors: scan.errors,
      };
    },
  }), side, { force: true });
  await gone(path.join(side, 'home/blob.bin'));
  assert.deepEqual(r.unscannable_deleted, ['blob.bin']);
  assert.equal(r.complete, true, '没有跳过任何目标，这一侧才真的扫完了');
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [], 'GLM-05 加告警是为了让没扫的看得见；删掉之后没有「没扫的」可看');
});

test('scrubSideDir：告警不影响 ok，错误才 ok:false（CODEX-02）', async () => {
  const side = await tmp();
  await write(path.join(side, 'out/stdout.jsonl'), 'x'.repeat(4096));
  const warned = await scrubSideDir(stubAdapter({
    async scrubRunDir() {
      return { deleted: [], unscannableDeleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: ['跳过超大文件 cache/big（模拟）'], skipped: 1, errors: [] };
    },
  }), side, { force: true, sizeCap: 1024 });
  assert.equal(warned.ok, true, '超大文件跳过是告警：载体早已删净，不能报成「副本仍在盘上」');
  assert.equal(warned.warnings.length, 2, '适配器的告警与超大日志的告警都进哨兵');
  assert.equal(describeScrubFailure(warned), null);

  const errored = await scrubSideDir(stubAdapter({
    async scrubRunDir() {
      return { deleted: [], unscannableDeleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: ['删不掉 config.json 副本：EPERM（模拟）'] };
    },
  }), side, { force: true });
  assert.equal(errored.ok, false);
  assert.match(describeScrubFailure(errored)!, /抹除失败/);
});

test('scrubSideDir：载体抹除抛异常 → ok:false、哨兵记 ok:false、人读一句可用', async () => {
  const side = await tmp();
  await write(path.join(side, 'out/stdout.jsonl'), '{}\n');
  const r = await scrubSideDir(stubAdapter({ async scrubRunDir() { throw new Error('EPERM 模拟'); } }), side);
  assert.equal(r.ok, false);
  assert.match(r.errors[0]!, /EPERM 模拟/);
  assert.equal((await readScrubSentinel(side))?.ok, false, 'ok:false 的哨兵不满足「跳过」条件，清扫会重试');
  assert.match(describeScrubFailure(r)!, /抹除失败/);
  assert.equal(describeScrubFailure({ ...r, ok: true }), null);

  // ok:false 的哨兵不阻止下一次非 force 清扫
  const retry = await scrubSideDir(stubAdapter(), side);
  assert.equal(retry.skipped, undefined);
});

test('scrubRunDir：只认注册表 id 命名的侧子目录，缺接线的侧仍处理日志', async () => {
  const run = await tmp();
  await write(path.join(run, 'status.json'), '{}');
  await write(path.join(run, 'glm/out/stdout.json'), `{"r":"token = \\"${FAKE_CRED}\\""}`);
  await write(path.join(run, 'gemini/out/stdout.jsonl'), '{}\n');
  await write(path.join(run, 'unknown-side/out/stdout.jsonl'), `token = "${FAKE_CRED}"`);
  const seen: string[] = [];
  const r = await scrubRunDir(run, (id) => {
    seen.push(id);
    return id === 'glm' ? stubAdapter() : undefined;
  });
  assert.deepEqual(Object.keys(r.sides).sort(), ['gemini', 'glm']);
  assert.equal(r.sides.glm?.logs_redacted[path.join('out', 'stdout.json')], 1);
  assert.equal(r.sides.gemini?.adapter_scrub, false);
  assert.ok(!scrubDidWork(r.sides.gemini!), 'gemini 侧什么都没抹');
  assert.ok((await fs.readFile(path.join(run, 'unknown-side/out/stdout.jsonl'), 'utf8')).includes(FAKE_CRED), '非侧目录不碰');
  assert.ok(seen.includes('gemini') && seen.includes('glm'));
});

// ── codex 自有二进制：整删而不是留一份永远扫不完的面 ──

test('scrubCodexHome：自有 sqlite 状态库整删且单列一格，skills/.system 整棵不扫', async () => {
  const dir = await tmp();
  const home = path.join(dir, 'codexhome');
  const blob = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`token = "${FAKE_CRED}"`)]);
  await write(path.join(home, 'config.toml'), TOML);
  // codex 跑起来自己生成的状态库，散在副本根这一层，`-shm` / `-wal` 边车同类
  for (const n of ['goals_1.sqlite', 'state_5.sqlite-shm', 'thread_history_1.sqlite-wal']) {
    await write(path.join(home, n), blob);
  }
  // 随 CLI 分发的系统技能树：每份技能带一个 PNG 图标
  await write(path.join(home, 'skills/.system/imagegen/assets/imagegen.png'), blob);
  // 模型自己装的技能不在 .system 下——那是「本轮没想到的文件」，仍要扫
  await write(path.join(home, 'skills/mine/notes.txt'), `token = "${FAKE_CRED}"`);
  await write(path.join(home, 'sessions/s.jsonl'), IO_LINE);

  const r = await scrubCodexHome(home);

  assert.deepEqual(r.deleted, [path.join('codexhome', 'config.toml')], '凭据载体只此一份，另两类不能混进来');
  assert.deepEqual(
    [...r.unscannableDeleted].sort(),
    ['goals_1.sqlite', 'state_5.sqlite-shm', 'thread_history_1.sqlite-wal']
      .map((n) => path.join('codexhome', n)).sort(),
    'sqlite 记在另一格：删除理由与凭据载体不同，混在一起哨兵就说了假话',
  );
  for (const n of ['goals_1.sqlite', 'state_5.sqlite-shm', 'thread_history_1.sqlite-wal']) {
    await gone(path.join(home, n));
  }
  await kept(path.join(home, 'skills/.system/imagegen/assets/imagegen.png'));
  await gone(path.join(home, 'skills/mine/notes.txt'));
  await clean(path.join(home, 'sessions/s.jsonl'));
  assert.equal(r.skipped, 0, '这两类正是此前唯一的跳过来源，处理掉之后该侧扫得完');
  assert.deepEqual(r.warnings, [], '扫得完就不该再有「跳过二进制」的告警');
});

test('scrubSideDir：codex 侧扫得完 → complete 为真 → 非 force 的下一次清扫直接跳过', async () => {
  const side = await tmp();
  const home = path.join(side, 'codexhome');
  await write(path.join(home, 'config.toml'), TOML);
  await write(path.join(home, 'goals_1.sqlite'), Buffer.from([0, 1, 2, 3]));
  const { codexAdapter } = await import('../../src/trivium/adapters/codex.js');

  const first = await scrubSideDir(codexAdapter, side, { force: true });
  assert.equal(first.complete, true, 'sqlite 已整删，没有跳过项');
  assert.deepEqual(first.unscannable_deleted, [path.join('codexhome', 'goals_1.sqlite')]);
  assert.equal(first.ok, true);

  const again = await scrubSideDir(codexAdapter, side);
  assert.equal(again.skipped, 'already-scrubbed', 'complete 为真才让哨兵真正收工，否则每次会话重扫同一批');
});

// ── 运行目录那一层：没有哨兵，不上报就等于静默 ──

test('scrubRunDir：运行目录层的脱敏结果要上报，不能像此前那样整个丢弃', async () => {
  const run = await tmp();
  await write(path.join(run, 'request.json'), `{"brief_text":"experimental_bearer_token = \\"${FAKE_CRED}\\""}`);
  await write(path.join(run, 'glm/out/stdout.json'), '{}');

  const r = await scrubRunDir(run, () => undefined);

  assert.equal(r.runDir.redacted['request.json'], 1, '交接包逐字含整份送审包，必须脱敏并计数');
  await clean(path.join(run, 'request.json'));
  assert.deepEqual(r.runDir.errors, []);
  assert.equal(r.runDir.skipped, 0);
  assert.ok('glm' in r.sides, '侧层照常返回');
});

test('scrubRunDir：运行目录层跳过超大文件要报出来——那一层没有哨兵可留', async () => {
  const run = await tmp();
  await write(path.join(run, 'request.json'), `{"x":"${'y'.repeat(4096)}"}`);

  const r = await scrubRunDir(run, () => undefined, { sizeCap: 1024 });

  assert.equal(r.runDir.skipped, 1);
  assert.ok(r.runDir.warnings.some((w) => w.includes('request.json')), `跳过要指名道姓：${JSON.stringify(r.runDir.warnings)}`);
  assert.deepEqual(r.runDir.errors, [], '跳过是告警不是错误，与侧层同档');
});

test('scrubRunDir：运行目录读不了时不再静默返回空——那意味着一侧都没抹', async () => {
  const dir = await tmp();
  const notADir = path.join(dir, 'not-a-dir');
  await write(notADir, 'x');

  const r = await scrubRunDir(notADir, () => undefined);

  assert.deepEqual(r.sides, {});
  assert.equal(r.runDir.errors.length, 1, '此前是 `return {}`：调用方三个计数全不增长，该目录在待办里完全不出现');
  assert.match(r.runDir.errors[0]!, /读运行目录失败/);
});

test('sentinelSettled：`complete` 字段加进来之前的旧哨兵不算收工，会被重扫一次并自愈', async () => {
  const side = await tmp();
  const home = path.join(side, 'codexhome');
  await write(path.join(home, 'goals_1.sqlite'), Buffer.from([0, 1, 2, 3]));
  // 旧版哨兵：那时还没有 `complete` 这个字段
  await write(path.join(side, SCRUB_SENTINEL), JSON.stringify({
    ok: true, at: '2026-09-01T00:00:00.000Z', adapter_scrub: true,
    carriers_deleted: [], scanned_files: 3, removed_on_hit: [], logs_redacted: {}, warnings: [], errors: [],
  }));

  assert.equal(sentinelSettled(await readScrubSentinel(side)), false, '「不知道扫没扫完」不能长得像「扫完了」');

  const { codexAdapter } = await import('../../src/trivium/adapters/codex.js');
  const r = await scrubSideDir(codexAdapter, side);
  assert.equal(r.skipped, undefined, '旧哨兵不该让这一侧被跳过');
  await gone(path.join(home, 'goals_1.sqlite'));
  assert.equal(sentinelSettled(await readScrubSentinel(side)), true, '重扫一次即写上新字段，自愈');
});

test('sentinelSettled：complete 为 false 或 ok 为 false 都不算收工', async () => {
  const base = {
    at: '2026-09-17T00:00:00.000Z', adapter_scrub: true, carriers_deleted: [], unscannable_deleted: [],
    scanned_files: 0, removed_on_hit: [], logs_redacted: {}, warnings: [], errors: [],
  };
  assert.equal(sentinelSettled(null), false);
  assert.equal(sentinelSettled({ ...base, ok: true, complete: true }), true);
  assert.equal(sentinelSettled({ ...base, ok: true, complete: false }), false);
  assert.equal(sentinelSettled({ ...base, ok: false, complete: true }), false);
});

test('scanAndRemoveSecrets：超过上限的二进制仍只跳过、不被整删——锁住两段判定的顺序（GLM-05）', async () => {
  const root = await tmp();
  // 前 8 KB 含 NUL（二进制）且超过 sizeCap：两个条件同时成立，结果只能由判定顺序决定
  await write(path.join(root, 'huge.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.alloc(4096, 0x41)]));

  const r = await scanAndRemoveSecrets(root, { sizeCap: 1024 });

  await kept(path.join(root, 'huge.bin'));
  assert.deepEqual(r.unscannableRemoved, [], '超大是「我们选择不读」，不是「读不了」——不该走整删');
  assert.equal(r.skipped, 1);
  assert.ok(
    r.warnings.some((w) => w.includes('超大文件') && w.includes('huge.bin')),
    `要报成超大而不是二进制：${JSON.stringify(r.warnings)}`,
  );
  // 把 sizeCap 判定挪到二进制判定之后，这份文件会从「跳过」变成「整删」，而本断言会红
});
