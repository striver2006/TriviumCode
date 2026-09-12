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
