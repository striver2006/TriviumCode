---
schema: trivium.disposition.v1
topic: M11-配置契约与档位解析
stage: plan
role: claude
kind: revised
run_id: 20261007T130746Z
addresses:
  - 2026-10-07-M11-配置契约与档位解析-codex.md
  - 2026-10-07-M11-配置契约与档位解析-gemini.md
  - 2026-10-07-M11-配置契约与档位解析-glm.md
---

# 裁决：M11-配置契约与档位解析 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-07-M11-配置契约与档位解析-claude.md`（原稿，起点 `951dc8d7`）
> ｜ 运行：`20261007T130746Z`（25 分 21 秒）
> ｜ 结论：codex `approve-with-nits`（次要 4、吹毛求疵 1）｜ gemini `request-changes`（重要 2、次要 1）｜ glm `approve-with-nits`（次要 4、吹毛求疵 2）
> ｜ 共 14 条：接受 14、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-07-M11-配置契约与档位解析-r2-claude.md`

每条都回原文或源码核过，核对结果写在「理由」列。三侧对焦点的核心结论独立一致：五条取值规则与 11.5 字面对得上、过渡闸对今天能跑的配置零误拦、P-4 的「现行退 64、69 分支不可达」属实、`routeModel` 的调用点 / 测试 / 注释清单与全仓 grep 一致。

重合三组：CODEX-01 ≡ GLM-03（PROTOCOL 废弃键段漏同步）；AGY-02 ≡ GLM-02（glm 的 `{model, effort}` 格子 schema 拦不住、运行期要兜）；CODEX-04 与 AGY-02 / GLM-02 同指 zcode 支收紧（前者是设计回补，后者是运行期兜底，各自成立）。

**AGY-01 改的是 11.5 的取值规则**（契约变更）：我按它接受，但已把它列为 r2 §2 的待拍板项 P-6，交用户确认；用户若不取，本条改为驳回、r2 回到原稿的字面读法。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：`doc/03_api/PROTOCOL_dual_critic_relay.md:90-93` 的「已废弃键」段逐条枚举 `gate.max_check_retries` 与 `agents.〈id〉.readonly_commands` 两条；核对时发现它**本来就已过期**——EV-30 ②③（`review.parallel`、`isolation.deny_via_cli`，设计 v1.3.122）也没补进去。再加第五条只会继续漂 | r2 §4.1 补 PROTOCOL：该段改为列出全部五条（含来源编号）并点名机制在 `DEPRECATED_CONFIG_KEYS`；顺手核该节有无随三形态放开而失准的形状措辞 |
| CODEX-02 | codex | minor | 接受 | 属实：`test/unit/probe-fixture-cleanup.test.ts:219-233` 与 `test/unit/fixture-repo-init.test.ts:342-346` 的假 codex `debug models` 只吐 `{slug, visibility: 'list'}`，没有 `supported_reasoning_levels` 也没有 hide 项；原稿写「沿用」不成立 | r2 §5.1 探针用例改为「扩写既有假 codex 的 `debug models` 输出」：加逐模型 `supported_reasoning_levels` 与一条 `visibility: hide` 项；§4 改动面 test 行列明夹具扩写 |
| CODEX-03 | codex | minor | 接受 | 属实：现行 `config.v2.json:464-493` 的 `plan/code/bug` 只有 `type: string`、无 `minLength`；空串 slug 今天能加载、在 slug 校验处退 64（`routeModel` 对空串 falsy），原稿给裸 slug 形态加 `minLength: 1` 会让它改为加载期退 69，违背「裸 slug 行为逐字不变」。取审查员倾向的 ① | r2 §3.1：`stageModel` 的裸 slug 形态保持 `type: string`、不加 `minLength`；新形态（`{tier}`、`{model, effort}`、档位条目的 `model`）照常 `minLength: 1`（无旧配置包袱）；§5.1 加一格「空串 slug 仍可加载、预检退 64」 |
| CODEX-04 | codex | minor | 接受 | 属实：主设计 11.5 :2942 写每档统一形状 `{model, effort?, profile?}`，原稿 §4.1 的 11.5 更新清单没回补「zcode 支不收 effort、profile 只在 openai 支」，落地后正文与 schema 分叉 | r2 §4.1 的 11.5 更新项补：数据模型句写明分支不对称（zcode 支档位条目只有 `model`；`profile` 只在 openai 支放行），并写理由 |
| CODEX-05 | codex | nit | 接受 | 属实：过渡闸只比档位 profile 与 `agents.codex.profile`；按 13.1.1 现行出口在本机层同批覆盖 `agents.codex.profile` 与模型时两者相等，闸不触发，换家族第 4 步即可端到端跑通。原稿「第 6 步才可用」过宽 | r2 §3.7 与 BACKLOG EV-27 状态句拆两半：两键同改（13.1.1 现行出口）第 4 步可用；只整段覆盖 `tiers` 一处（D-2 形态）待第 6 步拆闸 |
| AGY-01 | gemini | major | 接受（契约变更，待用户确认 P-6） | 属实：主设计 6.7.1 :1262 定义 `override` 为「精确值覆盖了档位提供的全部字段，**或模型完全来自 `--model-〈id〉`**」，后半句不限「第一段无命中」；11.5 :2952 的第 5 条却限了。两处本身不一致。按 11.5 字面，裸 slug 被 `--model-gemini` 覆盖后 `tier_source` 记 `legacy`，而那一侧的模型完全由命令行给出——留痕会把命令行的选择归因给旧配置；今天 `routeModel` 对同一情形记 `cli`。统一成「基础组合提供的字段被精确值全部覆盖 ⇒ `override`」后，第 2 条成为它的特例，与 6.7.1 两半句都对得上 | r2 §3.3 取值表改为四条（档位、`{model, effort}` 格子、裸 slug 三种基础形态共用「全覆盖 ⇒ `null` / `override`」，第一段无命中 ⇒ `override`）；「基础组合提供的字段」按实际给出的键计——裸 slug 只提供 `model`，gemini 回落的 `agents.gemini.effort` 是补全、不算基础组合提供；§4.1 11.5 :2952 与 6.7.1 :1262 同步改写；§5.1 矩阵按新规则；列为 r2 §2 P-6 |
| AGY-02 | gemini | major | 接受 | 属实：`profiles.〈表〉.〈id〉` 的 id 层是自由键（`config.v2.json:464-493`），schema 无法按 vendor 选分支，glm 格子写 `{model: GLM-5.3, effort: high}` 能过 schema；过渡期有闸拦，第 6 步拆闸后会成为「合法写入、运行期静默丢弃」 | r2 §3.4 校验表新增「该侧无思考等级概念而解析出 effort 非空 ⇒ 退 64，提示该审核者不支持思考等级」一格，排在过渡闸之前、属永久判据；「无此概念」由适配器钩子声明（见 AGY-03 落点），不按 Agent id 判 |
| AGY-03 | gemini | minor | 接受 | 属实：`preflight.ts:409-438` 与 `adapters/base.ts` 的注释立了「厂商特有知识住在适配器、preflight 按通用钩子判」的纪律（`catalogModelsFor` 先例）；原稿让 preflight 直接读 `probe.cli.codex.reasoning_levels` 与 `probe.cli.agy.models` 并按 vendor 分派，违背它 | r2 §3.4：`CriticAdapter` 增可选钩子 `reasoningLevelsFor(cfg, model, vendorProfile)`，返回三态 `{kind: 'none'}`（无此概念）/ `{kind: 'levels', levels}` / `{kind: 'unknown', why}`；codex 适配器读探针、antigravity 适配器做后缀派生、zcode 适配器返回 `none`、claude 适配器返回 `unknown`（P-2 A）；钩子缺席按 `unknown`。preflight 与 `review` 只调钩子 |
| GLM-01 | glm | minor | 接受 | 属实：`review.ts:1181` 请求构造处 `effort: effortFor(cfg, critic, stage)` 与路由来源无关；gemini 档位条目只写 `model`（slug 不带档位后缀）时，解析 effort 为 null，运行期却下传 `agents.gemini.effort[阶段]`。slug 带后缀时 agy 适配器本就不传 `--effort`（`adapters/agy.ts:84-97`），不构成偏差。它拦不得（拦了就杀掉档位换模型），按建议登记为过渡残余 | r2 §2 P-1 与 §7 登记该残余；§3.4 加一条**非阻断告警**：antigravity 侧基础组合非裸 slug、解析 effort 为 null、而模型不带档位后缀时，预检与 `--start` 告警「过渡期仍按 `agents.gemini.effort` 下传 〈值〉，第 6 步起不下传」；§6 问法同步改为「两类拦、一类告警」 |
| GLM-02 | glm | minor | 接受 | 与 AGY-02 同一缺口，属实（见上） | 同 AGY-02 |
| GLM-03 | glm | minor | 接受 | 与 CODEX-01 同一缺口，属实（见上） | 同 CODEX-01 |
| GLM-04 | glm | minor | 接受 | 属实：档位名未定义时模型也为 null，`checkModelSlugs`（`preflight.ts:344-359`）会先以「未定义模型」记 bad；`review` 准备阶段在它之后才调新检查，前者一抛就短路，用户看不到「档名拼错 + 可用档」。预检两格并列都能看到，两个入口诊断面不同 | r2 §3.4：档名校验**并入** `checkModelSlugs` 的「无模型」分支——解析结果带档位缺失标记时，这一格直接报「档位『X』未在 `agents.〈id〉.tiers` 定义，可用：…」，否则报扩写后的「未给该阶段模型」文案；新检查项不再重复档名一格。两个入口同一文案 |
| GLM-05 | glm | nit | 接受 | 属实：17.2 :3609 行文含 `--tier`（第 5 步旗标），原稿整行翻 ✅，与对 12.1 :3035 的拆分口径不一 | r2 §4.1：:3609 翻 ✅ 时补「`--tier` 旗标接线待第 5 步，本步以参数注入单测」半句，里程碑列不改 |
| GLM-06 | glm | nit | 接受 | 属实：原稿 §3 首行「拍板不同则按 §5 的分支改」，§5 并无分支 | r2 §3 首行改为「拍板不同则按 §2 对应候选改写 §3 与 §5 的相关格」，并在 §2 每个非建议候选下注明随之变的格 |

## 2. 不涉及驳回与暂缓

本轮 14 条全部接受。AGY-01 的接受以用户确认 P-6 为前提：用户若取「保持 11.5 字面」，本条改判驳回（理由：规则文本由用户定），r2 §3.3 恢复原稿的五条表，同时 6.7.1 :1262 的后半句按 11.5 第 5 条收窄，消除两处不一致。

## 3. 本轮附带记录

- CODEX-01 核对时发现 PROTOCOL 的废弃键段在设计 v1.3.122（EV-30 ②③）时就漏了同步，属同一类遗漏的第二次，r2 一并补齐，不另立条目。
- 待拍板项由原稿的五项增为六项（P-6 来自 AGY-01）；P-1 的覆盖面按 GLM-01 补「一类告警」。六项都写在 r2 §2，用户确认前 r2 按各项建议写。
