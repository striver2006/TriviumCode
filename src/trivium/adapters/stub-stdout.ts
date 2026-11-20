/** 仅由 TRIVIUM_STUB_CRITIC 启用。两个构建可用同一子进程负载对照最终文件与 UI。 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runReviewProcess } from '../live-stdout.js';

export type StubStdout = 'latch' | 'sparse' | 'dense' | 'timeout';

/** 固定脚本仅写本次桩的 out 目录，不执行夹具传入的命令。 */
const producer = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const [dir, id, mode] = process.argv.slice(1);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = bytes => new Promise(resolve => process.stdout.write(bytes, resolve));
const record = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value));
async function main() {
  const samples = [];
  const count = mode === 'dense' ? 512 : mode === 'sparse' ? 60 : 2;
  const size = mode === 'dense' ? 16384 : 256;
  const interval = mode === 'dense' ? 20 : 250;
  for (let i = 0; i < count; i++) {
    const mark = 'E1-' + id + '-' + i;
    const bytes = Buffer.from(mark.padEnd(size - 1, '.') + '\n');
    samples.push({ mark, sent: Date.now(), bytes: bytes.length });
    await write(bytes);
    if (mode === 'timeout') { record('producer.json', { pid: process.pid, samples }); await pause(60000); }
    if (mode === 'latch') {
      record('producer.json', { pid: process.pid, samples });
      const limit = Date.now() + 60000;
      while (!fs.existsSync(path.join(dir, 'release-' + i))) {
        if (Date.now() > limit) throw Error('latch_timeout');
        await pause(25);
      }
    } else await pause(interval);
  }
  record('producer.json', { pid: process.pid, samples });
}
main().catch(() => { process.exitCode = 1; });
`;

export async function stubStdout(dir: string, id: string, attempt: number, mode: StubStdout): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'stdout.jsonl');
  const r = await runReviewProcess({ path: file, attempt }, process.execPath,
    ['-e', producer, dir, id, mode], { killTree: true, timeoutMs: mode === 'timeout' ? 2400 : 130_000 });
  if (mode === 'timeout' ? !r.timedOut : r.code !== 0) throw new Error('分批输出桩失败');
  return file;
}
