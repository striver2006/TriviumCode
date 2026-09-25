---
schema: trivium.disposition.v1
topic: EV-123-预检提示副本源缺失
stage: plan
role: claude
kind: revised
run_id: 20260924T232734Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
---

# 裁决：EV-123（预检提示副本源缺失）· 计划双审第 2 轮

> 被审对象：`2026-09-25-EV-123-预检提示副本源缺失-r2-claude.md`（r2）
> ｜ 运行：`20260924T232734Z`（10m56s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 14 条：次要 10 ｜ 吹毛求疵 4 ｜ 零阻断、零重要
> ｜ **14 条全部接受**。同指四组：CODEX-03 ≡ AGY-03 ≡ GLM-01（契约用例漏 dual-run）；CODEX-04 ≡ AGY-02 ≡ GLM-03（warn 口径漏 slug 的内嵌 ⚠️ 行）；CODEX-05 ≡ GLM-02（§8.1 表里没有要「标注」的行）；CODEX-01 ≡ GLM-04 ≈ AGY-01（`--start` 那一路的注入与 JSON 层没有咬合点）

## 0. 本轮的形状：用户的五个焦点

- **焦点一 (a′) 可选成员判侧**：**三侧一致站得住。** 与 `authProbe?` / `normalizeModelForCatalog?` / `catalogModelsFor?` 同形，判侧由能力承担，不写厂商字面量，不需要 parity 豁免。唯一的纠正是论据里的一处事实错：`availability` 是必选成员，不是可选（CODEX 认为正确部分 ≡ GLM-05），不影响取舍。
- **焦点二 `--start` 复用的位置与边界**：**边界三侧一致成立；位置要写死，注入口要补。** 「派生之后才念出、拦不住拉起」与代码一致；B / C / D 下念两次三侧都接受。但 r2 只写了「`checkModelSlugs` 之后、派生之前」，而 `checkModelSlugs` 在共享的 `prepareRun` 里，纯文档跳过分支在 `startRun` 里、`prepareRun` 之后——两种读法在同步 `review` 与 `finished_inline` 上行为不同（CODEX-02）。r3 写死为 **`startRun` 内、跳过分支之后、写交接文件之前**，同步 `review` 不提示写成明确取舍。r2 说「与 C10 同形」也不准确：C10 是共享代码里的唯一调用点，本题是同一函数在两个入口各调一次——措辞改掉。另外 `startReview` 这个名字在代码里不存在，改为 `startRun`（GLM-04）。
- **焦点三 新措辞**：**三侧一致：无越界断言。** codex 与 glm 逐句对过 `decideModelUnenforced` 的四条件与 guard 原文（`guard.ts:892`「本次没有做模型覆盖」逐字吻合）。不改。
- **焦点四 warn 口径**：**误纳为零，漏纳一族，三侧同指。** 按「detail 以 ⚠️ 开头」划界，漏掉 `checkModelSlugs` 通过项里第二、三行的 ⚠️（「无模型目录可比对、未实际校验」「已回落到基底目录校验」）。这正是「没测到 ≠ 测通过」，真实预检可达。codex 还点出 `checkCliVersions` 的「入口在位（版本未校验）」。r3 把口径从文案前缀改成语义判据，并加一条机器断言顶住下一次新增 ⚠️ 项（§2 下的 §3.3）。
- **焦点五 用例、变异与验收能否咬住三处新增**：**能咬住两处，`--start` 那一处咬不住。** 可选成员判侧（P1、P2、世界 A/B）与预检 JSON 映射（P8）三侧都认可。`--start` 那一处：r2 说「注入带该成员的假适配器」，但 `--start` 路径上唯一的注入通道是 `TRIVIUM_STUB_CRITIC`，桩适配器不实现任何可选钩子（CODEX-01、GLM-04）；`cli.ts` 里 `--start` 的 `emitJson` 也是手写映射，没有用例与变异（AGY-01）。r3：桩适配器按注入配置实现该成员，经真实子进程跑 `review --start --json`（全桩、零配额），补 P10。契约用例的谓词覆盖不到 dual-run 的委托写法（三侧同指），r3 改为对 dual-run 单独断言。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。我复核了 `review.ts:538`（`prepareRun` 取 `resolveAdapters(realAdapters())`，`ReviewOptions` 无适配器口子）、`stub.ts:140-151`（跨进程注入只有 `TRIVIUM_STUB_CRITIC` 一条通道）与 `stub.ts:250-265`（`makeStubAdapter` 只给 `capability` / `availability` / `run`）。r2 的「注入假适配器」在 `--start` 这一路上无从实现，P9 因此杀不死；`--start` 的 JSON 也没有变异。与 GLM-04 同指，与 AGY-01 同源 | r3 §2 做清单新增：桩注入配置 `StubSpec` 加可选字段（覆盖源路径），`makeStubAdapter` 在该字段存在时实现 `modelOverrideSource`；r3 §4.1 `--start` 用例改为真实子进程 `review --start --json`（三侧全桩、HOME 钉到 mkdtemp，零配额）；r3 §4.2 新增 P10（删掉 `cli.ts` `--start` JSON 里的 `warnings`） |
| CODEX-02 | codex | minor | 接受 | 属实。`checkModelSlugs` 在 `prepareRun` 内（`review.ts:581`），同步 `review` 与 `--start` 共用；FR-23 跳过分支在 `startRun` 内、`prepareRun` 之后（`run-protocol.ts:316-334`）。两种落点对三条路径的行为不同，r2 没写死。取「`startRun` 内、跳过分支之后」：`finished_inline` 天然不算（没有审查员会被拉起，`[]` 是正确答案而不是「算出又丢」）；同步 `review` 是手工调试入口，skill 不走它，若要带出须动 `RunContext` 与 `ReviewOutcome`（后者 `warnings` 是 `string[]`，不同形），换来的只是一条手工路径——明确不做。「与 C10 同形」改掉 | r3 §3.3 (c′)：落点写死为 `startRun` 中跳过分支之后、`ensureDir` / `writeHandoff` 之前，以 `rc.sides`、`rc.adapters` 调用；三条路径的期望逐条写明：`--start` 正常支出 `warnings`；`finished_inline` 支为 `[]`（不计算）；同步 `review --stage` 不提示（明确取舍，收尾 guard 仍在）。§1.2 C10 改写为「同一函数、两个入口各调一次；C10 是共享 `prepareRun` 里的单一调用点，形态不同」；worker 走 `rebuildContext`、不经 `startRun`，不会重复计算 |
| CODEX-03 | codex | minor | 接受 | 属实。`skills/dual-run/SKILL.md` 不含 `review --start` 字面，S2 写的是「按 `/dual-review-plan` 的第 3 步执行 `--start` / `--wait` 循环」；而它 :66-69 已有一句「开场播报……随委托一并继承」，本来就是承载开场播报的那一句。r2 另写「同上」既重复，又落在谓词之外。与 AGY-03、GLM-01 同指 | r3 §3.4：dual-run 不另写「同上」，改为在既有的继承句里点名 `warnings`（「开场播报（含 `warnings` 的逐条转述）与每次 `--wait` 后的进度播报，随委托一并继承」）；r3 §4.1 契约用例对 dual-run 单独断言该句（仿 `skill-flag-parity.test.ts` 对 dual-run 的专属正则先例），P7 的击杀范围写准 |
| CODEX-04 | codex | minor | 接受 | 属实。`preflight.ts:348-354`：`checkModelSlugs` 通过项首行是规模，第二、三行才是 ⚠️，按 r2 口径不进 `warnings`；这正是本项目反复治的「没测到 ≠ 测通过」，真实可达。按文案前缀划界，与 r2 自己否掉的 (b)「按文案判语义」是同一件事。`preflight.ts:270` 的「入口在位（版本未校验）」同族，但它已由「版本漂移检查覆盖面」汇总念出，再标会重复。误纳方向三侧都没找到反例。与 AGY-02、GLM-03 同指 | r3 §3.3 口径改为语义判据：**通过项在说「本次有一部分没检查到 / 没按请求做到」时标 `warn`**。纳入：C5、版本漂移覆盖面、探活已跳过、`checkModelSlugs`（`unverifiable` 或 `fellBack` 非空时由代码置 `warn`，不看文案）；**有意不纳入**：各「X 可调用」项的「入口在位（版本未校验）」（已由覆盖面项汇总，再念是重复）、「当轮 Driver」（信息）。r3 §4.1 加机器断言：凡通过项 detail 任一行（去缩进后）以 ⚠️ 起头，必带 `warn`；§4.2 加 P11 |
| CODEX-05 | codex | nit | 接受 | 属实。设计 §8.1 表（:1448-1457）只有八行，没有「版本漂移检查覆盖面」「探活已跳过」，r2 的「标注两行」找不到落点。与 GLM-02 同指 | r3 §5：§8.1 表**新增四行**——ZCode 运行期选模（C5，C8 的欠账）、版本漂移检查覆盖面、探活已跳过（`--skip-auth-check`）、模型覆盖副本源（新检查），「失败处理」列均写「只警告、不中止（`warn`，进 `warnings`）」；**改一行**：「模型 slug 合法」行补「无目录可比或回落基底目录时通过但带 `warn`」。表中按两家时代写的 Antigravity / ZCode 行的陈旧写法不在本题 |
| AGY-01 | gemini | minor | 接受 | 属实（`cli.ts:629-652`）：`--start` 的 JSON 也是逐字段手写，r2 只给预检补了子进程用例与 P8，`--start` 漏加 `warnings` 时整条测试链全绿，而 §4.3 又写明 `--start` 没有真实验收。与 CODEX-01 同源 | 同 CODEX-01 的落点：r3 §4.1 真实子进程 `review --start --json`（全桩）断言 `warnings` 键在且内容正确；§4.2 P10 |
| AGY-02 | gemini | minor | 接受 | 与 CODEX-04 同指（`preflight.ts:345-355`）。gemini 建议「当且仅当 `unverifiable.size > 0 \|\| fellBack.size > 0` 时置 `warn`」，r3 正是这样做，由代码置位、不看文案 | 同 CODEX-04 的落点（r3 §3.3 口径、§4.1 断言、§4.2 P11） |
| AGY-03 | gemini | nit | 接受 | 与 CODEX-03 同指 | 同 CODEX-03 的落点（r3 §3.4、§4.1） |
| AGY-04 | gemini | nit | 接受 | 属实（`cli.ts:654-656`）：`--start` 人读分支只打印四行，r2 没说 `warnings` 在终端怎么显示；人工调试时告警会静默丢失 | r3 §3.3：`--start` 人读分支在 `warnings` 非空时，逐条打印 `⚠ <detail>`；§4.1 的 `--start` 子进程用例加一臂（不带 `--json`，断言输出含 `⚠` 行） |
| GLM-01 | glm | minor | 接受 | 与 CODEX-03 同指。glm 另外点出被引为先例的 `skill-flag-parity.test.ts` 对 dual-run 恰好不走字面谓词，而是改用专属正则（:139-162）——r3 照这个先例做 | 同 CODEX-03 的落点。P7 的击杀范围写为：三个 `dual-review-*` 各两句、dual-run 的 S0 句与继承句 |
| GLM-02 | glm | minor | 接受 | 与 CODEX-05 同指。glm 指出这两项与 C8 同族、属设计欠账，r2 只识别了 C5 一处 | 同 CODEX-05 的落点；r3 §1.2 C8 改写为「§8.1 表缺 C5、版本漂移覆盖面、探活已跳过三行」 |
| GLM-03 | glm | minor | 接受 | 与 CODEX-04 同指。glm 另外核实了「该侧未实现探活，本项未检查」四家真实适配器都实现 `authProbe`，只在桩模式可达，不算漏项——采信，r3 不纳入它 | 同 CODEX-04 的落点；设计「警告这一级」段落同步写入该边界（r3 §5） |
| GLM-04 | glm | minor | 接受 | 属实。全 src 无 `startReview`，`--start` 的编排函数是 `run-protocol.ts:281` 的 `startRun`；注入通道问题与 CODEX-01 同指 | r3 §3.3、§4.1、§4.2 一律改称 `startRun`；注入通道同 CODEX-01 的落点 |
| GLM-05 | glm | nit | 接受 | 属实（`base.ts:94`：`availability(ctx)` 无问号）。codex 在「认为正确的部分」里也指出了同一处。不影响 (a′) 的结论 | r3 §1.2 C12 改为「preflight 已在消费四个逐侧钩子：`availability` 为必选成员，`authProbe?` / `normalizeModelForCatalog?` / `catalogModelsFor?` 为可选成员」 |

## 2. 修订稿 r3（在 r2 基础上的改动，按节）

### §1.2 现状核实

- **C8** 改为：设计 §8.1 的预检检查表缺 C5、「版本漂移检查覆盖面」、「探活 已跳过」三行（同族欠账，EV-82 第三段起累积）。
- **C10** 改为：`--start` 已在派生之前复用预检的判定函数 `checkModelSlugs`——它是共享 `prepareRun` 里的**单一**调用点，同步 `review` 与 `--start` 都经过。本题不同：同一个函数在预检与 `startRun` **两个入口各调一次**。共同点只在「不写第二份判据」。
- **C11** 改为：通过项上的「没测到」提示共五处——C5、版本漂移覆盖面、探活已跳过三条以 ⚠️ 起头；`checkModelSlugs` 通过项的第二、三行内嵌 ⚠️（`preflight.ts:348-354`）；各「X 可调用」项的「入口在位（版本未校验）」（:270，无 ⚠️，已由覆盖面项汇总）。
- **C12** 改为：四个逐侧钩子里 `availability` 是必选成员，`authProbe?` / `normalizeModelForCatalog?` / `catalogModelsFor?` 为可选成员（`base.ts:94`、:103、:127、:132）。
- **新增 C15**：`--start` 的编排函数是 `run-protocol.ts:281` 的 `startRun`；FR-23 跳过分支在它内部、`prepareRun` 之后（:316-334）。worker 走 `rebuildContext`，不经 `startRun`。
- **新增 C16**：跨进程注入适配器只有 `TRIVIUM_STUB_CRITIC` 一条通道（`stub.ts:140-151`、`resolveAdapters` :480-496）；桩只实现 `capability` / `availability` / `run`（:250-265）。
- **新增 C17**：`cli.ts` 里 `--start` 的 JSON 与人读输出都是逐字段手写（:623-656），当前无 `warnings`。

### §2 范围 · 做

在 r2 六条之外新增：

7. 桩注入配置 `StubSpec` 加可选字段（覆盖源路径，字段名随 `StubSpec` 现有风格）；`makeStubAdapter` 在该字段存在时实现 `modelOverrideSource`，返回该路径。它只服务测试，与桩的其它可配置形态同一性质（C16）。
8. `checkModelSlugs` 在 `unverifiable` 或 `fellBack` 非空时给通过项置 `warn`。

### §3.3 警告这一级与转述通道

**口径（替换 r2）**：通过项在说「本次有一部分没检查到 / 没按请求做到」时标 `warn`。判定由产出该项的代码置位，**不看文案**。

| 项 | 标 `warn` | 理由 |
| :--- | :--- | :--- |
| C5 运行期选模 | 是 | 本次该侧大概率跑不到请求的模型 |
| 版本漂移检查覆盖面 | 是 | 有 CLI 本次没比对版本 |
| 探活已跳过（`--skip-auth-check`） | 是 | 凭据本次没验 |
| 模型 slug 合法（`unverifiable` 或 `fellBack` 非空时） | 是 | 有侧没实际校验、或按基底目录校验 |
| 模型覆盖副本源（新检查） | 是 | 该侧可能不做覆盖 |
| 「X 可调用」的「入口在位（版本未校验）」 | **否** | 已由覆盖面项汇总念出，再标会重复 |
| 当轮 Driver | **否** | 信息，不是缺口 |
| 「该侧未实现探活」 | **否** | 四家真实适配器都实现 `authProbe`，只在桩模式可达 |

`⚠️` 只是展示。加一条机器断言顶住下一次新增：**凡通过项 detail 任一行（去缩进后）以 ⚠️ 起头，必带 `warn`**（§4.1）。

**(c′) `--start` 复用（替换 r2 的落点句）**：
- 落点：`startRun` 内，FR-23 跳过分支**之后**、`ensureDir(rc.runDirBase)` / `writeHandoff` **之前**，以 `rc.sides`、`rc.adapters` 调 `checkModelOverrideSource`。`rc.adapters` 已经过 `resolveAdapters`，桩注入自然生效。
- 三条路径的期望：
  - `--start` 正常支：结果进 `StartOutcome.warnings`，JSON 恒带 `warnings` 键；人读分支在非空时逐条打印 `⚠ <detail>`（AGY-04）。
  - `finished_inline` 支：不计算，JSON 的 `warnings` 为 `[]`。没有审查员会被拉起，`[]` 是正确答案。
  - 同步 `review --stage`（手工调试入口）：**不提示**，明确取舍。skill 不走它；要带出须动 `RunContext` 与 `ReviewOutcome`（`warnings: string[]` 不同形），代价与收益不相称；收尾 guard 仍在。
- 「与 C10 同形」一句删去，改为「同一个函数、两个入口，不写第二份判据」。
- 全文 `startReview` 改为 `startRun`。

### §3.4 skill 的转述约定

- 第 1 步：不变（三个 `dual-review-*` 第 1 步、dual-run S0）。
- 第 3 步开场播报：三个 `dual-review-*` 的第 3 步补句，不变。
- **dual-run（替换 r2 的「S2 / S6 显式写一句同上」）**：不另加句子，改写既有的继承句（`skills/dual-run/SKILL.md` :66-69），在其中点名 `warnings`：「**开场播报（含 `warnings` 的逐条转述）与每次 `--wait` 后的进度播报，随委托一并继承**……」。

### §4.1 用例（改动项）

- **`--start`（替换 r2）**：真实子进程跑 `review --start --stage plan --json`，三侧全桩（零配额），glm 桩带覆盖源路径，子进程 HOME 钉到 mkdtemp，路径取 `<临时 HOME>/.zcode/cli/config.json`。先例：`test/integration/no-artifacts.test.ts:117` 的桩注入 `--start`。
  - 文件不在 ⇒ `warnings` 恰一项，detail 含 `~/.zcode/cli/config.json`、不含临时 HOME 的绝对路径；
  - 文件在 ⇒ `warnings` 为 `[]`（键在）；
  - `--critics` 不含 glm ⇒ `[]`；
  - 同一场景不带 `--json` ⇒ 输出含 `⚠` 行；
  - 沿用既有 FR-23 纯文档跳过用例，补断言 `warnings` 为 `[]`。
- **口径断言（新增）**：在 `runPreflight` 的各用例场景上统一套一个检查：凡 `ok: true` 且 detail 任一行去缩进后以 ⚠️ 起头的项，必带 `warn: true`。另加一个场景，让 `checkModelSlugs` 出 `unverifiable`（探针目录为空的侧）⇒ 该项 `warn: true`、进 `warnings`。
- **skill 文本（替换 r2 的谓词）**：
  - 含 `preflight --stage` 的 `SKILL.md` 必须有第 1 步转述句（覆盖三个 `dual-review-*` 与 dual-run S0）；
  - 含 `review --start` 的 `SKILL.md` 必须有开场播报转述句（三个 `dual-review-*`）；
  - dual-run 单独断言：继承句同时含「开场播报」「`warnings`」「随委托一并继承」（仿 `skill-flag-parity.test.ts` :139-162 对 dual-run 的专属正则）。

### §4.2 变异（改动项）

- P7 击杀范围写准：删掉任一 `dual-review-*` 的第 1 步句或开场播报句、dual-run 的 S0 句、或 dual-run 继承句里的 `warnings` ⇒ contract 用例红。
- P9 改为：`startRun` 不调新检查 ⇒ `--start` 子进程用例红。
- **P10（新增）**：删掉 `cli.ts` 中 `--start` JSON 的 `warnings` ⇒ `--start` 子进程用例红。
- **P11（新增）**：`checkModelSlugs` 在 `unverifiable` 非空时不置 `warn` ⇒ 口径断言红。
- **P12（新增）**：`makeStubAdapter` 忽略覆盖源字段 ⇒ `--start`「文件不在 ⇒ 一项」红。它确认用例真的穿过了桩注入链，而不是碰巧绿。

### §4.3 验收

不变。补一句：`--start` 那一路虽无真实验收，但已由全桩的真实子进程用例覆盖到 CLI 层，只有真实 zcode 适配器的 `modelOverrideSource` 返回值由单元用例（等于 `zcodeOverrideSourcePath()`）与 E2 / E3 覆盖。

### §5 文档同步（改动项）

- 设计 §8.1：**新增四行**（ZCode 运行期选模、版本漂移检查覆盖面、探活已跳过、模型覆盖副本源），「失败处理」列均写「只警告、不中止（`warn`，进 `warnings`）」；**改一行**「模型 slug 合法」，补「无目录可比或回落基底目录时通过但带 `warn`」。表下「警告这一级」段写入 §3.3 的口径表（含三条「有意不纳入」及理由）。
- PROTOCOL §九 `review --start` 行补：`warnings` 只在 `--start` 正常支计算，`finished_inline` 为 `[]`，同步 `review` 不提示。
- 其余不变。

### §6 量级

实现量约 110 行（r2 约 90 行，加桩字段、`checkModelSlugs` 置位、`--start` 人读分支）。用例在 r2 八组之上，`--start` 改为子进程并加口径断言。

## 3. 其它登记

- codex「未覆盖范围」：E2 从 `dist/test/` 导入，要先跑过 `npm test`（pretest 带 `--with-tests`）或 `build.mjs --tests-only`，单独 `npm run build` 不产出 `dist/test/`。r3 §4.3 的 E2 前置写明这一步（EV-82 的变异循环要用 `build.mjs --tests-only` 重编 `dist/test`，是同一个坑）。
- gemini「未覆盖范围」：读 `~/.zcode/cli/config.json` 遇到 EACCES 的边界。`checkModelOverrideSource` 只判存在（`exists`），权限问题在拉起时由 `prepareZcodeHome` 另行暴露，本题不处理。
