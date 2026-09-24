---
schema: trivium.disposition.v1
topic: EV-82-置首修法
stage: plan
role: claude
kind: revised
run_id: 20260924T090216Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - GLM-r2-01
  - GLM-r2-02
  - GLM-r2-03
---

# 裁决：EV-82 第三段（置首修法）· 计划双审第 2 轮

> 被审对象：`2026-09-24-EV-82-置首修法-r2-claude.md`
> ｜ 运行：`20260924T090216Z`（8m15s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve`（零意见） ｜ glm `approve-with-nits`
> ｜ 共 10 条：次要 7 ｜ 吹毛求疵 3 ｜ 零阻断、零重要
> ｜ **全部接受**；同指一组：CODEX-02 ≡ GLM-r2-01（结案表「被采信」行不看判据）

## 0. 本轮的形状

**三侧一致判定成立的**：
- 第 1 轮 24 条逐条真落地；
- 原样支 / 置首支的供数分工，`model_override_full_copy`、EV-94 ②、新事实三者互不串用；
- §4.2 按序表互斥穷尽，`null` 只来自 ① 与 ⑤、一律不覆盖旧值；
- §5 逐路径表与代码一致：codex 核了 9 处拉起点，glm 核了 8 条路径；
- `CriticResult` 新字段在结构上不外溢到 run.json：review.ts 与 guard.ts 都是逐字段挑选，全仓没有整体序列化点。

**意见都在边上**：
- 结案表「被采信」一行免掉了四条判据；
- guard 区分「恒等」只能匹配自由文本；
- 「不进 run.json」没有负向用例锁住；
- 第二段、第一段两份变异规格的失效成因没写全；
- 审查臂一行只在 `config_copy` 路由下成立；
- as-is 支的 `variant` 由谁产出没写；
- doctor 读数能不能否决那次真实派发，没写。

另有一处 codex 在总判断里点到、未编号：决定分支的 doctor 读数存在不进 Git 且每次 doctor 都会覆盖的 `config.local.yaml` 里；判据证据存在 30 天后整删的运行目录里；计划没要求落 evidence。**一并接受**，落点见 §2 第 7 项。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-02 | codex | minor | 接受 | 属实。`honored` 读自哨兵凭据的零配额臂，四条判据才是真实运行唯一的一手证据；「被采信」行不看判据，会把「真实运行跑的不是请求模型」洗成「上游已修」。这与焦点里「判不出被记成修法无效」正好是镜像的另一半 | r3 §7.3：四条判据在**所有**派发分支上先判。`honored` 且四条全满足 ⇒ 按上游修复结案；`honored` 而判据 1 或 2 不满足 ⇒ 「零配额读数与真实运行矛盾」，不结案、报告用户、另立 EV |
| GLM-r2-01 | glm | minor | 接受 | 与 CODEX-02 同指，并点出同表两行不对称：`reorder_ineffective` 不看判据是安全方向（不结案），`honored` 不看判据是结案方向 | 并入 CODEX-02 的落点 |
| CODEX-07 | codex | nit | 接受 | 属实。r2 把 doctor 读数写成「前置」，分支表却写成派发后的归因，没说零配额读数已预示失败时这次真实配额还花不花 | r3 §7.3 把读数写成**派发前的闸**：`reorder_needed` / `honored` ⇒ 派发；`reorder_ineffective` ⇒ **不派发**，报告用户；`null` ⇒ 先补一次 doctor，仍为 `null` 则不派发、报告用户，不记作修法无效 |
| GLM-r2-02 | glm | minor | 接受 | 属实。guard 要区分恒等与其余成因，只能按 `reason` 自由文本做子串匹配；这是跨模块的字符串耦合，文案一改就会静默走错格 | r3 §3.1：`VariantOutcome` 增结构化字段 `kind: 'applied' \| 'identity' \| 'not_movable' \| 'qualify_failed'`，`reason` 保持纯人读。这是搬迁之外**唯一的行为扩展**，写明。§3.4 的守卫通道改为 `{ applied, kind, reason? }`；§4.1 表的判据列改按 `kind`；§7.1 守卫用例按 `kind` 各一条；§7.2 加变异「guard 按 reason 文本分支 ⇒ 改文案后红」不可行，改为「`kind` 赋错 ⇒ 红」 |
| GLM-r2-03 | glm | minor | 接受 | 属实。边界现在只靠「review.ts 不挑它」这条实现纪律守着，而 `run.v2` 的 `$defs.critic` 是 `additionalProperties: true`，泄漏了 schema 也不拦 | r3 §7.1 补负向用例：沿用 `test/integration/code-stage.test.ts` 的逐侧段断言形态，断言置首侧 run.json 逐侧键集不含 `model_override_reorder`。§7.2 加变异「review.ts 透传该字段 ⇒ 红」 |
| CODEX-06 | codex | nit | 接受 | 属实。桩适配器不写 trace.json，集成用例正是拿桩注入 `false`；「一律指向 `modelSelection.reorder`」会在一份没有 trace.json 的留痕上生效 | r3 §4.1：只在 `modelOverrideReorder` **在场**时追加「先看 trace.json 的 `modelSelection.reorder`」与按 `kind` 的那一句；缺席时维持现文（「对照 run.json 的 `model_requested` 与 `model_effective`」） |
| CODEX-04 | codex | minor | 接受 | 属实。r2 说 `variant` 的「唯一来源」是 `prep.reorder`，而原样支的 `prep.reorder` 按定义是 `null`；既有用例断言的正是 `{ variant: 'as-is', applied: true }` | r3 §3.3：原样支的 `variant` 由同形臂自行合成为 `{ variant: 'as-is', applied: true, kind: 'applied' }`，与现状一致；「唯一来源是 `prep.reorder`」限定在置首支 |
| CODEX-03 | codex | minor | 接受 | 属实。审查臂只有建了副本时才用副本 HOME。未指定模型或副本源缺失时 `homeDir: null`，日志回落真实 HOME；并入后，宿主预置时日志从宿主目录改落 `~/.zcode/cli/log`，不在清扫面内 | r3 §5 表把审查臂拆成两行：①建了副本（`config_copy`，或限定失败仍建副本的 `global`）⇒ 副本 HOME，行为如 r2；②未建副本（未指定模型 / 副本源缺失）⇒ 真实 HOME，日志改落 `~/.zcode/cli/log`。第 ② 行写明：这是 CLI 不带该变量时的默认落点，与探活、headless 臂同处；此前落在宿主目录，同样不在清扫面内，所以不比现状更差；不进清扫面是既有残余，登记不修 |
| CODEX-05 | codex | nit | 接受 | 属实，仓库里没有 `probeZcodeVersion`，版本探针在 `probeZcodeEntry` 里 | r3 §5 表改为「版本探针（`probeZcodeEntry` 内）」，并给出文件与行号；裁决件第 1 轮 AGY-05 行的引述不改（历史记录），在 r3 §13 登记更正 |
| CODEX-01 | codex | minor | 接受 | 属实。第二段变异规格不能再跑的成因不止 EV-110：函数搬迁会让 RV1～RV4 的 find 命中 0 次，闸 7 在写盘之前就拒跑；第一段规格的 MF5 引用的正是 §3.2 要改的那一行。只写 EV-110，后来人会把闸 7 的报错读成「规格写坏了」 | r3 §5 末条改写为「历史变异规格的处置」：第一段规格（对应 `7212255`）的 MF5 因 `prepareZcodeHome` 改写失效；第二段两份规格（对应 `c673ba3`）因函数搬迁（RV1～RV6）与常量删除（RS7、原 RN3 一类）失效。三份一律**不改写**，在报告第 8 节补注各自对应的提交与失效成因。第三段规格重新表述这些形态：置首函数的四类变异落在 `adapters/zcode.ts` |

## 2. 修订稿 r3 的改动清单（按节）

| # | 节 | 改动 | 来源 |
| :-- | :--- | :--- | :--- |
| 1 | §3.1 | `VariantOutcome.kind` 结构化成因（搬迁之外唯一的行为扩展） | GLM-r2-02 |
| 2 | §3.3 | 原样支 `variant` 由同形臂自行合成；「唯一来源」限定在置首支 | CODEX-04 |
| 3 | §3.4 / §4.1 | 守卫通道 `{ applied, kind, reason? }`；追加句只在字段在场时出，按 `kind` 分三句 | GLM-r2-02、CODEX-06 |
| 4 | §5 | 审查臂按是否建副本拆两行；版本探针改名 `probeZcodeEntry`；历史变异规格的失效成因写全（第一段 MF5、第二段函数搬迁与常量删除） | CODEX-03、CODEX-05、CODEX-01 |
| 5 | §7.1 / §7.2 | run.json 负向用例；`kind` 各档用例；变异「review.ts 透传该字段」「`kind` 赋错」 | GLM-r2-03、GLM-r2-02 |
| 6 | §7.3 | doctor 读数改为派发前的闸；四条判据在所有派发分支上先判；`honored` 而判据不满足 ⇒ 矛盾，不结案、另立 EV | CODEX-02、GLM-r2-01、CODEX-07 |
| 7 | §7.3 | 验收留痕落 evidence：派发前的 doctor 读数（只取 `zcode.runtime_selection` 与两支读数摘要，不拷整份配置）、该次 run.json 与 trace.json 的判据字段、rollout 逐条核对脚本的输出，一并收进 `doc/05_testing/evidence/ev82-seg3-acceptance-<日期>/` | codex 总判断（未编号） |
| 8 | §13 | 与 r2 的偏差表；登记第 1 轮 AGY-05 行引述的函数名更正 | — |

## 3. 其它登记

- 本轮零阻断、零重要，10 条全是边。r3 的改动面是 §3.1、§3.3～§4.1、§5、§7，不改方向；**建议不再送第 3 轮计划双审**，r3 作定稿，由用户定。
- 台账：本轮记第 11 行（plan r2，10 条）。
