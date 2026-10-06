// EV-155 真实 CLI 验证（花少量配额，用户 2026-10-06 授权）：前台进程装 installForegroundInterruptForwarding，
// 以仓库构建的调用函数同时拉起三家真实审查员 CLI（agy 走 invokeAgy、zcode 走 invokeZcode、codex 用 run() 按 killTree
// 直接起 `codex exec -s read-only`——正式调用要准备凭据副本目录，这里只验进程组能否被结束），8 s 后对前台进程组发 SIGINT
// （终端 Ctrl-C 的形态）。看：前台是否以 SIGINT 退出、登记的各进程组成员是否归零、命令行含标记的进程是否一个不剩。
// 提示语要求长篇输出、带唯一标记；调用在 8 s 左右被打断，只消耗很少配额。
// 用法：node real-cli-sigint.mjs 〈仓库根〉 〈工作目录（须已存在、为空）〉
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [repo, cwd] = process.argv.slice(2);
if (!fs.existsSync(cwd) || fs.readdirSync(cwd).length !== 0) throw new Error('工作目录须已存在且为空');
const MARK = `EV155-${process.pid}-${Date.now()}`;
const prompt = `请写一篇关于软件测试方法论的长文，不少于三千字，分十个小节（标记 ${MARK}，不要调用任何工具）。`;
const dist = (p) => JSON.stringify(path.join(repo, 'dist/test/src/trivium', p));
const code = `
const rp = await import(${dist('run-protocol.js')});
const ex = await import(${dist('util/exec.js')});
const agy = await import(${dist('adapters/agy.js')});
const zc = await import(${dist('adapters/zcode.js')});
rp.installForegroundInterruptForwarding();
const P = ${JSON.stringify(prompt)}, CWD = ${JSON.stringify(cwd)};
void agy.invokeAgy({ bin: '/Users/chenzhenbo/.local/bin/agy', cwd: CWD, prompt: P, agent: 'trivium-critic', timeoutMs: 300000 });
void zc.invokeZcode({ entry: '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs', node: process.execPath, cwd: CWD, prompt: P,
  readonlyArgs: ['--mode', 'plan', '--disallowed-tools', 'Write,Edit,MultiEdit,ApplyPatch,Bash'], timeoutMs: 300000 });
void ex.run('/opt/homebrew/bin/codex', ['exec', '--skip-git-repo-check', '-s', 'read-only', P], { cwd: CWD, stdin: '', killTree: true, timeoutMs: 300000 });
setInterval(() => {}, 1000);
setTimeout(() => process.stdout.write('READY ' + JSON.stringify(ex.trackedTrees().map((t) => t.pgid)) + '\\n'), 8000);
`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psAll = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8' }).split('\n');
const members = (pgid) => psAll().filter((l) => Number(/^\s*\d+\s+\d+\s+(\d+)/.exec(l)?.[1]) === pgid && !/^\s*\d+\s+\d+\s+\d+\s+Z/.test(l));
const marked = () => psAll().filter((l) => l.includes(MARK) && !l.includes('real-cli-sigint'));

const child = spawn(process.execPath, ['--input-type=module', '-e', code], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (c) => (out += c));
child.stderr.on('data', (c) => (err += c));
const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
let groups = null;
for (let i = 0; i < 200 && groups === null; i++) {
  await sleep(100);
  const m = /READY (\[.*\])/.exec(out);
  if (m) groups = JSON.parse(m[1]);
}
const before = { groups, members: Object.fromEntries((groups ?? []).map((g) => [g, members(g).length])), marked: marked().length };
process.kill(-child.pid, 'SIGINT');
const t0 = Date.now();
const ex = await Promise.race([exited, sleep(20_000).then(() => 'still-running')]);
const exitMs = Date.now() - t0;
await sleep(2_000);
const after = { members: Object.fromEntries((groups ?? []).map((g) => [g, members(g)])), marked: marked() };
console.log(JSON.stringify({ mark: MARK, before, fg_exit: ex, exit_ms: exitMs, after, stderr_head: err.split('\n').slice(0, 4) }, null, 2));
// 收尾：只动本脚本拉起的组（前台进程组与它登记的各组）；有残留就如实留在上面的输出里
for (const g of [child.pid, ...(groups ?? [])]) { try { process.kill(-g, 'SIGKILL'); } catch {} }
