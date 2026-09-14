/**
 * 本轮入选审核者的判定（`resolveCriticSelection`，设计 13.1.1 / FR-29，M7b 第 5 步）。
 *
 * 这是 M7b 里**第一处真正改变对外行为**的judgment：前四步都是契约与内部泛化，
 * 到这里用户才第一次能决定「跑哪几侧」。所以每一条拒绝规则都要有负例——
 * 一条规则没有负例，等于没有那条规则。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCriticSelection } from '../../src/trivium/critics.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { DEFAULT_DRIVER, ALL_AGENT_IDS, agentById } from '../../src/trivium/agents/registry.js';
import { CRITICS, type Config } from '../../src/trivium/types.js';

const cfg = (): Config => defaultConfig();

/** 断言抛的是 USAGE（退 64）而不是别的码——参数错误必须零工件退出 */
function rejects(fn: () => unknown, ...patterns: RegExp[]): void {
  assert.throws(fn, (e: { code?: number; message: string }) => {
    assert.equal(e.code, EXIT.USAGE, '参数错误一律退 64，不能是其它码');
    for (const p of patterns) assert.match(e.message, p);
    return true;
  });
}

// ─────────────────────────── 正常路径 ───────────────────────────

test('都不给 → 取 review.default_critics', () => {
  assert.deepEqual(resolveCriticSelection(cfg()), [...CRITICS]);
});

test('--critics 显式多选', () => {
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  assert.deepEqual(resolveCriticSelection(cfg(), { critics: `${a},${b}` }), [a, b]);
});

test('--critics 选一个：合法，且顺序按用户写的来', () => {
  const only = CRITICS[1]!;
  assert.deepEqual(resolveCriticSelection(cfg(), { critics: only }), [only]);
});

test('--critics 容忍空格与尾随逗号', () => {
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  assert.deepEqual(resolveCriticSelection(cfg(), { critics: ` ${a} , ${b} , ` }), [a, b]);
});

test('--only 是 --critics 的单元素旧写法', () => {
  const only = CRITICS[0]!;
  assert.deepEqual(resolveCriticSelection(cfg(), { only }), [only]);
});

test('配置改了 default_critics → 缺省跟着变', () => {
  const c = cfg();
  c.review.default_critics = [CRITICS[1]!];
  assert.deepEqual(resolveCriticSelection(c), [CRITICS[1]!]);
});

// ─────────────────────────── 拒绝规则 ───────────────────────────

/*
 * 两个旗标同时给**报错，不做优先级静默取舍**。
 * 任选其一执行都会让另一个意图无声消失——而「静默忽略用户显式写下的参数」
 * 正是这一族缺口最常见的形态（`--base` 漏传、`--only` 丢失都是它）。
 */
test('--critics 与 --only 同时给 → 退 64（不静默取其一）', () => {
  const [a, b] = [CRITICS[0]!, CRITICS[1]!];
  rejects(() => resolveCriticSelection(cfg(), { critics: a, only: b }), /不能同时给/);
});

test('即便两者取值相同也拒绝：语义重复本身就该被指出', () => {
  const a = CRITICS[0]!;
  rejects(() => resolveCriticSelection(cfg(), { critics: a, only: a }), /不能同时给/);
});

/*
 * 重复项报错而不是去重：`--critics x,x` 几乎必然是笔误（想写另一家却手滑）。
 * 静默去重会把它变成一次更少侧的审查，而用户以为自己要了两侧。
 */
test('重复项 → 退 64（静默去重会悄悄减少侧数）', () => {
  const a = CRITICS[0]!;
  rejects(() => resolveCriticSelection(cfg(), { critics: `${a},${a}` }), /出现了多次/);
});

test('未登记的 id → 退 64 并列出可用值', () => {
  rejects(
    () => resolveCriticSelection(cfg(), { critics: 'gemmini' }),
    /未登记/, new RegExp(CRITICS[0]!),
  );
});

/*
 * **当轮 Driver 不能当审核者**（设计 §12 异常矩阵首行）。
 *
 * M7b 下 claude 的 criticEnabled 为 false，「未启用」那条检查顺带也能挡住它；
 * 但 M9 启用 claude 为审核者后就挡不住了，那时自己审自己会悄悄通过——
 * 而那恰恰是这整套流水线要防的第一件事。所以这条要独立存在。
 */
test('含当轮 Driver → 退 64，理由点明「自己审自己不构成二次审查」', () => {
  rejects(
    () => resolveCriticSelection(cfg(), { critics: DEFAULT_DRIVER }),
    /Driver/, /二次审查/,
  );
});

test('Driver 检查不依赖 criticEnabled 顺带生效（M9 之后仍要挡住）', () => {
  /*
   * 模拟「Driver 同时也是已启用审核者」的未来形态：直接传一个 driver 参数，
   * 让它等于某个 criticEnabled 为真的 id。若实现把这条检查写成
   * 「criticEnabled 为假就拒」的副产物，这里会漏过去。
   */
  const asCritic = CRITICS[0]!;
  rejects(
    () => resolveCriticSelection(cfg(), { critics: asCritic, driver: asCritic }),
    /Driver/,
  );
});

test('已登记但未启用为审核者 → 退 64，说明随后续里程碑接入', () => {
  const pending = ALL_AGENT_IDS.find(
    (id) => !agentById(id)!.criticEnabled && id !== DEFAULT_DRIVER,
  );
  assert.ok(pending, '四家全部启用时本用例失去意义，届时改用别的夹具');
  rejects(() => resolveCriticSelection(cfg(), { critics: pending }), /尚未启用/);
});

test('在 agents 段里没有配置条目 → 退 64（取不到调用参数）', () => {
  const c = cfg();
  const victim = CRITICS[0]!;
  delete c.agents[victim];
  rejects(() => resolveCriticSelection(c, { critics: victim }), /没有条目/);
});

test('超过 max_critics → 退 64 并报出上限', () => {
  const c = cfg();
  c.review.max_critics = 1;
  rejects(
    () => resolveCriticSelection(c, { critics: CRITICS.join(',') }),
    /超过/, /max_critics=1/,
  );
});

test('解析后是空集合 → 退 64（一次审查至少要有一个审核者）', () => {
  rejects(() => resolveCriticSelection(cfg(), { critics: ' , , ' }), /至少要有一个/);
});

test('配置的 default_critics 为空 → 同样退 64，不静默回落到全集', () => {
  const c = cfg();
  c.review.default_critics = [];
  rejects(() => resolveCriticSelection(c), /至少要有一个/);
});

// ─────────────────── 错误信息的质量（不是措辞洁癖）───────────────────

/*
 * 这几条断言的是「用户看完知道下一步怎么做」。
 * 上一轮 GLM-04 的教训：报错列出「已登记有哪几家」却不说哪些现在还能配，
 * 用户照着改会撞上第二个错误——**第一个错误把用户引向第二个错误**。
 */
test('拒绝信息一律带上当前可用值，用户不必去翻文档', () => {
  const c = cfg();
  for (const bad of ['nobody', DEFAULT_DRIVER, `${CRITICS[0]!},${CRITICS[0]!}`]) {
    assert.throws(() => resolveCriticSelection(c, { critics: bad }), (e: { message: string }) => {
      assert.match(e.message, new RegExp(CRITICS[0]!), `「${bad}」的报错没列出可用值`);
      return true;
    });
  }
});

/*
 * 与 `run.v2` 的接缝：选 1 侧是**配置意图**，不是降级（AC-22）。
 *
 * 这条不属于本函数的职责，但它是本函数存在的**理由**——前四步把
 * `critics_selected` 与 `review_mode: full|partial` 的契约铺好，就是为了让
 * 这里选出的单元素集合落盘时记 `full` 而不是 `partial`。
 * 端到端实跑已确认（选 glm 一侧 → `critics_selected:["glm"]`、`review_mode:"full"`、
 * `degraded_reason:null`、只落一份文档），此处锁住判定这一端的前提：
 * **单元素集合是合法返回值，不该被当成异常**。
 */
test('单元素集合是合法结果——降级与否由 runner 按「入选的都成了吗」判，与基数无关', () => {
  for (const c of CRITICS) {
    assert.deepEqual(
      resolveCriticSelection(cfg(), { critics: c }), [c],
      '把「只选一侧」当异常挡在这里，AC-22 就永远跑不起来',
    );
  }
});

/*
 * 「你不能选 Driver」的报错里，**不该把 Driver 自己列进可用值**
 * （审查意见 AGY-02）。当前 claude 未进 `CRITICS`，这层过滤不改变现有输出；
 * 但 M9 / M10 后 Driver 可能同时具备审核者能力，那时不过滤就会复现
 * 上一轮 GLM-04「第一个错误把用户引向第二个错误」的形态。
 */
test('Driver 拒绝信息里不得把 Driver 自己列为「当前可用」', () => {
  const asDriver = CRITICS[0]!;
  assert.throws(
    () => resolveCriticSelection(cfg(), { critics: asDriver, driver: asDriver }),
    (e: { message: string }) => {
      assert.match(e.message, /Driver/);
      const tail = e.message.slice(e.message.indexOf('当前可用'));
      assert.doesNotMatch(
        tail, new RegExp(asDriver),
        `可用值清单里仍有 ${asDriver}，而它正是被拒的那个：${tail}`,
      );
      return true;
    },
  );
});

test('报错点名是哪个旗标出的问题（--critics 与 --only 要区分得开）', () => {
  rejects(() => resolveCriticSelection(cfg(), { critics: 'nobody' }), /--critics/);
  rejects(() => resolveCriticSelection(cfg(), { only: 'nobody' }), /--only/);
  const c = cfg();
  c.review.default_critics = ['nobody' as never];
  rejects(() => resolveCriticSelection(c), /review\.default_critics/);
});
