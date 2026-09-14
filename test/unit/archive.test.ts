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
  checkStageArtifacts,
  type ArchiveLayout,
} from '../../src/trivium/archive.js';

async function tmpLayout(): Promise<ArchiveLayout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-archive-'));
  return { archiveRoot: path.join(root, '.reviews'), topic: '登录重构' };
}

const DATE = '2026-09-10';

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

test('落盘前密钥扫描：命中即拒绝写入，且文件不存在', async () => {
  const l = await tmpLayout();
  const poisoned = '# 审查\n发现硬编码凭据 sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\n';
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
  let c = await checkStageArtifacts(l, 'plan', 1);
  assert.equal(c.ok, false);
  assert.equal(c.missing.length, 4, 'plan 四件套全缺');

  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'glm', writer: 'glm', rerunIndex: 1, content: 'c', date: DATE });
  c = await checkStageArtifacts(l, 'plan', 1);
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, ['裁决件 …-revised-claude.md']);

  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'd', date: DATE });
  c = await checkStageArtifacts(l, 'plan', 1);
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
  let c = await checkStageArtifacts(l, 'plan', 1, undefined, undefined, recorded);
  assert.equal(c.ok, true, `不该有缺口：${c.missing.join(', ')}`);

  // 手工塞一份没登记的审查件进阶段目录（模拟 cp -R 搬运）
  const smuggled = path.join(l.archiveRoot, l.topic, 'plan', `${DATE}-登录重构-r9-gemini.md`);
  await fs.writeFile(smuggled, '# 伪造的审查意见\n');

  c = await checkStageArtifacts(l, 'plan', 1, undefined, undefined, recorded);
  assert.equal(c.ok, false, '未登记的审查件必须被查出来');
  assert.match(c.missing.join(' '), /未登记的审查件/);
  assert.match(c.missing.join(' '), /r9-gemini\.md/);

  // 不传登记清单时跳过该项（向后兼容）
  const skipped = await checkStageArtifacts(l, 'plan', 1);
  assert.equal(skipped.ok, true, '没提供登记清单就不该据此判失败');
});

test('阶段最低工件集：code 三件套不含 -claude.md 原稿，裁决件用 -response', async () => {
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'code', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'code', role: 'glm', writer: 'glm', rerunIndex: 1, content: 'b', date: DATE });
  let c = await checkStageArtifacts(l, 'code', 1);
  assert.deepEqual(c.missing, ['裁决件 …-response-claude.md']);

  await writeArtifact({ layout: l, stage: 'code', role: 'claude', writer: 'driver', kind: 'response', rerunIndex: 1, content: 'c', date: DATE });
  c = await checkStageArtifacts(l, 'code', 1);
  assert.equal(c.ok, true, `仍缺：${c.missing.join(', ')}`);
});

test('工件集校验按轮次隔离：第二轮缺件不受第一轮齐备影响', async () => {
  const l = await tmpLayout();
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'bug', role, writer: role, rerunIndex: 1, content: 'x', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'bug', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'y', date: DATE });
  await writeArtifact({ layout: l, stage: 'bug', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'z', date: DATE });
  assert.equal((await checkStageArtifacts(l, 'bug', 1)).ok, true);
  assert.equal((await checkStageArtifacts(l, 'bug', 2)).ok, false, '第二轮尚未开始，应判缺件');
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
  assert.equal((await checkStageArtifacts(l, 'plan', 1)).ok, true);

  // 第 2 轮：只有两侧审查 + 裁决件，原稿**不重新生成**
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: 2, content: 'x2', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 2, content: 'y2', date: DATE });

  const c2 = await checkStageArtifacts(l, 'plan', 2);
  assert.equal(c2.ok, true, `第 2 轮应判齐备，实际缺：${c2.missing.join(', ')}`);
});

test('回归：真的没有原稿时仍要报缺（不能因跨轮次查找而放水）', async () => {
  const l = await tmpLayout();
  for (const role of ['gemini', 'glm'] as const) {
    await writeArtifact({ layout: l, stage: 'plan', role, writer: role, rerunIndex: 1, content: 'x', date: DATE });
  }
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'y', date: DATE });
  const c = await checkStageArtifacts(l, 'plan', 1);
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
  const c = await checkStageArtifacts(l, 'plan', 2);
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

test('单侧轮次：不传入选集合就会回落到启用集合，并误报另一侧缺件', async () => {
  // 这是修复前的行为。留作负例，锁住「传与不传有差别」——否则上面的正例证明不了什么
  const l = await tmpLayout();
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', rerunIndex: 1, content: 'a', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: DATE });
  await writeArtifact({ layout: l, stage: 'plan', role: 'claude', writer: 'driver', kind: 'revised', rerunIndex: 1, content: 'd', date: DATE });

  const c = await checkStageArtifacts(l, 'plan', 1);
  assert.equal(c.ok, false, '回落到启用集合时应当报缺件——这正是被修掉的缺陷');
  assert.ok(
    c.missing.some((m) => m.includes('glm')),
    `缺件应点名未入选的那一侧，实得：${c.missing.join(', ')}`,
  );
});
