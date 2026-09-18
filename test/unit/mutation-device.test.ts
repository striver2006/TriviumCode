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
 * 装置头部那张「五道闸」表是一份**声称**，此前没有任何东西验证过它。
 *
 * ## 为什么这两条能安全地在真实仓库根上跑
 *
 * 两条都走**拒绝路径**，而 r3 的修法正是把拒绝路径挪到 `try` 之外：
 * 此时尚未备份、尚未变异、尚未构建，装置除了临时目录什么都没碰。
 * 所以它们**不动工作树、不花配额、不跑构建**，可以进 `npm test`。
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
