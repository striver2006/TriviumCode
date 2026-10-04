import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { type StubConfig } from '../../src/trivium/adapters/stub.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { repoId } from '../../src/trivium/review.js';
import { run } from '../../src/trivium/util/exec.js';
import type { RunMeta } from '../../src/trivium/types.js';

/**
 * EV-204 D1：审查跑完之后的漂移复算（`review.ts` 的 `workTreeHash`）删不掉临时索引目录，不再把整次运行判 failed。
 *
 * 此前 `workTreeHash` 的 finally 是裸递归删除，删不掉的异常穿出 `executeRun`，worker 走异常分支把运行收尾为 failed，
 * 各侧已花配额的结论作废。走打包 CLI 与跨进程桩注入（同 `fault-injection.test.ts`），全程零配额。
 *
 * **摆锁只落在 worker 里**（计划双审 AGY-01）：`--start` 对每个入选侧各冻结一次、各算一次 `workTreeHash`，
 * 按「第几个临时索引」计数会随侧数错位。改为按进程身份：git clean 过滤器沿祖先进程向上找命令行含
 * `review --worker` 的那一个（worker 由 `spawnDetached` 以 `<node> <bundle> review --worker <run_id>` 派生），
 * 找到才在 `GIT_INDEX_FILE` 所在目录建只读的 `locked/`（里面放一个文件——空的只读目录锁不住）。
 * **git 机制前提**：clean 过滤器继承 git 的环境（含 `GIT_INDEX_FILE`）；本机 git 2.54.0 实测。过滤器第一次被调就写标记，
 * 用例先断言标记在，「环境没跑过滤器」与「改动错了」是两种红。涉及权限，root 下跳过。
 */

const TOPIC = '临时索引删除';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const ROOT = process.getuid?.() === 0;

const CREATED: string[] = [];
after(async () => {
  for (const d of CREATED) {
    await unlockAll(d);
    await fs.rm(d, { recursive: true, force: true, maxRetries: 3 }).catch((e: unknown) => {
      console.warn(`worktree-hash-cleanup：目录没删掉，请手工删除 ${d}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
    });
  }
});

async function unlockAll(base: string): Promise<void> {
  const walk = async (d: string): Promise<void> => {
    await fs.chmod(d, 0o700).catch(() => {});
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) await walk(path.join(d, e.name));
  };
  await walk(base);
}

test('D1 worker 里的漂移复算删不掉临时索引目录：运行照常成功，提示进 worker.log，--start 不受影响', { skip: (bundleMissing && bundleSkipReason) || (ROOT && 'root 下只读目录锁不住') }, async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-whc-')));
  CREATED.push(base);
  const home = path.join(base, 'home');
  const tmp = path.join(home, 'tmp');
  await fs.mkdir(tmp, { recursive: true });
  const mark = path.join(base, 'filter-ran');

  // 夹具与它的运行根由 makeFixture 在进程退出时收尾（EV-207），不再登记进 CREATED
  const { root, runRoot, stageDir } = await makeFixture({ topic: TOPIC });

  const script = path.join(base, 'lock.sh');
  await fs.writeFile(
    script,
    [
      `: > '${mark}'`,
      'd=$(dirname "${GIT_INDEX_FILE:-.}")',
      `case "$d" in '${tmp}'/*)`,
      '  p=$PPID; i=0',
      '  while [ -n "$p" ] && [ "$p" -gt 1 ] && [ "$i" -lt 8 ]; do',
      '    case "$(ps -o args= -p "$p" 2>/dev/null)" in',
      "      *'review --worker'*)",
      '        if [ ! -d "$d/locked" ]; then mkdir "$d/locked" && : > "$d/locked/f" && chmod 500 "$d/locked"; fi',
      '        break ;;',
      '    esac',
      '    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); i=$((i + 1))',
      '  done ;;',
      'esac',
      'cat',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(root, '.git', 'info'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'info', 'attributes'), '* filter=trvlock\n', 'utf8');
  await run('git', ['config', 'filter.trvlock.clean', `sh '${script}'`], { cwd: root });

  const env = { TMPDIR: tmp, HOME: home };
  const started = await cli(
    root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', '注入用例', '--json'],
    STUB,
    120_000,
    env,
  );
  assert.equal(started.code, EXIT.OK, `--start 应成功：\n${started.stdout}\n${started.stderr}`);
  await fs.access(mark).catch(() => {
    assert.fail('过滤器一次都没被调到——是 git 机制前提不成立，不是被测改动的问题');
  });
  assert.doesNotMatch(started.stderr, /工作树哈希的临时目录删除失败/, '--start 里的冻结不该被锁（锁只落在 worker 里）');
  const candidate = extractJsonCandidate(started.stdout);
  assert.ok(candidate, `--start --json 未产出可解析的 JSON：\n${started.stdout}`);
  const runId = (JSON.parse(candidate.json) as { run_id: string }).run_id;

  let exitCode: number = EXIT.STILL_RUNNING;
  let waitOut = '';
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000, env);
    exitCode = w.code ?? EXIT.FAIL;
    waitOut += w.stdout + w.stderr;
  }
  const runDir = path.join(runRoot, repoId(root), runId);
  const workerLog = await fs.readFile(path.join(runDir, 'worker.log'), 'utf8').catch(() => '(worker.log 读不到)');
  assert.equal(exitCode, EXIT.OK, `漂移复算删不掉临时目录不该让运行失败：\n${waitOut}\n--- worker.log ---\n${workerLog}`);

  const meta = JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${runId}.json`), 'utf8')) as RunMeta;
  assert.equal(meta.status, 'success');
  assert.equal(meta.snapshot.drift.changed, false);
  const status = JSON.parse(await fs.readFile(path.join(runDir, 'status.json'), 'utf8')) as { phase: string };
  assert.equal(status.phase, 'success');

  assert.match(workerLog, /工作树哈希的临时目录删除失败（(EACCES|EPERM)）：~\/tmp\/trivium-index-/, 'worker 的复算确实删不掉过，提示进了 worker.log');
  const left: string[] = [];
  for (const n of (await fs.readdir(tmp)).filter((x) => x.startsWith('trivium-index-'))) {
    if (await fs.stat(path.join(tmp, n, 'locked')).then(() => true, () => false)) left.push(n);
  }
  assert.equal(left.length, 1, `应恰好留下一个带锁的临时索引目录（只锁了 worker 那一次）：${left.join(', ')}`);
});
