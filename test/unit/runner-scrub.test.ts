/**
 * 凭据抹除的挂载点 ①：runner 每次尝试的 `finally`（EV-20；计划双审 CODEX-02 ≡ GLM-02、GLM-05）。
 *
 * 用一个会「准备副本」的桩适配器走真实临时目录：每次 `run()` 往侧目录写一份载体，
 * `scrubRunDir` 删它。断言的是 runner 的行为，与厂商无关：
 * 四种出口都抹、重试各抹一次、抹除失败不改审查结论但看得见。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runBothSides, type SideProgress } from '../../src/trivium/runner.js';
import { TOOL_TRACE_CAPABILITY, failedResult, type AdapterContext, type CriticAdapter } from '../../src/trivium/adapters/base.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { readScrubSentinel } from '../../src/trivium/scrub.js';
import type { CriticId, CriticRequest, CriticResult } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const CTX: AdapterContext = { cfg: defaultConfig(), nodePath: process.execPath };

async function req(): Promise<{ req: CriticRequest; sideDir: string }> {
  const run = await scratchDir('trivium-runner-scrub-');
  const sideDir = path.join(run, 'glm');
  await fs.mkdir(path.join(sideDir, 'out'), { recursive: true });
  return {
    sideDir,
    req: {
      run_id: 'R1', topic: 't', stage: 'plan', critic: 'glm',
      project_root: run, subject_path: path.join(run, 's.md'), deny_paths: [],
      out_dir: path.join(sideDir, 'out'), brief_path: path.join(run, 'b.md'), brief_text: 'BRIEF',
      model: 'M', timeout_s: 30, schema_path: '/s.json',
      min_tool_calls: 0, profile_requested: null, min_project_reads: 0,
    },
  };
}

const ok = (): CriticResult => ({
  ...failedResult('glm', { status: 'failed', reason: 'x' }),
  status: 'ok', evidence_ok: true, fail_reason: null,
});

/** 桩：每次 run 先「准备」一份载体，按脚本返回；scrubRunDir 删载体并计数 */
function preparing(script: (CriticResult | Error)[], opts: { scrubThrows?: boolean } = {}) {
  let i = 0;
  const state = { prepared: 0, scrubbed: 0, sentinelSeenAtRun: [] as boolean[] };
  const adapter: CriticAdapter = {
    critic: 'glm',
    capability: TOOL_TRACE_CAPABILITY, commandExecution: 'none',
    availability: () => ({ ok: true }),
    async run(_ctx, r) {
      // 每次 run 开始时旧哨兵必须已被 runner 删掉：否则 worker 在本轮准备之后、finally 之前被杀，
      // 清扫路径会看见上一轮的 ok:true 而跳过这份新副本
      state.sentinelSeenAtRun.push(await fs.access(path.join(path.dirname(r.out_dir), 'scrub.json')).then(() => true, () => false));
      const carrier = path.join(path.dirname(r.out_dir), 'home', 'config.json');
      await fs.mkdir(path.dirname(carrier), { recursive: true });
      await fs.writeFile(carrier, '{"apiKey":"fake"}');
      state.prepared++;
      const next = script[Math.min(i++, script.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
    async scrubRunDir(sideDir) {
      if (opts.scrubThrows) throw new Error('抹不掉（模拟）');
      state.scrubbed++;
      await fs.rm(path.join(sideDir, 'home', 'config.json'), { force: true });
      return { deleted: ['home/config.json'], unscannableDeleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: [] };
    },
  };
  return { adapter, state };
}

const carrierGone = (sideDir: string) =>
  assert.rejects(fs.access(path.join(sideDir, 'home', 'config.json')), '载体必须在 run 返回后被删');

for (const [name, result] of [
  ['成功', ok()],
  ['业务性失败（不重试）', failedResult('glm', { status: 'failed', reason: '鉴权失败' })],
  ['超时', failedResult('glm', { status: 'timeout', reason: '脚本级超时' })],
] as const) {
  test(`出口「${name}」：run 返回后载体已删、哨兵 ok、结果挂 scrub`, async () => {
    const { req: r, sideDir } = await req();
    const { adapter, state } = preparing([result]);
    const out = await runBothSides({ ctx: CTX, adapters: { glm: adapter }, requests: { glm: r }, maxTransientRetries: 1 });
    assert.equal(out.results.glm?.status, result.status, '抹除不改变审查结论');
    await carrierGone(sideDir);
    assert.equal(state.scrubbed, 1);
    assert.equal(out.results.glm?.scrub?.ok, true);
    assert.deepEqual(out.results.glm?.scrub?.carriers_deleted, ['home/config.json']);
    assert.equal((await readScrubSentinel(sideDir))?.ok, true);
  });
}

test('出口「适配器抛异常」：finally 仍抹（覆盖准备中途失败的早退，GLM-05），抹除结果挂到合成结果上', async () => {
  const { req: r, sideDir } = await req();
  const { adapter, state } = preparing([new Error('准备副本到一半炸了')]);
  const out = await runBothSides({ ctx: CTX, adapters: { glm: adapter }, requests: { glm: r }, maxTransientRetries: 0 });
  assert.equal(out.results.glm?.status, 'failed');
  await carrierGone(sideDir);
  assert.equal(state.scrubbed, 1);
  assert.equal((await readScrubSentinel(sideDir))?.ok, true);
  assert.equal(out.results.glm?.scrub?.ok, true, '异常出口上的抹除结果也要跟着结果走（代码双审 r1 GLM-04）');

  // 异常 + 抹除失败：合成结果里 scrub.ok=false，executeRun 才能把它写进终态 message
  const bad = preparing([new Error('又炸了')], { scrubThrows: true });
  const { req: r2 } = await req();
  const out2 = await runBothSides({ ctx: CTX, adapters: { glm: bad.adapter }, requests: { glm: r2 }, maxTransientRetries: 0 });
  assert.equal(out2.results.glm?.status, 'failed');
  assert.equal(out2.results.glm?.scrub?.ok, false);
});

test('瞬时故障重试：两次尝试各抹一次，第二次重新准备的载体不因第一次的哨兵而漏抹（CODEX-02）', async () => {
  const { req: r, sideDir } = await req();
  const { adapter, state } = preparing([failedResult('glm', { status: 'failed', reason: 'schema 校验失败' }), ok()]);
  const out = await runBothSides({ ctx: CTX, adapters: { glm: adapter }, requests: { glm: r }, maxTransientRetries: 1 });
  assert.equal(out.attempts.glm, 2, '前提：确实重试了');
  assert.equal(state.prepared, 2, '前提：重试重新准备了副本');
  assert.equal(state.scrubbed, 2, '每次尝试各抹一次——只抹一次就是「哨兵在即跳过」那个缺陷');
  assert.deepEqual(state.sentinelSeenAtRun, [false, false], '第二次尝试开始时，第一次留下的哨兵必须已删（准备即失效）');
  await carrierGone(sideDir);
  assert.equal(out.results.glm?.status, 'ok');
});

test('抹除失败：审查结论不变，scrub.ok=false，进度回调收到 note（CODEX-10 ≡ AGY-06）', async () => {
  const { req: r, sideDir } = await req();
  const { adapter } = preparing([ok()], { scrubThrows: true });
  const notes: string[] = [];
  const out = await runBothSides({
    ctx: CTX, adapters: { glm: adapter }, requests: { glm: r }, maxTransientRetries: 0,
    onSideProgress: (_c: CriticId, p: SideProgress) => { if (p.note) notes.push(p.note); },
  });
  assert.equal(out.results.glm?.status, 'ok', '结果已产出、配额已烧，抹除失败不判该侧失败');
  assert.equal(out.results.glm?.scrub?.ok, false);
  assert.ok(notes.some((n) => n.includes('抹除失败')), `失败必须走到 status 的侧 note：${JSON.stringify(notes)}`);
  assert.equal((await readScrubSentinel(sideDir))?.ok, false, 'ok:false 的哨兵让清扫重试');
  await fs.access(path.join(sideDir, 'home', 'config.json'), undefined).catch(() => {});
});

test('侧目录不存在（假路径）：不抛、不写、scrub 记 skipped', async () => {
  const adapter: CriticAdapter = {
    critic: 'glm', capability: TOOL_TRACE_CAPABILITY, commandExecution: 'none', availability: () => ({ ok: true }),
    async run() { return ok(); },
  };
  const out = await runBothSides({
    ctx: CTX, adapters: { glm: adapter }, maxTransientRetries: 0,
    requests: { glm: { ...(await req()).req, out_dir: '/nonexistent-trivium/x/out' } },
  });
  assert.equal(out.results.glm?.scrub?.skipped, 'no-side-dir');
});
