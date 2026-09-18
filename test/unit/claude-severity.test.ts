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
import { READONLY_INVARIANTS, judgeStrictMcpConfig } from '../../src/trivium/probes/claude.js';
import type { ClaudeProbe } from '../../src/trivium/types.js';

function healthy(over: Partial<ClaudeProbe> = {}): ClaudeProbe {
  /*
   * ── 先合并，再推导 ────────────────────────────────────────────
   *
   * 顺序是判据的一部分（代码双审 r2 CODEX-03 ≡ GLM-r2-04 ≡ AGY-01）。上一版：
   *
   *   · 推导读的是 `over`，于是默认值要在推导里**再写一份**——
   *     基座的 readonly_flags 与推导的 fallback 逐字重复。改其中一份、
   *     另一份不跟，夹具就静默落出 `{flags: 不含硬前置, strict: true}`
   *     的矛盾组合，而没有任何对账用例会发现。
   *     **这正是同一个 diff 在 `probes/claude.ts` 自己引的「同一个字面量存两份」。**
   *   · 那个 fallback 用的是 `?? true`，而 `??` 对 `null` 与 `undefined` 一视同仁——
   *     `healthy({ tool_surface_checked: null })` 会被推成 `true`，
   *     造出 `{checked: null, strict: true}` 这个现实中不存在的组合。
   *
   * 改成「先合出终态 `base`，再由 `base` 推导」：默认清单只剩一份，
   * `??` 消失，三态不被抹平。JSDoc 那句「夹具代表的机器与探针真会产出的值再也分不开」
   * 到这一版才真正成立——**上一版是先写下承诺、后兑现的，顺序反了，记一笔。**
   */
  const base: ClaudeProbe = {
    ...(defaultProbe().cli.claude as ClaudeProbe),
    entrypoint: '/Users/x/.local/bin/claude',
    version: '2.1.273',
    probed_at: new Date().toISOString(),
    // 默认清单**只此一份**，且直接用探针导出的常量，与 claude-events 那组用例同源
    readonly_flags: [...READONLY_INVARIANTS],
    tool_surface_checked: true,
    readonly_breach: false,
    headless_read_ok: true,
    trust_prompt_required: false,
    ...over,
  };
  return {
    ...base,
    // 与探针用的是同一个函数，入参取**合并后**的终态
    strict_mcp_config_applied: judgeStrictMcpConfig(base.tool_surface_checked, base.readonly_flags),
  };
}

/**
 * 直接钉住某个字段值的夹具 —— **只给「专测判定侧单点行为」的用例用**。
 *
 * 与 `healthy()` 的分工：那个代表「一台真实机器」、字段由生产侧判据推导；
 * 这个代表「假如判定函数收到这个值」，用于锁 `claudeSeverity` 自己的分支语义
 * （典型用途：注入「上游退化后会送来的坏值」，验第二层防御）。
 */
function pinned(over: Partial<ClaudeProbe>): ClaudeProbe {
  return { ...healthy(), ...over };
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

/*
 * ── MCP 硬前置（M9 第 2 步，`strict_mcp_config_applied`）────────────────
 *
 * 这个字段存在的**唯一**理由是给适配层一个不必写出旗标字面量的判据
 * （`registry-parity` 第 6 条禁止 `adapters/` 出现它）。若没有消费方，
 * 它就是「只有定义处的新字段」——claude 镜头 code 轴第三条点名的形态。
 * 下面三条把 doctor 这个消费方钉住。
 */

/**
 * **探针在「什么都没测到」时真实产出的形状。**
 *
 * 这个夹具是代码双审三侧共同要求的（AGY-01 ≡ GLM-01 ≡ CODEX-01）：
 * 上一版四条新用例全走 `healthy()`，而我在同一个改动里刚给 `healthy()` 补了
 * `strict_mcp_config_applied: true`——于是**没有任何一条用例覆盖生产侧真会产出的组合**，
 * 一个会把未登录机器判成安全失守的 blocker 就此全绿通过。
 *
 * 成因：未登录、断网、spawn 报错 ⇒ 读探针拿不到 `system/init` ⇒
 * `tool_surface_checked=false`、`readonly_flags` 停在初始 `[]`。
 */
function unmeasured(over: Partial<ClaudeProbe> = {}): ClaudeProbe {
  return healthy({
    tool_surface_checked: false,
    readonly_flags: [],
    headless_read_ok: null,
    trust_prompt_required: null,
    ...over,
  });
}

test('【安全】落盘组合**非空但缺**硬前置 → blocker，且理由点明越界与成本', () => {
  /*
   * 这是 ②' 真正要认领的那一格：工具面核对过、数组非空、其中没有硬前置。
   * 空数组不归它——那有三个更硬的成因，各归 ①/②/⑥。
   */
  const lines = claudeSeverity(
    healthy({ readonly_flags: ['--restricted', '--tools', 'Read,Grep,Glob'] }),
    LIVE,
  );
  assert.equal(lines[0]!.level, 'blocker');
  assert.match(lines[0]!.message, /24 倍/);
  assert.match(lines[0]!.message, /越出项目边界/);
});

test('【回归】探针什么都没测到时，不得判安全失守', () => {
  /*
   * 代码双审三侧独立打中的那条阻断（AGY-01 ≡ GLM-01 ≡ CODEX-01），
   * codex 用构建产物复现过。**这条用例锁的是那个真实组合，不是一个合成的 null。**
   */
  const lines = claudeSeverity(unmeasured(), LIVE);
  assert.equal(
    lines.every((l) => l.level !== 'blocker'),
    true,
    `什么都没测到却报了 blocker：${JSON.stringify(lines)}`,
  );
  assert.match(lines[0]!.message, /未得出结论|未核对/, '该说的是「没测到，请重跑」');
});

test('【回归】没测到 + 需人工信任时，信任提示不得被硬前置那条截住', () => {
  /*
   * 阻断的第二半：②' 排在 ③ 之前，于是需要人工信任的机器拿到的是一条
   * 失实的失守指控 + 一句必然复现的「请重跑」，而真实原因永不出现。
   */
  const lines = claudeSeverity(unmeasured({ trust_prompt_required: true }), LIVE);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!.message, /新克隆/);
});

test('【回归】空数组 + 已核对（breach / 工具面脏）由 ①② 认领，不落到 ②\'', () => {
  /*
   * judgeStrictMcpConfig 对这两种清空返回 false（数组确实不含硬前置），
   * 于是 `=== false` 那道门会命中——靠 ②' 自己的 `length > 0` 排除掉，
   * 而不是靠「① 排在前面」侥幸。两条各验一次。
   */
  const breach = claudeSeverity(
    healthy({ readonly_breach: true, readonly_flags: [] }),
    LIVE,
  );
  assert.match(breach[0]!.message, /负对照失败/);

  const dirty = claudeSeverity(
    healthy({ readonly_flags: [] }),
    LIVE,
  );
  assert.match(dirty[0]!.message, /只读保障不成立/, '工具面脏该由 ② 说，不由 ②\' 说');
});

test('【纵深】探针侧即便退化送来「确认缺失」，判定侧也不得判失守', () => {
  /*
   * 这条锁的是 ②' **自己的**两道前置（`tool_surface_checked === true` 与
   * `readonly_flags.length > 0`），不是上游的判据。
   *
   * 为什么需要单独锁：修好 `judgeStrictMcpConfig` 之后，「什么都没测到」产出的是
   * `null`，于是 ②' 那两道前置**再也走不到**——去掉它们，全部用例照样绿。
   * 一道走不到的守卫等于没有守卫，而它恰恰是**上游再退化一次时**的最后一层。
   *
   * 所以这里用 `pinned()` 直接注入「初版探针会送来的那个坏值」
   * （`tool_surface_checked:false` 却带 `strict_mcp_config_applied:false`），
   * 让第二层在自己的论域里被验到。
   */
  const lines = claudeSeverity(
    pinned({
      tool_surface_checked: false,
      readonly_flags: [],
      strict_mcp_config_applied: false, // ← 上游退化后的产物，现实中不该出现
      headless_read_ok: null,
      trust_prompt_required: null,
    }),
    LIVE,
  );
  assert.equal(
    lines.every((l) => l.level !== 'blocker'),
    true,
    `判定侧没能独立挡住上游的坏值：${JSON.stringify(lines)}`,
  );
});

test('硬前置为 null 是「没测到」，不得当失守', () => {
  /*
   * 与本文件其余分支同一条口径：把未测说成失守，是本仓已经踩过三次的塌缩
   * （flags 空集双义、path_deny 落 false、denied_tool_in_trace 二态化）。
   */
  assert.deepEqual(
    claudeSeverity(pinned({ strict_mcp_config_applied: null }), LIVE),
    [],
    'null 不该产生任何诊断——它归 ⑤/⑥ 的泛化 note，而本夹具其余项都正常',
  );
});

test('--no-model-calls 下不判硬前置（与工具面那条同口径）', () => {
  /*
   * 跳过模型调用时这一项保留上一轮结论，可能是任意值；拿它去判失守，
   * 等于让一个**没跑**的探针产出安全指控。②（工具面）早就是这个口径。
   */
  assert.deepEqual(
    claudeSeverity(
      healthy({
        readonly_flags: ['--restricted', '--tools', 'Read,Grep,Glob'],
      }),
      { ...LIVE, skipModelCalls: true },
    ),
    [],
  );
});

test('已核实的失守排在硬前置之前：负对照落了文件时报的是那条', () => {
  /*
   * 顺序判据（本函数注释的「确证的事实排在推断之前」）：两条都成立时，
   * 该报的是「文件真被创建了」——它是文件系统事实，比「组合里缺一项」更硬。
   */
  const lines = claudeSeverity(
    healthy({ readonly_breach: true, readonly_flags: [] }),
    LIVE,
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0]!.message, /负对照失败/);
});
