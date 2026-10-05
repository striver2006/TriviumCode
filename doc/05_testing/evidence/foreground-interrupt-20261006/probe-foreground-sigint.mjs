// EV-155 零配额实测：前台进程以 run(…, { killTree: true }) 拉起子进程（替身 /bin/sleep），
// 模拟终端 Ctrl-C——SIGINT 发给前台进程组——之后，子进程是否被遗弃（过继给 init 继续活着）。
// 结构：本脚本 = 「终端」；它 detached 起一个「前台进程」（自成一组，组号 = 其 pid），前台进程用仓库 bundle 的 run()
// 以 killTree 拉起 sleep（sleep 自成另一组）。然后本脚本向前台进程组发 SIGINT（终端 Ctrl-C 的形态），观察：
// 前台进程是否退出、sleep 是否还活着、sleep 的 ppid。最后只结束本脚本自己拉起的那两组（组号来自 spawn 返回的 pid 与前台进程报的 pid）。
// 用法：node ev155-probe.mjs 〈仓库根〉 〈变体：plain | handler〉
//   plain   —— 前台进程不装任何信号处理器（现状）
//   handler —— 前台进程装 SIGINT 处理器：调 shutdownTrackedTrees 结束登记过的树后退出（候选修法的形态）
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const [repo, variant = 'plain'] = process.argv.slice(2);
if (!repo) throw new Error('用法：node ev155-probe.mjs 〈仓库根〉 〈plain|handler〉');
const execJs = path.join(repo, 'dist/test/src/trivium/util/exec.js');
const fg = `
const m = await import(${JSON.stringify(execJs)});
${variant === 'handler' ? `process.on('SIGINT', async () => { await m.shutdownTrackedTrees({ graceMs: 1000, killWaitMs: 1000 }).catch(() => {}); process.exit(130); });` : ''}
const p = m.run('/bin/sleep', ['30'], { killTree: true, timeoutMs: 60000 });
setTimeout(() => {
  const kids = m.trackedTrees().map((t) => t.pgid);
  process.stdout.write('KIDS ' + JSON.stringify(kids) + '\\n');
}, 300);
await p;
`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (pid) => {
  try { return execFileSync('/bin/ps', ['-o', 'pid=,ppid=,pgid=,stat=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; }
};
const child = spawn(process.execPath, ['--input-type=module', '-e', fg, 'trivium-ev155-probe'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (c) => (out += c));
child.stderr.on('data', (c) => (err += c));
const exited = new Promise((r) => child.once('exit', (code, sig) => r({ code, sig })));
let kids = [];
for (let i = 0; i < 50 && kids.length === 0; i++) {
  await sleep(100);
  const m = /KIDS (\[.*\])/.exec(out);
  if (m) kids = JSON.parse(m[1]);
}
const before = kids.map(ps);
process.kill(-child.pid, 'SIGINT');
const fgExit = await Promise.race([exited, sleep(5000).then(() => 'still-running')]);
await sleep(1500);
const after = kids.map(ps);
console.log(JSON.stringify({ variant, fg_pid: child.pid, fg_exit: fgExit, kids, before, after, stderr_head: err.split('\n').slice(0, 3) }, null, 2));
// 收尾：只动本脚本拉起的组
try { process.kill(-child.pid, 'SIGKILL'); } catch {}
for (const k of kids) { try { if (typeof k === 'number' && k > 1) process.kill(-k, 'SIGKILL'); } catch {} }
