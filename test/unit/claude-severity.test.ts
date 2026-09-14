/**
 * claude 探针结论 → 诊断严重度的分档（M6 第 3 步）。
 *
 * 与 `codex-severity.test.ts` 同构。首要理由也一样：这里有一条**安全判定**
 * （只读保障不成立时必须阻断），埋在 `runDoctor` 里就要真跑才走得到，
 * 等于没有断言守着——上一步正是因此被审出一条 security 级意见。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeSeverity } from '../../src/trivium/doctor.js';
import { defaultProbe } from '../../src/trivium/config.js';
import type { ClaudeProbe } from '../../src/trivium/types.js';

function healthy(over: Partial<ClaudeProbe> = {}): ClaudeProbe {
  return {
    ...(defaultProbe().cli.claude as ClaudeProbe),
    entrypoint: '/Users/x/.local/bin/claude',
    version: '2.1.270',
    probed_at: new Date().toISOString(),
    readonly_flags: ['--restricted', '--strict-mcp-config', '--tools', 'Read,Grep,Glob'],
    tool_surface_checked: true,
    readonly_breach: false,
    headless_read_ok: true,
    trust_prompt_required: false,
    ...over,
  };
}

const LIVE = { enabled: false, asked: false, skipModelCalls: false };

test('一切正常时不产生任何诊断', () => {
  assert.deepEqual(claudeSeverity(healthy(), LIVE), []);
});

test('【安全】只读保障不成立时恒为 blocker，哪怕该侧尚未启用', () => {
  /*
   * claude 的只读靠**工具白名单**而不是沙箱，所以失守有两种形态：
   * 工具面混入了写工具（--strict-mcp-config 失效），或负对照真落了文件。
   * 两者都反映在 readonly_flags 被清空上。
   *
   * 不分档的理由同 codex：失守说明这台机器上的 claude 现在就是不安全的，
   * 与「我们打不打算用它当审核者」无关。
   */
  const lines = claudeSeverity(healthy({ readonly_flags: [] }), LIVE);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 'blocker');
  assert.match(lines[0]!.message, /只读保障不成立/);
  assert.match(lines[0]!.message, /strict-mcp-config/, '要指出该查哪个旗标');
});

test('【安全】失守盖过「读不到文件」', () => {
  const lines = claudeSeverity(
    healthy({ readonly_flags: [], headless_read_ok: false }),
    LIVE,
  );
  assert.match(lines[0]!.message, /只读保障/, '失守要排在前面：读不到是用不了，失守是用了会坏事');
});

test('负对照没跑过时，readonly_flags 为空不算失守', () => {
  assert.deepEqual(
    claudeSeverity(healthy({ readonly_flags: [] }), { ...LIVE, skipModelCalls: true }),
    [],
  );
});

test('未启用为审核者时，「没装」只是 note', () => {
  const lines = claudeSeverity(healthy({ entrypoint: null }), LIVE);
  assert.equal(lines[0]!.level, 'note');
  assert.match(lines[0]!.message, /尚未启用为审核者/);
});

test('显式 --only claude 时，「没装」升为 blocker', () => {
  const lines = claudeSeverity(healthy({ entrypoint: null }), { ...LIVE, asked: true });
  assert.equal(lines[0]!.level, 'blocker');
});

test('第三态不静默放行：未得出结论要留痕，且不是 blocker', () => {
  const lines = claudeSeverity(healthy({ headless_read_ok: null }), LIVE);
  assert.equal(lines[0]!.level, 'note');
  assert.match(lines[0]!.message, /未得出结论/);
  assert.match(lines[0]!.message, /重跑/);
});

test('需要人工信任时单列一条 note：该侧对新克隆的仓库不可用', () => {
  /*
   * 设计单列这一项的理由：若首跑需要人工信任，该侧对「新克隆的仓库」就不可用，
   * 必须如实标记、写进用户文档，不能靠「我这台机器上是好的」糊过去。
   * 本机实测为 false，但判定链路要在——否则换台机器为真时没人会注意到。
   */
  const lines = claudeSeverity(healthy({ trust_prompt_required: true }), LIVE);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 'note');
  assert.match(lines[0]!.message, /新克隆/);
  assert.match(lines[0]!.message, /用户文档/, '要说出处置去向，而不只是报现象');
});

test('【安全】工具面未核对过时不得产出 blocker', () => {
  /*
   * 审查意见 AGY-02 ≡ GLM-01，两侧独立收敛判 major。
   *
   * `readonly_flags` 的空集有**两个来源**：「核对过、发现混入写工具」与
   * 「压根没核对」。后者发生在读探针拿不到 system/init 时——未登录、断网、
   * spawn 报错，而 `run()` 对这些都不抛错。
   *
   * 原实现把空集一律判失守，于是 claude（Driver，**人人皆装**）的登录态一过期，
   * 默认 doctor 就给出一条**失实的安全失守指控**。
   */
  const lines = claudeSeverity(
    healthy({ tool_surface_checked: false, readonly_flags: [], headless_read_ok: true }),
    LIVE,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 'note', '没测到不是失守');
  assert.match(lines[0]!.message, /未核对/);
  assert.match(lines[0]!.message, /未得出结论/, '要说清这是「没测到」而不是测出了问题');
  /*
   * 断言「没有断言式的失守指控」，而不是「不出现失守二字」——
   * 文案里那句「既不能算通过也不能算失守」正是在**澄清**，不该被误伤。
   * 起草这条时我用了 /不成立|失守/ 的粗正则，把澄清语也算成了指控，
   * 于是红在一个措辞正确的实现上。判据要贴着「它在断言什么」写。
   */
  assert.doesNotMatch(
    lines[0]!.message, /只读保障不成立/,
    '不得给出失守的断言——用户会照着它去查一个不存在的安全问题',
  );
});

test('【安全】读探针没结论时，note 优先于失守判定', () => {
  /*
   * 同一缺陷的另一条路径：`headless_read_ok === null` 的 note 原本排在
   * 失守判据**之后**，永远走不到。顺序本身是判定的一部分。
   */
  const lines = claudeSeverity(
    healthy({ headless_read_ok: null, tool_surface_checked: false, readonly_flags: [] }),
    LIVE,
  );
  assert.equal(lines[0]!.level, 'note');
  assert.match(lines[0]!.message, /未得出结论/);
  assert.match(lines[0]!.message, /人工信任/, '要把信任提示列为候选原因（GLM-05）');
});

test('工具面核对过且确实混入写工具时，才是失守', () => {
  const lines = claudeSeverity(
    healthy({ tool_surface_checked: true, readonly_flags: [] }),
    LIVE,
  );
  assert.equal(lines[0]!.level, 'blocker');
  assert.match(lines[0]!.message, /只读保障不成立/);
});

/*
 * ── r4 复审：判定顺序本身就是判定的一部分（AGY-01 ≡ GLM-01）──
 *
 * r3 修「没测到被判失守」时多做了一步（把 null note 提到失守判据之前），
 * 开了反方向的洞：**已核实的失守**被「请重跑」压掉。
 * 下面三条锁的是修正后的顺序，且**真的构造那个组合**——
 * 只验「顺序换了」的测试抓不住这类问题。
 */

test('【安全】读探针没跑完，但工具面已核对出脏：仍须 blocker', () => {
  /*
   * GLM-01 路径①：init 在事件流前部就到、工具面核对完成，
   * 而 result 事件因超时没等到 → headless_read_ok 落 null。
   * **这两件事彼此独立**，「读探针没跑完」不等于「什么都没测到」。
   */
  const lines = claudeSeverity(
    healthy({
      headless_read_ok: null,      // 读探针没跑到 result
      tool_surface_checked: true,  // 但工具面确实核对过
      readonly_flags: [],          // 且核对出脏
    }),
    LIVE,
  );
  assert.equal(lines[0]!.level, 'blocker', '已核实的失守不得被「请重跑」遮蔽');
  assert.match(lines[0]!.message, /只读保障不成立/);
});

test('【安全】负对照真落了文件：恒 blocker，独立于其它一切判据', () => {
  /*
   * GLM-01 路径②：`breach.txt` 在不在是**文件系统事实**，不依赖读探针。
   * r3 之前它只体现为 readonly_flags 被清空——与「工具面脏」「没核对成」
   * 三者共用一个信号，读侧分不出来（同一塌缩模式的第三次）。
   */
  const lines = claudeSeverity(
    healthy({
      readonly_breach: true,
      headless_read_ok: null,       // 读探针没结论
      tool_surface_checked: false,  // 工具面也没核对成
      readonly_flags: [],
    }),
    LIVE,
  );
  assert.equal(lines[0]!.level, 'blocker', '文件真被创建了，其它判据统统不重要');
  assert.match(lines[0]!.message, /负对照失败/);
});

test('信任提示排在泛化 null 之前，否则永远被截住', () => {
  /*
   * 它的产出前提正是 `!read.completed`，而那时 headless_read_ok 必为 null。
   * 泛化 note 排前面的话这条永远走不到——r3 修好了探针侧的不可达，
   * r4 发现 doctor 侧又把它挡住了，**同一个字段连着两轮不可达**。
   */
  const lines = claudeSeverity(
    healthy({ trust_prompt_required: true, headless_read_ok: null }),
    LIVE,
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0]!.message, /新克隆/, '特化诊断要盖过泛化的「请重跑」');
});
