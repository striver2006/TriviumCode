/**
 * ISSUE-08 的实测验收：Windows Job（KILL_ON_JOB_CLOSE）收杀下，detached worker 的生死。
 *
 * 验收批次 four-agent-win-20261029 实锤的形态：agy 会话的工具通道把派生链圈进收杀 Job，
 * `--start` 派生的 detached worker 12~15 s 静默死（`detached` 只是 DETACHED_PROCESS|
 * CREATE_NEW_PROCESS_GROUP，**逃不出 Job**）；worker 被杀时它拉起的审查 CLI 成孤儿、持日志锁。
 *
 * 本文件用 P/Invoke 夹具（`test/fixtures/win-job-escape/harness.ps1`）原样复刻该形态：
 * 建收杀 Job → 挂起创建父进程（= 工具通道里的 `trivium --start`）→ assign 进 Job → 放行，
 * 父进程经 `spawnDetached` 派生 worker 后退出，随后关闭 Job（= 通道结束）：
 *   - 对照组（direct，修复前形态）：worker 必须随 Job 关闭被收杀——夹具本身的可信度断言；
 *   - 实验组（escape，`winRelay` WMI 中继）：worker 必须存活并继续心跳。
 * 两个都断言：夹具如果造不出收杀 Job，对照组先红，不会出现「双绿但什么都没测到」。
 *
 * PowerShell 直接封送 ref struct 时 `SetInformationJobObject` 的标志会静默丢失（win32 实测：
 * 返回 True、回读 0x0，Job 不收杀、对照组假绿）——夹具因此整段 C# 内联。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IS_WIN } from '../helpers/platform.js';
import { run } from '../../src/trivium/util/exec.js';
import { BUNDLE, REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 编译产物位于 dist/test/test/integration/，据此定位同构的 src 产物（win32 的 ESM import 需 file:// URL）
const EXEC_MODULE = pathToFileURL(path.resolve(HERE, '../../src/trivium/util/exec.js')).href;
const HARNESS = path.resolve(REPO_ROOT, 'test/fixtures/win-job-escape/harness.ps1');

interface HarnessOutcome {
  assigned?: string;
  pid?: number;
  before?: string;
  after?: string;
  error?: string;
  /** spawnDetached 实际走的通道（父进程把它写进 channel.txt） */
  channel?: string;
}

/** 跑一遍夹具：mode 决定父进程的派生形态（direct / escape） */
async function runHarness(mode: 'direct' | 'escape'): Promise<HarnessOutcome> {
  const dir = await scratchDir(`trivium-jobesc-${mode}-`);
  const workerScript = path.join(dir, 'worker.mjs');
  // worker 心跳：Job 关闭后仍要活着写文件（对照组死了自然停）
  await fs.writeFile(
    workerScript,
    `import { appendFileSync } from 'node:fs';
     const t0 = Date.now();
     appendFileSync(${JSON.stringify(path.join(dir, 'beat.txt'))}, 'start\\n');
     const iv = setInterval(() => {
       appendFileSync(${JSON.stringify(path.join(dir, 'beat.txt'))}, 'tick ' + (Date.now() - t0) + '\\n');
       if (Date.now() - t0 > 25000) { clearInterval(iv); process.exit(0); }
     }, 300);`,
    'utf8',
  );
  const parentScript = path.join(dir, `parent-${mode}.mjs`);
  const winRelay = mode === 'escape'
    ? `, winRelay: { bin: process.execPath, args: [${JSON.stringify(BUNDLE)}, 'review', '--spawn-relay'] }`
    : '';
  await fs.writeFile(
    parentScript,
    `import { writeFileSync, appendFileSync } from 'node:fs';
     const { spawnDetached } = await import(${JSON.stringify(EXEC_MODULE)});
     const r = await spawnDetached(process.execPath, [${JSON.stringify(workerScript)}], {
       cwd: ${JSON.stringify(dir)},
       logFile: ${JSON.stringify(path.join(dir, 'worker.log'))}${winRelay},
     });
     writeFileSync(${JSON.stringify(path.join(dir, 'pid.txt'))}, String(r.pid) + '\\n');
     appendFileSync(${JSON.stringify(path.join(dir, 'channel.txt'))}, r.channel + '\\n');`,
    'utf8',
  );
  const pidFile = path.join(dir, 'pid.txt');
  const outFile = path.join(dir, 'result.txt');
  const ps = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HARNESS, '-ParentJs', parentScript, '-PidFile', pidFile, '-OutFile', outFile],
    { cwd: dir, timeoutMs: 120_000 },
  );
  assert.equal(ps.code, 0, `夹具应正常退 0：\n${ps.stdout}\n${ps.stderr}`);
  const text = await fs.readFile(outFile, 'utf8');
  const out: HarnessOutcome = {};
  for (const kv of text.trim().split(/\s+/)) {
    const [k, v] = kv.split('=');
    if (k === 'pid') out.pid = Number(v);
    else if (k) (out as Record<string, string | number | undefined>)[k] = v;
  }
  out.channel = (await fs.readFile(path.join(dir, 'channel.txt'), 'utf8').catch(() => '')).trim();
  return out;
}

test('ISSUE-08 对照：direct 派生的 worker 被收杀 Job 连带杀死（复现验收形态）', { skip: !IS_WIN && 'win32 专属：KILL_ON_JOB_CLOSE Job 收杀语义（POSIX 无 Job 对应物）' }, async () => {
  const out = await runHarness('direct');
  assert.equal(out.error, undefined, `夹具出错：${JSON.stringify(out)}`);
  assert.equal(out.assigned, 'True', '父进程必须真的被 assign 进 Job，否则整个夹具不成立');
  assert.equal(out.before, 'ALIVE_IN_JOB', `worker 应被 Job 圈住（detached 逃不出），实际 before=${out.before}`);
  assert.equal(out.after, 'GONE', `Job 关闭后 worker 必须死——这里活了说明夹具没造出收杀 Job（假绿风险），实际 after=${out.after}`);
  assert.equal(out.channel, 'direct');
});

test('ISSUE-08 修复：WMI 中继派生的 worker 不进 Job，通道收杀后存活并持续心跳', { skip: !IS_WIN && 'win32 专属：WMI 派生逃 Job 机制（POSIX 上 spawnDetached 本就脱离父进程组）' }, async () => {
  const out = await runHarness('escape');
  assert.equal(out.error, undefined, `夹具出错：${JSON.stringify(out)}`);
  assert.equal(out.channel, 'wmi-escape', `逃逸通道必须成功（否则是静默回退，ISSUE-08 未修复）：\n${JSON.stringify(out)}`);
  assert.equal(out.before, 'ALIVE_NO_JOB', `worker 应不在任何 Job（WmiPrvSE 承载的中继派生），实际 before=${out.before}`);
  assert.equal(out.after, 'ALIVE_NO_JOB', `Job 关闭（通道结束）后 worker 必须仍活着——这正是验收里 12~15 s 静默死的场景，实际 after=${out.after}`);
  assert.ok(typeof out.pid === 'number' && out.pid! > 0);
  // 收尾：别把 worker 留到测试进程之后
  try {
    process.kill(out.pid!, 'SIGKILL');
  } catch {
    /* 已退出 */
  }
});
