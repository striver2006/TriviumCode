# M9 第 5 步 · `--driver` 全链路与选侧收口 实施计划（第 2 轮）

- **日期**：2026-09-19
- **起点**：`8ff9fc3`（M9 第 4 步），`main` 干净
- **上一轮**：`20260918T154204Z`，三侧 `request-changes`，25 条**全部接受**
  （裁决件 `2026-09-19-…-revised-claude.md`）
- **本轮是什么**：按 r1 的 25 条裁决重写后的计划。**三处改变了形状**，不是润色。

## 0. 相对 r1 改了什么（给审查员的差分索引）

| # | 改动 | 来自 |
| :--- | :--- | :--- |
| **A** | **§5.6 判据换底**：由「运行元数据登记反推」改为**文件自身 front-matter 判定**，复用既有 `classifyArtifact`。`recordedArtifactPaths` 这个新函数**不再需要** | CODEX-05、GLM-08、AGY-03、CODEX-10、GLM-05 |
| **B** | **§5.7 扩为闸门区整体收口**，EV-58 大部分不再可推后——闸门区在**第 6 步**就会硬失败，不是 M10 | GLM-03、CODEX-06、CODEX-13 |
| **C** | **§4 测试判据整体重写**：r1 写的扫源码判据在今天的 HEAD 上**就已经全绿** | CODEX-01/02/03/04、AGY-01、GLM-01/02 |
| D | §3 顺序 5.3 与 5.4 互换，删去「不得留过夜」的人工约束 | GLM-07 |
| E | §5.5 补 `driverEnabled` 的来源；`:466` 回落分支传 driver；`Handoff.options.driver` 改必填；理由改准 | CODEX-07、CODEX-11、GLM-01、GLM-06 |
| F | §5.8 定死 `override_reason` 取值来源 | AGY-02、GLM-04 |
| G | R-2、§5.6 依据 2 两处**失实断言**改正 | GLM-09、GLM-08 |
| H | R-8 配额口径改写；§1.2 范围表收窄；§5.1 USAGE 论域同源 | CODEX-08、CODEX-13、CODEX-09 |

**r1 中三侧一致确认成立、本轮原样保留的**：`resolveDriver` 集中判定；EV-53 源头合一；
R-1 双轨；R-6 留痕不可逆口径；§5.2 预检提示必须 `ok: true`；「不再自构入参写选侧用例」；
以及两处范围扩张（`resolveRerunIndex` 补进本步、EV-54 纳入本步）。

---

## 1. 前序指路

| 项 | 位置 |
| :--- | :--- |
| **当前生效的步骤表** | `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-revised-claude.md` §3 |
| 第 5 步落点表 / 边界 / `driverEnabled` 提案 | 同上 §2.1 / §2.14；原稿 `…-claude.md` §6.1 |
| **本轮的上一轮裁决** | 同目录 `2026-09-19-M9-Driver旗标全链路与选侧收口-revised-claude.md` |
| EV 台账 | `doc/08_project/BACKLOG.md` |
| **明确不读** | `doc/08_project/M9-交底.md` 对第 5 步一个字没写；`doc/02_design/2026-09-13-…设计.md` §7.2 已作废 |

---

## 2. 范围与完成判据

### 2.1 做

| # | 内容 | 出处 |
| :--- | :--- | :--- |
| A | `--driver` 全链路接线（解析 → 选侧 → 被审对象定位 → freeze → 运行元数据） | 步骤表 §2.1 |
| B | 只校验「已登记」，`driverEnabled === false` 不拒但如实标注 | §6.1 |
| C | CODEX-07：审查件不得被当原稿；`--driver` 非缺省时预检打提示 | 步骤表 §2.1 |
| D | **EV-53**：`--model-<id>` 白名单与文案论域合一 | BACKLOG:150，触发条件明写本步 |
| E | **EV-54**：补 `override_reason` 写入方（只补写入方） | BACKLOG:151；r1 三侧一致认可 |
| **F** | **闸门区以运行元数据为 driver 事实来源（新增，见 §6.7）** | **r1 GLM-03 / CODEX-06** |

### 2.2 不做（逐条附出处）

| 不做 | 出处 |
| :--- | :--- |
| `--driver` 不进 skill、不进 `argument-hint`；J4/J8 的「完整编排链路」限定为手工 CLI 路径 | 步骤表 §2.14 |
| 不翻任何一家的 `driverEnabled`；不校验 `driverEnabled` | `registry.ts` 三处 `// M10 启用`；§6.1 |
| 运行元数据 schema 不加 `if/then`（`driver_enabled` 与 `override_reason` 都不加） | R-6 |
| Hook 后缀集的跨时间面 | BACKLOG **EV-55** |
| **`report.ts` / `naming.ts` / `hooks.ts` 的 driver 消费面** | 不在步骤表 §2.1；见 R-3。**注意：闸门区已不在此列**（CODEX-13） |
| `checkConfigAgents` 的两条 skip 用例 | BACKLOG **EV-52** |
| `isHeterogeneous` 的 Driver 感知改造 | 本轮新登记 **EV-62**，见 §6.8 |
| `--model-*` 帮助文本的论域插值 | 本轮新登记 **EV-61** |
| 验收实跑本身（J4/J5/J6） | 步骤表**第 6 步** |
| §21/§24 台账、PRD AC 状态、`doc/05_testing` 回溯 | BACKLOG **EV-57**，第 7 步 |

### 2.3 完成判据

- **C1**：`--driver <非 claude> --critics claude` 经真实 CLI 子进程走通选侧（桩注入，不烧配额）
- **C2**：`--driver claude --critics claude` 经真实 CLI 子进程仍退 64（J8）
- **C3**：`npm run check` 全绿，跳过数由 3 降为 2
- **C4（新增）**：非缺省 Driver 下 `gate --check` 能定位到 `-revised-<真Driver>.md`，不报 `missing_disposition`

---

## 3. 开工前的核实（r1 已被三侧复核，本轮保留并补一条）

### 3.1 步骤表落点表漏了 `resolveRerunIndex`（三侧一致确认属实）

`archive.ts:65-68` 签名第 3 形参是 `driver: AgentId = DEFAULT_DRIVER`，而 `review.ts:559`
与 `cli.ts:731` 两处调用都只传两参。步骤表 §2.1 未列它。

**代价按 r1 GLM-09 的更正重写**（原表述与所引代码相反，是失实断言）：
`review.ts:1065-1069` 恰恰是**防**分叉的——抬升时同步改写 `meta.rerun_index`，
最终落盘与文件名一致。漏传的真实代价是：

- 骨架运行元数据**短暂**记错轮次（崩溃取证面失真）；
- 必然触发一次「轮次被占用、两侧一并抬升」告警；
- 触发条件收窄：只在 `driver ≠ 缺省` **且** critics 恰为 `[claude]` **且**已到第二轮时发生
  （其余组合里非 claude 后缀的审查件会让缺省算法碰巧算对）。

结论「该补」不变，但 D5 的裁定要基于这个准确代价。

### 3.2 EV-53 是硬依赖（三侧一致确认）

`critics.ts:57-73` 的 `legalList` 减 Driver，`topic-args.ts:451/455` 不减。
接线后**同一条命令里两段「当前可用」文案互相矛盾**。

### 3.3 `resolveDriver` 不存在；`DRIVER_AGENT_IDS` 零消费方

本步不消费后者——判据是「已登记」不是「已启用为 Driver」。

### 3.4（本轮新增）闸门区在第 6 步就会硬失败

`gate.ts:151` 的 `checkAdjudication` 按 `input.driver ?? DEFAULT_DRIVER` 定位裁决件；
`cli.ts:801`、`:876` 两处调用**都不传**，`cmdGate` 也没有旗标可传。
非缺省 Driver 下实际裁决件是 `-revised-<真Driver>.md`，它却去找 `-revised-claude.md`
→ `missing_disposition` **硬失败**，`--run-id` 救不了。

`inferLatestRunId`（`cli.ts:759/775/866`）跳过 `role === driver`，critics 含 claude 时恒推不出
run_id，于是 r1 §5.7 那条「从 `artifactMeta` 取 driver」的修复**在该场景整段失效**
（`artifactMeta` 恒为 null）。

**我 r1 认定「EV-58 可推后」的前提是「M9 期间 Driver 恒为 claude」——
这个前提被我自己的第 6 步剧本打穿**：验收跑 `--critics claude`，它只在 driver ≠ claude 时成立。

---

## 4. 测试（本轮整体重写 · 对应差分 C）

### 4.1 r1 的判据为什么是假证明

三侧独立命中同一处：r1 写的扫源码判据**在今天的 HEAD 上就已经全绿**。

- `review.ts:670` 的注释「下面 `driver` 字段的注释记的就是第一次」**就在 freeze 实参块内**
  → 裸词 `includes('driver')` 今天即真；
- 而 §5.5 给的落地形态是简写 `driver,` → `includes('driver:')` 又会对着它红；
- `topic-args.ts:520` 的**函数声明**本就带第 5 形参 `driver` → 不锁调用点就命中声明；
- `newRunMeta` 块里本步要同时加 `driver` 与 `driverEnabled` → 任何裸词判据被后者满足，
  而「只加了 `driverEnabled`、漏了 `driver`」正是失败形态；
- `Handoff.options` 只断**类型键集**，`writeHandoff` / `rebuildContext` 漏传值时类型照样成立。

### 4.2 判据形态（钉死，不留给实现者临场发明）

沿用 `deny-matrix.test.ts:362` 的三件套骨架：**唯一调用计数 → 实参块结尾定位断言 → 值表达式**。
在此之上加三条硬约束：

1. **剥注释行**后再匹配（行级，去掉 `*` 开头与 `//` 之后的内容）；
2. **锁调用点**：一律匹配 `await <fn>(` 形态，不匹配函数声明；
3. **区分 `driver` 与 `driverEnabled`**：按属性位匹配（`driver,` / `driver:` / `driver }`），
   带词边界，不用裸子串。

### 4.3 机制优先于测试（GLM-01）

`Handoff.options.driver` 声明为**必填**（与 `critics` / `sessionId` / `allowSingle` 同列），
让「类型可选 + 漏写」这条静默路径在**编译期**就不可达。测试只兜住类型兜不住的那部分。

### 4.4 用例清单

| # | 放哪 | 断言 |
| :--- | :--- | :--- |
| **T-1（C2/J8）** | 新建 `test/integration/driver-flag.test.ts`，**注入 `TRIVIUM_STUB_CRITIC` 并断言桩指纹** | `--driver claude --critics claude` 退 64，含 `/Driver/` 与 `/二次审查/` |
| **T-2（C1）** | 同上 | `--driver <SELECTABLE[0]> --critics claude` 走通选侧；`--driver X --critics X` 退 64 |
| **T-3（freeze 接线）** | **扩 `test/unit/deny-matrix.test.ts:362` 既有用例** | 按 §4.2 三条约束断言 freeze 实参块含 `driver` 属性位 |
| **T-4（其余接线）** | 新建 `test/unit/driver-wiring.test.ts` | 扫描集：`newRunMeta(`、`cli.ts` 两处 `resolveCriticSelection(`、**`topic-args.ts:328` 第三个选侧入口**、`await locateSubjectReadOnly(`、`writeHandoff` 的 options 字面量、`rebuildContext` 的 opts 映射、`isHeterogeneous(` 所在实参块含 `overrideReason` |
| **T-5a（CODEX-07 · 只读路径）** | `test/unit/topic-args.test.ts` | 审查件不得被当原稿；显式指定退 65 且文案含「审查件」；**反向误伤**：未登记原稿必须正常选中 |
| **T-5b（CODEX-07 · 真实路径）** | **`test/unit/topic.test.ts`**（既有 `locateSubject` 用例在 `:50-85`） | 同 T-5a，针对 `topic.ts` 的 `locateSubject`——它才是 `review --start` 走的那条 |
| **T-6（EV-53）** | `test/unit/topic-args.test.ts:563-618` | 改判据、**取消 skip**；`:611-613` 改为减 Driver 的清单；新增：文案不得含当轮 Driver |
| **T-7（EV-53 正例）** | 同文件 `:620-643` | 新增 `--driver <SELECTABLE[0]> --model-claude m-1` 必须放行 |
| **T-8（留痕）** | `test/unit/run-meta.test.ts` | `driver:'gemini', driverEnabled:false` 落盘正确且 `validateRunMeta` 返回 `[]`；历史形状仍合契约 |
| **T-9（EV-54）** | `test/unit/render.test.ts` + `run-meta.test.ts` | 按 §6.8 定死的取值断言**内容**（不只是非空），两处同值 |
| **T-10（预检提示 · 新增）** | `test/unit/preflight.test.ts` | 传 driver 的两种取值（非缺省已启用 / 非缺省未启用）：`ok` 恒 true、detail 文案命中、不短路后续检查 |
| **T-11（闸门区 · 新增）** | `test/integration/gate-loop.test.ts` | 非缺省 Driver 的一轮留痕下，`gate --check` 能定位 `-revised-<真Driver>.md`（C4） |

### 4.5 已存在、不要重写

`critics.test.ts:292`（非缺省 Driver 正例）与 `:308`（负例）都已在。
**不得再写「自己构造入参调 `resolveCriticSelection`」的用例**——那条路径今天就是绿的。

### 4.6 EV-52 三条 skip 复查

`topic-args.test.ts:592` **因本步恢复**（T-6）；`config-migrate.test.ts:364/:416` **不恢复**
（判据是 `configurableVendors()`，与 `--driver` 无关）。

---

## 5. 落地顺序（本轮 5.3 与 5.4 互换 · 对应差分 D）

| 序 | 动作 | 为什么在这个位置 |
| :--- | :--- | :--- |
| 6.1 | 判定处 `resolveDriver` | 后面都消费它 |
| 6.2 | **EV-53 论域源头合一**（原 5.4） | **先落 `selectableCritics` 导出、`legalList` 改调它——行为等价、不产生矛盾** |
| 6.3 | `cli.ts` 两个入口接线 | — |
| 6.4 | 预检可见提示 | 依赖 6.3 的 `enabledAsDriver` |
| 6.5 | `topic-args.ts` 解析与透传（原 5.3） | **此时接 driver，白名单判据已在 6.2 就位，矛盾窗口为零** |
| 6.6 | `review.ts` + 交接文件 | 链路下半段 |
| 6.7 | 闸门区整体收口 | 依赖 6.6 的留痕字段 |
| 6.8 | EV-54 写入方 | 与主链路无耦合 |

**r1 那条「5.1～5.4 不得留过夜」的人工约束已删除**——互换顺序后矛盾窗口为零，
不再依赖「记得别过夜」。这符合本仓「靠记性的纪律要换成不依赖记性的机制」。

---

## 6. 各步落点

### 6.1 `resolveDriver` — `src/trivium/critics.ts`

`resolveDriver(raw): { driver: AgentId; enabledAsDriver: boolean }`。
缺省 → `{ DEFAULT_DRIVER, true }`；未登记 → 退 64（可用值列 `ALL_AGENT_IDS`）；
已登记但 `driverEnabled === false` → `enabledAsDriver: false`，不抛。

复用 `isAgentId` / `agentById` / `ALL_AGENT_IDS`、`swallowedTextHint`。
**判定只此一处，三个调用点共用。**

### 6.2 EV-53 论域源头合一 — `critics.ts` + `topic-args.ts:448-459`

从 `critics.ts` 导出 `selectableCritics(cfg, driver, descriptors?)`，`legalList` 改调它。
`topic-args.ts` 的判据与文案改用同一份派生。**本步先落导出与 `legalList` 改调（行为等价）**，
driver 的接入在 6.5。

### 6.3 `cli.ts` 两个入口

`cmdReview`（:462 附近）与 `cmdPreflight`（:633）各取一次 `resolveDriver(flagString(args,'driver'))`，
透传给 `resolveCriticSelection`、`reviewOpts`、`runPreflight`。

USAGE（:208 / :226）补 `--driver <id>`，**取值清单与 `resolveDriver` 的接受集同源**
（即 `ALL_AGENT_IDS`，不是 `DRIVER_AGENT_IDS`）——后者今天只含 claude，写进帮助文本会与
实际接受的四家不符，正是本仓反复点名的「第一个错误引向第二个错误」。

`--driver` 是取值旗标，不进 `BOOLEAN_FLAGS`。

### 6.4 预检可见提示 — `src/trivium/preflight.ts`

`PreflightOptions` 加 `driver?` / `driverEnabled?`；`runPreflight` 在 `checkProbeFreshness` 之前，
**仅当 `driver !== DEFAULT_DRIVER`** 时推一条 `ok: true` 的 `CheckResult`。
`driverEnabled === false` 时 detail 逐字含「本次声明的 Driver 尚未启用为 Driver，该值仅用于选侧判定」。

**必须 `ok: true`**：`checks.every(c => c.ok)` 用于短路、`find(c => !c.ok)` 决定 exitCode，
判 false 会把一条提示变成一次失败。配套用例见 T-10。

### 6.5 `topic-args.ts` 解析与透传

1. `STATIC_FLAGS` 加 `'driver'`
2. `scope === 'all'` 拒绝 `--driver`（**D3 采纳**：与 `--critics`/`--only` 的拒绝理由逐字同构——接受即静默丢弃）
3. `resolveCriticSelection`（:328）传 driver
4. `locateSubjectReadOnly`（:473）补第 5 实参
5. `TopicResolution` 加 `driver`；`enabledAsDriver === false` 时 `notes.push(…)`
6. 白名单判据（6.2 已就位的 `selectableCritics`）此时接入 driver

### 6.6 `review.ts` + 交接文件

| 落点 | 改什么 |
| :--- | :--- |
| `ReviewOptions`（:279） | 加 `driver?: AgentId` |
| `prepareRun` 开头 | `const driver = opts.driver ?? DEFAULT_DRIVER;`<br>**`const driverEnabled = agentById(driver)?.driverEnabled ?? false;`（CODEX-07 指出 r1 漏了来源）** |
| **:466 回落分支** | `resolveCriticSelection(cfg, { driver })` —— **r1 漏了这处**（CODEX-11） |
| :497 旁 | `sides.includes(driver)` 兜底，**只留给「直传 critics」这一种绕过形态**，文案复用判定处 |
| :559 `resolveRerunIndex` | 补第 3 实参（见 §3.1） |
| :610 `locateSubject` | 补第 4 实参 |
| :650 `freeze` | 补 `driver` |
| :776 `newRunMeta` | 补 `driver` / `driverEnabled` |

**交接文件** `run-protocol.ts`：`Handoff.options.driver` 声明为**必填**（§4.3）；
`writeHandoff` 写入、`rebuildContext` 读回。

**理由改准**（GLM-06 指出 r1 失实）：driver 的全部消费方（`resolveRerunIndex`/`locateSubject`/
`freeze`/`newRunMeta`/`resolveCriticSelection`）**都在 `prepareRun`，即 `--start` 侧**；
`executeRun` 今天不读 `opts.driver`。接线的理由是**与 `critics`/`sessionId`/`entry` 同构、
保持交接完整性**，不是「worker 侧会静默为 undefined 而出错」。

**留痕字段**：`meta.ts` 的 `NewRunMetaInput` 加 `driverEnabled?`，`newRunMeta` 恒写
`driver_enabled`；`types.ts` 的 `RunMeta` 加**可选** `driver_enabled?`；
`run.v2.json` 的 `properties` 加 `driver_enabled`（boolean，**不进 required、不加 enum**）。

**同批修两句失实文字**：`types.ts:1175` 与 `run.v2.json` 的 `properties.driver.description`
都写着「M7b 起恒为 claude，M10 起可变」——放开 `--driver` 的是 M9 第 5 步。

### 6.7 闸门区整体收口（本轮新增 · 对应差分 B）

**`cmdGate` 内部一律以运行元数据为 driver 的事实来源**（`meta.driver`），
**仍不加 `--driver` 旗标**——事实来源是留痕不是旗标，这条原则不变
（与 `cli.ts:745-757`「事实来源是 `critics_selected`，不是键集」同源）。

覆盖六处：`checkAdjudication` 两处（`cli.ts:801`、`:876`）、`checkStageArtifacts` 一处（`:762`）、
`inferLatestRunId` 三处（`:759`、`:775`、`:866`）、`resolveRerunIndex` 一处（`:731`）。

**取值链的先后（这是本节唯一的难点）**：`inferLatestRunId` 需要 `rerunIndex`，
而准确的 `rerunIndex` 需要 driver，driver 又在运行元数据里——存在循环。
**解法**：有 `--run-id` 时直接读元数据取 `meta.driver` 与 `meta.rerun_index`；
没有时先按缺省 Driver 推一次 run_id，读到元数据后**用 `meta.driver` 复算一次**，
两次结果不一致就以元数据为准并打一行提示。

EV-58 只保留「两次推断都落空时如何取 meta」这一格。

### 6.8 EV-54 写入方（取值来源本轮定死 · 对应差分 F）

`review.ts:1144` 与 `:1341` 两处 `heterogeneous:` 旁补 `overrideReason`。
承接侧已完整接通（`render.ts:99` 声明、`:192` 落盘、`:314` 渲染）。

**取值来源（r1 未定，AGY-02/GLM-04 指出会被临场发明成两份文案）**：
由模型覆盖的**来源链**派生，两处共用**同一个派生函数**：

- 用户经 `--model-<id>` 显式指定了 claude 系模型 → 「用户经 `--model-<id>` 显式指定」
- 档位默认落到 claude 系 → 「档位 `<profile>` 的默认模型」

T-9 按该来源断言**内容**，不只是非空。

**本步不做** `isHeterogeneous` 的 Driver 感知改造（AGY-02 后半）：它只判模型串含不含 claude、
不感知当轮 Driver，非 claude 为 Driver 时 claude 审核者会被判「与主脑同源」而实际异构。
这是真缺陷，但改它超出本步范围 → **EV-62**。本步在留痕里如实说明判据口径。

### 6.9 CODEX-07 判据换底（对应差分 A）

**r1 的「登记反推」判据被三条事实推翻了不变式地位**：

1. `roleIsAllowedForWriter(writer, role, driver)` 实核为 `writer === 'driver' ? role === driver`
   —— 编排器本就把「Driver 产出角色工件」当一等公民。M10 之下让 Driver 原稿也走
   `writeArtifact` 是自然做法，那时 r1 判据会把合法原稿判死；
2. **`verify.ts:216` 是第二个写 `artifacts[]` 的地方**（r1 说「写入方只有 review.ts」不精确。
   结论不变——`buildVerifyName` 不带角色后缀、落在 `verify/` 目录、进不了候选论域——
   但「唯一」是那条推导的支点之一，写不准会让后人按「唯一」做扩展时踩空）；
3. 登记清单里**没有产出方信息**，「任一 run 的登记」比「某次审查的某一侧产出」宽。

**改用本仓既有口径**：`freeze.ts:200-215` 的 `classifyArtifact` 走**文件自身 front-matter**。
审查件带 `schema: trivium.review.v1`，原稿与裁决件不带（或带 `trivium.disposition.v1`）。
这是**内容级判据**，不依赖调用点清单、不依赖登记，第四条写入路径出现也不影响。

**等价性有实测背书**：r1 codex 侧枚举 84 份运行元数据、162 条带角色后缀的登记条目逐条读文件头，
**162/162 全部含 `trivium.review.v1`**，0 条是原稿或裁决件——两种判据在今天结论完全一致，
但 front-matter 那条扛得住明天。

**换底连带消掉三条 r1 遗留问题**：路径归一化（AGY-03）不再需要（不比对路径了）；
`stage` 论域与 `unreadable` 分流（CODEX-10 / GLM-05）随之消失（不再读运行元数据）。
**`recordedArtifactPaths` 这个新函数不再需要。**

**两处候选逻辑仍必须同改**（判据逐项同形）：`locateSubjectReadOnly`（`topic-args.ts:520-573`）
与 `locateSubject`（`topic.ts:76-119`）。规则：

- 显式 `--plan-file` / `--rca-file` 指向审查件 → **硬拒绝**（`EXIT.MISSING_ARTIFACT`）
- 自动候选命中 → **从候选里剔除**，剔空了才抛，错误里列出被剔文件与理由

**不采纳** CODEX-05 的子建议「显式路径降为告警」：换成内容判据后误判面已消除，
降为告警会让「显式指向一份审查件」这个明确错误静默通过。显式路径**维持硬拒绝**。

---

## 7. 风险与边界

| # | 风险 | 处置 |
| :--- | :--- | :--- |
| **R-1** | 同一主题换过 Driver 时，日期更晚的审查件会排在真原稿前（`rerunIndex desc, fileName desc`） | 过滤而非硬拒；显式指定才硬拒。三侧一致认可 |
| **R-2** | `resolveRerunIndex` 漏传 driver | 代价按 §3.1 的**准确**表述：骨架短暂失真 + 一次抬升告警 + 触发条件收窄。**r1 那句「元数据与文件名分叉」与代码相反，已删** |
| **R-3** | 接线未覆盖 `report.ts` / `naming.ts` / `hooks.ts` 的 driver 消费面 | 在 §2.2 具名。**闸门区已不在此列**——它进了范围（§6.7） |
| **R-4** | `:466` 回落与直传 critics 两条绕过路径 | 回落分支传 driver（6.6）；防御条只留给直传形态 |
| **R-5** | 落盘层没有「driver ∉ critics_selected」机器判据（`schemas.ts:255-297` 只有三条） | 登记 EV-59 |
| **R-6** | **唯一真正不可逆**：归档里会出现 `driver_enabled: false` 的留痕，M10 收紧后仍要读回 | 可选字段、保持 `additionalProperties: true`、**不加 if/then**（`override_reason` 同） |
| **R-7** | `--driver` 进 `STATIC_FLAGS` 后，正文里逐字出现会被吞掉下一个 token | 既有固有歧义；**本主题自身就是高危语料** |
| **R-8** | **配额（r1 口径写错）**：6.1～6.8 的单测与类型检查零配额，但 **T-1/T-2/T-11 是真起子进程的集成用例，且每次 `npm run check` 都跑** | **必须注入 `TRIVIUM_STUB_CRITIC` 并断言桩指纹**（与既有集成用例同款）。不注入就是每次提交闸门烧一次配额 |

---

## 8. 台账

**本轮新登记**：

- **EV-60**：zcode 侧出现 `project_reads: 29` 而工具计数全 0 的轨迹分叉，触发
  `insufficient_evidence` 降级，而人工复核确认该侧确实读了工作树——**判据与事实不符**。
  它会让合格的一侧被误判为不合格；反向（真没读却计数正常）更危险。
- **EV-61**：`cli.ts:198` 的 `--model-gemini / --model-glm` 帮助文本写死两家，代码接受四家。
- **EV-62**：`isHeterogeneous`（`adapters/base.ts:1670`）不感知当轮 Driver（见 §6.8）。

**r1 已登记、本轮保留**：EV-58（收窄为「两次推断都落空时如何取 meta」）、EV-59。

---

## 9. 不可逆决策

| 决策 | 选择 | 理由 | 回滚方式 |
| :--- | :--- | :--- | :--- |
| `--driver` 校验强度 | 只校验「已登记」 | 校验 `driverEnabled` ⇒ 第 6 步跑不成（死循环）。出处 §6.1 | 改一处即可收紧；**已落盘的 `driver_enabled: false` 留痕不可回收** |
| `driver_enabled` 契约位置 | 可选顶层字段，不进 required、不加 if/then | 见 R-6 | **不可逆**——一旦有旧留痕写出，required 再也加不上 |
| **CODEX-07 判据换底** | **文件自身 front-matter，不用登记反推** | 登记判据靠调用点清单而非不变式（§6.9 三条）；162/162 实测证明两者今天等价 | 可逆 |
| **闸门区事实来源** | **运行元数据，不加 `--driver` 旗标** | 与「事实来源是 `critics_selected` 不是键集」同源 | 可逆 |
| `override_reason` | 只补写入方，不升机器判据 | 升了历史留痕集体读不回 | 可逆 |
| `--driver` 不进 skill | 只作 CLI / 编排器内部旗标 | §2.14；进 argument-hint 要同批改三份模板 | 可逆（M10 本就要做） |

---

## 10. 验收标准

```
cd /Users/chenzhenbo/Work/TriviumCode
npm run typecheck && npm run pretest
node --test "dist/test/test/unit/critics.test.js" \
            "dist/test/test/unit/topic-args.test.js" \
            "dist/test/test/unit/topic.test.js" \
            "dist/test/test/unit/driver-wiring.test.js" \
            "dist/test/test/unit/review-sides.test.js" \
            "dist/test/test/unit/run-meta.test.js" \
            "dist/test/test/unit/run-meta-strict.test.js" \
            "dist/test/test/unit/registry-parity.test.js" \
            "dist/test/test/unit/deny-matrix.test.js" \
            "dist/test/test/unit/preflight.test.js" \
            "dist/test/test/unit/render.test.js" \
            "dist/test/test/unit/config-migrate.test.js"
node --test "dist/test/test/integration/driver-flag.test.js" \
            "dist/test/test/integration/topic-resolve.test.js" \
            "dist/test/test/integration/gate-loop.test.js"
npm run check
```

判据：**V1**=T-1（C2/J8）｜**V2**=T-2（C1）｜**V3**=T-3/T-4（接线）｜**V4**=T-6 由 skip 转执行且绿、跳过数 3→2｜
**V5**=T-5a+T-5b（两个 `locateSubject` 都覆盖）｜**V6**=T-8（新旧形状都过校验）｜**V7**=T-9（按来源断内容）｜
**V8**=T-10（预检提示）｜**V9**=T-11（C4：非缺省 Driver 下 gate 能定位裁决件）

### 变异验证（**逐条对应，r1 只有一行的问题已修**）

| 改什么 | 哪条必须红 |
| :--- | :--- |
| 删 `cli.ts:470` 的 `driver` 实参 | T-4 |
| 删 `cli.ts:633` 的 `driver` 实参 | T-4 |
| 删 `topic-args.ts:328` 的 `driver` 实参 | T-4 |
| 删 `review.ts:650` `freeze` 的 `driver` | T-3 |
| 删 `review.ts:776` `newRunMeta` 的 `driver`（**只留 `driverEnabled`**） | T-4（这条专测 §4.2 约束 3） |
| 删 `writeHandoff` 的 `driver` 传值 | T-4 |
| 删 `rebuildContext` 的 `driver` 映射 | T-4 |
| 把 `topic-args.ts` 判据改回 `CRITICS.includes(id)` | T-6 / T-7 |
| 删 `topic.ts` 的 front-matter 过滤 | **T-5b** |
| 删 `topic-args.ts` 的 front-matter 过滤 | **T-5a** |
| 删 `isHeterogeneous(` 旁的 `overrideReason` | T-9 |
| 把预检提示的 `ok` 改成 `false` | **T-10**（r1 绑的是既有用例，那些用例看不见这条提示） |
| 把 `checkAdjudication` 的 driver 改回缺省 | **T-11** |
| 在 freeze 实参块里只留注释、删掉 `driver` 属性位 | T-3（专测 §4.2 约束 1「剥注释」） |

---

## 11. 给审查员的提醒

**请回原文核，不要信本文的概括。** 本轮三处最可能出问题的自证薄弱点：

1. **§6.9 的判据换底是本轮最大的形状改动，而我没有实跑验证过 `classifyArtifact` 的适用面。**
   我读了 `freeze.ts:200-215` 的实现与文档块，但**没有核**：它对「front-matter 缺失 / 损坏 /
   非 UTF-8 / 空文件」这些边界返回什么，也没核它是否只在 freeze 语境下成立（比如它可能假定
   调用方已经过了某层过滤）。若它在这些边界上抛错或误分类，换底就是把一个已知问题换成未知问题。
2. **§6.7 的取值链解法（先按缺省推一次、读到元数据后复算）是我现场设计的，没有先例可抄。**
   「两次结果不一致就以元数据为准」这条在什么情况下会震荡、会不会在归档被人工改动过的主题上
   死循环，我没有推演完。这是本轮唯一一处纯新增的控制流。
3. **§4.2 的三条判据约束（剥注释、锁调用点、区分 driver/driverEnabled）是我照三侧意见归纳的，
   但我没有把它写成可执行的匹配器再自测一遍。** 上一轮的教训正是「判据看起来对、实际永绿」——
   这一轮的判据同样只是散文，仍有可能在实现时退化。请特别核第 14 行变异（专测剥注释）
   是否真的能区分「注释里的 driver」与「属性位的 driver」。

另有一条事实要点名：**上一轮 glm 侧被编排器判 `evidence_ok: false`（工具调用 0 次），
但我逐条回原文核实了它的三条载重断言，全部属实**，其中两条指出的是我自己计划里的失实。
本轮若 glm 侧再次出现该形态，请按同样方式对待——**以断言能否被原文核实为准，不以计数为准**。
