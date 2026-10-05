// EV-156 · BSD script（macOS）在不同 stdin 形态下能否跑起来（零配额：被包装的命令是 /bin/echo 与 /usr/bin/tty）。
// `run()` 的 pty 分支是 `script -q /dev/null <bin> <args…>`，stdin 恒为管道（Node 在 macOS 上用 socketpair）。
// 这里把 stdin 分别给成 pipe / ignore（/dev/null）/ 一个普通文件，记 script 的退出码、stdout、stderr 首行，
// 再看被包装的命令是否真拿到了伪终端（`tty` 打印设备名而不是 `not a tty`）。
// 用法：node probe-pty-stdin.mjs（在任意目录；只读，不建文件）
import { spawn } from 'node:child_process';
import os from 'node:os';

const run = (stdin, inner) =>
  new Promise((resolve) => {
    const child = spawn('script', ['-q', '/dev/null', ...inner], { stdio: [stdin, 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    if (stdin === 'pipe') child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: out.replace(/\r/g, '').trim(), stderr: err.split('\n')[0] });
    });
  });

console.log(JSON.stringify({ platform: process.platform, release: os.release(), node: process.version }));
for (const stdin of ['pipe', 'ignore', 'inherit']) {
  for (const inner of [['/bin/echo', 'hello-pty'], ['/usr/bin/tty']]) {
    const r = await run(stdin, inner);
    console.log(JSON.stringify({ stdin, inner: inner.join(' '), ...r }));
  }
}
