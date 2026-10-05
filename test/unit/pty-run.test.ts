/**
 * `run()` 的 pty 模式在 macOS 上跑得起来（EV-156）。
 *
 * - N 系列直测 `ptyOutputNormalizer`：首部 `^D\b\b` 去掉、`\r\n` 还原，含被拆在两块之间的两种边界；正文中间的同样字符不动。
 * - R 系列在 macOS 上真跑 `run(…, { pty: true })`，被包装的是 `/bin/echo`、`/usr/bin/tty`、`/bin/sh -c`（零配额）：
 *   改前 stdin 是管道，BSD `script` 直接退 1（`tcgetattr/ioctl: Operation not supported on socket`），命令根本没跑。
 *   非 macOS 跳过（Linux 的 util-linux 分支未实测、原样不动）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PTY_EOF_ECHO, ptyOutputNormalizer, run } from '../../src/trivium/util/exec.js';

const feed = (chunks: string[]): string => {
  const n = ptyOutputNormalizer();
  return chunks.map((c) => n.push(c)).join('') + n.flush();
};

test('EV-156 N1：首部回显去掉，\\r\\n 还原', () => {
  assert.equal(PTY_EOF_ECHO, '^D\b\b');
  assert.equal(feed(['^D\b\bL1\r\nL2\r\n']), 'L1\nL2\n');
});

test('EV-156 N2：回显被拆在两块之间、\\r 落在块尾——照样还原', () => {
  assert.equal(feed(['^D', '\b\bA\r', '\nB\r', '\n']), 'A\nB\n');
  assert.equal(feed(['^', 'D\b', '\b', '{"a":1}']), '{"a":1}');
});

test('EV-156 N3：没有回显、正文中间出现同样字符、孤立的 \\r——都原样保留', () => {
  assert.equal(feed(['hello\r\n']), 'hello\n');
  assert.equal(feed(['x^D\b\by']), 'x^D\b\by');
  assert.equal(feed(['50%\r', '100%\r\n']), '50%\r100%\n');
  assert.equal(feed(['tail\r']), 'tail\r', '流末的 \\r 由 flush 吐回');
  assert.equal(feed(['^D']), '^D', '只有半截回显时 flush 原样吐回');
  assert.equal(feed([]), '');
});

const skip = process.platform !== 'darwin' ? '只在 macOS（BSD script）上跑' : false;

test('EV-156 R1（macOS）：pty 模式跑得起来，stdout 与非 pty 一致', { skip, timeout: 30_000 }, async () => {
  const r = await run('/bin/echo', ['hello-pty'], { pty: true, timeoutMs: 15_000 });
  assert.equal(r.code, 0, `script 应退 0：stderr=${r.stderr}`);
  assert.equal(r.stdout, 'hello-pty\n');
  const plain = await run('/bin/echo', ['hello-pty'], { timeoutMs: 15_000 });
  assert.equal(plain.stdout, r.stdout, '非 pty 回归：输出相同');
});

test('EV-156 R2（macOS）：被包装的命令确实拿到了伪终端', { skip, timeout: 30_000 }, async () => {
  const r = await run('/usr/bin/tty', [], { pty: true, timeoutMs: 15_000 });
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  assert.match(r.stdout, /^\/dev\/ttys\d+\n$/, `应打出伪终端设备名：${JSON.stringify(r.stdout)}`);
});

test('EV-156 R3（macOS）：逐行回调不带 \\r，stderr 经伪终端并进 stdout', { skip, timeout: 30_000 }, async () => {
  const lines: string[] = [];
  const r = await run('/bin/sh', ['-c', 'echo L1; echo E1 >&2; echo L2'], {
    pty: true, timeoutMs: 15_000, onStdoutLine: (l) => lines.push(l),
  });
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  assert.deepEqual(lines, ['L1', 'E1', 'L2']);
  assert.equal(r.stdout, 'L1\nE1\nL2\n');
  assert.equal(r.stderr, '', '被包装命令的 stderr 不再单独出现');
});

test('EV-156 R4（macOS）：输出以孤立的 \\r 收尾——收尾时吐回扣住的 \\r，不丢字符', { skip, timeout: 30_000 }, async () => {
  const r = await run('/bin/sh', ['-c', "printf 'a\\r'"], { pty: true, timeoutMs: 15_000 });
  assert.equal(r.code, 0, `stderr=${r.stderr}`);
  assert.equal(r.stdout, 'a\r');
});
