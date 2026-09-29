// 执行文档与清单变异（计划 r2 §5.4 ③；代码双审 r1 CODEX-02 / 03 / 04 修订）。
//
// 逐条：备份原文并写日志 → 施加 → （改 helper 的先 tests-only 重编）→ 只跑目标测试文件 → 记 fail 数与失败用例名
// → 写回原文并**立即**核 sha256 → （改 helper 的再重编）→ 读数立即落盘。全族结束后再 tests-only 重编、复跑目标测试确认零失败。
//
// 它在**活工作树**上改文件（doc/、.reviews/README.md、test/helpers/），所以：
//   · 有任何主题的闸门处于 running（审查进行中）或 awaiting_approval（闸门期）就拒跑，退 2；
//   · 每条施加前把原文备份到本次 mkdtemp 目录，并把「正在改哪个文件、原 sha256、备份在哪」写进日志
//     doc-mutation.journal.json；SIGINT / SIGTERM 时先按备份还原再退出；
//   · 日志还在（上次被硬杀）就拒跑，退 2——用 `--recover` 按日志从备份还原，不要用 git checkout
//     （那会连本主题未提交的改动一起抹掉）；
//   · 不要求工作树干净：本装置的用途就是提交前给代码双审看读数；启动时的 git status 快照记进读数。
// 退出码：0 全部符合期望；1 有变异不符合期望；2 环境前提不满足（含重编失败、测试输出解析不出）。
// 用法：node scripts/build.mjs --tests-only && node <本目录>/gen-doc-mutation-spec.mjs && node <本目录>/doc-mutation.mjs
//       中断恢复：node <本目录>/doc-mutation.mjs --recover
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, ROOT, TEST_JS, checkPrereqs, git } from './lib.mjs';

const JOURNAL = path.join(HERE, 'doc-mutation.journal.json');
const OUTPUT = path.join(HERE, 'doc-mutation-output.json');
const BUNDLE = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const sha = (s) => createHash('sha256').update(s).digest('hex');

function fatal(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

// ── 中断恢复 ──
function restoreFromJournal() {
  const j = JSON.parse(readFileSync(JOURNAL, 'utf8'));
  if (j.current) {
    const abs = path.join(ROOT, j.current.file);
    const now = existsSync(abs) ? sha(readFileSync(abs, 'utf8')) : null;
    if (now !== j.current.sha) {
      writeFileSync(abs, readFileSync(j.current.backup, 'utf8'));
      if (sha(readFileSync(abs, 'utf8')) !== j.current.sha) fatal(`还原后 sha256 仍不符：${j.current.file}（备份在 ${j.current.backup}）`);
      console.log(`已按备份还原 ${j.current.file}（中断于 ${j.current.id}）`);
    } else {
      console.log(`${j.current.file} 已是原文，无需还原`);
    }
    if (j.current.rebuild) rebuildTests();
  }
  unlinkSync(JOURNAL);
  if (j.backup_dir && existsSync(j.backup_dir)) rmSync(j.backup_dir, { recursive: true, force: true });
}

if (process.argv.includes('--recover')) {
  if (!existsSync(JOURNAL)) fatal('没有中断日志，无需恢复', 0);
  restoreFromJournal();
  process.exit(0);
}

// ── 前提 ──
checkPrereqs();
if (existsSync(JOURNAL)) {
  fatal(`上次变异被中断，日志还在：${path.relative(ROOT, JOURNAL)}\n先跑 node ${path.relative(ROOT, path.join(HERE, 'doc-mutation.mjs'))} --recover 按备份还原（不要用 git checkout，会抹掉未提交的改动）`);
}
if (!existsSync(BUNDLE)) fatal(`环境前提不满足：仓库构建不存在，无法核对是否有审查在跑（先 npm run build）`);
{
  const r = spawnSync(process.execPath, [BUNDLE, 'status', '--json'], { cwd: ROOT, encoding: 'utf8' });
  let busy;
  try {
    busy = JSON.parse(r.stdout).topics.flatMap((t) =>
      (t.open_gates ?? []).filter((g) => g.state === 'running' || g.state === 'awaiting_approval').map((g) => `${t.topic} / ${g.stage}：${g.state}`),
    );
  } catch {
    fatal(`环境前提不满足：读不懂 trivium status --json 的输出（退出码 ${r.status}）`);
  }
  if (busy.length) fatal(`有审查在跑或处于闸门期，变异会改工作树，拒跑：\n  - ${busy.join('\n  - ')}`);
}

const spec = JSON.parse(readFileSync(path.join(HERE, 'doc-mutation-spec.json'), 'utf8'));
const gitStatus = git(['status', '--porcelain']).split('\n').filter(Boolean);

function rebuildTests() {
  const r = spawnSync(process.execPath, ['scripts/build.mjs', '--tests-only'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw Object.assign(new Error(`tests-only 构建失败：${r.stderr}`), { buildFailed: true });
}

function runTarget() {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', TEST_JS], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = r.stdout ?? '';
  const fail = Number(/^# fail (\d+)/m.exec(out)?.[1]);
  const pass = Number(/^# pass (\d+)/m.exec(out)?.[1]);
  if (!Number.isInteger(fail) || !Number.isInteger(pass)) {
    return { parseError: `测试输出里找不到整数的「# pass / # fail」汇总行（退出码 ${r.status}）：\n${out.split('\n').slice(0, 40).join('\n')}` };
  }
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
  const kinds = [...new Set([...out.matchAll(/\[([a-z_]+)\]/g)].map((m) => m[1]))].sort();
  return { status: r.status, pass, fail, failed, kinds };
}

const baseline = runTarget();
if (baseline.parseError) fatal(`环境前提不满足：${baseline.parseError}`);
if (baseline.fail !== 0) fatal(`基线就不是全绿（fail=${baseline.fail}），不跑变异：${baseline.failed.join(' / ')}`, 1);

const backupDir = mkdtempSync(path.join(os.tmpdir(), 'facade-mutation-'));
const results = [];
const writeOutput = (extra = {}) => {
  writeFileSync(
    OUTPUT,
    `${JSON.stringify(
      {
        base: spec.base,
        generated_at: new Date().toISOString(),
        git_status_at_start: gitStatus,
        baseline: { pass: baseline.pass, fail: baseline.fail },
        total: spec.mutations.length,
        done: results.length,
        ok: results.filter((x) => x.ok).length,
        ...extra,
        results,
      },
      null,
      2,
    )}\n`,
  );
};

// 信号处理器只置标记：循环全靠 spawnSync，事件循环不空转时处理器根本跑不到（中断演练 D1 第一次就是这样
// 照常跑完、退 0）。所以循环在「文件处于变异态」的那一刻让出一次事件循环，再看标记——
// 处理器跑到了就立刻写回原文并退 130。
let stopRequested = null;
let current = null;
const onSignal = (sig) => {
  stopRequested ??= sig;
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
const tick = () => new Promise((r) => setImmediate(r));

async function stopIfRequested() {
  await tick();
  if (!stopRequested) return;
  if (current) {
    try {
      writeFileSync(current.abs, current.original);
      if (current.rebuild) rebuildTests();
    } catch (err) {
      console.error(`中断时还原失败，按日志用 --recover 再试：${err.message}`);
      process.exit(130);
    }
  }
  writeOutput({ interrupted: `${stopRequested}，中断于 ${current?.id ?? '两条之间'}` });
  if (existsSync(JOURNAL)) unlinkSync(JOURNAL);
  rmSync(backupDir, { recursive: true, force: true });
  console.error(`收到 ${stopRequested}，已还原并退出（中断于 ${current?.id ?? '两条之间'}）`);
  process.exit(130);
}

for (const [i, m] of spec.mutations.entries()) {
  await stopIfRequested();
  const abs = path.join(ROOT, m.file);
  const original = readFileSync(abs, 'utf8');
  const before = sha(original);
  const row = { id: m.id, family: m.family, expect: m.expect, why: m.why };
  if (original.split(m.find).length - 1 !== 1) {
    results.push({ ...row, ok: false, error: 'spec_mismatch：find 在目标文件里不是恰好一次（规格与文档失配，重跑生成脚本）' });
    writeOutput();
    console.log(`✗ ${m.id.padEnd(16)} spec_mismatch`);
    continue;
  }
  const backup = path.join(backupDir, `${i}.orig`);
  writeFileSync(backup, original);
  writeFileSync(JOURNAL, `${JSON.stringify({ backup_dir: backupDir, current: { id: m.id, file: m.file, sha: before, backup, rebuild: m.rebuild } }, null, 2)}\n`);
  current = { id: m.id, abs, original, rebuild: m.rebuild };

  let r;
  let buildError = null;
  try {
    writeFileSync(abs, original.replace(m.find, m.replace));
    if (m.rebuild) rebuildTests();
    r = runTarget();
  } catch (err) {
    buildError = err;
  }
  await stopIfRequested();
  writeFileSync(abs, original);
  const restored = sha(readFileSync(abs, 'utf8')) === before;
  try {
    if (m.rebuild) rebuildTests();
  } catch (err) {
    buildError ??= err;
  }
  current = null;
  unlinkSync(JOURNAL);

  if (buildError || r?.parseError) {
    results.push({ ...row, ok: false, restored, error: buildError ? `build_failed：${buildError.message}` : `parse_error：${r.parseError}` });
    writeOutput({ aborted: m.id });
    rmSync(backupDir, { recursive: true, force: true });
    fatal(`环境前提不满足（${m.id}）：${buildError ? buildError.message : r.parseError}\n源文件${restored ? '已' : '未'}还原；后续读数不可信，整族中止`);
  }
  const ok = (m.expect === 'red' ? r.fail > 0 : r.fail === 0) && restored;
  results.push({ ...row, fail: r.fail, pass: r.pass, failed: r.failed, kinds: r.kinds, restored, ok });
  writeOutput();
  console.log(`${ok ? '✓' : '✗'} ${m.id.padEnd(16)} 期望 ${m.expect.padEnd(5)} fail=${r.fail} ${restored ? '已还原' : '未还原！'}  ${r.kinds.join(',')}  ${r.failed.slice(0, 3).join(' / ')}`);
}

rmSync(backupDir, { recursive: true, force: true });
rebuildTests();
const after = runTarget();
if (after.parseError) fatal(`环境前提不满足：${after.parseError}`);
writeOutput({ after: { pass: after.pass, fail: after.fail } });
const okCount = results.filter((x) => x.ok).length;
console.log(`\n变异 ${okCount}/${results.length} 符合期望；变异前 ${baseline.pass} 过 / ${baseline.fail} 败，全族结束重编后 ${after.pass} 过 / ${after.fail} 败`);
process.exit(okCount === spec.mutations.length && after.fail === 0 ? 0 : 1);
