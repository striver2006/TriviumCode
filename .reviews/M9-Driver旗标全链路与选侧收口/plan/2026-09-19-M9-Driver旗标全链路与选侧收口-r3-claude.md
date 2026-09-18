# M9 第 5 步 · `--driver` 全链路与选侧收口 实施计划（第 3 轮）

- **日期**：2026-09-19
- **起点**：`8ff9fc3`（M9 第 4 步），`main` 干净
- **上两轮**：r1 `20260918T154204Z`（25 条全接受）、r2 `20260918T160720Z`（18 条全接受，含 **1 阻断**）
- **本轮是什么**：按 r2 的 18 条裁决重写。**三处形状改动的落地写法全部换掉**，
  其中闸门区取值链是推倒重来，不是修补。

## 0. 相对 r2 改了什么（差分索引）

| # | 改动 | 来自 |
| :--- | :--- | :--- |
| **A** | **§6.7 推倒重来**：取消「先按缺省猜一次 run_id、再复算」，改为**直读运行元数据**。循环依赖消失，不需要定义两遍/终止/不动点 | AGY-01（阻断）、CODEX-01/02、GLM-01 |
| **B** | **§6.9 落地写法换掉**：不搬私有的三值 `classifyArtifact`，改为基于已导出的 `parseFrontMatter` 写**二值**谓词 `isReviewArtifact` | AGY-02、GLM-02、CODEX-04/07 |
| **C** | **§4.2 三条约束重写**：约束 1 改整块剥离、约束 2 改逐目标锚点、约束 3 保留 | CODEX-05/06、GLM-03/04、AGY-03 |
| D | §6.6 补第三处 `locateSubject`（`resolveTaskGoal`）；`rebuildContext` 补运行期校验 | CODEX-03、CODEX-09 |
| E | §6.1 给 `resolveDriver` 开 `descriptors` 注入口（否则 T-10 有一臂不可构造） | GLM-05 |
| F | R-8 桩口径改正：桩配置必须点名本轮每一侧；T-1 不断指纹 | CODEX-08 |
| G | 变异表那条「专测剥注释」改掉——**它自己是假证明** | AGY-03 |
| H | 「六处」改「七处」；`freeze.ts` 引用行号改正 | GLM-06 |

### 0.1 本轮开工前先自查出的一处：r2 裁决件里的新解法也不能照抄

r2 裁决件 §2.1 我写「`listRecordedRuns` 权威地给出 driver 与 rerun_index」。
**实读否证**：`RecordedRun`（`archive.ts:414-419`）只有
`run_id / stage / artifacts / status`（另加 `skipped` / `unreadable` / `unreadableReason`），
**没有 `driver`，也没有 `rerun_index`**；而且 `listRecordedRuns`（`archive.ts:492`）
读的是裸 JSON，不走 v1 迁移。

这与 r2 里 `classifyArtifact` 那次是**同一形态的错误**：我提出「复用某个现成件」，
而那个现成件并不提供我要的东西。本轮的解法按下面 §6.7 重写，入口改用
`readRunMeta`（`meta.ts:325`，它会把 v1 记录迁移并补上 `driver`）。

---

## 1. 前序指路

| 项 | 位置 |
| :--- | :--- |
| **当前生效的步骤表** | `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-revised-claude.md` §3 |
| 第 5 步落点表 / 边界 / `driverEnabled` 提案 | 同上 §2.1 / §2.14；原稿 `…-claude.md` §6.1 |
| **r1 裁决** | 同目录 `2026-09-19-…-revised-claude.md`（25 条） |
| **r2 裁决** | 同目录 `2026-09-19-…-r2-revised-claude.md`（18 条，含阻断）——**注意其 §2.1 的解法已被本轮 §0.1 否证** |
| EV 台账 | `doc/08_project/BACKLOG.md` |
| **明确不读** | `doc/08_project/M9-交底.md` 对第 5 步一字未写；`doc/02_design/2026-09-13-…设计.md` §7.2 已作废 |

---

## 2. 范围与完成判据

### 2.1 做

| # | 内容 | 出处 |
| :--- | :--- | :--- |
| A | `--driver` 全链路接线（解析 → 选侧 → 被审对象定位 → freeze → 运行元数据） | 步骤表 §2.1 |
| B | 只校验「已登记」，`driverEnabled === false` 不拒但如实标注 | §6.1 |
| C | 审查件不得被当原稿；`--driver` 非缺省时预检打提示 | 步骤表 §2.1 |
| D | **EV-53**：`--model-<id>` 白名单与文案论域合一 | BACKLOG:150 |
| E | **EV-54**：补 `override_reason` 写入方 | BACKLOG:151 |
| F | 闸门区以**运行元数据**为 driver 与轮次的事实来源（七处） | r2 AGY-01 阻断 |

### 2.2 不做

| 不做 | 出处 |
| :--- | :--- |
| `--driver` 不进 skill、不进 `argument-hint` | 步骤表 §2.14 |
| 不翻任何一家的 `driverEnabled`；不校验 `driverEnabled` | `registry.ts` 三处 `// M10 启用`；§6.1 |
| 运行元数据 schema 不加 `if/then` | R-6 |
| Hook 后缀集跨时间面 | **EV-55** |
| `report.ts` / `naming.ts` / `hooks.ts` 的 driver 消费面（闸门区**不在此列**，已进范围） | 不在步骤表 §2.1；R-3 |
| `checkConfigAgents` 两条 skip | **EV-52** |
| `isHeterogeneous` 的 Driver 感知改造 | **EV-62** |
| `--model-*` 帮助文本论域插值 | **EV-61** |
| 「front-matter 被剥掉的审查件」的防御告警 | **EV-63**（本轮新登记，见 §6.9 残余风险） |
| 验收实跑（J4/J5/J6） | 步骤表**第 6 步** |
| §21/§24 台账、PRD AC、`doc/05_testing` 回溯 | **EV-57**，第 7 步 |

### 2.3 完成判据

- **C1**：`--driver <非 claude> --critics claude` 经真实 CLI 子进程走通选侧（**桩注入**）
- **C2**：`--driver claude --critics claude` 仍退 64（J8）
- **C3**：`npm run check` 全绿，跳过数由 3 降为 2
- **C4**：非缺省 Driver 下 `gate --check` 能定位 `-revised-<真Driver>.md`，
  **且在「本轮审查件已落盘、裁决件尚未写出」这一格也不误报**（r2 CODEX-01 指出 r2 的 C4
  只覆盖了不会出问题的那个状态）

---

## 3. 开工前的核实

### 3.1 步骤表漏了 `resolveRerunIndex`（r1/r2 三侧均复核属实）

`archive.ts:65-68` 第 3 形参是 `driver`，`review.ts:559` 与 `cli.ts:731` 都只传两参。

**代价（r2 glm 复核后的准确版）**：`review.ts:1065-1069` 是**防**分叉的（抬升时同步改写
`meta.rerun_index`）。真实代价是骨架运行元数据短暂失真 + 一次抬升告警，
触发条件收窄为「driver ≠ 缺省 **且** critics 恰为 `[claude]` **且**已到第二轮」。

### 3.2 EV-53 是硬依赖

`critics.ts:57-73` 的 `legalList` 减 Driver，`topic-args.ts:451/455` 不减 →
接线后同一条命令两段「当前可用」互相矛盾。

### 3.3 `resolveDriver` 不存在；`DRIVER_AGENT_IDS` 零消费方；`isReviewArtifact` 也不存在

三条均 grep 确认。

### 3.4 闸门区在第 6 步就会失败（r2 三侧复核，措辞取 codex 的精确版）

`gate.ts:734` 的 `if (i.parsed.role === driver) continue;` 在 driver=claude、critics=[claude] 时
跳过全部 `-claude.md` 审查件。

**精确边界**（r2 CODEX-01 更正了我 r2 §3.4 的「恒推不出」）：
裁决件 role ≠ 缺省 Driver，**不**被跳过，且其 front-matter 带 `run_id`
（`disposition.v1` 把 `run_id` 列为必填）——所以**有裁决件时第一趟能拿到值**。
真正落空的是**裁决件尚未写出**那一格，而那恰是 `gate --check` 最常用的状态。

`checkAdjudication`（`gate.ts:151`）按 `input.driver ?? DEFAULT_DRIVER` 找裁决件，
`cli.ts:801` 与 `:876` 两处调用都不传 → 非缺省 Driver 下 `missing_disposition` 硬失败。

---

## 4. 测试

### 4.1 前两轮的教训（判据本身是被审对象）

- **r1**：扫源码判据在当时的 HEAD 上就已全绿（`review.ts:670` 的注释含 `driver` 字样）。
- **r2**：我给出的三条约束里，约束 1 漏掉单行块注释——codex **按我的字面规则实现了剥离器实测**，
  `/* driver, */` 判**命中**；约束 2「一律 `await <fn>(`」对七个目标里**五个**不成立。
- **r2 还有一条**：我那条「专测剥注释」的变异行**本身是假证明**——`review.ts:670` 的
  `driver` 后跟反引号，不含 `,`/`:`，不写剥离逻辑它也会红。

### 4.2 判据形态（本轮重写）

沿用 `deny-matrix.test.ts:362` 的三件套骨架（唯一调用计数 → 实参块结尾定位断言 → 值表达式），
三条约束改为：

| 约束 | 内容 |
| :--- | :--- |
| **1 剥注释** | **整块剥离**：先去掉 `/* … */`（含单行、行尾、跨行三种形态），再去掉 `//` 行尾。**「属性位与逗号之间夹行内注释」（`driver /* 当轮 */,`）列为合法形态必须判命中**——否则正确实现被误红，实现者有动机把判据放松回裸词 |
| **2 锁调用点** | **逐目标钉锚点**，不再「一律 `await`」：<br>· await 型（`freeze`、`locateSubjectReadOnly`、`locateSubject`）→ `await <fn>(`<br>· 同步赋值型（`newRunMeta`、三处 `resolveCriticSelection`）→ `= <fn>(`<br>· `isHeterogeneous` → 「`isHeterogeneous(` 所在实参块内含属性位 `overrideReason`」<br>· `writeHandoff` / `rebuildContext` → 以函数体内的具名字面量为锚<br>**统一要求：锚点不得命中声明行**（过滤行首 `function` / `export`） |
| **3 区分相似键名** | **保留不动**（r2 codex 实测：`driver,` / `driver: driver,` / `driver }` 命中，`driverEnabled,` 不命中） |

**期望条数按文件写明**（如「`review.ts` 恰好 1 处 `= newRunMeta({`」），计数错了就红。

### 4.3 机制优先于测试

`Handoff.options.driver` 声明为**必填**。
**但「编译期不可达」只在同版本进程内成立**（r2 CODEX-09）：`rebuildContext` 是
`JSON.parse(...) as Handoff`，无运行期校验，`--worker` 恢复读旧版交接文件时
类型必填而运行期 undefined → 静默回落缺省 Driver。故 §6.6 另加运行期校验。

### 4.4 用例清单

| # | 放哪 | 断言 |
| :--- | :--- | :--- |
| **T-1（C2/J8）** | 新建 `test/integration/driver-flag.test.ts`，桩注入 | `--driver claude --critics claude` 退 64，含 `/Driver/` 与 `/二次审查/`。**只断退码与文案——本用例在选侧阶段就退出，无工件可做指纹断言** |
| **T-2（C1）** | 同上，**桩配置必须含 `claude`** | `--driver <SELECTABLE[0]> --critics claude` 走通选侧并断言桩指纹 |
| **T-3（freeze 接线）** | 扩 `deny-matrix.test.ts:362` | 按 §4.2 三条约束断言 freeze 实参块含 `driver` 属性位 |
| **T-4（其余接线）** | 新建 `test/unit/driver-wiring.test.ts` | 七个目标逐个按 §4.2 约束 2 的对应锚点 |
| **T-5a** | `test/unit/topic-args.test.ts` | 审查件不得当原稿；显式指定审查件退 65；**未登记原稿正常选中**；**显式指定「旧 Driver 后缀的原稿」必须放行**（R-1 的逃生门） |
| **T-5b** | `test/unit/topic.test.ts` | 同 T-5a，针对 `topic.ts:76` 的 `locateSubject`——真实审查路径 |
| **T-6 / T-7（EV-53）** | `topic-args.test.ts:563-643` | 取消 skip；文案不得含当轮 Driver；`--driver <X> --model-claude m-1` 放行 |
| **T-8（留痕）** | `run-meta.test.ts` | `driver:'gemini', driverEnabled:false` 落盘且过校验；历史形状仍合契约 |
| **T-9（EV-54）** | `render.test.ts` + `run-meta.test.ts` | 按 §6.8 的来源断言**内容**，两处同值 |
| **T-10（预检提示）** | `preflight.test.ts` | 两臂均**用注入表构造**（见 §6.1）：非缺省已启用 / 非缺省未启用。断 `ok` 恒 true、文案命中、不短路 |
| **T-11（闸门区）** | `test/integration/gate-loop.test.ts`，桩含每一侧 | 非缺省 Driver 下 `gate --check` 定位 `-revised-<真Driver>.md`；**并覆盖「审查件已落盘、裁决件未写出」一格**（C4） |

### 4.5 已存在、不要重写

`critics.test.ts:292`（非缺省 Driver 正例）与 `:308`（负例）已在。
不得再写自构入参调 `resolveCriticSelection` 的用例。

### 4.6 EV-52 三条 skip

`topic-args.test.ts:592` 因本步恢复；`config-migrate.test.ts:364/:416` 不恢复。

---

## 5. 落地顺序

| 序 | 动作 |
| :--- | :--- |
| 6.1 | `resolveDriver`（含 `descriptors` 注入口） |
| 6.2 | EV-53 论域源头合一（行为等价，先落） |
| 6.3 | `cli.ts` 两个入口接线 |
| 6.4 | 预检可见提示 |
| 6.5 | `topic-args.ts` 解析与透传（此时接 driver，矛盾窗口为零） |
| 6.6 | `review.ts` + 交接文件 |
| 6.7 | 闸门区（直读运行元数据） |
| 6.8 | EV-54 写入方 |
| 6.9 | `isReviewArtifact` 与两处候选逻辑 |

---

## 6. 各步落点

### 6.1 `resolveDriver` — `src/trivium/critics.ts`

```
resolveDriver(raw, descriptors?): { driver: AgentId; enabledAsDriver: boolean }
```

缺省 → `{ DEFAULT_DRIVER, true }`；未登记 → 退 64（可用值列 `ALL_AGENT_IDS`）；
已登记但 `driverEnabled === false` → `enabledAsDriver: false`，不抛。

**`descriptors` 注入口是本轮新增**（r2 GLM-05）：注册表里 `driverEnabled: true` 只有 claude
一家（即缺省本尊），其余三家都是 `false`。没有注入口，T-10 的「非缺省**已启用**」臂
**今天不可构造**，实现者只能临场造夹具绕注册表——又是一条留给临场发明的口子。
形态与理由照抄 `CriticSelectionInput.descriptors`（`critics.ts:41`）的既有先例。

判定只此一处，三个调用点共用。错误文案论域用 `ALL_AGENT_IDS`（判据是「已登记」），
**不是** `DRIVER_AGENT_IDS`。

### 6.2 EV-53 论域源头合一

从 `critics.ts` 导出 `selectableCritics(cfg, driver, descriptors?)`，`legalList`（`:57-73`）改调它；
`topic-args.ts:448-459` 的判据与文案改用同一份派生。本步先落导出与改调（行为等价）。

### 6.3 `cli.ts` 两个入口

`cmdReview`（:462 附近）与 `cmdPreflight`（:633）各取一次 `resolveDriver`，透传给
`resolveCriticSelection`、`reviewOpts`、`runPreflight`。
USAGE（:208 / :226）补 `--driver <id>`，**取值清单与 `resolveDriver` 的接受集同源**。

### 6.4 预检可见提示 — `src/trivium/preflight.ts`

`PreflightOptions` 加 `driver?` / `driverEnabled?`；仅当 `driver !== DEFAULT_DRIVER` 时
在 `checkProbeFreshness` 之前推一条 **`ok: true`** 的 `CheckResult`
（`checks.every` 用于短路、`find(!ok)` 定 exitCode，判 false 会把提示变成失败）。
`driverEnabled === false` 时 detail 逐字含
「本次声明的 Driver 尚未启用为 Driver，该值仅用于选侧判定」。

### 6.5 `topic-args.ts`

`STATIC_FLAGS` 加 `'driver'`；`scope === 'all'` 拒绝 `--driver`（D3 采纳，与 `--critics`/`--only`
的拒绝理由逐字同构）；`resolveCriticSelection`（:328）与 `locateSubjectReadOnly`（:473）补传；
`TopicResolution` 加 `driver`，`enabledAsDriver === false` 时 `notes.push(…)`。

### 6.6 `review.ts` + 交接文件

| 落点 | 改什么 |
| :--- | :--- |
| `ReviewOptions`（:279） | 加 `driver?: AgentId` |
| `prepareRun` 开头 | `driver = opts.driver ?? DEFAULT_DRIVER`；`driverEnabled = agentById(driver)?.driverEnabled ?? false` |
| :466 回落分支 | `resolveCriticSelection(cfg, { driver })` |
| :497 旁 | `sides.includes(driver)` 兜底，只留给「直传 critics」形态 |
| :559 `resolveRerunIndex` | 补第 3 实参 |
| :610 `locateSubject` | 补第 4 实参 |
| **:245 `resolveTaskGoal` 内的 `locateSubject`（本轮新增）** | **补 driver**。r2 CODEX-03：这是第三处调用，不传 driver 且整段包在 try/catch 里**静默**返回 null。换底后若那份 `-claude.md` 是审查件就被剔除 → 任务目标无声消失；换底前则把审查意见当计划原稿提目标。**两种结局都不报错、不进留痕** |
| :650 `freeze` | 补 `driver` |
| :776 `newRunMeta` | 补 `driver` / `driverEnabled` |

**交接文件** `run-protocol.ts`：`Handoff.options.driver` 改**必填**；`writeHandoff` 写入；
`rebuildContext` 读回，**并补运行期校验**——`h.options.driver` 缺失时取缺省**并打可见告警**
（r2 CODEX-09：读侧是 `JSON.parse(...) as Handoff`，类型必填在恢复路径上等于没有）。

**接线理由如实写**（r2 GLM-06 更正）：driver 的全部消费方都在 `prepareRun`（`--start` 侧），
`executeRun` 今天不读 `opts.driver`。理由是**与 `critics`/`sessionId`/`entry` 同构、保持交接完整性**，
不是「worker 侧会出错」。

**留痕字段**：`meta.ts` 的 `NewRunMetaInput` 加 `driverEnabled?`，恒写 `driver_enabled`；
`types.ts` 的 `RunMeta` 加**可选** `driver_enabled?`；`run.v2.json` 的 `properties` 加
`driver_enabled`（boolean，**不进 required、不加 enum**）。

**同批修两句失实文字**：`types.ts:1175` 与 `run.v2.json` 的 `properties.driver.description`
都写着「M7b 起恒为 claude，M10 起可变」。

### 6.7 闸门区：直读运行元数据（本轮推倒重来 · 差分 A）

**r2 解法错在哪**：`inferLatestRunId` 要 driver 才能跳过 Driver 产出，driver 又在留痕里。
我的「先按缺省猜一次、读到元数据再复算」只是**把循环包了一层**——在「裁决件尚未写出」
这一格第一趟就断了（`gate.ts:734`），第二趟无从触发；glm 还构造出一个 2-循环。

**新解法：根本不从后缀反推。**

```
latestRunMeta(layout, stage): 列 <阶段>/_meta/ 下的 run-*.json 文件名
  → run_id 是时间戳、字典序即时序，倒序取最新
  → 逐个 readRunMeta(layout, stage, runId) 直到拿到非 null
  → RunMeta 权威地给出 driver 与 rerun_index（run.v2 把两者列为必填）
```

复用 `readRunMeta`（`meta.ts:325`）而**不是** `listRecordedRuns`——后者的 `RecordedRun`
（`archive.ts:414`）不带这两个字段，且不走 v1 迁移（见 §0.1）。`readRunMeta` 会把 v1 记录
经 `migrateRunMetaV1` 补上 `driver`。

**没有猜测、没有两遍、没有不动点、没有循环**——r2 GLM-01 要求定义的「恰好两遍 / 超限失败 /
终态一致性」随之全部消失，不需要那些补丁。

**要定义的回落**（r2 GLM-01 第 ③ 点）：
- 有 `--run-id` → 直接 `readRunMeta` 该条；返回 null（缺失 / 损坏 / schema 不识）→ **硬失败并说明是哪一种**，不静默回落
- 无 `--run-id` 且该阶段一条运行元数据都没有 → 沿用现有文案「请先跑一次双审」
- 无 `--run-id` 但全部 `readRunMeta` 返回 null → **硬失败并点名**，不回落缺省 Driver

**覆盖七处**（r2 GLM-06 更正「六处」）：`cli.ts` 的 `:731`、`:759`、`:762`、`:775`、`:801`、`:866`、`:876`。

**`cmdGate` 仍不加 `--driver` 旗标**——事实来源是留痕不是旗标。新解法让这条更站得住：
从「后缀反推」升成了「留痕直读」。

**EV-58 随之关闭**（原本保留的「两次推断都落空」那一格在新解法里不存在）。

### 6.8 EV-54 写入方

`review.ts:1144` 与 `:1341` 两处 `heterogeneous:` 旁补 `overrideReason`。
承接侧已接通（`render.ts:99` 声明、`:192` 落盘、`:314` 渲染）。

**取值来源**（两处共用同一派生函数）：
- 用户经 `--model-<id>` 显式指定了 claude 系模型 → 「用户经 `--model-<id>` 显式指定」
- 档位默认落到 claude 系 → 「档位 `<profile>` 的默认模型」

T-9 按该来源断言**内容**，不只是非空。

**本步不做** `isHeterogeneous` 的 Driver 感知改造 → **EV-62**。

### 6.9 `isReviewArtifact`：二值谓词（本轮换写法 · 差分 B）

**r2 写「复用 `classifyArtifact`」错在哪**（实读 `freeze.ts:212-248`）：

- 它**无 `export`**，是 freeze.ts 的模块私有函数；
- 它是**三值** `peer-review | own-or-driver | indeterminate`；
- 它为**禁读矩阵**设计，fail-closed，且其注释明写「fail-closed 只用在这里，**不外扩**」
  ——**它自己就禁止了我打算做的事**；
- 搬进 `topic.ts` 会造成分层倒置（`topic.ts → freeze.ts`）；
- 显式路径没有 `role === driver` 前置过滤，`indeterminate` 映射未定义：映射为拒会**误杀
  R-1 自己留的显式逃生门**（换过 Driver 的主题上，`--plan-file` 指向旧 Driver 后缀的原稿）。

**改为**：在已导出的 `parseFrontMatter`（`render.ts:394`）之上写一个**二值**谓词，三处共用：

```
isReviewArtifact(abs): 解析失败 / 无 front-matter / 无 schema → false
                       schema === 'trivium.review.v1'        → true
```

不引入分层倒置、不把 fail-closed 语义带进选原稿语境。
**显式路径的判据明确为「只对 `schema === trivium.review.v1` 硬拒」**，
无 front-matter 的手写原稿一律放行。

**两处候选逻辑同改**：`locateSubjectReadOnly`（`topic-args.ts:520-573`）与
`locateSubject`（`topic.ts:76-119`）。显式路径命中 → 硬拒（`EXIT.MISSING_ARTIFACT`）；
自动候选命中 → 剔除，剔空才抛并列出被剔文件与理由。

**边界已有确定答案**（r2 glm 核实，我复核了 `render.ts:394-403`）：
front-matter 缺失 / 损坏 / 非 UTF-8 / 空文件**四类全部坍缩为「无 schema」且不抛错**。
`parseFrontMatter` 对非 `---` 开头、无闭合 `---`、YAML 解析失败一律返回 null。
**换底不引入崩溃型风险——r2 §11 我担心的那个问题不存在。**

**残余风险如实写**（r2 CODEX-07）：「front-matter 被剥掉或损坏的审查件」这一格，
二值谓词判 false（当原稿），**比 r1 的登记判据弱**——登记判据在这一格是可靠的，只是不完备。
「扛得住明天」收窄为「**对未损坏的留痕**扛得住」。→ **EV-63**。

---

## 7. 风险与边界

| # | 风险 | 处置 |
| :--- | :--- | :--- |
| **R-1** | 换过 Driver 的主题里，日期更晚的审查件排在真原稿前 | 自动候选过滤、显式硬拒；**显式指定旧 Driver 后缀的原稿必须放行**（§6.9），T-5a/T-5b 有该臂 |
| **R-2** | `resolveRerunIndex` 漏传 driver | 代价按 §3.1 的准确版 |
| **R-3** | `report.ts` / `naming.ts` / `hooks.ts` 仍恒取 `DEFAULT_DRIVER` | §2.2 具名。闸门区**已进范围** |
| **R-4** | `:466` 回落与直传 critics 两条绕过路径 | 回落传 driver；防御条只留给直传形态 |
| **R-5** | 落盘层无「driver ∉ critics_selected」机器判据 | EV-59 |
| **R-6** | **唯一真正不可逆**：归档会出现 `driver_enabled: false` 的留痕 | 可选字段、保持 `additionalProperties: true`、不加 if/then |
| **R-7** | `--driver` 进 `STATIC_FLAGS` 后正文里的字面会被吞 | 既有固有歧义；本主题自身是高危语料 |
| **R-8** | **配额**：T-1/T-2/T-11 是每次 `npm run check` 都跑的真子进程用例 | **桩配置必须点名本轮入选的每一侧**——桩只替换点名的侧（`stub.ts`），`gate-loop.test.ts:27` 现有配置是 `{ gemini, glm }`，T-2 选 claude 而配置里没有就会拉真 CLI，**且只在调用之后才由指纹断言暴露，钱已经花了**。T-1 无工件、只断退码与文案 |

---

## 8. 台账

**本轮新登记**：
- **EV-63**：二值谓词对「front-matter 被剥掉或损坏的审查件」判 false（当原稿）。
  建议：主题内出现「后缀等于当轮 Driver、却读不出任何已知 schema」的文件时，
  在 `locateSubject` 出一条可见告警而非静默当原稿。

**本轮关闭**：**EV-58** —— 新取值链不再有「两次推断都落空」这一格。

**保留**：EV-52、EV-55、EV-57、EV-59、EV-61、EV-62；
**EV-60** 补记：r1 的 zcode 轨迹分叉在 r2 **未复现**（r2 glm `read: 23`/`grep: 10`/`evidence_ok: true`），
触发形态改记为「偶发，非稳定复现」。

---

## 9. 不可逆决策

| 决策 | 选择 | 理由 | 回滚方式 |
| :--- | :--- | :--- | :--- |
| `--driver` 校验强度 | 只校验「已登记」 | 校验 `driverEnabled` ⇒ 第 6 步跑不成 | 改一处可收紧；**已落盘的 `driver_enabled: false` 不可回收** |
| `driver_enabled` 契约位置 | 可选、不进 required、不加 if/then | R-6 | **不可逆** |
| **闸门区事实来源** | **直读运行元数据，不从后缀反推，不加旗标** | 后缀反推有循环依赖，r2 已被判阻断 | 可逆 |
| **审查件判据** | **二值 `isReviewArtifact`，基于 `parseFrontMatter`** | 私有三值 fail-closed 判定不外扩（其注释明写） | 可逆 |
| `override_reason` | 只补写入方 | 升机器判据会让历史留痕读不回 | 可逆 |
| `--driver` 不进 skill | 只作 CLI / 编排器内部旗标 | §2.14 | 可逆 |

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

**V1**=T-1｜**V2**=T-2｜**V3**=T-3/T-4｜**V4**=T-6 转执行、跳过数 3→2｜**V5**=T-5a+T-5b（含逃生门臂）｜
**V6**=T-8｜**V7**=T-9（按来源断内容）｜**V8**=T-10（两臂均用注入表）｜**V9**=T-11（含「裁决件未写出」一格）

### 变异验证（逐条对应）

| 改什么 | 哪条必须红 |
| :--- | :--- |
| 删 `cli.ts:470` / `:633` / `topic-args.ts:328` 的 `driver` 实参（三行） | T-4 |
| 删 `review.ts:650` `freeze` 的 `driver` | T-3 |
| 删 `review.ts:776` `newRunMeta` 的 `driver`（**只留 `driverEnabled`**） | T-4（专测约束 3） |
| 删 `writeHandoff` 的 `driver` 传值 / `rebuildContext` 的映射（两行） | T-4 |
| **删 `resolveTaskGoal`（`review.ts:245`）的 `driver`** | T-4 |
| 把 `topic-args.ts` 判据改回 `CRITICS.includes(id)` | T-6 / T-7 |
| 删 `topic.ts` 的 `isReviewArtifact` 过滤 | **T-5b** |
| 删 `topic-args.ts` 的 `isReviewArtifact` 过滤 | **T-5a** |
| 把显式路径判据改成「非 own-or-driver 即拒」 | **T-5a/T-5b 的逃生门臂** |
| 删 `isHeterogeneous(` 旁的 `overrideReason` | T-9 |
| 把预检提示的 `ok` 改成 `false` | **T-10** |
| 把 `checkAdjudication` 的 driver 改回缺省 | **T-11** |
| **在 freeze 实参块里注入 `/* driver, */` 并删掉真实属性位** | **T-3**（专测约束 1 的**整块**剥离——r2 那行「只留注释」是假证明，因 `:670` 注释不含 `,`/`:`，不写剥离逻辑也会红） |
| **把 `driver /* 当轮 */,` 写进实参块** | T-3 **必须仍绿**（合法形态，防止判据被放松回裸词） |

---

## 11. 给审查员的提醒

**请回原文核，不要信本文的概括。** 本轮三处最可能出问题的自证薄弱点：

1. **§6.7 的 `latestRunMeta` 是本轮唯一纯新增的函数，我仍然没有实跑验证。**
   「run_id 是时间戳、字典序即时序」这条我没有核过全部历史 run_id 的形态——
   若某个主题里存在非时间戳形态的 run_id（例如人工改过、或早期版本用过别的生成规则），
   倒序取最新就会取错。**这与我前两轮栽的是同一个坑**：提出一个「复用现成规律」的解法，
   而没核那条规律在全部历史数据上成立。请核 `newRunId()` 的生成规则与归档里的实际取值。
2. **§6.9 把显式路径判据定为「只对 review schema 硬拒」，那么「显式指定一份裁决件」
   （`schema: trivium.disposition.v1`）会被放行当原稿。** 我认为这可接受（用户显式指定，
   且裁决件确实是 Driver 产出），但没有推演过后果——它会让一次审查以裁决件为被审对象。
   请判这是不是一个该堵的口子。
3. **本计划已经连续两轮出现「提出复用 X，而 X 并不提供所需能力」**（r2 的
   `classifyArtifact` 私有且语义不符、r3 §0.1 自查出的 `listRecordedRuns` 不带所需字段）。
   §6.7 与 §6.9 的新方案我都只做了签名级核对，**没有把调用方代码写出来验证一遍**。
   请把这两处当成「最可能还有第三次」的地方来核。

另记两条事实：**r1 的 zcode 轨迹分叉（工具计数全 0）在 r2 未复现**，若本轮再现，
请以断言能否被原文核实为准、不以计数为准。**本轮所有 BACKLOG 编号已重排**：
EV-58 关闭、EV-63 新增，请按 §8 核对而非沿用 r2 的清单。
