// 「只读失守未确证改动放行」（EV-223）三格验收读数（计划 r2 §6.1，决策七「至少三格」）。
// 零配额：全程走 TRIVIUM_STUB_CRITIC 桩，经打包产物（skills/dual-critic/scripts/trivium.cjs）的真实 CLI 跑
// review --start / --wait → 落裁决件 → gate --check → 两处 Hook，读数写成 JSON。夹具复用测试辅助（dist/test 产物），
// 进程退出时自动删除（EV-207 / EV-208）。
//
// 三格：
//   A 只产写事件不落盘（write_breach）                         ⇒ 期望放行：gate --check 退 0、告警 readonly_breach_unconfirmed（复算无变化）
//   B 真改项目文件（write_breach_applied）                     ⇒ 期望拦截：gate --check 退 2、failure readonly_breach、闸门停在待裁决
//   C 比不了 + 写事件（write_breach + prune_objects，on_drift_related: warn）⇒ 期望放行：告警为「比不了」的说法
//
// 用法（在仓库根，先 node scripts/build.mjs --with-tests）：
//   node doc/05_testing/evidence/breach-unconfirmed-release-20261006/acceptance.mjs 〈输出 JSON 路径〉
import path from 'node:path';
import { promises as fs } from 'node:fs';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node acceptance.mjs 〈输出 JSON 路径〉');
const { cli, makeFixture, today, BUNDLE, ASSET_ROOT } = await import(path.join(ROOT, 'dist/test/test/helpers/fixture.js'));
const { extractJsonCandidate } = await import(path.join(ROOT, 'dist/test/src/trivium/parse.js'));
const { run } = await import(path.join(ROOT, 'dist/test/src/trivium/util/exec.js'));

const TOPIC = '失守三格';
const SESSION = 'S-三格';
const DRIVER = ['cl', 'aude'].join('');

async function runPlan(root, stub) {
  const started = await cli(root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--entry', 'A', '--session-id', SESSION, '--json'], stub);
  if (started.code !== 0) throw new Error(`--start 失败：${started.stdout}${started.stderr}`);
  const { run_id } = JSON.parse(extractJsonCandidate(started.stdout).json);
  let code = 73;
  for (let i = 0; i < 12 && code === 73; i++) {
    code = (await cli(root, ['review', '--wait', run_id, '--timeout', '20'], stub, 60_000)).code;
  }
  return { runId: run_id, reviewExit: code };
}

async function writeDisposition(stageDir, runId) {
  const ids = [];
  for (const f of await fs.readdir(path.join(stageDir, '_meta'))) {
    const m = /^review-(gemini|glm)-.*\.json$/.exec(f);
    if (!m) continue;
    const r = JSON.parse(await fs.readFile(path.join(stageDir, '_meta', f), 'utf8'));
    for (const x of r.findings ?? []) ids.push({ id: x.id, side: m[1] });
  }
  await fs.writeFile(
    path.join(stageDir, `${today()}-${TOPIC}-revised-${DRIVER}.md`),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
      `role: ${DRIVER}`, 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${TOPIC}-gemini.md`, `  - ${today()}-${TOPIC}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      ...ids.map((x) => `| ${x.id} | ${x.side} | minor | 接受 | 验收只为走到闸门，逐条接受 | §1 |`),
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(stageDir, `${today()}-${TOPIC}-r2-${DRIVER}.md`),
    ['# 计划 r2', '', '相对上一轮的改动：', ...ids.map((x) => `- ${x.id}：按建议补上`), ''].join('\n'),
    'utf8',
  );
  return ids.map((x) => x.id);
}

async function hook(root, name, input) {
  return run(process.execPath, [BUNDLE, 'gate', name], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, CLAUDE_SESSION_ID: SESSION, TRIVIUM_STUB_CRITIC: undefined },
    stdin: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}

async function gateState(root) {
  const st = JSON.parse(await fs.readFile(path.join(root, '.trivium', 'state.json'), 'utf8'));
  return st.gates[`${TOPIC}/plan`]?.state ?? null;
}

const GRIDS = [
  { id: 'A', desc: '只产写事件不落盘', stub: { gemini: { mode: 'write_breach' }, glm: { mode: 'ok' } }, extraReview: [], expect: 'release' },
  { id: 'B', desc: '真改项目文件', stub: { gemini: { mode: 'write_breach_applied' }, glm: { mode: 'ok' } }, extraReview: [], expect: 'block' },
  {
    id: 'C', desc: '比不了 + 写事件（on_drift_related: warn）',
    stub: { gemini: { mode: 'write_breach' }, glm: { mode: 'prune_objects' } }, extraReview: ['on_drift_related: warn'],
    seedUntracked: true, expect: 'release',
  },
];

const out = { bundle_sha256: null, grids: [] };
{
  const { createHash } = await import('node:crypto');
  out.bundle_sha256 = createHash('sha256').update(await fs.readFile(BUNDLE)).digest('hex');
}
for (const g of GRIDS) {
  const fx = await makeFixture({ topic: TOPIC, ...(g.extraReview.length ? { extraReview: g.extraReview } : {}) });
  if (g.seedUntracked) await fs.writeFile(path.join(fx.root, 'src/untracked-seed.ts'), 'export const seed = 1;\n', 'utf8');
  const { runId, reviewExit } = await runPlan(fx.root, g.stub);
  const meta = JSON.parse(await fs.readFile(path.join(fx.stageDir, '_meta', `run-${runId}.json`), 'utf8'));
  await writeDisposition(fx.stageDir, runId);
  const stateBefore = await gateState(fx.root);
  const check = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION]);
  const cj = JSON.parse(extractJsonCandidate(check.stdout).json);
  const stateAfter = await gateState(fx.root);
  const stop = await hook(fx.root, 'hook-stop', { session_id: SESSION, hook_event_name: 'Stop' });
  const commit = await hook(fx.root, 'hook-pre-commit', { session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } });
  const w = (cj.warnings ?? []).find((x) => x.code === 'readonly_breach_unconfirmed');
  const f = (cj.failures ?? []).find((x) => x.code === 'readonly_breach');
  const got = check.code === 0 ? 'release' : 'block';
  out.grids.push({
    grid: g.id, desc: g.desc, stub: g.stub, extra_review: g.extraReview,
    review_exit: reviewExit, run_status: meta.status,
    guard: { readonly_breach: meta.guard.readonly_breach, breached_files: meta.guard.breached_files },
    drift: meta.snapshot.drift,
    gate_check: {
      exit: check.code, ok: cj.ok,
      failure_codes: (cj.failures ?? []).map((x) => x.code),
      warning_codes: (cj.warnings ?? []).map((x) => x.code),
      readonly_breach_message: f?.message ?? null,
      readonly_breach_unconfirmed_message: w?.message ?? null,
    },
    gate_state: { before_check: stateBefore, after_check: stateAfter },
    hooks_after_check: { stop_exit: stop.code, pre_commit_exit: commit.code, stop_reason_head: (stop.stdout.trim().split('\n')[0] ?? '').slice(0, 160) },
    expect: g.expect, got, pass: got === g.expect,
  });
  console.log(`${g.id} ${g.desc}：期望 ${g.expect}，实得 ${got}（gate --check 退 ${check.code}；failures ${JSON.stringify(out.grids.at(-1).gate_check.failure_codes)}；warnings ${JSON.stringify(out.grids.at(-1).gate_check.warning_codes)}；drift.changed ${meta.snapshot.drift.changed}${meta.snapshot.drift.unknown_reason ? `，unknown ${meta.snapshot.drift.unknown_reason.cause}` : ''}；闸门 ${stateBefore} → ${stateAfter}）`);
}
out.all_pass = out.grids.every((x) => x.pass);
await fs.writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`三格 ${out.grids.filter((x) => x.pass).length}/${out.grids.length} 符合期望`);
process.exitCode = out.all_pass ? 0 : 1;
