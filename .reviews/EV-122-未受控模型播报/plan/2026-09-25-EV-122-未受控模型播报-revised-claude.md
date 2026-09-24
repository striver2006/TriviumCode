---
schema: trivium.disposition.v1
topic: EV-122-未受控模型播报
stage: plan
role: claude
kind: revised
run_id: 20260924T175141Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - AGY-01
  - AGY-02
  - AGY-03
  - GLM-01
  - GLM-02
  - GLM-03
---

# 裁决：EV-122（未受控模型播报）· 计划双审第 1 轮

> 被审对象：`2026-09-25-EV-122-未受控模型播报-claude.md`（r1）
> ｜ 运行：`20260924T175141Z`（8m54s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 13 条：次要 8 ｜ 吹毛求疵 5 ｜ 零阻断、零重要
> ｜ **接受 12 条，暂缓 1 条（CODEX-05）**。同指三组：CODEX-03 ≡ AGY-01（`requested` 实参取 `req.model`）；CODEX-01 ≡ GLM-02（三家缺口落到 EV-91）；CODEX-07 ≡ GLM-03（设计文档两处落点）

## 0. 本轮的形状

**三侧一致判定成立的**（对应四个焦点）：
- **焦点一 D1 取 (a)**：三侧都认同。(b) 会把「压根没做覆盖」与「做了覆盖没落实」压成同一个 `false`，两者排查方向相反；(c) 违反「判据归适配器、判定层只播报」（`guard.ts:116-117`、设计 :252）。
- **焦点二 误报面**：三侧逐格对过，无误报路径。providerId 两形态、短名与全限定名都归约到同一 modelId 段；「限定失败时回落模型恰与请求同名」是**不播报**（假阴性方向），而且此时实际跑的就是请求的 modelId，不播报在语义上正确。维持原判据。
- **焦点三 可达性**：codex 与 glm 都读完了 `prepareZcodeHome`，确认 `route !== 'config_copy'` 的出口只有三条，① ③ 可达、② 被派发前与预检双拦；codex 另核了调用点，只有审查臂与 doctor 探针臂，后者不进守卫论域。没有第四种情形。
- **焦点四 三家缺口**：codex 与 glm 独立得出同一结论——三家都是「传参、回读、不比对 ⇒ 守卫恒静默」，其中 agy 更深一层（拿不到回读值时用请求值顶替、记 `model_effective_source: 'requested'`），claude 探针的 `model_flag` 在审查路径零消费方。**gemini 在「认为正确的部分」第 4 条判「三侧无同类静默缺口」，不采信**：它的依据是「参数非法会非零退出」，只覆盖了「slug 不认识」这一种换模型，覆盖不到「slug 认识、CLI 却跑了别的」（EV-82 正是这一种）；我复核了 `agy.ts:358` 与 `grep model_flag`（仅声明、缺省值、探针产出四处），与 codex / glm 的读数一致。结论按 CODEX-01 / GLM-02 落进 EV-91，不另立条目，也不扩大本题。

**改动最大的一处**：新字段加结构化成因 `cause`（CODEX-02），守卫文案删掉因果句、按成因给排查指向（CODEX-06）。两条是同一处改动，r2 把它们合在 §3.1–§3.2。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。判断本身（不扩到三家）codex 同意，缺的是登记闭环：r1 §5 只写「EV-122 关闭」，关闭后读者会以为「守卫播报模型失守」已经齐备，而实际 3/4 侧什么都不会说。EV-91 的文本也没覆盖 agy 的「请求值顶替」，也没预见本题会让待通用化的字段变成两个。与 GLM-02 同指 | r2 §2「不做」第 3 条改写为指向 EV-91；§5 BACKLOG 格新增「EV-91 补记」：①codex / claude 回读了 `model_effective` 但不比对；②agy 拿不到 init 模型时以请求值顶替并记 `source: 'requested'`，换模型在留痕里不可见；③claude 探针 `model_flag` 审查路径零消费方（GLM-02）；④待通用化的字段由一个变两个（`model_override_applied` 与 `model_unenforced`），「什么算一次覆盖尝试」的定义要同时回答两者 |
| CODEX-02 | codex | minor | 接受 | 属实。r1 让读者与用例都靠匹配中文散文区分成因，而同一子系统里 `reorderHint` 已经立过「按结构化 kind 分句、不匹配 reason 文案」的口径（`guard.ts:914-925`，r2 GLM-r2-02）；run.json 进 Git 不可回改，成因码日后补不回历史留痕。取建议的第一种：加枚举 | r2 §3.1：`ZcodeHomePrep` 新增 `cause`，取值 `source_missing`、`no_model`、`qualify_failed` 三者之一（`config_copy` 支为 null），由 `prepareZcodeHome` 三个出口各自产出；`model_unenforced` 改为 `{ requested, effective, cause, reason }`，`cause` 只取 `source_missing` / `qualify_failed`；`reason` 只供人读、不参与判定、不保证文案稳定（设计 6.7.1 同写）。§4.1 用例一律断言 `cause`，不断言 `reason` 片段 |
| CODEX-03 | codex | nit | 接受 | 属实，与 AGY-01 同指。本支 `home.qualified` 恒为 null，照抄相邻的 `decideModelOverride` 传参会让新字段恒缺席——正是本题要消灭的静默。`req.model` 与 run.json 的 `model_requested`（`review.ts:1471`）同源，守卫文案里的「请求的是 X」与 run.json 对得上 | r2 §3.1 写明接线实参 `decideModelUnenforced(overrideAttempted, req.model, modelEffective, home.cause, home.reason)`，并注明与 `decideModelOverride` 第二参的差异；§4.2 新增 N7（`requested` 换成 `home.qualified` ⇒ 副本源缺失那格红） |
| CODEX-04 | codex | minor | 接受 | 属实。`checkZcodeRuntimeSelection` 的警告把读者指向「请求的模型没有生效」一条（`preflight.ts:538`）。`reorder_ineffective` 本身只在副本支有意义，指向旧通道对大多数情形是对的；但同一台机器副本源临时缺失时，本轮出声的是新播报，文案指向会落空。两条通道的分工也没写下 | r2 §3.4（新）：该警告的指向句改为「跑完看 guard 的『请求的模型没有生效』或『本次没有做模型覆盖』告警」；§5 设计文档格写明分工：预检那条由 doctor 探针读数驱动、说「大概率」，收尾两条由本次运行回读驱动、说「实际」 |
| CODEX-05 | codex | minor | 暂缓 | 事实属实：① 支在预检期可判定（`authProbe.fingerprint()` 已经取过 `cli/config.json`），收尾播报只能在配额烧完之后出现，E2 那一轮白烧了 16m42s。但「预检期只提示不阻断」是候选 ① ② 之外的第四档，用户 2026-09-25 只定了 ①；按「一句答复只作用于它回答的那一项」，这一档要不要做由用户定，不在本题里自行扩大。codex 的建议本身接受：r1 确实「两不写」 | r2 §2「不做」新增一条，写明「预检期提示本题不做、原因是用户未选、已另行登记」；§5 BACKLOG 格新增 EV-123（候选：副本源缺失时预检给非阻断提示，形态同 `checkZcodeRuntimeSelection`；附 E2 的配额读数作为动机） |
| CODEX-06 | codex | minor | 接受 | 属实，已复核 `zcode.ts:884-899`：③ 支副本已写，`cfg.model` 只在 `q.qualified !== null` 时改，限定失败时副本保留副本源自己的 `model.main`，生效值不是「CLI 自己的默认模型」。r1 §1.3 写的是「副本默认或回落模型」，§3.2 的文案却写成全局默认，自相矛盾，也违背 `selectionNote` 旁「只陈述可观测事实，因果不在这里下」的口径（`zcode.ts:1206-1211`） | r2 §3.2 文案只陈述三件事：请求值、回读值、本次没有做模型覆盖（附 `reason`）；删掉「CLI 用的是它自己的默认模型」。另按 `cause` 追加一句**排查指向**（不是成因断言）：`source_missing` ⇒ 看副本源是否存在；`qualify_failed` ⇒ 看请求的模型名是否在副本源的 provider 目录里。分句按 `cause`，不匹配 `reason` |
| CODEX-07 | codex | nit | 接受 | 属实，与 GLM-03 同指。「覆盖是否落实要可判」原文在设计 :252（§3.3 ZCode 小节的结论与对策清单），§11.3 的 :2467 是措辞不同的同义条目，`run.v2.json` 的 `model_override_applied` 说明是第三处同源表述。r1 只点了一处 | r2 §5 设计文档格点名三处：:252、:2467、`run.v2.json` 第 534 行起的 `model_override_applied` 说明；同步后再按「覆盖是否落实」「只对 `false`」「缺席」三个短语各扫一遍全仓 |
| AGY-01 | gemini | minor | 接受 | 属实，与 CODEX-03 同指 | 同 CODEX-03 的落点（r2 §3.1 接线实参、§4.2 N7） |
| AGY-02 | gemini | nit | 接受 | 属实。r1 文案写死「glm 侧」，而 `guard.ts:871` 的既有告警都用 `${s.critic}`；字段目前只有 zcode 产出，但守卫不该假定这一点（EV-91 通用化后别家也可能产出） | r2 §3.2 文案改为 `${s.critic} 侧…`，模型名与字段名的引用方式沿用 `guard.ts:870-876` 既有告警（反引号） |
| AGY-03 | gemini | nit | 接受 | 属实。`carriers_landed` 对内层声明了 `required`（`run.v2.json:552`、:555），新字段一旦出现，内层缺项就是残缺数据 | r2 §3.3：`model_unenforced` 在 critic 级可选，内层 `required: ["requested", "effective", "cause", "reason"]`，`cause` 为 `enum: ["source_missing", "qualify_failed"]`，`additionalProperties: false` |
| GLM-01 | glm | minor | 接受 | 属实，已复核：`agents.glm.unsupported_override` 只在 `types.ts:947` 声明、`config.ts:320` 给缺省 `reject`，零消费方；EV-30 第 ⑦ 条登记的「接线还是删」待裁。本题的播报在语义上正是 annotate 档在守卫侧的等价物（放行、标注），若将来按缺省把 reject 接上，同一情形会同时有「退 69 拒跑」与「播报放行」两套机制 | r2 §2「不做」新增一条，写明本题与 `unsupported_override` 的关系（本题不接线也不删键）；§5 BACKLOG 格新增「EV-30 ⑦ 补记」：annotate 语义已由 EV-122 的守卫播报承担（不阻断）；reject 若接线，要先定它与 `model_unenforced` 播报的先后，避免两套机制并存 |
| GLM-02 | glm | minor | 接受 | 属实，与 CODEX-01 同指。正确答案是「不另立，EV-91 已覆盖」，但 r1 没点名 EV-91；glm 补的两个事实（claude `model_flag` 零消费方、agy 请求值兜底）我都复核过 | 同 CODEX-01 的落点（r2 §2、§5 EV-91 补记 ①–④）；r2 §6 第 4 条改为已答复并引 EV-91 |
| GLM-03 | glm | nit | 接受 | 属实，与 CODEX-07 同指。两侧对 :252 所在小节的说法不同（codex 说 §3.3，glm 说 §1.2），我按标题复核：:252 位于「### 3.3 ZCode」（:230 起）之下 | 同 CODEX-07 的落点（r2 §5 点名 :252（§3.3）、:2467（§11.3）与 `run.v2.json` 三处） |

## 2. 修订稿 r2 的改动清单（按节）

| # | 节 | 改动 | 来源 |
| :-- | :--- | :--- | :--- |
| 1 | 稿首 | 性质栏补一句：字段带结构化成因 | CODEX-02 |
| 2 | §1.2 | C1 补各出口的 `cause`；新增 C8（③ 支生效值来自副本源 `model.main`）、C9（预检已有同族非阻断通道） | CODEX-02、CODEX-06、CODEX-04 |
| 3 | §2 | 「不做」改写：三家缺口指向 EV-91；预检期提示登记 EV-123；与 `unsupported_override` 的关系 | CODEX-01、GLM-02、CODEX-05、GLM-01 |
| 4 | §3.1 | 字段加 `cause`；`ZcodeHomePrep` 加 `cause`；接线实参写明取 `req.model` | CODEX-02、CODEX-03、AGY-01 |
| 5 | §3.2 | 文案：`${s.critic}` 占位、只陈述事实、按 `cause` 给排查指向 | CODEX-06、AGY-02 |
| 6 | §3.3 | schema 内层 `required` 与 `cause` 枚举 | AGY-03、CODEX-02 |
| 7 | §3.4（新） | 预检警告的指向句 | CODEX-04 |
| 8 | §4.1 | 用例断言 `cause` 而非文案；`prepareZcodeHome` 三出口的 `cause` 各一格；守卫两种 `cause` 各一格 | CODEX-02、CODEX-06 |
| 9 | §4.2 | 新增 N7（接线取错实参）、N8（守卫改按 `reason` 文案分句 ⇒ 注入任意 `reason` 的两格红）、N9（③ 出口 `cause` 填错） | CODEX-03、CODEX-02 |
| 10 | §4.3 | 写明 run.json 里没有 `reason`，验收脚本现跑 `prepareZcodeHome`（`srcConfig` 指向不存在路径，早退、零写入）取 `cause` 与 `reason` | codex「认为正确的部分」第 5 条 |
| 11 | §5 | 设计文档三处落点与短语扫描；RUNBOOK 按 `cause` 分行；BACKLOG 四格（EV-122 关闭、EV-91 补记、EV-30 ⑦ 补记、EV-123 新登记） | CODEX-07、GLM-03、CODEX-01、GLM-01、CODEX-05、CODEX-04 |
| 12 | §6 | 重点改写：四个焦点已答复，保留新增部分请审 | — |
| 13 | 文末 | 与 r1 的偏差表 | — |

## 3. 其它登记

- **是否送第 2 轮计划双审，由用户定。** 我的建议是不送、r2 作定稿：本轮零阻断零重要，四个焦点三侧（焦点四是两侧）一致；r2 的新增内容是一个两值枚举、一句预检文案、四格 BACKLOG 登记，都是审查员自己提出的形态，接口面变化只有 `cause` 一个字段。它会在代码双审里第一次被看到，那一轮足以兜住。若用户倾向稳妥，再送一轮也只是 plan 1 轮的量级。
- **CODEX-05 暂缓项请用户定**：EV-123（副本源缺失时预检给非阻断提示）要不要做、并进本题还是另起，是一个独立的范围决策，r2 只登记不实施。
- 编排器收尾提示两条都属 codex 侧既有能力边界（被拒写操作不进轨迹、读取路径只在命令文本里），与 EV-112 各轮同形，不影响本轮结论，只记录。
- 台账：EV-122 的轮次不进 M10b 累计与阈值，本轮耗时 8m54s。
