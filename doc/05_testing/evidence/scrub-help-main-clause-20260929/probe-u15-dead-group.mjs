// 探针（清扫帮助主句失实 verify 失败的归因，与本主题改动无关）：复现 cli-group-record U15「不发信号的格」里「已退出」那一格的时序——
// detached `sh -c 'sleep 600; : "$0"'`（sh 派生 sleep 子进程），按组 SIGKILL，只等 sh 的 exit 事件，随即按 EV-165 的判据判这条记录。
// 统计判成什么：gone（期望）/ orphaned（按组 SIGKILL、sh 退出之后组号下仍有非僵尸成员，terminateRecordedCliGroups 会对它发信号）/ 其它。
// 成因未定：疑为按组 SIGKILL 的瞬间 sh 正在派生 sleep、子进程漏过了信号（未逐字节核实）。
// 零配额；只起本脚本自己的进程组，收尾按组结束。用法（在仓库根，先 build --with-tests）：node probe-u15-dead-group.mjs [次数] [with-live]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { cliGroupsConfirmedGone, newStatus } = await imp('dist/test/src/trivium/status.js');
const { processStartTime } = await imp('dist/test/src/trivium/util/exec.js');
const N = Number(process.argv[2] ?? 200);
const tally = {};
const samples = [];
const WITH_LIVE = process.argv[3] === 'with-live';
for (let i = 0; i < N; i++) {
  // with-live：像用例那样先派生一个活组（与「已退出」那组同时存在），收尾一并结束
  const live = WITH_LIVE ? spawn('/bin/sh', ['-c', 'sleep 600; : "$0"', 'probe-u15-live'], { detached: true, stdio: 'ignore' }) : null;
  const child = spawn('/bin/sh', ['-c', 'sleep 600; : "$0"', 'probe-u15-dead'], { detached: true, stdio: 'ignore' });
  const exited = new Promise((r) => child.once('exit', () => r()));
  const pgid = child.pid;
  const started = await processStartTime(pgid, { canonical: true });
  try { process.kill(-pgid, 'SIGKILL'); } catch { /* 已不在 */ }
  await exited;
  const s = newStatus({ runId: 'R', topic: 't', stage: 'plan', sides: ['claude'], models: {} });
  s.sides.claude.cli = { pgid, started_at: started };
  const r = await cliGroupsConfirmedGone(s);
  const kind = r.gone ? 'gone' : r.blockers.map((b) => b.kind).join('+');
  tally[kind] = (tally[kind] ?? 0) + 1;
  if (!r.gone && samples.length < 3) samples.push(r.why);
  try { process.kill(-pgid, 'SIGKILL'); } catch { /* 已不在 */ }
  if (live) try { process.kill(-live.pid, 'SIGKILL'); } catch { /* 已不在 */ }
}
console.log(JSON.stringify({ n: N, withLive: WITH_LIVE, tally, samples }, null, 2));
