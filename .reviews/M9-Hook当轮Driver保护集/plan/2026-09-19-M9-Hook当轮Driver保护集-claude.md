# 计划：Hook 当轮 Driver 保护集（EV-68）

- **主题**：`M9-Hook当轮Driver保护集`
- **起点**：`6177d26`（M9 第 6 步前置 EV-66 已合入），`main` 干净，无未关闭闸门
- **触发**：BACKLOG **EV-68**，触发时点逐字写着「M9 第 6 步验收，不是 M10」
- **产出**：本文件，随后由用户发起 `/dual-review-plan`

---

## 一、目标与范围

### 目标

让 Hook 的**当轮**保护集真的按当轮 Driver 计算，而不是在模块加载期烙死成缺省 Driver 的补集。

这是 M9 第 6 步验收的**第二条硬前置**（第一条 EV-66 已由 `6177d26` 解除）。
验收剧本是「非缺省 Driver + `--critics claude`」，它要求两件事同时成立：

1. 非缺省 Driver 能写出自己的裁决件（`-response-codex.md`）；
2. 同轮里 claude 作为**审核者**，它的 `-claude.md` 不得由 Driver 手写。

今天这两条**都不成立**，而且是同一个缺口的两个方向。

### 做

- `hasCriticRoleSuffix` 收 `driver` 参数，不再在函数内部调 `criticRoleSuffixes()` 的默认值；
- `isForgedRoleFile` 同步收 `driver`，由 `hookPreWrite` 从 run 元数据取值后传入；
- `ROLE_SUFFIX_ANYWHERE` 由模块级 `const` 改惰性求值（否则正则在构造时就固化了）；
- 把「当轮面」与「跨时间面」在**函数签名层面**分开，不再共用一个无参函数；
- 改掉 `hooks.ts:113-121` 与 BACKLOG EV-55 里「M10」的过期时点记载。

### 不做（逐条附理由）

| 不做 | 理由 |
| :--- | :--- |
| 提交锚 `immutableChangeReason` 的判据重构 | 那是 EV-55 的**跨时间**面，修法是「按 run 元数据的 artifacts 登记判不可变」，与本步不同源。本步只保证它的行为**不变**。 |
| Bash 侧 `bashTargetsProtected` 的当轮化 | 同属 EV-55 跨时间面，且 Bash 侧拿不到 run 上下文，EV-55 给提交锚的修法覆盖不到它，需要单独决定。 |
| 主题级 driver 落盘（`task.json` 顶层） | 见 §五「已知边界」——这是原稿时序那一格的解法，范围是 schema 变更，不混进本步。 |
| `GateCheckInput.driver` 改必填（EV-69） | 触发条件是「出现第三个调用点」，本步不新增调用点。 |
| `Disposition` / `DispositionFrontMatter` 合并（EV-70） | 触发条件是「下一次动裁决件解析」，本步不动解析面。 |

---

## 二、现状与约束

### 缺口本体

`criticRoleSuffixes(driver = DEFAULT_DRIVER)` 的语义是「全部已登记角色减当轮 Driver」，
[hooks.ts:123](src/trivium/hooks.ts#L123) 写得是对的。错在两处消费点**都不把 driver 传进去**：

- [hooks.ts:155](src/trivium/hooks.ts#L155) `hasCriticRoleSuffix(fileName)` 根本不收 `driver` 参数，
  函数体里直接 `criticRoleSuffixes()` 吃默认值；
- [hooks.ts:545](src/trivium/hooks.ts#L545) `ROLE_SUFFIX_ANYWHERE` 是模块级 `const`，
  正则在**模块加载期**就固化了，运行期换谁当 Driver 都不会变。

于是保护集恒为 `{codex, gemini, glm}`，与当轮是谁无关。

### 后果是双向的

| 方向 | 场景 | 今天的行为 | 应有的行为 |
| :--- | :--- | :--- | :--- |
| ① | 当轮 Driver = codex，它写 `.reviews/<主题>/code/…-response-codex.md` | `isForgedRoleFile` 判**伪造件**，退 2——**它交不了卷** | 放行：那是 Driver 自己的产出 |
| ② | 当轮 Driver = codex，claude 是审核者，Driver 手写 `…-claude.md` | **放行**——「Driver 不得伪造审核者产出」对 claude 失守 | 拦截 |

方向②是 M9 第 4 步翻开 `criticEnabled` 时新产生的：在那之前 claude 不是审核者，
`-claude.md` 不该被保护是对的；翻开关之后，它在「别人当 Driver」的轮次里就是审查件。

### 一个有利的既有条件：driver 的权威来源已经在了

M9 第 5 步已经把 `driver` 落进三处留痕面，其中两处本步可直接读：

- `GateEntry.driver`（[state.ts:147](src/trivium/state.ts#L147)），注释明写「**本步只记不读**」——
  那个读取面就是给这一步留的；
- `task.json.runs[].driver` 与 `_meta/run-<runId>.json` 的 `driver`（run.v2 里**必填**）。

而且 `cmdGate` 已经示范了怎么取：[cli.ts:855](src/trivium/cli.ts#L855) 的
`const gateDriver = latest?.driver ?? DEFAULT_DRIVER;`，来源是 `latestRunMeta`。
[cli.ts:788-794](src/trivium/cli.ts#L788-L794) 的注释解释了为什么事实来源是**留痕**而不是旗标。

**本步复用同一模式，不新发明数据通路。** `hooks.ts` 已经 import 了 `readState`
（[hooks.ts:34](src/trivium/hooks.ts#L34)），`hookPreWrite` 本身是 `async`，取值不需要改调用链形态。

### 约束：`GateEntry.driver` 缺失不等于缺省 Driver

[state.ts:147](src/trivium/state.ts#L147) 的注释把这句话写死了：
「早于该步立起的闸门项没有这个字段，**缺失即『无从得知』，不等于缺省 Driver**」。
本步的回落取向必须与这句话一致，不能反过来把「无从得知」实现成「就是 claude」。
——但也不能一律 fail-closed，见 §三 3.2 与 §五。

---

## 三、方案（每步可单独验证）

### 3.1 当轮面与跨时间面在签名上分家 — [hooks.ts:155](src/trivium/hooks.ts#L155)

现状是一个无参函数被两种语义的消费者共用，这正是缺口能长期潜伏的原因：
调用点看不出自己吃的是哪种语义。拆成两个具名函数：

```
// 当轮面：必须显式传 driver，没有默认值 —— 漏传变成编译期错误
hasProtectedRoleSuffix(fileName: string, driver: AgentId): boolean

// 跨时间面：保留现状行为（全集减缺省 Driver），名字里写明它是跨时间的
hasRoleSuffixCrossTime(fileName: string): boolean   // 挂 EV-55
```

**不给当轮面留默认参数**，理由与 EV-69 登记的教训同源：
`gate.ts` 那段 `voidedSides` 注释的原话是「可选参数的默认值让漏传静默成功」。
这一步要让「新调用点忘了传 driver」在 `tsc` 阶段就红，而不是在某次非缺省 Driver 的验收里才显形。

消费点改判如下：

| 消费点 | 语义 | 改后调用 |
| :--- | :--- | :--- |
| `isForgedRoleFile`（[hooks.ts:254](src/trivium/hooks.ts#L254)） | 当轮 | `hasProtectedRoleSuffix(target, driver)` |
| `immutableChangeReason`（[hooks.ts:305](src/trivium/hooks.ts#L305)） | 跨时间 | `hasRoleSuffixCrossTime(base)` —— **行为一字不变** |
| `ROLE_SUFFIX_ANYWHERE` → `bashTargetsProtected` | 跨时间 | 改惰性求值，取值仍是跨时间集 —— **行为一字不变** |

`ROLE_SUFFIX_ANYWHERE` 这一处要特别说明：本步**不**把它当轮化（那是 EV-55），
但仍要把它从模块级 `const` 改成惰性求值。理由是它今天的固化是**隐式**的副作用，
改惰性之后取值口径由函数名显式说明，EV-55 真做的时候不必再拆一次模块加载期的耦合。

### 3.2 driver 取值：`hookPreWrite` 内解析，三级来源

`isForgedRoleFile` 只在归档内为真，归档内路径必然是
`<archiveRoot>/<主题>/<阶段>/<文件名>`——正好够拼出 `gateKey(topic, stage)`。取值顺序：

1. 由目标路径解析出 `<主题>/<阶段>` → 查 `state.json` 的 `GateEntry.driver`；
2. 取不到，回落该主题 run 元数据里最近一条的 `driver`（与 `cmdGate` 同源）；
3. 两处都取不到 → **回落 `DEFAULT_DRIVER`**，并在拦截文案里注明「按缺省 Driver 判定」。

第 3 级的取向需要双审裁定，见 §八。先说清楚为什么**不**选 fail-closed（缺失即按全集保护）：
那会把缺省 Driver 的正常流程一起锁死——plan 阶段的原稿是 Driver 在 `review --start`
**之前**写的（skill 第 3 步的 `--plan-file` 指向的是一份已存在的稿），那一刻
gate 与 run 元数据都还没有。fail-closed 会让今天走得通的 `/dual-review-plan` 当场退 2。

`readState` 抛 `StateCorruptError` 时按 `hooks.ts` 开头那张退出码表处理（state 坏了退 2），
不吞异常——这与 `isInsideArchiveResolved` 的「不抛异常、回退纯词法」取向不同，
因为那里的回退方向是收紧，这里的回退方向是放宽。

### 3.3 提示文案同源 — [hooks.ts:651](src/trivium/hooks.ts#L651)

`bashTargetsProtected` 的提示里 `criticRoleSuffixes().map(…)` 列的是跨时间集，
与该处判据同源，**保持不变**。`hookPreWrite` 的拦截文案要补一句当轮 Driver 是谁，
否则非缺省 Driver 撞上方向①时，报错文案会指向一条不存在的原因。

### 3.4 用例：既有断言要分两类改

`test/unit/hooks.test.ts` 里对 `hasCriticRoleSuffix` / `isForgedRoleFile` 的断言有 20 余处
（第 53-67、95-112、155-170、516-580 行几段）。它们今天都跑在缺省 Driver 语境下。
改签名后**不能**无脑补一个 `DEFAULT_DRIVER` 了事：

- 属**当轮面**的断言：显式传 driver，并**成对**补一条非缺省 Driver 的翻转格
  （同一文件名，driver 换成 codex 后结论必须翻转）。只补默认值等于把新能力测了个寂寞。
- 属**跨时间面**的断言：改调 `hasRoleSuffixCrossTime`，断言**一字不改**——
  它们是本步「行为不变」承诺的机器判据。

第 126 行那条「换当轮 Driver：保护集与差集一起翻转（`criticRoleSuffixes` 的参数契约）」
今天测的是 `criticRoleSuffixes` 本身，它**已经**是对的；本步要把同形断言推到
`hasProtectedRoleSuffix` 与 `isForgedRoleFile` 这两层——缺口正是在那两层，不在源头。

第 85 行注释已经点破过一次「差集那条断言是**重言式**」（`diff` 与 `criticRoleSuffixes()`
同源于 `ALL_AGENT_IDS`）。新补的断言不要再造一条重言式：**文件名字面要写死**
（`…-codex.md` / `…-claude.md`），不要从 `criticRoleSuffixes(driver)` 反推。

### 3.5 新增用例：两个方向各一条端到端

| 用例 | 构造 | 期望 |
| :--- | :--- | :--- |
| 方向① | gate 记 `driver: codex`，`hookPreWrite` 写归档内 `…-response-codex.md` | 退 0（Driver 交得了卷） |
| 方向② | 同上 gate，写归档内 `…-claude.md` | 退 2（claude 此轮是审核者） |
| 回落 | gate 无 driver 字段、无 run 元数据，写 `…-claude.md` | 退 0（缺省 Driver 语义，今日行为不变） |
| 跨时间不变 | 提交锚与 Bash 侧各一条既有断言 | 与改动前逐字相同 |

---

## 四、不可逆决策

**把当轮面的 `driver` 设为必填、无默认值。** 之后任何新增调用点都必须显式表态
自己吃的是哪种语义。代价是改签名会波及 20 余条既有用例（见 3.4），
收益是这一族缺口（「默认参数让漏传静默成功」）在类型层面再也复发不了。
EV-69 记的是同一族问题的另一处现场，本步不顺手改它，但取向要一致。

---

## 五、已知边界（如实登记，不假装解决）

**原稿时序那一格本步修不掉。** plan / bug 阶段的原稿由 Driver 在 `review --start`
之前写出，那一刻 gate 与 run 元数据都不存在，§3.2 的三级取值必然落到第 3 级、
按缺省 Driver 判定。于是**非缺省 Driver 仍写不出自己的 `-codex.md` 原稿**。

- 对 **M9 第 6 步验收不构成阻碍**：验收剧本走的是 **code 阶段**，
  以 diff 为被审对象，原计划 §7.2 第 2 点明写「不需要原稿」；
  该阶段 Driver 唯一要写的是裁决件，而那在 run 之后，取值落第 1 或第 2 级。
- 对 **M10 构成阻碍**：真换 Driver 后 plan 阶段第一步就撞。
  解法是主题级 driver 落盘（`topic resolve --driver` 时写进 `task.json` 顶层），
  那是 schema 变更，**本步不做**，实施后登记为新 EV 并写进 M10 前置。

这条边界要同时落进 BACKLOG 新条目与主设计 §16.1 的 M10 行，否则 M10 接手的会话读不到。

---

## 六、影响面（实核，非推测）

- `src/trivium/hooks.ts`：`criticRoleSuffixes` 的两处派生 + 三处语义，加提示文案一处；
- `test/unit/hooks.test.ts`：20 余条断言分两类改 + 4 条新增；
- `skills/dual-critic/hooks/hooks.json`：**不改**——四条拦截命令仍不带 driver 参数，
  driver 由 Hook 进程自己从留痕解析（EV-68 条目把 `hooks.json` 列进了落点，
  实核**不需要动它**，这一处要随本步改准）；
- `src/trivium/init.ts` 的 `writeWrapper`：**不改**，同上；
- `src/trivium/state.ts`：**不改**，只是把「只记不读」的注释改成「读取方见 hooks.ts」。

EV-68 条目登记的落点里有两处（`hooks.json`、`init.ts`）实核不需要改动，
本步要把条目文字一并改准，理由与 EV-39 那次「改 BACKLOG 条目文字」同源。

---

## 七、验收标准

1. `npm run check` 全绿，跳过数不增加（基线 1459 tests / 1457 pass / 0 fail / 2 skip）；
2. 方向①②两条新用例在**改动前**跑必红、改动后必绿（变异验证，逐条实跑）；
3. 跨时间面的既有断言一字未改且全绿；
4. `tsc` 上：删掉任一调用点的 `driver` 实参会编译失败（必填契约的机器判据）。

---

## 八、请双审裁定

1. **§3.2 第 3 级回落取 `DEFAULT_DRIVER` 是否可接受。** 它与 `GateEntry.driver`
   注释「缺失不等于缺省 Driver」字面相抵。我的理由是 fail-closed 会锁死今天走得通的
   plan 流程（§3.2 末段），但这是拿正确性换可用性，请裁定，或给第三条路。
2. **拆成两个具名函数 vs. 保留一个函数加必填参数。** 后者改动更小，
   但「跨时间面传什么」这个问题会留在每个调用点上；前者把语义写进函数名，代价是多一个导出。
3. **§五那条边界是否该拦住本步。** 即：修一半（code 阶段通、plan 阶段不通）是否比不修好。
   我的主张是好——它精确解除第 6 步验收的阻碍，且边界有机器判据与文档落点。
4. `ROLE_SUFFIX_ANYWHERE` 改惰性求值但**不**改取值口径，是否算范围蔓延。

---

## 九、执行顺序

1. 拆函数 + 改签名，`tsc` 先红后绿（3.1）；
2. 改 `hookPreWrite` 的 driver 解析（3.2）；
3. 既有用例分两类改（3.4）；
4. 新增四条用例，逐条做变异验证（3.5）；
5. 文案与注释收口（3.3 + `hooks.ts:113-121` 的 M10 记载）；
6. BACKLOG：EV-68 转 done 并改准落点，EV-55 改时点记载，新 EV 登记 §五边界；
7. 主设计 §16.1 的 M10 行补 §五边界。

主设计 §21 版本台账行与 §24 台账**留待 M9 第 7 步**统一回溯（EV-57 已登记该欠账），
此处只回补会当场失实的现状断言——与第 4、5 步同一口径。
