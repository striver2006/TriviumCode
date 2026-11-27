import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  bundleMissing,
  bundleSkipReason,
  cli,
  listFiles,
  makeFixture,
  today,
} from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { acquireLock } from '../../src/trivium/lock.js';

/**
 * 「失败不留半套工件」（修订版 M3 计划 §7，审查意见 GLM-04）。
 *
 * 原先 `prepareRun` 的顺序是「建阶段目录 → 逐侧冻结并**立即**写 brief」，
 * 于是第二侧路由（当时的 `routeModel`）抛 69 时，第一侧的 brief 已经落盘：
 * `.reviews/` 里留下一个只有单侧送审包、没有任何审查结论的残骸，
 * 而 `gate --check-artifacts` 又会把它当成一次跑过的运行。
 *
 * 所以改成**先全部算完、再统一写**。本文件逐个失败出口验证这条不变量：
 * 失败时 `.reviews/` 与运行目录的文件集合必须与失败前**逐字节一致**。
 */

const TOPIC = '零工件';

/** 记录失败前后的文件集合，断言完全没变 */
async function assertNoTrace(
  root: string,
  archiveRoot: string,
  act: () => Promise<{ code: number | null; stdout: string; stderr: string }>,
  expectExit: number,
  what: string,
) {
  const before = await listFiles(archiveRoot);
  const runsBefore = await listFiles(path.join(root, '.trivium'));

  const r = await act();
  assert.equal(
    r.code,
    expectExit,
    `${what} 应退 ${expectExit}，实际 ${r.code}：\n${r.stdout}\n${r.stderr}`,
  );

  const after = await listFiles(archiveRoot);
  assert.deepEqual(after, before, `${what} 后 .reviews/ 多出或少了文件：${JSON.stringify({ before, after })}`);

  const runsAfter = await listFiles(path.join(root, '.trivium'));
  // 锁文件允许出现后被回收，但不得残留
  assert.deepEqual(
    runsAfter.filter((f) => f.startsWith('lock/')),
    runsBefore.filter((f) => f.startsWith('lock/')),
    `${what} 后残留了主题锁：${runsAfter.join(', ')}`,
  );
  return r;
}

test('非法模型 slug → 退 64 且零工件（GLM-01 的校验执行点）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC,
    // 必须先有模型目录：没有目录就无从比对，校验会整段跳过
    probeModels: { gemini: ['gemini-3.1-pro-high'], glm: ['GLM-5.4', 'GLM-5.3'] },
  });
  const r = await assertNoTrace(
    fx.root,
    fx.archiveRoot,
    () =>
      cli(
        fx.root,
        ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--model-gemini', '压根不存在的模型'],
        { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
      ),
    EXIT.USAGE,
    'slug 校验失败',
  );
  // §7.3 承诺「退 64 并列出可用值」——只报错不给可用值等于让人去猜
  assert.match(r.stdout + r.stderr, /gemini-3\.1-pro-high/, '必须列出可用值');
});

/*
 * **档位组合在 review 准备阶段同样拦**（M11 第 4 步，设计 11.5；计划 r2 §3.4、§5.1）。
 * 与 slug 校验同理：只在预检拦的话，终端直接跑 `--start` 就绕过了。两格各取一条**永久**判据：
 * glm 没有思考等级概念、档位表格子却给了（schema 够不着这一格，计划三审 AGY-02）；思考等级不在该模型的原生枚举里。
 * 第 4、5 步这里第二格是过渡闸（gemini 格子写了合法 effort 即退 64），M11 第 6 步拆闸后那一格改为通过
 * （见 tier-resolve.test.ts 的 T 组），这里换成枚举外取值——永久判据不随拆闸消失。
 */
test('档位组合不合法 → review --start 退 64 且零工件（两条永久判据各一格）', { skip: bundleMissing && bundleSkipReason }, async () => {
  for (const [cell, want, what, probeModels] of [
    ['    glm:\n      plan: { model: GLM-5.3, effort: high }', /不支持思考等级/, 'glm 格子写 effort', undefined],
    [
      '    gemini:\n      plan: { model: gemini-3.8-flash, effort: ultra }',
      /「ultra」不在模型「gemini-3\.8-flash」的原生枚举中。可用值：high, low/,
      'gemini 格子写枚举外 effort',
      { gemini: ['gemini-3.8-flash', 'gemini-3.8-flash-low', 'gemini-3.8-flash-high'], glm: ['GLM-5.4', 'GLM-5.3'] },
    ],
  ] as const) {
    const fx = await makeFixture({ topic: TOPIC, ...(probeModels ? { probeModels: { gemini: [...probeModels.gemini], glm: [...probeModels.glm] } } : {}) });
    await fs.appendFile(path.join(fx.root, '.trivium', 'config.yaml'), `profiles:\n  default:\n${cell}\n`, 'utf8');
    const r = await assertNoTrace(
      fx.root,
      fx.archiveRoot,
      () =>
        cli(
          fx.root,
          ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'],
          { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
        ),
      EXIT.USAGE,
      what,
    );
    assert.match(r.stdout + r.stderr, /档位组合不合法/, what);
    assert.match(r.stdout + r.stderr, want, what);
  }
});

/*
 * **档位命令行旗标的非法格同样零工件**（M11 第 5 步，计划 r2 §3.1）：形状层（未入选侧、档名、没有厂商 profile 概念的侧）
 * 在入口退 64；永久判据（给没有思考等级概念的侧 `--effort-〈id〉`）在准备阶段退 64。都在任何落盘之前。
 * 第 5 步这里最后一格是过渡闸（`--effort-gemini` 在第 6 步前不下传），M11 第 6 步拆闸后改为永久判据那一格。
 */
test('档位旗标不合法 → review --start 退 64 且零工件（未入选侧、档名、无厂商 profile 概念、无思考等级概念）', { skip: bundleMissing && bundleSkipReason }, async () => {
  for (const [flags, want, what] of [
    [['--tier-codex', 'low'], /--tier-codex：codex 本轮没有入选/, '给未入选侧选档'],
    [['--tier-glm', 'ultra'], /--tier-glm 只接受 low \| medium \| high/, '档名不在三档内'],
    [['--profile-gemini', 'x'], /--profile-gemini：gemini 没有厂商 profile 概念/, '没有厂商 profile 概念的侧'],
    [['--effort-glm', 'high'], /ZCode 不支持思考等级/, '永久判据：glm 没有思考等级概念'],
  ] as const) {
    const fx = await makeFixture({ topic: TOPIC });
    const r = await assertNoTrace(
      fx.root,
      fx.archiveRoot,
      () =>
        cli(
          fx.root,
          ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', ...flags],
          { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
        ),
      EXIT.USAGE,
      what,
    );
    assert.match(r.stdout + r.stderr, want, what);
  }
});

test('无探针目录时 slug 校验按设计跳过，而不是误拒', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--model-gemini', '随便一个名字'],
    { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
  );
  /*
   * 这是刻意的：探针没跑过就没有可比对的模型目录，此时硬拒会让 review 在
   * 未 doctor 的项目里完全不可用。把「探针缺失」拦在门口是 `preflight` 的职责
   * （它对过期/缺失探针 fail-fast），不是 slug 校验的。
   */
  assert.equal(r.code, EXIT.OK, `无目录时不该因 slug 被拒：\n${r.stdout}${r.stderr}`);
});

test('非法主题名 → 退 64，不创建主题目录', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  for (const bad of ['../逃逸', '.前导点', '某主题-r2', '某主题-revised']) {
    const r = await cli(
      fx.root,
      ['review', '--start', '--stage', 'plan', '--topic', bad, '--focus', 'x'],
      { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
    );
    assert.equal(r.code, EXIT.USAGE, `主题「${bad}」应被拒：\n${r.stdout}${r.stderr}`);
    const dirs = await fs.readdir(fx.archiveRoot);
    assert.deepEqual(dirs, [TOPIC], `主题「${bad}」不该建目录，实际 .reviews/ 下有：${dirs.join(', ')}`);
  }
});

test('缺 --focus → 退 64，除非 --entry A（命令 A 的焦点是可选补充）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const stub = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };

  // 不带 --entry：按 B/C/D 规则，缺焦点即拒
  let r = await cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC], stub);
  assert.equal(r.code, EXIT.USAGE, `缺 --focus 应退 64：\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /只有 --entry A/);

  // --entry B：同样拒
  r = await cli(fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC], stub);
  assert.equal(r.code, EXIT.USAGE);

  // 非法 --entry
  r = await cli(fx.root, ['review', '--start', '--entry', 'X', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'], stub);
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.stderr, /--entry 只接受/);

  // 以上三次都不该留下工件
  assert.deepEqual(await listFiles(path.join(fx.archiveRoot, TOPIC, 'plan', '_meta')), []);
});

test('缺待审计划草稿 → 退 65 且不留空主题目录（AC-16）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC, draft: false });

  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'],
    { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
  );
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `应退 65，实际 ${r.code}：\n${r.stdout}${r.stderr}`);

  const left = await listFiles(fx.archiveRoot);
  assert.deepEqual(left, [], `.reviews/ 应保持为空，实际残留：${left.join(', ')}`);
  // 连主题目录本身都不该有：否则 gate --check-artifacts 会以为这个主题存在过
  let entries: string[] = [];
  try {
    entries = await fs.readdir(fx.archiveRoot);
  } catch {
    entries = [];
  }
  assert.deepEqual(entries.filter((e) => e === TOPIC), [], '不该留下空的主题目录');
});

test('两侧均不可用 → 退 69 且零工件', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  // 不注入桩，也没有探针结论 → availability 判不可用
  await assertNoTrace(
    fx.root,
    fx.archiveRoot,
    () => cli(fx.root, ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'], null),
    EXIT.ENV,
    '两侧不可用',
  );
});

test('主题锁被占 → 退 70，且不覆盖已有工件', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });

  // 手工占锁，模拟同主题已有运行在跑
  const lock = await acquireLock({
    triviumDir: path.join(fx.root, '.trivium'),
    topic: TOPIC,
    stage: 'plan',
    kind: 'run',
    heartbeatStaleMs: 120_000,
  });
  try {
    const before = await listFiles(fx.archiveRoot);
    const r = await cli(
      fx.root,
      ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'],
      { gemini: { mode: 'ok' }, glm: { mode: 'ok' } },
    );
    assert.equal(r.code, EXIT.LOCKED, `应退 70，实际 ${r.code}：\n${r.stdout}${r.stderr}`);
    assert.deepEqual(await listFiles(fx.archiveRoot), before, '被锁拒绝时不得动工件');
  } finally {
    await lock.release();
  }
});

/*
 * ── 上一轮未裁决直接重跑 → 退 2 且零工件（EV-109 / EV-145 ①，闸门拦截不留骨架计划 r2 §4.2 B1 / B4）──
 *
 * 此前闸门判定排在落盘段之后：被拦那次已写下 brief、run.json 骨架、task.json 登记与运行目录，
 * AC-16「任一失败出口不留半套工件」的列举里偏偏没有退 2 这一格（EV-109）。
 *
 * 闸门状态只比闸门项，不比文件字节：判负的比较-交换也会刷新 `updated_at`、整文件重写（计划 r2 S1，
 * r1 CODEX-01 ≡ AGY-01 ≡ GLM-01）。两次运行之间隔 1.1 s：run_id 只到秒，同秒撞名时旧顺序下的覆盖会让
 * 文件集合看起来不变（计划 r2 §2.3），断言就假绿了。
 */
async function assertBlockedLeavesNoTrace(fx: Awaited<ReturnType<typeof makeFixture>>, reviewArgs: string[], what: string) {
  const stub = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };
  const first = await cli(fx.root, ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'], stub, 180_000);
  assert.equal(first.code, EXIT.OK, `第 1 轮应成功：\n${first.stdout}${first.stderr}`);
  await new Promise((r) => setTimeout(r, 1100));

  const statePath = path.join(fx.root, '.trivium', 'state.json');
  const gateOf = async () =>
    (JSON.parse(await fs.readFile(statePath, 'utf8')) as { gates: Record<string, unknown> }).gates;
  const taskPath = path.join(fx.archiveRoot, TOPIC, 'task.json');
  const runRoot = fx.runRoot;
  const gatesBefore = await gateOf();
  assert.equal((gatesBefore[`${TOPIC}/plan`] as { state: string }).state, 'review_done_awaiting_disposition', '前提：上一轮待裁决');
  const taskBefore = await fs.readFile(taskPath);
  const runsBefore = await listFiles(runRoot);

  const r = await assertNoTrace(fx.root, fx.archiveRoot, () => cli(fx.root, reviewArgs, stub, 180_000), EXIT.GATE_BLOCK, what);
  assert.match(r.stdout + r.stderr, /尚未裁决/);
  assert.deepEqual(await fs.readFile(taskPath), taskBefore, `${what}：task.json 不得多出登记`);
  assert.deepEqual(await gateOf(), gatesBefore, `${what}：闸门项不得改动`);
  assert.deepEqual(await listFiles(runRoot), runsBefore, `${what}：不得在项目外建运行目录`);
}

test('上一轮未裁决 → review --start 退 2 且零工件（B1，EV-109）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await assertBlockedLeavesNoTrace(
    fx,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'],
    '异步路径被闸门拦下',
  );
});

test('上一轮未裁决 → 同步 review --stage 退 2 且零工件（B4，EV-109）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  await assertBlockedLeavesNoTrace(
    fx,
    ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'],
    '同步路径被闸门拦下',
  );
});

test('草稿已有且成功跑完 → 重跑抬升 -r2，原文件字节不变（FR-25）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const stub = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };

  const runOnce = async () => {
    const s = await cli(
      fx.root,
      ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x'],
      stub,
      180_000,
    );
    assert.ok(
      s.code === EXIT.OK || s.code === EXIT.FAIL,
      `同步审查异常退出 ${s.code}：\n${s.stdout}${s.stderr}`,
    );
    return s;
  };

  await runOnce();
  /*
   * 上一轮审完未裁决时，重跑会被闸门挡下（审查意见 GLM-r2-01 ③）——
   * 否则待裁决状态会被无声抹掉、那一轮从此逃过裁决。
   * 这里显式作废它，模拟「这一轮不要了，重来」的正当操作。
   */
  const ab = await cli(fx.root, ['abandon', '--topic', TOPIC, '--stage', 'plan', '--reason', '重跑用例']);
  assert.equal(ab.code, EXIT.OK, `abandon 应成功：\n${ab.stdout}${ab.stderr}`);
  const first = path.join(fx.stageDir, `${today()}-${TOPIC}-gemini.md`);
  const firstBytes = await fs.readFile(first);

  await runOnce();
  assert.deepEqual(
    await fs.readFile(first),
    firstBytes,
    '首轮工件必须逐字节不变——只追加不覆盖（P6）',
  );
  const docs = await fs.readdir(fx.stageDir);
  assert.ok(
    docs.includes(`${today()}-${TOPIC}-r2-gemini.md`),
    `重跑应产出 -r2 文件，实际：${docs.join(', ')}`,
  );
});

test('report 不存在的主题 → 退 65 并给候选，不凭空建目录（审查意见 GLM-r2-10）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const before = await listFiles(fx.archiveRoot);

  const r = await cli(fx.root, ['report', '--topic', '拼错的主题名']);
  /*
   * USAGE 承诺 report「只读归档」，而 resolveTopic 会无条件 ensureDir——
   * 对拼错的主题名跑 report 会凭空建出 .reviews/<拼错名>/plan/，
   * 既违背承诺，也让拼错名得不到报错（只得到一份空报告加一个新目录）。
   */
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `应退 65：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, new RegExp(TOPIC), '要给出现有主题作为候选');
  assert.deepEqual(await listFiles(fx.archiveRoot), before, '只读命令不得创建任何目录');
});

test('verify 也不凭空建目录', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC });
  const before = await listFiles(fx.archiveRoot);
  await cli(fx.root, ['verify', '--topic', '另一个拼错名']);
  const after = await listFiles(fx.archiveRoot);
  assert.ok(
    !after.some((f) => f.startsWith('另一个拼错名/plan/')),
    `不该建出 plan 目录：${after.filter((f) => f.startsWith('另一个拼错名')).join(', ')}`,
  );
  assert.ok(after.length >= before.length);
});

test('--timeout 拼错时报 64 并回显原值，不静默回退默认值', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: TOPIC, extraVerify: ["  build: ['echo ok']", '  test: []'] });
  for (const bad of ['abc', '0', '-5']) {
    const r = await cli(fx.root, ['verify', '--topic', TOPIC, '--timeout', bad]);
    assert.equal(r.code, EXIT.USAGE, `「${bad}」应退 64：\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, new RegExp(bad.replace('-', '\\-')), '要回显用户给的原值');
  }
});
