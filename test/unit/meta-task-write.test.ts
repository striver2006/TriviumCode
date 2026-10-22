/**
 * 审批正本读不出拒写（EV-248，计划 r2 §五 U1～U5）。
 *
 * 写入口 `updateTask` / `updateTaskAsync` 原先在锁内宽松读，读不出回落空正本再写回，`approvals[]` 随之丢失。
 * 现在：读不出（含形状不对）⇒ 抛退 2 的受控错误、不调回调、文件原样；不存在 ⇒ 新主题照旧起写。
 * U5 测 `recordApproval` 的先判与「闸门已写、正本才坏」的补偿回退。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  emptyTask, isTaskUnreadableError, readTask, readTaskStrict, taskUnreadableError, taskUnreadableExit, updateTask, updateTaskAsync,
  type TaskMeta,
} from '../../src/trivium/meta.js';
import { recordApproval, taskUnreadableHold } from '../../src/trivium/approval.js';
import { getGate, setGate } from '../../src/trivium/state.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '正本拒写';
const STALE = 120_000;
/** 审批正本的文件名（`meta.ts` 的 `taskPath` 落点） */
const TASK_FILE = 'task.json';

async function fakeCtx(): Promise<Ctx> {
  const root = await scratchDir('trivium-taskwrite-');
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  await fs.mkdir(path.join(root, '.reviews', TOPIC), { recursive: true });
  return { config: defaultConfig(), projectRoot: root, archiveRoot: path.join(root, '.reviews'), triviumDir, sources: ['<test>'] };
}

const layoutOf = (ctx: Ctx) => ({ archiveRoot: ctx.archiveRoot, topic: TOPIC });
const taskFileOf = (ctx: Ctx) => path.join(ctx.archiveRoot, TOPIC, TASK_FILE);
const lockOf = (ctx: Ctx) => ({ triviumDir: ctx.triviumDir, heartbeatStaleMs: STALE });

/** 断言是写入口的拒写错误：退 2、点名绝对路径、给出 Git 出口与「由用户在终端执行」 */
function assertRefusal(e: unknown, file: string): true {
  assert.ok(isTaskUnreadableError(e), `应是拒写错误，实际：${String(e)}`);
  assert.equal(e.code, EXIT.GATE_BLOCK);
  assert.ok(e.message.includes(file), e.message);
  assert.match(e.message, /git restore --source=HEAD/);
  assert.match(e.message, /由用户在终端执行/);
  return true;
}

/** 读不出的形态：内容（写成文件）或目录 */
const SYNTAX_FORMS: Array<{ name: string; content: string }> = [
  { name: '截断的 JSON', content: '{ "schema": "trivium.task.v1", "approvals": [' },
];
/** 形状不对的五种（计划双审 AGY-02）：合法 JSON，但不是一份 task.json；`hint` 是 error 里应点名的那一项 */
const SHAPE_FORMS: Array<{ name: string; content: string; hint: RegExp }> = [
  { name: 'null', content: 'null', hint: /不是一个 JSON 对象（是 null）/ },
  { name: '数组', content: '[]', hint: /不是一个 JSON 对象（是 数组）/ },
  { name: '数字', content: '123', hint: /不是一个 JSON 对象（是 number）/ },
  { name: '空对象', content: '{}', hint: /schema 不是 trivium\.task\.v1/ },
  {
    name: 'approvals 是对象',
    content: JSON.stringify({ ...emptyTask(TOPIC), approvals: {} }),
    hint: /approvals 不是数组/,
  },
];

for (const form of [...SYNTAX_FORMS, ...SHAPE_FORMS]) {
  for (const entry of ['updateTask', 'updateTaskAsync'] as const) {
    test(`U1 · ${form.name} × ${entry}：拒写退 2、不调回调、文件字节不变`, async () => {
      const ctx = await fakeCtx();
      await fs.writeFile(taskFileOf(ctx), form.content, 'utf8');
      const before = await fs.readFile(taskFileOf(ctx));
      let calls = 0;
      const run = entry === 'updateTask'
        ? updateTask(layoutOf(ctx), () => { calls++; }, lockOf(ctx))
        : updateTaskAsync(layoutOf(ctx), async () => { calls++; }, lockOf(ctx));
      await assert.rejects(run, (e) => assertRefusal(e, taskFileOf(ctx)));
      assert.equal(calls, 0, '读不出时不得调用改写回调');
      assert.deepEqual(await fs.readFile(taskFileOf(ctx)), before, '坏件必须原样保留');
    });
  }
}

for (const form of SHAPE_FORMS) {
  test(`U1 · ${form.name}：readTaskStrict 判 unreadable 并点名不合的那一项`, async () => {
    const ctx = await fakeCtx();
    await fs.writeFile(taskFileOf(ctx), form.content, 'utf8');
    const r = await readTaskStrict(layoutOf(ctx));
    assert.equal(r.state, 'unreadable');
    assert.match(r.error ?? '', form.hint);
    // 宽松读照旧当空（读侧口径不变，只是不再在属性访问处抛 TypeError）
    assert.deepEqual((await readTask(layoutOf(ctx))).approvals, []);
  });
}

test('U1 · task.json 的位置是目录：拒写退 2、目录原样', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(taskFileOf(ctx));
  await fs.writeFile(path.join(taskFileOf(ctx), 'sentinel'), 'x');
  let calls = 0;
  await assert.rejects(updateTask(layoutOf(ctx), () => { calls++; }, lockOf(ctx)), (e) => assertRefusal(e, taskFileOf(ctx)));
  assert.equal(calls, 0);
  assert.ok((await fs.stat(taskFileOf(ctx))).isDirectory());
  assert.deepEqual(await fs.readdir(taskFileOf(ctx)), ['sentinel']);
});

test('U1 · 权限 000：拒写退 2、文件原样', { skip: process.getuid?.() === 0 ? 'root 读得动 000 文件' : false }, async () => {
  const ctx = await fakeCtx();
  const t = emptyTask(TOPIC);
  t.approvals.push({ at: '2026-10-22T00:00:00.000Z', stage: 'plan', run_id: 'R1', decision: 'approved', reason: null });
  await fs.writeFile(taskFileOf(ctx), JSON.stringify(t), 'utf8');
  await fs.chmod(taskFileOf(ctx), 0o000);
  try {
    await assert.rejects(updateTask(layoutOf(ctx), () => {}, lockOf(ctx)), (e) => assertRefusal(e, taskFileOf(ctx)));
  } finally {
    await fs.chmod(taskFileOf(ctx), 0o644);
  }
  assert.equal(JSON.parse(await fs.readFile(taskFileOf(ctx), 'utf8')).approvals.length, 1, '审批记录不得被覆盖');
});

test('U2 · 正本不存在：首次写入建出完整正本（新主题不受影响）', async () => {
  const ctx = await fakeCtx();
  await updateTask(layoutOf(ctx), (t) => { t.goal = '首次'; }, lockOf(ctx));
  const r = await readTaskStrict(layoutOf(ctx));
  assert.equal(r.state, 'ok', r.error);
  assert.equal(r.task.schema, 'trivium.task.v1');
  assert.equal(r.task.topic, TOPIC);
  assert.equal(r.task.goal, '首次');
});

test('U3 · 正本可读：既有字段保留、本次改动生效', async () => {
  const ctx = await fakeCtx();
  const t: TaskMeta = emptyTask(TOPIC);
  t.approvals.push({ at: '2026-10-22T00:00:00.000Z', stage: 'plan', run_id: 'R1', decision: 'approved', reason: null });
  await fs.writeFile(taskFileOf(ctx), JSON.stringify(t), 'utf8');
  await updateTaskAsync(layoutOf(ctx), async (x) => { x.disputed = true; }, lockOf(ctx));
  const r = await readTaskStrict(layoutOf(ctx));
  assert.equal(r.state, 'ok');
  assert.equal(r.task.approvals.length, 1);
  assert.equal(r.task.disputed, true);
});

test('U4 · 写入口拒写与停点保守处理共用同一段出口', () => {
  const l = { archiveRoot: '/tmp/归档', topic: TOPIC };
  const exit = taskUnreadableExit(l, 'Unexpected end of JSON input\n第二行不进文案');
  assert.ok(exit.includes(path.join('/tmp/归档', TOPIC, TASK_FILE)));
  assert.match(exit, /Unexpected end of JSON input/);
  assert.ok(!exit.includes('第二行不进文案'), '原因只取首行');
  assert.match(exit, /由用户在终端执行；在会话里执行会被 TriviumCode Hook 拦下/);
  assert.ok(taskUnreadableHold(l, 'Unexpected end of JSON input').includes(taskUnreadableExit(l, 'Unexpected end of JSON input')));
  assert.ok(taskUnreadableError(l, 'Unexpected end of JSON input', '某事').message.includes(taskUnreadableExit(l, 'Unexpected end of JSON input')));
  assert.equal(taskUnreadableError(l, undefined, '某事').code, EXIT.GATE_BLOCK);
});

// ── U5 · recordApproval：先判 + 补偿（计划 r2 §三.2）──

test('U5 · 正本先已读不出：approve 退 2，闸门不动、正本原样', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await fs.writeFile(taskFileOf(ctx), '{ 坏', 'utf8');
  for (const decision of ['approved', 'rejected', 'abandoned'] as const) {
    await assert.rejects(
      recordApproval({ ctx, topic: TOPIC, stage: 'plan', decision, reason: '理由', verifiedRunId: 'R1' }),
      (e) => {
        assertRefusal(e, taskFileOf(ctx));
        // 拦在写闸门之前，不是写了再补偿回来（补偿会掩盖先判缺失，计划 r2 §五 M3）
        assert.doesNotMatch((e as Error).message, /回退/);
        return true;
      },
    );
    assert.equal((await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state, 'awaiting_approval', `${decision}：闸门不得被改动`);
  }
  assert.equal(await fs.readFile(taskFileOf(ctx), 'utf8'), '{ 坏');
});

test('U5 · 闸门已写下决定、正本才坏：比较-交换回原状态，错误原样上抛', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  let gateSeen: string | undefined;
  await assert.rejects(
    recordApproval({
      ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1',
      afterGateAppliedForTest: async () => {
        gateSeen = (await getGate(ctx.triviumDir, TOPIC, 'plan'))?.state;
        await fs.writeFile(taskFileOf(ctx), '{ 坏', 'utf8');
      },
    }),
    (e) => {
      assertRefusal(e, taskFileOf(ctx));
      assert.match((e as Error).message, /闸门已回退到本次之前的 awaiting_approval/);
      return true;
    },
  );
  assert.equal(gateSeen, 'approved', '前提：注入点确实在闸门写下之后');
  const g = await getGate(ctx.triviumDir, TOPIC, 'plan');
  assert.equal(g?.state, 'awaiting_approval', '补偿必须把闸门回退');
  assert.equal(g?.run_id, 'R1');
  assert.equal(await fs.readFile(taskFileOf(ctx), 'utf8'), '{ 坏', '坏件不得被覆盖');
});

test('U5 · 补偿前闸门已被别的运行接管：不回退，文案说明未回退', async () => {
  const ctx = await fakeCtx();
  await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'awaiting_approval', runId: 'R1', heartbeatStaleMs: STALE });
  await assert.rejects(
    recordApproval({
      ctx, topic: TOPIC, stage: 'plan', decision: 'approved', verifiedRunId: 'R1',
      afterGateAppliedForTest: async () => {
        await setGate({ triviumDir: ctx.triviumDir, topic: TOPIC, stage: 'plan', state: 'running', runId: 'R9', heartbeatStaleMs: STALE });
        await fs.writeFile(taskFileOf(ctx), '{ 坏', 'utf8');
      },
    }),
    (e) => {
      assertRefusal(e, taskFileOf(ctx));
      assert.match((e as Error).message, /未回退/);
      return true;
    },
  );
  const g = await getGate(ctx.triviumDir, TOPIC, 'plan');
  assert.equal(g?.state, 'running', '别的运行的闸门不得被动');
  assert.equal(g?.run_id, 'R9');
});
