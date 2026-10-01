/**
 * `run.v2` 的 `guard` 节点收严之后的回归锁（2026-09-16）。
 *
 * ## 收严了什么
 *
 * `guard` 此前没有 `additionalProperties: false`：新增一个 guard 字段而忘了同步
 * schema，照样过 ajv、照样落盘——于是「这个字段已经在机读契约面上了」只是一句话。
 * 本批新增 `peer_leak_via_path` 与 `joint_check` 时把它收严了。
 *
 * ## 收严的代价与它的边界
 *
 * 归档是进 Git 的审计凭证、不可回改。收严之后，任何一份 `guard` 里含未声明键的
 * 历史留痕都会变成**读不回**。收严前实测本仓库 29 份 v2 留痕**零差额**，
 * 所以对本仓库没有代价；项目负责人明示**不为其它项目的历史留痕做兼容**。
 *
 * 下面第一条用真实归档做回归锁：它不是构造夹具，就是仓库里那些留痕本身。
 * 将来若有人往 `meta.guard` 加字段而不同步 schema，它会**当场红**——
 * 这正是收严要买的东西。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { WORKER_LOST_REASONS } from '../../src/trivium/status.js';
import { DRIFT_UNKNOWN_CAUSES, EXCEPTION_TERMINATION_BY } from '../../src/trivium/types.js';
import { REPO_ROOT } from '../helpers/fixture.js';

/** 递归找出归档里的全部运行记录 */
async function collectRunMetas(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collectRunMetas(p, out);
    else if (/^run-.*\.json$/.test(e.name)) out.push(p);
  }
  return out;
}

test('收严回归锁：本仓库全部 v2 留痕仍能通过校验', async () => {
  const files = await collectRunMetas(path.join(REPO_ROOT, '.reviews'));
  assert.ok(files.length > 0, '归档里一份运行记录都没有，这条锁就没有在锁任何东西');

  const broken: string[] = [];
  let v2 = 0;
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(f, 'utf8'));
    } catch {
      continue; // 坏文件不是本条的论域
    }
    const schema = (raw as { schema?: unknown }).schema;
    if (typeof schema !== 'string' || !schema.includes('v2')) continue;
    v2++;
    const problems = validateRunMeta(raw);
    if (problems.length > 0) {
      broken.push(`${path.relative(REPO_ROOT, f)}：${problems.slice(0, 3).join('；')}`);
    }
  }

  assert.ok(v2 > 0, '一份 v2 留痕都没扫到——检查收集逻辑，否则这条锁是空的');
  assert.deepEqual(
    broken,
    [],
    'guard 收严之后，下列历史留痕读不回了。要么是新加的 guard 字段没同步 schema，' +
      '要么是收严本身打坏了历史归档——归档不可回改，只能改 schema：\n  ' +
      broken.join('\n  '),
  );
});

test('收严生效：guard 里出现未声明的键必须判错，而不是静默通过', async () => {
  /*
   * 拿一份真实留痕做底，塞一个未声明的 guard 键。
   *
   * 不构造整份 run.json 是有意的：手写夹具会与写侧各自漂移，
   * 而这条断言要的恰恰是「写侧产出的真实形状 + 一个多余键」会被拒。
   */
  const files = await collectRunMetas(path.join(REPO_ROOT, '.reviews'));
  let sample: Record<string, unknown> | null = null;
  for (const f of files) {
    try {
      const raw = JSON.parse(await fs.readFile(f, 'utf8')) as Record<string, unknown>;
      const schema = raw.schema;
      if (typeof schema === 'string' && schema.includes('v2') && raw.guard) {
        sample = raw;
        break;
      }
    } catch {
      /* 跳过坏文件 */
    }
  }
  assert.ok(sample, '没找到可用的 v2 样本');

  assert.deepEqual(validateRunMeta(sample), [], '前提：原样本本来是合法的');

  const tampered = {
    ...sample,
    guard: { ...(sample.guard as Record<string, unknown>), some_field_nobody_declared: true },
  };
  assert.ok(
    validateRunMeta(tampered).length > 0,
    'guard 多出一个未声明的键却校验通过——收严没生效，' +
      '「新增 guard 字段必须同步 schema」又变回一句没有代码支撑的话',
  );
});

// ── EV-142：termination（计划 r2 §3.5 / §4.1 S1、S2）──

function terminationSample(): Record<string, unknown> {
  return newRunMeta({
    runId: '20260927T000000Z', topic: 't', stage: 'plan', rerunIndex: 1, command: 'test', promptHint: null, taskGoal: null,
    criticsSelected: ['gemini'], treeHash: 'T', gitHead: null, dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
  }) as unknown as Record<string, unknown>;
}

test('EV-142 S1：termination 两种形状通过；多键、by 取别的值、reason 越出枚举都判错；缺席照样通过', () => {
  const base = { ...terminationSample(), status: 'failed' };
  assert.deepEqual(validateRunMeta(base), [], '缺席：正常收尾、取消轮与旧留痕都没有这一键');
  assert.deepEqual(validateRunMeta({ ...base, termination: { by: 'worker_exception', exit_code: 1 } }), []);
  assert.deepEqual(validateRunMeta({ ...base, termination: { by: 'worker_lost', reason: 'pid_gone' } }), []);
  const bad: unknown[] = [
    { by: 'worker_exception', exit_code: 1, detail: '/private/var/folders/…' }, // 不存自由文本
    { by: 'worker_lost', reason: 'pid_gone', exit_code: 1 },
    { by: 'cancel' },
    { by: 'worker_lost', reason: 'oom' },
    { by: 'worker_exception', exit_code: '1' },
  ];
  for (const t of bad) {
    assert.ok(validateRunMeta({ ...base, termination: t }).length > 0, `应判错：${JSON.stringify(t)}`);
  }
});

test('EV-142 S2：schema 里 termination.reason 的枚举与 status.ts 的 WORKER_LOST_REASONS 逐项相等（单一来源）', async () => {
  const schema = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, 'skills/dual-critic/schema/run.v2.json'), 'utf8'),
  ) as { properties: { termination: { oneOf: { properties: { by: { const: string }; reason?: { enum: string[] } } }[] } } };
  const lost = schema.properties.termination.oneOf.find((b) => b.properties.by.const === 'worker_lost');
  assert.ok(lost?.properties.reason, 'schema 里没找到 worker_lost 分支的 reason');
  assert.deepEqual(
    [...lost.properties.reason.enum].sort(),
    [...WORKER_LOST_REASONS].sort(),
    '给 interpretStatus 加了失联原因却没同步 run.v2 schema：写出的 run.json 会不合契约、被读成 null',
  );
});

test('EV-145 S1′：prepare_exception / sync_exception 与 worker_exception 同形——带整数退出码通过；缺退出码、串形状、带自由文本都判错', () => {
  const base = { ...terminationSample(), status: 'failed' };
  for (const by of ['prepare_exception', 'sync_exception']) {
    assert.deepEqual(validateRunMeta({ ...base, termination: { by, exit_code: 1 } }), [], `${by} 应通过`);
  }
  const bad: unknown[] = [
    { by: 'prepare_exception' },
    { by: 'sync_exception', reason: 'pid_gone' },
    { by: 'prepare_exception', exit_code: 1, detail: '/private/var/folders/…' },
    { by: 'sync_exception', exit_code: 'EACCES' },
  ];
  for (const t of bad) {
    assert.ok(validateRunMeta({ ...base, termination: t }).length > 0, `应判错：${JSON.stringify(t)}`);
  }
});

test('EV-150 S1″：post_spawn_exception 与另三个异常取值同形——带整数退出码通过；缺退出码、串形状、带自由文本都判错', () => {
  const base = { ...terminationSample(), status: 'failed' };
  assert.deepEqual(validateRunMeta({ ...base, termination: { by: 'post_spawn_exception', exit_code: 1 } }), []);
  const bad: unknown[] = [
    { by: 'post_spawn_exception' },
    { by: 'post_spawn_exception', reason: 'pid_gone' },
    { by: 'post_spawn_exception', exit_code: 1, detail: 'EISDIR …/worker.pid' },
  ];
  for (const t of bad) {
    assert.ok(validateRunMeta({ ...base, termination: t }).length > 0, `应判错：${JSON.stringify(t)}`);
  }
});

test('EV-145 S3：schema 里 termination.by 的取值集合与 types.ts 的 EXCEPTION_TERMINATION_BY + worker_lost 逐项相等（单一来源）', async () => {
  const schema = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, 'skills/dual-critic/schema/run.v2.json'), 'utf8'),
  ) as { properties: { termination: { oneOf: { properties: { by: { const?: string; enum?: string[] } } }[] } } };
  const fromSchema = schema.properties.termination.oneOf.flatMap((b) =>
    b.properties.by.enum ?? (b.properties.by.const !== undefined ? [b.properties.by.const] : []),
  );
  assert.deepEqual(
    [...fromSchema].sort(),
    [...EXCEPTION_TERMINATION_BY, 'worker_lost'].sort(),
    '给 termination.by 加了取值却只改了一边：写出的 run.json 会不合契约、被读成 null（事后收尾余项计划 r2 §3.1）',
  );
});

// ── EV-139：snapshot.drift.unknown_reason（漂移比不了不放行计划 r2 §5.1 C1、C2）──

test('EV-139 C1：schema 里 unknown_reason.cause 的枚举与 types.ts 的 DRIFT_UNKNOWN_CAUSES 逐项相等（单一来源）', async () => {
  const schema = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, 'skills/dual-critic/schema/run.v2.json'), 'utf8'),
  ) as { properties: { snapshot: { properties: { drift: { properties: { unknown_reason?: { properties: { cause: { enum: string[] } } } } } } } } };
  const node = schema.properties.snapshot.properties.drift.properties.unknown_reason;
  assert.ok(node, 'schema 里没找到 snapshot.drift.unknown_reason');
  assert.deepEqual(
    [...node.properties.cause.enum].sort(),
    [...DRIFT_UNKNOWN_CAUSES].sort(),
    '给 judgeDrift 加了「比不了」的原因却没同步 run.v2 schema：写出的 run.json 会不合契约、被读成 null',
  );
});

test('EV-139 C2：unknown_reason 合法形状通过；表外原因、缺 detail、多出键、detail 非字符串都判错；缺席（旧形）照样通过', () => {
  const base = terminationSample() as { snapshot: { drift: Record<string, unknown> } } & Record<string, unknown>;
  const withDrift = (drift: Record<string, unknown>): Record<string, unknown> => ({
    ...base, snapshot: { ...(base.snapshot as Record<string, unknown>), drift },
  });
  const ok = { changed: true, files: [], policy: 'fail' };
  assert.deepEqual(validateRunMeta(withDrift(ok)), [], '缺席：比对成功或旧留痕');
  for (const cause of DRIFT_UNKNOWN_CAUSES) {
    assert.deepEqual(validateRunMeta(withDrift({ ...ok, unknown_reason: { cause, detail: 'x' } })), [], `${cause} 应通过`);
  }
  const bad: unknown[] = [
    { cause: 'pruned', detail: 'x' },
    { cause: 'object_gone' },
    { cause: 'object_gone', detail: 'x', stderr: 'fatal: …' },
    { cause: 'object_gone', detail: 1 },
    'object_gone',
  ];
  for (const u of bad) {
    assert.ok(validateRunMeta(withDrift({ ...ok, unknown_reason: u })).length > 0, `应判错：${JSON.stringify(u)}`);
  }
});
