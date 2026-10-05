// EV-156 · stdin 为 /dev/null 时 BSD script 往伪终端送 EOF，回显 `^D\b\b`——看它在输出里的位置稳不稳定、
// 伪终端是否把 \n 改成 \r\n。零配额：被包装的是 /bin/sh -c 的 echo / sleep / printf。
// 每种内层命令跑 N 次，统计 `^D\b\b` 出现的位置（首部 / 中间 / 末尾 / 没有）与 \r\n 出现次数。
// 用法：node probe-pty-eof-echo.mjs [次数，默认 20]（只读，不建文件）
import { spawn } from 'node:child_process';

const N = Number(process.argv[2] ?? 20);
const ECHO = '^D\b\b';
const run = (inner) =>
  new Promise((resolve) => {
    const child = spawn('script', ['-q', '/dev/null', '/bin/sh', '-c', inner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });

const INNERS = {
  fast: 'echo L1; echo L2; echo L3',
  delayed: 'sleep 0.3; echo L1; echo L2',
  burst: 'i=0; while [ $i -lt 200 ]; do echo line$i; i=$((i+1)); done',
  silent_then: 'sleep 0.1; printf "%s" "{\\"a\\":1}"',
};

const summary = {};
for (const [name, inner] of Object.entries(INNERS)) {
  const pos = { head: 0, middle: 0, tail: 0, none: 0, multi: 0 };
  let crlf = 0;
  let codes = new Set();
  let sample = null;
  for (let i = 0; i < N; i++) {
    const r = await run(inner);
    codes.add(r.code);
    const n = r.out.split(ECHO).length - 1;
    if (n > 1) pos.multi++;
    const at = r.out.indexOf(ECHO);
    if (at === -1) pos.none++;
    else if (at === 0) pos.head++;
    else if (at + ECHO.length === r.out.length) pos.tail++;
    else pos.middle++;
    if (r.out.includes('\r\n')) crlf++;
    if (sample === null) sample = JSON.stringify(r.out.slice(0, 80));
  }
  summary[name] = { runs: N, codes: [...codes], echo_pos: pos, has_crlf: crlf, sample_head: sample };
}
console.log(JSON.stringify({ platform: process.platform, node: process.version, summary }, null, 2));
