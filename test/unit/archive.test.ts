import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  writeArtifact,
  writeMeta,
  writeVerifyRecord,
  resolveRerunIndex,
  listStageArtifacts,
  listRecordedRuns,
  checkStageArtifacts,
  metaDir,
  type ArchiveLayout,
} from '../../src/trivium/archive.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { CRITICS, DEFAULT_CRITICS, type StageOrVerify } from '../../src/trivium/types.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { ALL_AGENT_IDS } from '../../src/trivium/agents/registry.js';

async function tmpLayout(): Promise<ArchiveLayout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-archive-'));
  return { archiveRoot: path.join(root, '.reviews'), topic: '登录重构' };
}

const DATE = '2026-09-10';

/**
 * 本文件考的是**工件集语义**（缺什么、按轮次隔离、原稿不被覆盖），
 * **不是「默认跑几侧」**。所以显式钉两侧，不随注册表的 `defaultSelected` 漂移——
 * 用例摆的也正是两侧的文档。D4-4 把 codex 纳入缺省集合时，这里原本按缺省集合回落，
 * 于是「四件套」变五件、一片红，而被考的语义一个字没变。
 */
const TWO = ['gemini', 'glm'] as const;


test('首跑落盘：文件名无 -r 后缀，返回相对归档根的路径', async () => {
  const l = await tmpLayout();
  const w = await writeArtifact({
    layout: l, stage: 'plan', role: 'gemini', writer: 'gemini',
    rerunIndex: 1, content: '# 计划审查\n无问题。\n', date: DATE,
  });
  assert.equal(w.fileName, '2026-09-10-登录重构-gemini.md');
  assert.equal(w.relPath, path.join('登录重构', 'plan', '2026-09-10-登录重构-gemini.md'));
  assert.equal(w.effectiveRerunIndex, 1);
  assert.equal(await fs.readFile(w.absPath, 'utf8'), '# 计划审查\n无问题。\n');
});

test('防覆盖：同名再写不覆盖原文件，而是抬升 -r<N>', async () => {
  const l = await tmpLayout();
  const first = await writeArtifact({
    layout: l, stage: 'plan', role: 'glm', writer: 'glm',
    rerunIndex: 1, content: '第一轮\n', date: DATE,
  });
  const second = await writeArtifact({
    layout: l, stage: 'plan', role: 'glm', writer: 'glm',
    rerunIndex: 1, content: '第二轮\n', date: DATE,
  });
  assert.equal(second.effectiveRerunIndex, 2);
  assert.equal(second.fileName, '2026-09-10-登录重构-r2-glm.md');
  // FR-25：既有工件字节不变
  assert.equal(await fs.readFile(first.absPath, 'utf8'), '第一轮\n');
});

test('listRecordedRuns：审查阶段下不合 run.v1 的清单判不可读；verify/ 下的遗留 run.v1 标签不误判', async () => {
  const { listRecordedRuns } = await import('../../src/trivium/archive.js');
  const l = await tmpLayout();
  await fs.mkdir(path.join(l.archiveRoot, l.topic, 'plan/_meta'), { recursive: true });
  await fs.mkdir(path.join(l.archiveRoot, l.topic, 'verify/_meta'), { recursive: true });
  // plan 下自称 run.v1 却缺必填字段：被搅坏
  await fs.writeFile(path.join(l.archiveRoot, l.topic, 'plan/_meta/run-R1.json'), JSON.stringify({ schema: 'trivium.run.v1', run_id: 'R1', status: 'success' }));
  // verify 下 AGY-03 之前的历史记录：标 run.v1 但形状是 verify 记录，是合法的不可变工件
  await fs.writeFile(path.join(l.archiveRoot, l.topic, 'verify/_meta/run-V1.json'), JSON.stringify({
    schema: 'trivium.run.v1', run_id: 'V1', topic: l.topic, stage: 'verify', rerun_index: 1, status: 'success',
    started_at: 'x', finished_at: 'y', artifacts: [],
  }));
  const runs = await listRecordedRuns(l);
  assert.equal(runs.find((r) => r.run_id === 'R1')?.unreadable, true);
  assert.equal(runs.find((r) => r.run_id === 'V1')?.unreadable, undefined, '历史 verify 记录不得被误判，否则提交永久被拦');
});

test('firstFreeRerunIndex：对两侧都空闲的轮次，单侧残留即整体抬升', async () => {
  const { firstFreeRerunIndex } = await import('../../src/trivium/archive.js');
  const l = await tmpLayout();
  await fs.mkdir(path.join(l.archiveRoot, l.topic, 'plan'), { recursive: true });
  // 上一次运行写完 gemini 侧就崩了，留下 -r2-gemini.md 而没有 -r2-glm.md
  await fs.writeFile(path.join(l.archiveRoot, l.topic, 'plan', `${DATE}-${l.topic}-r2-gemini.md`), 'x');
  const n = await firstFreeRerunIndex(l, 'plan', ['gemini', 'glm'], 2, DATE);
  assert.equal(n, 3, '不能让 glm 落在 r2 而 gemini 抬到 r3');
  assert.equal(await firstFreeRerunIndex(l, 'plan', ['gemini', 'glm'], 4, DATE), 4);
});

test('resolveRerunIndex：按已有工件的最大轮次加一，两侧共用同一 N', async () => {
  const l = await tmpLayout();
  assert.equal(await resolveRerunIndex(l, 'plan'), 1);

  const n1 = await resolveRerunIndex(l, 'plan');
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: n1, content: 'x\n', date: DATE });
  }
  await writeArtifact({
    layout: l, stage: 'plan', role: 'claude', writer: 'driver',
    kind: 'revised', rerunIndex: n1, content: 'y\n', date: DATE,
  });

  const n2 = await resolveRerunIndex(l, 'plan');
  assert.equal(n2, 2, '第二轮应为 2');

  const a = await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: n2, content: 'x2\n', date: DATE });
  const b = await writeArtifact({ layout: l, stage: 'plan', role: 'glm', writer: 'glm', rerunIndex: n2, content: 'y2\n', date: DATE });
  assert.equal(a.effectiveRerunIndex, b.effectiveRerunIndex, '两侧必须共用同一轮次');
  assert.equal(a.effectiveRerunIndex, 2);
});

test('角色后缀硬约束：Driver 不得产 gemini/glm，审查员不得产 claude', async () => {
  const l = await tmpLayout();
  await assert.rejects(
    writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'driver', rerunIndex: 1, content: 'x', date: DATE }),
    /角色后缀违规/,
  );
  await assert.rejects(
    writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'glm', rerunIndex: 1, content: 'x', date: DATE }),
    /角色后缀违规/,
  );
});

test('writeMeta 的 added-lines 模式：补丁上下文行不拦、新增行照拦', async () => {
  const l = await tmpLayout();
  const fake = ['sk-', 'ant-api03-', 'AbCdEfGhIjKlMnOp', 'QrStUvWxYz0123456789'].join('');
  const ctxOnly = ['@@ -1 +1 @@', `-const old = "${fake}";`, ' const keep = 1;'].join('\n');
  await assert.doesNotReject(
    writeMeta(l, 'code', 'changes-R1.diff', ctxOnly, { scan: 'added-lines' }),
    '删除行与上下文行是 HEAD 已有内容，不该拦——否则删除凭据的提交送不进审查',
  );
  await assert.rejects(writeMeta(l, 'code', 'full-R1.diff', ctxOnly), /拒绝落盘/, '默认仍是整份扫');
  await assert.rejects(
    writeMeta(l, 'code', 'added-R1.diff', ['@@ -1 +1 @@', `+const now = "${fake}";`].join('\n'), { scan: 'added-lines' }),
    /拒绝落盘/,
    '新增行里的凭据照拦',
  );
});

test('落盘前密钥扫描：命中即拒绝写入，且文件不存在', async () => {
  const l = await tmpLayout();
  // 假凭据运行时拼接：静态文本里出现完整形态，本文件自己就会被归档闸拦下（见 test/contract/fixture-credentials）
  const fake = ['sk-', 'ant-api03-', 'AbCdEfGhIjKlMnOp', 'QrStUvWxYz0123456789'].join('');
  const poisoned = `# 审查\n发现硬编码凭据 ${fake}\n`;
  await assert.rejects(
    writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: poisoned, date: DATE }),
    /拒绝落盘/,
  );
  const items = await listStageArtifacts(l, 'plan');
  assert.equal(items.length, 0, '被拒绝的内容不得留下任何文件');
});

test('_meta/ 拒绝角色后缀文件名，避免与 AC-07 检查器混淆', async () => {
  const l = await tmpLayout();
  await assert.rejects(
    writeMeta(l, 'plan', '2026-09-10-登录重构-gemini.md', 'x'),
    /_meta\/ 内不得出现/,
  );
  const ok = await writeMeta(l, 'plan', 'brief-gemini-20260910T142310Z.md', '# BRIEF\n');
  assert.ok(ok.absPath.includes(path.join('plan', '_meta')));
});

test('_meta/ 的拒绝文案点名全部已登记后缀，与判据同源（EV-61 ④）', async () => {
  const l = await tmpLayout();
  await assert.rejects(writeMeta(l, 'plan', 'x-gemini.md', 'x'), (e: Error) => {
    // 此前文案写死三家、缺 codex：判据认四家，被拦的人照文案排查会漏掉一家
    for (const id of ALL_AGENT_IDS) assert.ok(e.message.includes(`-${id}`), `文案缺 -${id}：${e.message}`);
    return true;
  });
});

test('_meta/ 按 run_id 命名，同名重写视为修正，允许覆盖', async () => {
  const l = await tmpLayout();
  await writeMeta(l, 'plan', 'run-20260910T142310Z.json', '{"a":1}');
  const w = await writeMeta(l, 'plan', 'run-20260910T142310Z.json', '{"a":2}');
  assert.equal(await fs.readFile(w.absPath, 'utf8'), '{"a":2}');
});

test('验证记录不带角色后缀，重复写同样抬升轮次', async () => {
  const l = await tmpLayout();
  const a = await writeVerifyRecord(l, '# 验证\n', { date: DATE });
  assert.equal(a.fileName, '2026-09-10-登录重构-verify.md');
  const b = await writeVerifyRecord(l, '# 验证 2\n', { date: DATE });
  assert.equal(b.fileName, '2026-09-10-登录重构-r2-verify.md');
});

test('阶段最低工件集：plan 缺件时报出缺什么', async () => {
  const l = await tmpLayout();
  let c = await checkStageArtifacts(l, 'plan', 1, TWO);
  assert.equal(c.ok, false);
  assert.equal(c.missing.length, 4, 'plan 四件套全缺');

  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'glm', writer: 'glm', rerunIndex: 1, content: 'c', date: DATE });
  c = await checkStageArtifacts(l, 'plan', 1, TWO);
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, ['裁决件 …-revised-claude.md']);

  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'd', date: DATE });
  c = await checkStageArtifacts(l, 'plan', 1, TWO);
  assert.equal(c.ok, true, `仍缺：${c.missing.join(', ')}`);
});

test('未登记的审查件被查出来：堵住「把伪审查件搬进阶段目录」', async () => {
  /*
   * 审查意见 GLM-03。Write 侧收窄放开 doc/ 之后，`cp -R doc/ .reviews/t/plan/`
   * 这类**全程不含角色后缀字样**的搬运不会命中 Hook 的任何字面规则，
   * 而 hook-pre-commit 的 git 锚对新增未跟踪文件失明，此前完全没有兜底。
   *
   * 这道核对是**路径信号**：不问文件怎么进来的，只问它在不在 run.json 的登记内。
   */
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  const g = await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  const z = await writeArtifact({ layout: l, stage: 'plan', role: 'glm', writer: 'glm', rerunIndex: 1, content: 'c', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'd', date: DATE });

  const recorded = new Set(
    [g, z].map((a) => path.relative(l.archiveRoot, path.join(l.archiveRoot, l.topic, 'plan', a.fileName))),
  );

  // 登记齐全时照常通过
  let c = await checkStageArtifacts(l, 'plan', 1, TWO, undefined, recorded);
  assert.equal(c.ok, true, `不该有缺口：${c.missing.join(', ')}`);

  // 手工塞一份没登记的审查件进阶段目录（模拟 cp -R 搬运）
  const smuggled = path.join(l.archiveRoot, l.topic, 'plan', `${DATE}-登录重构-r9-gemini.md`);
  await fs.writeFile(smuggled, '# 伪造的审查意见\n');

  c = await checkStageArtifacts(l, 'plan', 1, TWO, undefined, recorded);
  assert.equal(c.ok, false, '未登记的审查件必须被查出来');
  assert.match(c.missing.join(' '), /未登记的审查件/);
  assert.match(c.missing.join(' '), /r9-gemini\.md/);

  // 不传登记清单时跳过该项（向后兼容）
  const skipped = await checkStageArtifacts(l, 'plan', 1, TWO);
  assert.equal(skipped.ok, true, '没提供登记清单就不该据此判失败');
});

test('阶段最低工件集：code 三件套不含 -claude.md 原稿，裁决件用 -response', async () => {
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'code', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'code', role: 'glm', writer: 'glm', rerunIndex: 1, content: 'b', date: DATE });
  let c = await checkStageArtifacts(l, 'code', 1, TWO);
  assert.deepEqual(c.missing, ['裁决件 …-response-claude.md']);

  await writeArtifact({ layout: l, stage: 'code', role: 'claude', writer: 'driver', kind: 'response', rerunIndex: 1, content: 'c', date: DATE });
  c = await checkStageArtifacts(l, 'code', 1, TWO);
  assert.equal(c.ok, true, `仍缺：${c.missing.join(', ')}`);
});

test('工件集校验按轮次隔离：第二轮缺件不受第一轮齐备影响', async () => {
  const l = await tmpLayout();
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'bug', role, writer: role, rerunIndex: 1, content: 'x', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'bug', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'y', date: DATE });
  await writeArtifact({ layout: l, stage: 'bug', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'z', date: DATE });
  assert.equal((await checkStageArtifacts(l, 'bug', 1, TWO)).ok, true);
  assert.equal((await checkStageArtifacts(l, 'bug', 2, TWO)).ok, false, '第二轮尚未开始，应判缺件');
});

test('不同主题的工件互不干扰', async () => {
  const l = await tmpLayout();
  const other: ArchiveLayout = { archiveRoot: l.archiveRoot, topic: '支付重构' };
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: other, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  assert.equal((await listStageArtifacts(l, 'plan')).length, 1);
  assert.equal((await listStageArtifacts(other, 'plan')).length, 1);
  assert.equal(await resolveRerunIndex(other, 'plan'), 2);
});

// ── 回归：轮次不得被 Driver 原稿抬升（实跑时踩到过）──

test('回归：首次审查的轮次是 1，原稿存在也不抬升（设计 §6.2 目录示例）', async () => {
  const l = await tmpLayout();
  // Driver 先落原稿，这属于第 1 轮四件套的一部分
  await writeArtifact({
    layout: l, stage: 'plan', role: 'claude', writer: 'driver',
    rerunIndex: 1, content: '# 计划\n', date: DATE,
  });
  assert.equal(await resolveRerunIndex(l, 'plan'), 1, '原稿不是「已完成的一轮」');
});

test('回归：轮次由审查工件决定；重跑时原稿不重新生成', async () => {
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  const n1 = await resolveRerunIndex(l, 'plan');
  assert.equal(n1, 1);

  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: n1, content: 'x', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: n1, content: 'y', date: DATE });

  assert.equal(await resolveRerunIndex(l, 'plan'), 2, '有了第 1 轮审查，下一轮才是 2');
});

test('回归：裁决件也不抬升轮次（它与审查同轮）', async () => {
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'code', role: 'claude', writer: 'driver', kind: 'response', rerunIndex: 5, content: 'z', date: DATE });
  assert.equal(await resolveRerunIndex(l, 'code'), 1, 'claude 角色一律不参与轮次计算');
});


// ── 回归：原稿只在第 1 轮，重跑的工件集校验不得误报缺原稿 ──

test('回归：重跑时原稿留在第 1 轮，第 2 轮四件套仍应判齐备', async () => {
  const l = await tmpLayout();
  // 第 1 轮：原稿 + 两侧审查 + 裁决件
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: '原稿', date: DATE });
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: 1, content: 'x', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'y', date: DATE });
  assert.equal((await checkStageArtifacts(l, 'plan', 1, TWO)).ok, true);

  // 第 2 轮：只有两侧审查 + 裁决件，原稿**不重新生成**
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: 2, content: 'x2', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 2, content: 'y2', date: DATE });

  const c2 = await checkStageArtifacts(l, 'plan', 2, TWO);
  assert.equal(c2.ok, true, `第 2 轮应判齐备，实际缺：${c2.missing.join(', ')}`);
});

test('回归：真的没有原稿时仍要报缺（不能因跨轮次查找而放水）', async () => {
  const l = await tmpLayout();
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: 1, content: 'x', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'y', date: DATE });
  const c = await checkStageArtifacts(l, 'plan', 1, TWO);
  assert.equal(c.ok, false);
  assert.ok(c.missing.some((m) => m.includes('原稿')));
});

test('回归：本轮审查缺失不受跨轮次查找影响', async () => {
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: '原稿', date: DATE });
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: 1, content: 'x', date: DATE });
  }
  // 第 2 轮只有 gemini
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 2, content: 'x2', date: DATE });
  const c = await checkStageArtifacts(l, 'plan', 2, TWO);
  assert.equal(c.ok, false);
  assert.ok(c.missing.some((m) => m.includes('glm')), '第 2 轮缺 glm 必须报出');
  assert.ok(!c.missing.some((m) => m.includes('原稿')), '原稿在第 1 轮存在，不得报缺');
});

/*
 * ── 单侧轮次不得被误报缺件（M7b 第 2 步，两侧收敛意见 AGY-04 ≡ GLM-02）──
 *
 * 计划 §4 的欠账表把这条列为「闸门缺口」：`--check-artifacts` 此前给
 * `critics` 传 `undefined`，于是回落到**当前启用集合**去找工件。
 * `--only gemini` 跑完的轮次里 glm 那份工件永远不存在，一个完全合规的轮次
 * 被判成缺件。
 *
 * **正负成对写**是有意的：只写正例的话，把实现改成「永远不报缺件」也能过。
 * 负例锁住的是「传与不传确实有差别」——修复本身才有防回退锚点。
 */

test('单侧轮次：传入真实入选集合则不报缺件', async () => {
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'd', date: DATE });

  const c = await checkStageArtifacts(l, 'plan', 1, ['gemini']);
  assert.equal(c.ok, true, `单侧轮次不该缺件，实缺：${c.missing.join(', ')}`);
});

test('单侧轮次：不传入选集合就会回落到缺省集合，并误报未入选侧缺件', async () => {
  /*
   * 这是修复前的行为。留作负例，锁住「传与不传有差别」——否则上面的正例证明不了什么。
   *
   * **本例必须不传第四参**：它考的就是那个缺省形参本身，而生产路径确实会走到它
   * （`cli.ts` 读不到 run.json 时回落）。2026-09-16 r12 三侧独立指出，
   * 我曾用正则把本例也批量改成显式传 `TWO`——调用形状对上了，用例意图没了：
   * 回落分支从此零覆盖，把它改回启用全集也不会变红。
   *
   * 断言按 `DEFAULT_CRITICS` **派生**，不写死侧数：缺省集合再变一次，
   * 本例仍然锁的是「回落取的是缺省集合」这件事，而不是「回落到了那两家」。
   *
   * **本例锁得住什么、锁不住什么（变异验证实测，别高估它）**：
   *   · 锁得住「传与不传有差别」——把回落值退化成任一真子集（实测 `[DEFAULT_CRITICS[0]]`）当场红；
   *   · **锁不住**「回落取的是缺省集合而非启用全集」——`CRITICS` 与 `DEFAULT_CRITICS`
   *     当前恰好相等（都是三家），把回落值改成 `CRITICS` 实测**不红**，因为那个变异语义无变化。
   *     等两个集合再次分叉（有 Agent 只 `criticEnabled` 不 `defaultSelected`）时，
   *     本例会自动重新获得这份区分力——它派生自 `DEFAULT_CRITICS`，不必改。
   */
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'd', date: DATE });

  const c = await checkStageArtifacts(l, 'plan', 1);
  assert.equal(c.ok, false, '回落到缺省集合时应当报缺件——这正是被修掉的缺陷');

  // 夹具只摆了 gemini：缺省集合里其余各侧都该被点名，一个不少
  const notStaged = DEFAULT_CRITICS.filter((c2) => c2 !== 'gemini');
  assert.ok(notStaged.length > 0, '缺省集合至少要有一侧不是 gemini，否则本例证明不了回落取值');
  for (const side of notStaged) {
    assert.ok(
      c.missing.some((m) => m.includes(side)),
      `缺件应点名缺省集合里未摆工件的 ${side} 侧，实得：${c.missing.join(', ')}`,
    );
  }
});

// ─────────── 读侧按阶段精确分发（设计 §6.7.1，M7b 第 3 步）───────────

/**
 * 构造一份合法的 `trivium.run.v2` 运行元数据。
 *
 * 用真实写侧 `newRunMeta` 而不是手写字面量：手写夹具会与写侧各自漂移，
 * 而本组用例断言的恰恰是「写侧产出的形状能被读侧认出来」。
 */
function v2Meta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(newRunMeta({
      runId: 'RV2', topic: '登录重构', stage: 'plan', rerunIndex: 1, command: 'x',
      promptHint: null, taskGoal: null, criticsSelected: CRITICS,
      treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
      denyPaths: [], driftPolicy: 'warn',
    }) as unknown as Record<string, unknown>),
    ...over,
  };
}

/** v1 时代的形状：没有 driver / critics_selected，完成度是 dual|single */
function v1Meta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'trivium.run.v1',
    run_id: 'RV1', topic: '登录重构', stage: 'plan', rerun_index: 1, command: 'x',
    prompt_hint: null, task_goal: null,
    snapshot: {
      git_head: null, tree_hash: 'h', dirty: false, subject_sha256: 's',
      drift: { changed: false, files: [], policy: 'warn' },
    },
    started_at: 'x', finished_at: 'y',
    review_mode: 'dual', degraded_reason: null,
    critics: {},
    deny_paths: [],
    guard: { readonly_breach: false, peer_artifact_read: false, peer_deny_applied: {}, forged_role_file: false },
    artifacts: [], gate: { adjudication_complete: false, state: 'running' }, status: 'success',
    ...over,
  };
}

async function writeRawRunMeta(
  l: ArchiveLayout, stage: StageOrVerify, runId: string, body: unknown,
): Promise<void> {
  const dir = metaDir(l, stage);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `run-${runId}.json`), JSON.stringify(body));
}

const unreadableOf = async (l: ArchiveLayout, runId: string): Promise<boolean | undefined> =>
  (await listRecordedRuns(l)).find((r) => r.run_id === runId)?.unreadable;

/*
 * §2.4 的收严，本步最重要的一条行为变化。
 *
 * 旧实现是 `schema === 'trivium.run.v1' && 校验不过` 才判坏——`schema` 一旦不是
 * 那个字面量，第一个合取项即为 false，**整个校验被跳过**，记录的工件清单原样进表。
 * 而这份清单正是提交完整性锚的消费对象：把 schema 改成任意别的字符串，
 * 清单就脱离了契约校验。那是伪造通道，不是宽容。
 */
test('审查阶段：未知 schema 判不可读（旧实现静默放行，是条伪造通道）', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'plan', 'RFAKE', {
    schema: 'trivium.run.v3', run_id: 'RFAKE', status: 'success',
    artifacts: [{ path: 'x.md', sha256: 'deadbeef' }],
  });
  assert.equal(await unreadableOf(l, 'RFAKE'), true);
});

test('审查阶段：schema 字段缺失同样判不可读', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'plan', 'RNONE', { run_id: 'RNONE', status: 'success', artifacts: [] });
  assert.equal(await unreadableOf(l, 'RNONE'), true);
});

test('审查阶段：写侧产出的 run.v2 可读', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'plan', 'RV2', v2Meta());
  assert.equal(await unreadableOf(l, 'RV2'), undefined);
});

test('审查阶段：自称 run.v2 却不合契约 → 不可读', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'plan', 'RBAD', v2Meta({ critics_selected: [] }));
  assert.equal(await unreadableOf(l, 'RBAD'), true);
});

test('审查阶段：历史 run.v1 按 v1 契约判读，合契约即可读', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'plan', 'RV1', v1Meta());
  assert.equal(
    await unreadableOf(l, 'RV1'), undefined,
    '既有归档是不可变工件，必须按写入时的规范解读（P6）',
  );
});

test('审查阶段：自称 run.v1 却缺必填字段 → 仍判不可读', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'plan', 'RV1BAD', { schema: 'trivium.run.v1', run_id: 'RV1BAD', status: 'success' });
  assert.equal(await unreadableOf(l, 'RV1BAD'), true);
});

/*
 * verify 分支：写错会**永久拦死本仓库的每一次 git commit**（§6.7.1 的方框）。
 *
 * 提交完整性锚见 unreadable 即闸门阻断，而归档里的历史 verify 记录违反 stage 枚举、
 * 缺大量必填字段——拿审查契约去校验它们，结果是无法通过改代码之外的任何手段解除的死锁。
 */
test('verify 阶段：verify-run.v1 可读', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'verify', 'V1', {
    schema: 'trivium.verify-run.v1', run_id: 'V1', status: 'success', artifacts: [],
  });
  assert.equal(await unreadableOf(l, 'V1'), undefined);
});

test('verify 阶段：历史 run.v1 不施加审查元数据校验（写错即锁死仓库提交）', async () => {
  const l = await tmpLayout();
  // 形状是 verify 记录、标签却是 run.v1：拿审查契约校验必然不过
  await writeRawRunMeta(l, 'verify', 'V2', {
    schema: 'trivium.run.v1', run_id: 'V2', topic: l.topic, stage: 'verify',
    rerun_index: 1, status: 'success', started_at: 'x', finished_at: 'y', artifacts: [],
  });
  assert.equal(
    await unreadableOf(l, 'V2'), undefined,
    'verify 下的历史 run.v1 一旦被判不可读，此后每一次 git commit 都会被拦死',
  );
});

test('verify 阶段：未知 schema 仍判不可读（宽容只给两种历史形状，不是给所有）', async () => {
  const l = await tmpLayout();
  await writeRawRunMeta(l, 'verify', 'V3', {
    schema: 'trivium.whatever.v9', run_id: 'V3', status: 'success', artifacts: [],
  });
  assert.equal(await unreadableOf(l, 'V3'), true);
});

/*
 * 拿**本仓库的真实归档**当回归夹具。
 *
 * 上面每一条都是我造的样本，而造样本的人与实现分发规则的是同一个——
 * 我没想到的形态，样本里同样不会有。真实归档是唯一不受这个偏差影响的输入：
 * 它由过去几十次运行自然积累，含 §6.7.1 点名的那 5 份历史记录。
 * 断言的不变量很朴素：**当前实现读不坏本仓库已有的任何一份留痕**——
 * 它一旦变红，下一次提交就会被拦死。
 */
test('真实归档回归：本仓库归档里没有任何一份运行留痕被判不可读', async () => {
  const archiveRoot = path.join(REPO_ROOT, '.reviews');
  let topics: string[];
  try {
    topics = (await fs.readdir(archiveRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
      .map((d) => d.name);
  } catch {
    return; // 全新检出没有归档：跳过，而不是假装通过
  }

  let seen = 0;
  const bad: string[] = [];
  for (const topic of topics) {
    for (const r of await listRecordedRuns({ archiveRoot, topic })) {
      seen++;
      if (r.unreadable) bad.push(`${topic}/${r.stage}/${r.run_id}`);
    }
  }
  assert.deepEqual(bad, [], '真实归档里出现不可读留痕，提交会被永久拦死');
  assert.ok(seen > 0, '一份都没扫到说明夹具本身失效了，不等于「全都可读」');
});
