#!/usr/bin/env node
/**
 * EV-82 第二段实验（计划 r2 §5）：零配额观测三次拉起的运行期选定。
 *
 *   ① 白名单臂 probeModelOverride
 *   ② 同形臂原样 probeModelOverrideFullCopy（variant: as-is）
 *   ③ 同形臂置首 probeModelOverrideFullCopy（variant: requested-first）
 *
 * 三次都显式请求同一个模型（GLM-07）。副本凭据一律换哨兵，拉起带只读参数（取自探针结论），零配额。
 *
 * - 只读：不改真实 `~/.zcode/**`；读 `cli/config.json` 只取 provider / 成员 id 的结构（算目录首位），不输出任何值；
 * - 输出只含请求值、配置层结论、运行期读数（值或成因）、置首是否生效、替换键**路径**；
 * - 清理只认 `mkdtemp` 的返回值（2026-09-20 事故 R1）；两臂自己的临时根由仓库函数自清；
 * - 仓库根按脚本位置推导，不写死绝对路径（EV-103）。
 *
 * 用法：先 `node scripts/build.mjs --tests-only`，再 `node doc/05_testing/evidence/ev82-seg2-20260924/runtime-selection.mjs`
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium', p)).href);

const { probeModelOverride, probeModelOverrideFullCopy, ZCODE_CLI_CONFIG } = await mod('probes/zcode.js');
const { legacyProviderMembers, readonlyArgsFromProbe } = await mod('adapters/zcode.js');
const { loadCtx } = await mod('config.js');

const REQUESTED = 'bigmodel-coding-plan/GLM-5.3-Flash';
const S5_ENTRY_SHA16 = 'b1df2ef3e5bd76c4';
const STARTUP_EVENT = 'bootstrap.app.startup.runtime_config.completed';
const tail = (m) => (m === null || m === undefined ? null : m.slice(m.indexOf('/') + 1));

// ── 环境登记（r2 §5.1 GLM-03）──
const ctx = await loadCtx({ cwd: ROOT });
const zp = ctx.config.probe.cli.zcode;
if (!zp?.entrypoint) throw new Error('探针结论里没有 zcode.entrypoint，先跑 trivium doctor');
const entryBytes = await fs.readFile(zp.entrypoint);
const entrySha16 = createHash('sha256').update(entryBytes).digest('hex').slice(0, 16);
const eventLiteralPresent = entryBytes.includes(Buffer.from(STARTUP_EVENT));
const readonlyArgs = readonlyArgsFromProbe(zp.readonly_flags ?? []);

const cliCfg = JSON.parse(await fs.readFile(ZCODE_CLI_CONFIG, 'utf8'));
let catalogFirst = null;
for (const [pk, members] of legacyProviderMembers(cliCfg)) {
  const first = members.values().next().value;
  if (first !== undefined) { catalogFirst = `${pk}/${first}`; break; }
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const env = {
  entrypoint: zp.entrypoint,
  entry_sha256_16: entrySha16,
  entry_same_as_s5: entrySha16 === S5_ENTRY_SHA16,
  version_probe: zp.version ?? null,
  startup_event_literal_present: eventLiteralPresent,
  readonly_args: readonlyArgs,
  host_preset_env: ['ZCODE_LOG_DIR', 'ZCODE_API_KEY', 'ZCODE_BASE_URL'].filter((k) => process.env[k]),
  catalog_first: catalogFirst,
  git_head: git('rev-parse', 'HEAD'),
  worktree_dirty_outside_evidence: git('status', '--porcelain', '--', ':!doc/05_testing/evidence/ev82-seg2-20260924') !== '',
  node: process.version,
  ran_at: new Date().toISOString(),
};

// ── 三次拉起；运行期读数非 ok 的复跑一次（r2 §5.3 (N)）──
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev82seg2-cwd-'));
const node = process.execPath;
const summarize = (name, r, attempt) => ({
  name, attempt,
  requested: r.requested,
  override: r.override,
  observed: r.observed,
  runtime: r.runtimeSelected ?? null,
  variant: r.variant ?? null,
  replaced_paths: r.replacedPaths ?? null,
  host_credential_env: r.hostCredentialEnv ?? null,
  why: r.why,
});
const arms = [
  ['① 白名单臂', () => probeModelOverride(zp.entrypoint, node, cwd, { model: REQUESTED, readonlyArgs })],
  ['② 同形原样', () => probeModelOverrideFullCopy(zp.entrypoint, node, cwd, { model: REQUESTED, readonlyArgs, variant: 'as-is' })],
  ['③ 同形置首', () => probeModelOverrideFullCopy(zp.entrypoint, node, cwd, { model: REQUESTED, readonlyArgs, variant: 'requested-first' })],
];
const runs = [];
try {
  for (const [name, fn] of arms) {
    let s = summarize(name, await fn(), 1);
    if (s.runtime?.cause !== 'ok') {
      runs.push(s);
      s = summarize(name, await fn(), 2);
    }
    runs.push(s);
  }
} finally {
  await fs.rm(cwd, { recursive: true, force: true });
}

// ── 判读表：按次序首命中（r2 §5.3），机判供人核 ──
const final = (name) => runs.filter((r) => r.name === name).at(-1);
const [w, a, f] = ['① 白名单臂', '② 同形原样', '③ 同形置首'].map(final);
const firstTail = tail(catalogFirst);
const reqTail = tail(REQUESTED);
const notes = [];
let cell;
if (!eventLiteralPresent) cell = '(V) 环境：包内事件名字面已不在 ⇒ 整轮作废';
else {
  if (!env.entry_same_as_s5) notes.push('(V) 入口摘要与 S5 不同：全部读数加注「环境已变」');
  if (new Set([w, a, f].map((r) => r.requested)).size !== 1) notes.push('三次请求值不一致：F1 / F4 降级为「各自请求值上成立」');
  const rt = (r) => (r.runtime?.cause === 'ok' ? tail(r.runtime.model) : null);
  if ([w, a, f].some((r) => r.runtime?.cause !== 'ok')) cell = '(N) 读数不可用';
  else if (rt(w) !== rt(a)) cell = '(F4) 两臂分歧';
  else if (rt(a) === firstTail && f.variant?.applied && rt(f) === reqTail) cell = '(F1) 置首生效';
  else if (rt(a) === reqTail) cell = '(F2) 哨兵与真实不同';
  else if (rt(a) === firstTail && f.variant?.applied && rt(f) === firstTail) cell = '(F3) 置首无效';
  else cell = '(X) 兜底';
}

const out = { plan: 'EV-82 第二段计划 r2 §5', requested: REQUESTED, env, runs, judgement: { cell, notes } };
const outPath = path.join(HERE, 'runtime-selection-output.json');
await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`环境：入口 ${entrySha16}（S5 ${env.entry_same_as_s5 ? '相同' : '不同'}）｜版本 ${env.version_probe} ｜ 事件名字面 ${eventLiteralPresent ? '在' : '不在'} ｜ 目录首位 ${catalogFirst} ｜ HEAD ${env.git_head.slice(0, 7)} ｜ 宿主预置 ${env.host_preset_env.join(',') || '无'}`);
for (const r of runs) {
  const rs = r.runtime ? (r.runtime.cause === 'ok' ? r.runtime.model : `读不到（${r.runtime.cause}）`) : '未采集';
  const v = r.variant ? `｜ 变体 ${r.variant.variant} ${r.variant.applied ? '生效' : `未生效：${r.variant.reason ?? ''}`}` : '';
  console.log(`${r.name}（第 ${r.attempt} 次）：请求 ${r.requested} ｜ 配置层 ${r.override}（写出 ${r.observed}）｜ 运行期 ${rs} ${v}`);
}
console.log(`判读：${cell}${notes.length ? '；' + notes.join('；') : ''}`);
console.log(`输出：${path.relative(ROOT, outPath)}`);
