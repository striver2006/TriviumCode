/**
 * 本轮入选审核者的判定（`resolveCriticSelection`，设计 13.1.1 / FR-29，M7b 第 5 步）。
 *
 * 这是 M7b 里**第一处真正改变对外行为**的judgment：前四步都是契约与内部泛化，
 * 到这里用户才第一次能决定「跑哪几侧」。所以每一条拒绝规则都要有负例——
 * 一条规则没有负例，等于没有那条规则。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCriticSelection, resolveDriver, selectableCritics } from '../../src/trivium/critics.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { AGENTS, ALL_AGENT_IDS, DEFAULT_DRIVER, DRIVER_AGENT_IDS } from '../../src/trivium/agents/registry.js';
import { CRITICS, type Config, DEFAULT_CRITICS } from '../../src/trivium/types.js';
import { SELECTABLE, assertSelectableUsable } from '../helpers/critic-fixtures.js';

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
  /*
   * 比的是**缺省集合**而不是启用全集（M8 第 3 步）。
   * 此前二者是同一个，codex 启用后分了家：能选三家、默认跑两家（决策 D-1）。
   * 用例名一直写的就是「取 review.default_critics」——断言现在才与它一致。
   */
  assert.deepEqual(resolveCriticSelection(cfg()), [...DEFAULT_CRITICS]);
});

test('--critics 显式多选', () => {
  assertSelectableUsable(2);
  const [a, b] = [SELECTABLE[0]!, SELECTABLE[1]!];
  assert.deepEqual(resolveCriticSelection(cfg(), { critics: `${a},${b}` }), [a, b]);
});

test('--critics 选一个：合法，且顺序按用户写的来', () => {
  assertSelectableUsable();
  const only = SELECTABLE[1] ?? SELECTABLE[0]!;
  assert.deepEqual(resolveCriticSelection(cfg(), { critics: only }), [only]);
});

test('--critics 容忍空格与尾随逗号', () => {
  assertSelectableUsable(2);
  const [a, b] = [SELECTABLE[0]!, SELECTABLE[1]!];
  assert.deepEqual(resolveCriticSelection(cfg(), { critics: ` ${a} , ${b} , ` }), [a, b]);
});

test('--only 是 --critics 的单元素旧写法', () => {
  assertSelectableUsable();
  const only = SELECTABLE[0]!;
  assert.deepEqual(resolveCriticSelection(cfg(), { only }), [only]);
});

test('配置改了 default_critics → 缺省跟着变', () => {
  const c = cfg();
  const pick = SELECTABLE[1] ?? SELECTABLE[0]!;
  c.review.default_critics = [pick];
  assert.deepEqual(resolveCriticSelection(c), [pick]);
});

// ─────────────────────────── 拒绝规则 ───────────────────────────

/*
 * 两个旗标同时给**报错，不做优先级静默取舍**。
 * 任选其一执行都会让另一个意图无声消失——而「静默忽略用户显式写下的参数」
 * 正是这一族缺口最常见的形态（`--base` 漏传、`--only` 丢失都是它）。
 */
test('--critics 与 --only 同时给 → 退 64（不静默取其一）', () => {
  assertSelectableUsable(2);
  const [a, b] = [SELECTABLE[0]!, SELECTABLE[1]!];
  rejects(() => resolveCriticSelection(cfg(), { critics: a, only: b }), /不能同时给/);
});

test('即便两者取值相同也拒绝：语义重复本身就该被指出', () => {
  assertSelectableUsable();
  const a = SELECTABLE[0]!;
  rejects(() => resolveCriticSelection(cfg(), { critics: a, only: a }), /不能同时给/);
});

/*
 * 重复项报错而不是去重：`--critics x,x` 几乎必然是笔误（想写另一家却手滑）。
 * 静默去重会把它变成一次更少侧的审查，而用户以为自己要了两侧。
 */
test('重复项 → 退 64（静默去重会悄悄减少侧数）', () => {
  assertSelectableUsable();
  const a = SELECTABLE[0]!;
  rejects(() => resolveCriticSelection(cfg(), { critics: `${a},${a}` }), /出现了多次/);
});

test('未登记的 id → 退 64 并列出可用值', () => {
  rejects(
    () => resolveCriticSelection(cfg(), { critics: 'gemmini' }),
    /未登记/, new RegExp(SELECTABLE[0]!),
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
  /*
   * **改用注入表，不再从真实注册表现取**（M9 第 4 步，计划双审 AGY-02 ≡ GLM-01 ≡ CODEX-02）。
   *
   * 上一版靠 `ALL_AGENT_IDS.find(id => !criticEnabled)` 取夹具，并在 assert 消息里
   * 预告「四家全部启用时本用例失去意义」。M9 把第四家启用之后那天就到了——
   * 而预告写在**消息**里，不是写在**断言**里，所以它是静默失效的：
   * 覆盖存不存在，取决于生产数据碰巧长什么样。
   *
   * 现在把登记表参数化（`deriveDefaultCritics` 的同款先例），这条分支有了
   * 不依赖注册表状态的真覆盖。**紧接其后的那条用例**是配套的自适应断言：
   * 将来真引入未启用的第五家时它会红，提醒这里可以回到真实注册表。
   */
  assertSelectableUsable();
  const notEnabled = SELECTABLE[0]!;
  /*
   * 注入表里**只有 `notEnabled` 那一家未启用**，其余（含 Driver）全部启用。
   * 这样目标 id 既不是当轮 Driver（否则被 Driver 检查先拦、走不到这条分支），
   * 也确实处在「已登记、未启用」这一格。
   */
  const registry = AGENTS.map((a) => ({ ...a, criticEnabled: a.id !== notEnabled }));
  rejects(
    () => resolveCriticSelection(cfg(), {
      critics: notEnabled,
      driver: DEFAULT_DRIVER,
      descriptors: registry,
    }),
    /尚未启用/,
  );

  /*
   * **「当前可用」清单必须来自注入表**（代码双审 AGY-02 ≡ CODEX-02）。
   *
   * 上一版这条用例只断言 `/尚未启用/`，不看报错尾部那段清单——于是
   * `legalList` 的注入表线程化（计划双审 GLM-05 的裁决）**没有任何锁例**：
   * 把三处调用点改回 `legalList(cfg, driver)`、丢掉 descriptors，全部用例照样绿。
   * 一条改动没有能证伪它的断言，等于没有改。
   *
   * 两种派生**确实不同**，所以这条断言区分得开（实算核过）：
   *   · 注入表派生：`gemini | glm`（notEnabled 被关掉）
   *   · 真实注册表派生：`codex | gemini | glm`
   * 都不含 `claude`——那是 `c !== driver` 排掉的，与注入表无关。
   *
   * （codex 侧原以为两份清单逐字相同、需要「在注入表里再关掉一家」才能制造差异；
   * 实算否证了那个前提：`legalList` 只排除 driver，**不排除正在报错的那个 id**。
   * 所以这条更省的断言就够用。）
   */
  assert.throws(
    () => resolveCriticSelection(cfg(), {
      critics: notEnabled,
      driver: DEFAULT_DRIVER,
      descriptors: registry,
    }),
    (e: { message: string }) => {
      const tail = e.message.slice(e.message.indexOf('当前可用'));
      assert.doesNotMatch(
        tail, new RegExp(notEnabled),
        `「当前可用」列出了注入表里已关掉的 ${notEnabled}——说明 legalList 读的是真实注册表而不是注入表：${tail}`,
      );
      return true;
    },
  );
});

/*
 * **自适应断言：真实注册表当前是不是全部启用**（M9 第 4 步）。
 *
 * 上一条用注入表拿回了覆盖，但「真实注册表里还有没有未启用的家」这个事实
 * 本身也值得被断言看着——它决定上一条的注入表是不是仍然必要。
 *
 * **写成断言而不是注释**：注释里的「当前四家全部启用」会随注册表变化而失真，
 * 且没有任何机制提醒。断言会在引入第五家（未启用）时红，提示回去看上一条。
 */
test('真实注册表明确记录未启用审核者——上一条保留注入表负向覆盖', () => {
  const notEnabled = AGENTS.filter((a) => !a.criticEnabled).map((a) => a.id);
  assert.deepEqual(notEnabled, ['kimi', 'qoder-cn']);
});

test('在 agents 段里没有配置条目 → 退 64（取不到调用参数）', () => {
  const c = cfg();
  const victim = SELECTABLE[0]!;
  delete c.agents[victim];
  rejects(() => resolveCriticSelection(c, { critics: victim }), /没有条目/);
});

test('超过 max_critics → 退 64 并报出上限', () => {
  const c = cfg();
  c.review.max_critics = 1;
  rejects(
    () => resolveCriticSelection(c, { critics: SELECTABLE.join(',') }),
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

/*
 * ── 缺省集合减去当轮 Driver（M10b 第 2 步，用户 2026-09-25 拍板）──
 *
 * 此前「缺省集合含当轮 Driver」一律退 64，命令 A 当时不收 `--critics`（EV-125 起才收），非缺省 Driver 走命令 A 无出口。
 * 只减**缺省**：显式写出的 `--critics` / `--only` 含 Driver 仍退 64（上面那组用例照旧）。
 */
test('缺省集合含当轮 Driver：减去它，不退 64；顺序按缺省集合', () => {
  const c = cfg();
  const driver = c.review.default_critics[0]!;
  assert.deepEqual(resolveCriticSelection(c, { driver }), c.review.default_critics.filter((x) => x !== driver));
});

test('显式 --critics / --only 含当轮 Driver：仍退 64（只减缺省，不减用户亲手写的）', () => {
  assertSelectableUsable();
  const driver = SELECTABLE[0]!;
  rejects(() => resolveCriticSelection(cfg(), { critics: driver, driver }), /二次审查/);
  rejects(() => resolveCriticSelection(cfg(), { only: driver, driver }), /二次审查/);
});

test('缺省集合只有当轮 Driver 一家：减完为空 → 退 64，不静默回落', () => {
  const c = cfg();
  const driver = c.review.default_critics[0]!;
  c.review.default_critics = [driver];
  rejects(() => resolveCriticSelection(c, { driver }), /至少要有一个/);
});

// ─────────────────── 错误信息的质量（不是措辞洁癖）───────────────────

/*
 * 这几条断言的是「用户看完知道下一步怎么做」。
 * 上一轮 GLM-04 的教训：报错列出「已登记有哪几家」却不说哪些现在还能配，
 * 用户照着改会撞上第二个错误——**第一个错误把用户引向第二个错误**。
 */
test('拒绝信息一律带上当前可用值，用户不必去翻文档', () => {
  const c = cfg();
  for (const bad of ['nobody', DEFAULT_DRIVER, `${SELECTABLE[0]!},${SELECTABLE[0]!}`]) {
    assert.throws(() => resolveCriticSelection(c, { critics: bad }), (e: { message: string }) => {
      assert.match(e.message, new RegExp(SELECTABLE[0]!), `「${bad}」的报错没列出可用值`);
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
  assertSelectableUsable();
  for (const c of SELECTABLE) {
    assert.deepEqual(
      resolveCriticSelection(cfg(), { critics: c }), [c],
      '把「只选一侧」当异常挡在这里，AC-22 就永远跑不起来',
    );
  }
});

/*
 * **缺省 Driver 那一家的单选合法性**（M9 第 4 步，计划双审 AGY-03）。
 *
 * 上一条改用 `SELECTABLE` 之后，缺省 Driver 那一家就再也不会走到「单选成功」这条路径——
 * 它每次都在 Driver 检查处被拒。**而那恰恰是第 5 步落 `--driver` 之后要走的路径**：
 * 把 Driver 换成别人，claude 就该像任何一家一样能被单独选中。
 *
 * 今天它已经能通过（`resolveCriticSelection` 的 driver 是参数化的，
 * 只是**没有调用方传值**——见计划 §2.3）。所以这条用例今天就该在：
 * 第 5 步接上 `--driver` 时，它能回答「新做对了，还是本来就对」。
 * 缺了它，那一步只有负例（V6）没有正例，等于只验证了「拦得住」，
 * 没验证「换掉 Driver 之后拦对了人」。
 */
test('把 Driver 换成别人之后，原 Driver 那一家可以被单独选中（第 5 步 --driver 的正例）', () => {
  assertSelectableUsable();
  const otherDriver = SELECTABLE[0]!;
  assert.deepEqual(
    resolveCriticSelection(cfg(), { critics: DEFAULT_DRIVER, driver: otherDriver }),
    [DEFAULT_DRIVER],
    `${DEFAULT_DRIVER} 不当 Driver 时就是普通审核者，不该还被 Driver 检查拦下`,
  );
});

/*
 * 「你不能选 Driver」的报错里，**不该把 Driver 自己列进可用值**
 * （审查意见 AGY-02）。当前 claude 未进 `CRITICS`，这层过滤不改变现有输出；
 * 但 M9 / M10 后 Driver 可能同时具备审核者能力，那时不过滤就会复现
 * 上一轮 GLM-04「第一个错误把用户引向第二个错误」的形态。
 */
test('Driver 拒绝信息里不得把 Driver 自己列为「当前可用」', () => {
  const asDriver = SELECTABLE[0]!;
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

// ───────────── resolveDriver：`--driver` 的唯一判定处（M9 第 5 步）─────────────

test('resolveDriver：不给就是缺省 Driver，且 enabledAsDriver 是查表得来不是写死 true', () => {
  for (const raw of [null, undefined, '', '   ']) {
    const r = resolveDriver(raw);
    assert.equal(r.driver, DEFAULT_DRIVER, `取值 ${JSON.stringify(raw)} 应回落缺省 Driver`);
    assert.equal(r.enabledAsDriver, true);
  }
});

test('resolveDriver：未登记的取值退 64，并列出**可用作 Driver** 的那几家（M10a 第 3 步起两个分支同口径）', () => {
  assert.throws(
    () => resolveDriver('nobody'),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, '参数错误一律退 64');
      /*
       * M9 时这里列「全部已登记」，因为那时判据就是「已登记」。M10a 第 3 步起判据是
       * 「已登记且已启用为 Driver」，报错列出的可用值必须与实际接受的取值一致，
       * 否则第一个错误把用户引向第二个错误（计划双审 r2 GLM-02）。今天四家全启用，两口径同集。
       */
      assert.match(e.message, /可用作 Driver/);
      for (const a of AGENTS.filter((x) => x.driverEnabled)) {
        assert.match(e.message, new RegExp(a.id), `报错里要列出 ${a.id}：它是合法取值`);
      }
      return true;
    },
  );
});

/**
 * 造一个「只关掉某一家 Driver 能力」的注入表（M10a 第 3 步的桩 overlay）。
 *
 * 四家翻开之后 `driverEnabled: false` 对真实注册表不可达——它守的是**第五家登记而未启用**
 * 的那一格。覆盖不能取决于生产数据碰巧长什么样（本文件 :133 那条的同款教训），所以靠注入表。
 */
function withDriverDisabled(id: string) {
  return AGENTS.map((a) => (a.id === id ? { ...a, driverEnabled: false } : a));
}

test('resolveDriver：已登记但未启用为 Driver（桩）→ 退 64，清单来自注入表且不含该桩', () => {
  const stub = ALL_AGENT_IDS.find((id) => id !== DEFAULT_DRIVER)!;
  const registry = withDriverDisabled(stub);
  assert.throws(
    () => resolveDriver(stub, registry),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, 'M10a 第 3 步起未启用为 Driver 退 64，不再「放行 + 标注」');
      assert.match(e.message, /尚未启用为 Driver/);
      const tail = e.message.slice(e.message.indexOf('可用作 Driver'));
      assert.doesNotMatch(tail, new RegExp(`\\b${stub}\\b`), `清单里不该有未启用的 ${stub}：${tail}`);
      return true;
    },
  );
  // 未登记分支同口径：未启用的那一家同样不出现在它的清单里（计划双审 r2 GLM-02）
  assert.throws(
    () => resolveDriver('nobody', registry),
    (e: { message: string }) => {
      const tail = e.message.slice(e.message.indexOf('可用作 Driver'));
      assert.doesNotMatch(tail, new RegExp(`\\b${stub}\\b`), `未登记分支的清单也不该列未启用的 ${stub}：${tail}`);
      return true;
    },
  );
});

test('resolveDriver：清单按 Driver 口径派生，不借审核者口径（criticEnabled 为假的 Driver 也要列出）', () => {
  /*
   * 计划双审 r1 CODEX-03：`legalList` 是审核者口径（criticEnabled ∩ 有配置段 − 当轮 Driver）。
   * 今天四家两口径同集，看不出差别；第五家「只当 Driver 不当审核者」时就会漏列一个合法取值。
   */
  const driverOnly = ALL_AGENT_IDS.find((id) => id !== DEFAULT_DRIVER)!;
  const disabled = ALL_AGENT_IDS.find((id) => id !== DEFAULT_DRIVER && id !== driverOnly)!;
  const registry = withDriverDisabled(disabled).map((a) =>
    a.id === driverOnly ? { ...a, criticEnabled: false } : a,
  );
  assert.throws(
    () => resolveDriver(disabled, registry),
    (e: { message: string }) => {
      const tail = e.message.slice(e.message.indexOf('可用作 Driver'));
      assert.match(tail, new RegExp(`\\b${driverOnly}\\b`), `只当 Driver 的 ${driverOnly} 是合法取值，清单漏了它：${tail}`);
      return true;
    },
  );
});

test('resolveDriver：缺省分支走同一个判定——缺省 Driver 在注入表里被关掉时，不传旗标同样退 64', () => {
  const registry = withDriverDisabled(DEFAULT_DRIVER);
  for (const raw of [null, undefined, '', '   ']) {
    assert.throws(
      () => resolveDriver(raw, registry),
      (e: { code?: number; message: string }) => {
        assert.equal(e.code, EXIT.USAGE, `取值 ${JSON.stringify(raw)}：缺省分支不能写死 true 放行`);
        assert.match(e.message, /未传 --driver/, '要说清楚这是缺省 Driver，不是用户传错了');
        return true;
      },
    );
  }
});

test('resolveDriver：真实注册表中的已启用 Driver 可用（未启用候选仍拒绝）', () => {
  /*
   * M9 时「非缺省且已启用」这一臂只能靠注入表构造。四家翻开之后真实注册表即可覆盖；
   * 注入表那一格留作对照：判定要跟着注入表走，而不是偷看模块级注册表。
   */
  for (const id of DRIVER_AGENT_IDS) {
    const r = resolveDriver(id);
    assert.equal(r.driver, id);
    assert.equal(r.enabledAsDriver, true, `${id} 已启用为 Driver`);
  }
  const other = ALL_AGENT_IDS.find((id) => id !== DEFAULT_DRIVER)!;
  assert.throws(() => resolveDriver(other, withDriverDisabled(other)), /尚未启用为 Driver/,
    '同一个 id，注入表里关掉就必须退 64——判定跟着注入表走');
});

/*
 * **自适应断言：真实注册表是否四家全启用为 Driver**（同 :206 的先例）。
 * 第五家登记而未启用时这条红——提醒上面几条桩用例可以回到真实注册表取夹具。
 * 写成断言而不是注释：注释会随注册表变化而失真，且没有任何机制提醒。
 */
test('真实注册表明确区分 Driver 开关与登记全集', () => {
  assert.deepEqual([...DRIVER_AGENT_IDS], ['claude', 'codex', 'gemini', 'glm']);
  assert.deepEqual(
    ALL_AGENT_IDS.filter((id) => !DRIVER_AGENT_IDS.includes(id)),
    ['kimi', 'qoder-cn'],
  );
});

/*
 * **J5 穷举**（M10 计划 r7 §4.6）：四家逐一作为 Driver 时，自己都不在可入选集合里，
 * 显式选自己退 64。论域取「全部已登记」而不是「已启用为 Driver」，第五家登记时自动进穷举。
 */
test('J5：每一家作为 Driver 时，selectableCritics 都不含自己，且 --critics 自己 退 64', () => {
  for (const id of ALL_AGENT_IDS) {
    assert.ok(
      !(selectableCritics(cfg(), id) as readonly string[]).includes(id),
      `${id} 作为 Driver 时仍在自己的可入选集合里——自己审自己不构成二次审查`,
    );
    rejects(() => resolveCriticSelection(cfg(), { critics: id, driver: id }), /Driver/);
  }
});

test('selectableCritics：论域是「启用 ∩ 有配置条目 − 当轮 Driver」，且跟着注入表走', () => {
  /*
   * EV-53 的源头。此前这份论域有两套实现（critics.ts 减 Driver、topic-args.ts 不减），
   * driver 接进选侧之后，同一条命令里两段「当前可用」会互相矛盾。
   */
  assertSelectableUsable();
  const other = SELECTABLE[0]!;
  assert.deepEqual(
    selectableCritics(cfg(), DEFAULT_DRIVER), [...SELECTABLE],
    '缺省 Driver 下应当正好是 SELECTABLE',
  );
  assert.ok(
    selectableCritics(cfg(), other).includes(DEFAULT_DRIVER),
    `把 Driver 换成 ${other} 之后，${DEFAULT_DRIVER} 就是个普通审核者`,
  );
  assert.ok(
    !selectableCritics(cfg(), other).includes(other),
    '当轮 Driver 永远不在自己的可入选集合里',
  );
});
