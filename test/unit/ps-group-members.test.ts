/**
 * 「组里只剩僵尸」的计数（EV-169）：`processGroupMemberCount` 按 `ps -axo pgid=,stat=` 排除状态以 `Z` 开头的僵尸。
 *
 * - S 系列喂**录制的真实样本**（`test/fixtures/ps-samples/`，本机 macOS 录制，脚本在
 *   `doc/05_testing/evidence/ps-zombie-sample-20261006/`）：样本一是组长 `Ss` 加一个僵尸，样本二是组里只剩一个僵尸
 *   （父进程在另一组、从不 wait）。直测纯函数 `countLiveGroupMembers`，不依赖实机时序。
 * - L1 在 macOS 上用样本二的同一造法实起一个只剩僵尸的组，直接调 `processGroupMemberCount`（无 perl 或非 macOS 跳过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { countLiveGroupMembers, processGroupMemberCount } from '../../src/trivium/util/exec.js';
import { REPO_ROOT } from '../helpers/fixture.js';

// WIN_FILE_SKIP（Windows 移植）：活体 POSIX 进程语义（进程组信号/SIGTERM 阶梯/僵尸/ps 形态）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 活体 POSIX 进程语义（进程组信号/SIGTERM 阶梯/僵尸/ps 形态）');
} else {

const SAMPLES = path.join(REPO_ROOT, 'test', 'fixtures', 'ps-samples');

async function sample(name: string): Promise<{ text: string; meta: { pgid: number; parent_pgid?: number } }> {
  const text = await fs.readFile(path.join(SAMPLES, `${name}.txt`), 'utf8');
  const meta = JSON.parse(await fs.readFile(path.join(SAMPLES, `${name}.meta.json`), 'utf8')) as { pgid: number; parent_pgid?: number };
  return { text, meta };
}

/** 样本里该组的原始行（自证样本形态，免得样本被换了而用例还绿） */
const groupLines = (text: string, pgid: number) =>
  text.split('\n').filter((l) => Number(/^\s*(\d+)\s/.exec(l)?.[1]) === pgid).map((l) => l.trim());

test('EV-169 S1：录制样本「组长 + 僵尸」⇒ 只数组长，计 1', async () => {
  const { text, meta } = await sample('group-with-zombie');
  const lines = groupLines(text, meta.pgid);
  assert.equal(lines.length, 2, `样本前提：该组两行（${lines.join(' ｜ ')}）`);
  assert.ok(lines.some((l) => /\sZ/.test(l)) && lines.some((l) => /\sS/.test(l)), `样本前提：一个 S、一个 Z（${lines.join(' ｜ ')}）`);
  assert.equal(countLiveGroupMembers(text, meta.pgid), 1);
});

test('EV-169 S2：录制样本「组里只剩僵尸」⇒ 计 0；父进程所在组计 1', async () => {
  const { text, meta } = await sample('only-zombie');
  const lines = groupLines(text, meta.pgid);
  assert.deepEqual(lines.map((l) => l.split(/\s+/)[1]![0]), ['Z'], `样本前提：该组只有一行僵尸（${lines.join(' ｜ ')}）`);
  assert.equal(countLiveGroupMembers(text, meta.pgid), 0, '只剩僵尸的组应判为空');
  assert.equal(countLiveGroupMembers(text, meta.parent_pgid!), 1, '不回收它的父进程在另一组，照常计数');
});

test('EV-169 S3：组号整数比较——前缀相同的别的组、不存在的组都计 0', async () => {
  const { text, meta } = await sample('group-with-zombie');
  const prefix = Number(String(meta.pgid).slice(0, -1));
  assert.equal(groupLines(text, prefix).length, 0, '样本前提：前缀组号在样本里不存在');
  assert.equal(countLiveGroupMembers(text, prefix), 0);
  assert.equal(countLiveGroupMembers(text, 999_999_99), 0);
  assert.equal(countLiveGroupMembers('', meta.pgid), 0);
});

const perl = '/usr/bin/perl';
const liveSkip = process.platform !== 'darwin' ? '只在 macOS 上跑' : !existsSync(perl) ? '本机没有 /usr/bin/perl' : false;

test('EV-169 L1（实机）：只剩僵尸的组 ⇒ processGroupMemberCount 计 0', { skip: liveSkip, timeout: 30_000 }, async () => {
  // 父进程（自成一组）fork 出子进程，子进程 setsid 自成一组后立即退出；父进程不 wait，子进程留成僵尸、独占那一组
  const code = 'use POSIX (); my $c = fork(); if ($c == 0) { POSIX::setsid(); POSIX::_exit(0); } $| = 1; print "$c\\n"; while (1) { sleep 30 }';
  const parent = spawn(perl, ['-e', code, 'trivium-ev169-test'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise((r) => parent.once('exit', r));
  let timer: NodeJS.Timeout | undefined;
  try {
    const child = await Promise.race([
      new Promise<number>((resolve) => {
        let buf = '';
        parent.stdout!.on('data', (c: Buffer) => {
          buf += c.toString('utf8');
          const m = /^(\d+)\n/.exec(buf);
          if (m) resolve(Number(m[1]));
        });
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('perl 父进程 10 s 内没报子进程 pid（测试环境问题）')), 10_000);
      }),
    ]);
    parent.stdout!.destroy();
    // 等子进程变成僵尸（带上限）；前提不成立就以环境问题判红，不进被测断言
    let stat = '';
    for (let i = 0; i < 50; i++) {
      stat = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(child)], { encoding: 'utf8' }).trim();
      if (stat.startsWith('Z')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(stat.startsWith('Z'), `前提：子进程 ${child} 应已是僵尸（stat=${stat}）`);
    assert.equal(await processGroupMemberCount(child), 0, '组里只剩僵尸，应计 0');
    assert.equal(await processGroupMemberCount(parent.pid!), 1, '父进程那一组照常计 1');
  } finally {
    if (timer) clearTimeout(timer);
    try {
      process.kill(-parent.pid!, 'SIGKILL');
    } catch {
      // 已不在
    }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  }
});

}
