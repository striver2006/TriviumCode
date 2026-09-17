/**
 * 运行目录凭据抹除的三层（BACKLOG EV-20）：载体整删、自有目录后验扫描（模型 I/O 日志改就地脱敏）、
 * 编排器日志就地脱敏；告警与错误分档；哨兵的幂等语义。
 * 挂载点（runner / worker_lost / cancel / 清扫）各自的用例在别处。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { scrubCodexHome } from '../../src/trivium/adapters/codex-home.js';
import { scrubZcodeHome } from '../../src/trivium/adapters/zcode.js';
import { TOOL_TRACE_CAPABILITY, failedResult, type CriticAdapter } from '../../src/trivium/adapters/base.js';
import {
  SCRUB_SENTINEL, clearScrubSentinel, describeScrubFailure, readScrubSentinel,
  scanAndRemoveSecrets, scrubDidWork, scrubRunDir, scrubSideDir,
} from '../../src/trivium/scrub.js';

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

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'trivium-scrub-'));
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
  assert.deepEqual(r, { deleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: [] });
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

test('scanAndRemoveSecrets：exclude 按相对路径前缀排除，软链与二进制不读', async () => {
  const root = await tmp();
  await write(path.join(root, 'keep/x.txt'), `token = "${FAKE_CRED}"`);
  await write(path.join(root, 'scan/y.txt'), `token = "${FAKE_CRED}"`);
  await write(path.join(root, 'clean.txt'), 'nothing here');
  await write(path.join(root, 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`token = "${FAKE_CRED}"`)]));
  await fs.symlink(path.join(root, 'scan/y.txt'), path.join(root, 'link.txt'));
  const r = await scanAndRemoveSecrets(root, { exclude: ['keep'] });
  await kept(path.join(root, 'keep/x.txt'));
  await gone(path.join(root, 'scan/y.txt'));
  await kept(path.join(root, 'clean.txt'));
  await kept(path.join(root, 'blob.bin'));
  assert.deepEqual(r.removed, [path.join('scan', 'y.txt')]);
  assert.equal(r.scanned, 2, '软链与二进制不计入扫描');
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
    capability: TOOL_TRACE_CAPABILITY,
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
      return { deleted: had ? ['home/creds.json'] : [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: [] };
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

test('scrubSideDir：二进制跳过与超大文件同档记告警，不再静默（GLM-05）', async () => {
  const side = await tmp();
  await write(path.join(side, 'home/blob.bin'), Buffer.concat([Buffer.from([0, 1]), Buffer.from(`token = "${FAKE_CRED}"`)]));
  const r = await scrubSideDir(stubAdapter({
    async scrubRunDir(dir) {
      const scan = await scanAndRemoveSecrets(path.join(dir, 'home'));
      return { deleted: [], scanned: scan.scanned, removedOnHit: scan.removed, redacted: {}, warnings: scan.warnings, skipped: scan.skipped, errors: scan.errors };
    },
  }), side, { force: true });
  assert.ok(r.warnings.some((w) => w.includes('二进制')), `二进制跳过要留痕：${JSON.stringify(r.warnings)}`);
  assert.equal(r.complete, false, '跳过就是没扫完');
  assert.equal(r.ok, true, '但不是错误');
});

test('scrubSideDir：告警不影响 ok，错误才 ok:false（CODEX-02）', async () => {
  const side = await tmp();
  await write(path.join(side, 'out/stdout.jsonl'), 'x'.repeat(4096));
  const warned = await scrubSideDir(stubAdapter({
    async scrubRunDir() {
      return { deleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: ['跳过超大文件 cache/big（模拟）'], skipped: 1, errors: [] };
    },
  }), side, { force: true, sizeCap: 1024 });
  assert.equal(warned.ok, true, '超大文件跳过是告警：载体早已删净，不能报成「副本仍在盘上」');
  assert.equal(warned.warnings.length, 2, '适配器的告警与超大日志的告警都进哨兵');
  assert.equal(describeScrubFailure(warned), null);

  const errored = await scrubSideDir(stubAdapter({
    async scrubRunDir() {
      return { deleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: ['删不掉 config.json 副本：EPERM（模拟）'] };
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
  assert.deepEqual(Object.keys(r).sort(), ['gemini', 'glm']);
  assert.equal(r.glm?.logs_redacted[path.join('out', 'stdout.json')], 1);
  assert.equal(r.gemini?.adapter_scrub, false);
  assert.ok(!scrubDidWork(r.gemini!), 'gemini 侧什么都没抹');
  assert.ok((await fs.readFile(path.join(run, 'unknown-side/out/stdout.jsonl'), 'utf8')).includes(FAKE_CRED), '非侧目录不碰');
  assert.ok(seen.includes('gemini') && seen.includes('glm'));
});
