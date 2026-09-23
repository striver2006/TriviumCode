/**
 * **变异装置自身的锁例**（`scripts/mutation-check.mjs`，代码双审 r3）。
 *
 * ## 为什么现在才有
 *
 * 装置是**测别人的工具**，于是「谁来测它」一直没人问。代价在 r3 兑现：
 * 三侧独立命中同一个 bug（AGY-01 ≡ GLM-02 ≡ CODEX-01）——哨兵在**它被检出的
 * 那条路径上被装置自己删掉**，于是这道闸只生效一次，第二次开跑照常把可能带
 * 残留变异的工作树当干净基线。而它要防的恰恰就是那件事。
 *
 * 这与本仓反复记过的形状同源：**加了守卫不等于守卫被守着**。
 * 装置头部那张闸表是一份**声称**，此前没有任何东西验证过它。
 *
 * ## 为什么这两条能安全地在真实仓库根上跑
 *
 * 两条都走**拒绝路径**，而 r3 的修法正是把拒绝路径挪到 `try` 之外：
 * 此时尚未备份、尚未变异、尚未构建，装置除了临时目录什么都没碰。
 * 所以它们**不动工作树、不花配额、不跑构建**，可以进 `npm test`。
 *
 * M10a 第 4 步补的 D3 / D4 同理：闸 7 与哨兵只读预检都在建哨兵与 `try` 之前。
 * D1 / D4 会在仓库根**临时放一个哨兵**作为夹具，并在 `finally` 里删掉——那是测试自己的
 * 夹具，不是装置写的。
 *
 * 走不到这里的那些闸（变异生效、逐字节恢复、收尾重建）需要真改文件，
 * 不适合进单测——它们的验证面是装置**跑真活**时的输出，记在报告 §5.1。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../helpers/fixture.js';

const ROOT = REPO_ROOT;
const SCRIPT = path.join(ROOT, 'scripts', 'mutation-check.mjs');
const SENTINEL = path.join(ROOT, '.mutation-check-running');

/** 写一份最小规格到临时目录，返回路径 */
async function writeSpec(spec: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-mut-test-'));
  const p = path.join(dir, 'spec.json');
  await fs.writeFile(p, JSON.stringify(spec), 'utf8');
  return p;
}

function run(specPath: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, specPath], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, stderr: `${r.stderr ?? ''}${r.stdout ?? ''}` };
}

test('D1 闸 3 前半：发现 stale 哨兵时拒绝开跑，且**哨兵必须原样保留**', async () => {
  /*
   * 这是 r3 那个 bug 的直接锁例。变异：把闸 3 前半挪回 `try` 内
   * （或给 `finally` 的 `rm(SENTINEL)` 去掉前置条件）⇒ 哨兵被删 ⇒ 本条红。
   *
   * 第二条断言比第一条重要：**退出非零**上一版也做到了，
   * 它掩盖的恰恰是「拒绝完把自己的拒绝依据删了」。
   */
  await fs.writeFile(SENTINEL, 'started_at=2026-01-01T00:00:00.000Z\nspec=<自测>\n', 'utf8');
  try {
    const spec = { targets: ['package.json'], suites: [], cases: [] };
    const { status, stderr } = run(await writeSpec(spec));

    assert.notEqual(status, 0, 'stale 哨兵在场时必须拒绝开跑');
    assert.equal(
      await fs
        .stat(SENTINEL)
        .then(() => true)
        .catch(() => false),
      true,
      '哨兵必须原样保留：装置不能替人做出「树是干净的」那个判断',
    );
    assert.match(stderr, /没有善终|正在跑/, '拒绝理由要说人话');
    assert.doesNotMatch(
      stderr,
      /工作树可能已脏/,
      '拒绝路径在任何写盘之前，不得发出「树已脏」的假告警',
    );
  } finally {
    await fs.rm(SENTINEL, { force: true });
  }
});

test('D2 闸 6：`cases ⊄ targets` 拦在写盘前，且不发假「树已脏」告警（GLM-07）', async () => {
  /*
   * 上一版闸 6 拦在 `try` 内，于是 `finally` 对每个 target 从**空备份目录**
   * `copyFile` ⇒ 逐条 ENOENT ⇒ 逐条打印「工作树可能已脏」，而树从未被碰过。
   * 装置在自己的告警上说过头话，会训练操作者无视它的告警。
   *
   * 变异：把闸 6 挪回 `try` 内 ⇒ 假告警重现 ⇒ 本条红。
   */
  const spec = {
    targets: ['package.json'],
    suites: [],
    cases: [{ id: 'X1', file: 'src/trivium/types.ts', replace: [], expect: 'red' }],
  };
  const { status, stderr } = run(await writeSpec(spec));

  assert.notEqual(status, 0, '规格错误必须拒绝开跑');
  assert.match(stderr, /不在 targets 里/, '要点名是哪几条 case 越界');
  assert.doesNotMatch(
    stderr,
    /工作树可能已脏/,
    '闸 6 在任何写盘之前，恢复面不该被触发，更不该报树已脏',
  );
  assert.equal(
    await fs
      .stat(SENTINEL)
      .then(() => true)
      .catch(() => false),
    false,
    '闸 6 先于闸 3 前半，不得留下哨兵',
  );
});

/*
 * ── D3 / D4：闸 7 与哨兵预检（M10a 第 4 步）──
 *
 * 夹具取一个**不进构建图**的仓库文件：去掉闸 7 的手工变异会让装置真跑，
 * 改的若是源码，可能把构建改坏。`suites` 取一个轻量的既有套件，
 * **不取本文件自身**——那会递归拉起装置。
 */
const D3_TARGET = 'README.md';
const D3_MULTI = 'TriviumCode';
const D3_ZERO = '闸7零命中探针·9c1e';
const D3_SUITE = 'dist/test/test/unit/render.test.js';

const countIn = (text: string, s: string): number => text.split(s).length - 1;

function d3Spec(): unknown {
  return {
    targets: [D3_TARGET],
    suites: [D3_SUITE],
    cases: [
      { id: 'X1', desc: '多处命中', file: D3_TARGET, find: D3_MULTI, replace: 'x', expect: D3_SUITE },
      { id: 'X2', desc: '零处命中', file: D3_TARGET, find: D3_ZERO, replace: 'x', expect: D3_SUITE },
    ],
  };
}

test('D3 闸 7：find 不唯一或零命中时，在建哨兵与构建之前整批拒跑', async () => {
  /*
   * **承重的是 stderr 两条**：点名两条 case 与各自的命中数，且不出现基线进度行。
   * 去掉闸 7 后装置会真跑：先建哨兵、构建、跑基线套件、打出「基线全绿」，
   * 这两条随即变红（M10a 第 4 步计划 r3 的手工变异 M-D3）。
   *
   * 后两条（不留哨兵、目标文件哈希不变）是**条件性判别**：去掉闸 7 后装置若干净跑完，
   * 收尾会删哨兵、闸 5 会恢复文件，这两条照样绿；只在那一轮留下脏状态（超时被杀、
   * 收尾重建失败）时才红。它们守的是闸 7 生效时拒绝路径不碰工作树，不是 M-D3 的鉴别点。
   * （计划 r2 把「不留哨兵」写成了鉴别点，三侧独立指出不成立，r3 改正。）
   */
  const before = await fs.readFile(path.join(ROOT, D3_TARGET), 'utf8');
  // 夹具前提先自己断言：目标文件漂移后判据会悄悄只剩一个分支，那要干净地红
  const multi = countIn(before, D3_MULTI);
  assert.ok(multi >= 2, `夹具漂移：${D3_TARGET} 里「${D3_MULTI}」只有 ${multi} 处，D3 已覆盖不到多处命中分支`);
  assert.equal(countIn(before, D3_ZERO), 0, `夹具漂移：${D3_TARGET} 里出现了零命中探针串`);

  const { status, stderr } = run(await writeSpec(d3Spec()));

  assert.notEqual(status, 0, 'find 不唯一或零命中必须拒绝开跑');
  assert.ok(
    stderr.includes(`X1（${D3_TARGET}）：find 命中 ${multi} 处`),
    `要点名多处命中的那条及其命中数（${multi}）：\n${stderr.slice(0, 600)}`,
  );
  assert.ok(
    stderr.includes(`X2（${D3_TARGET}）：find 命中 0 处`),
    `要点名零命中的那条：\n${stderr.slice(0, 600)}`,
  );
  assert.doesNotMatch(stderr, /基线全绿/, '拒绝必须发生在构建与基线之前');

  // ── 以下为条件性判别，见上方注释 ──
  assert.equal(
    await fs
      .stat(SENTINEL)
      .then(() => true)
      .catch(() => false),
    false,
    '闸 7 先于哨兵独占创建，不得留下哨兵',
  );
  assert.equal(await fs.readFile(path.join(ROOT, D3_TARGET), 'utf8'), before, '拒绝路径不得改动目标文件');
});

test('D4 哨兵预检先于闸 7：残留哨兵在场时，报的是上次没善终，不是规格写错', async () => {
  /*
   * 上次异常退出时工作树常带着残留变异，而那往往让本规格的 find 命中 0。
   * 若闸 7 先开口，读起来是「规格写错」，而修规格正好把残留固化下来（计划双审 r2 CODEX-05）。
   * 手工变异 M-D4：把闸 7 挪到哨兵预检之前 ⇒ stderr 先出闸 7 文案 ⇒ 本条红。
   */
  await fs.writeFile(SENTINEL, 'started_at=2026-01-01T00:00:00.000Z\nspec=<自测 D4>\n', 'utf8');
  try {
    const { status, stderr } = run(await writeSpec(d3Spec()));

    assert.notEqual(status, 0, 'stale 哨兵在场时必须拒绝开跑');
    assert.match(stderr, /没有善终|正在跑/, '要报的是上次没善终');
    assert.doesNotMatch(stderr, /find 命中/, '哨兵在场时不该先报规格错误：诊断方向会被带偏');
    assert.equal(
      await fs
        .stat(SENTINEL)
        .then(() => true)
        .catch(() => false),
      true,
      '哨兵必须原样保留',
    );
  } finally {
    await fs.rm(SENTINEL, { force: true });
  }
});
