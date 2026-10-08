# M11 第 1 步 · 档位事实探针报告

> - **日期**：2026-10-07
> - **依据**：M11 计划 r3（`.reviews/M11-档位全链路与文档收口/plan/`，2026-10-07 审批）§3.2、§4.1；纪律 1「先探路后编码」、纪律 6a「事实回填」
> - **起点**：`92d53be4`（计划归档提交；源码同 `6adbfae2`）
> - **性质**：只取事实，不改实现。证据与可重跑脚本在 [`evidence/m11-tier-facts-20261007/`](./evidence/m11-tier-facts-20261007/)
> - **配额**：用户 2026-10-07 授权「该花就花，不限次数」。实际花费：codex 9 次最小调用、agy 3 次、claude 5 次（claude 侧约 0.12 美元，取自 `modelUsage`；codex、agy 侧没有计费读数）；另 codex 目录探测 5 次零配额

---

## 0. 结论速览

| # | 事实 | 推翻或修正了什么 |
| :--- | :--- | :--- |
| F1 | codex 会话文件 `turn_context.payload.effort` 是**请求值的原样回显**：目录外的值、厂商不认的乱写值都照抄 | 推翻 r3 §3.8 给 codex 定的退路「接受 `turn_context` 值为生效值」——那等于采信请求值 |
| F2 | codex 在 `exec --json` 模式下 stderr 不打印 header，事件流与会话文件里都没有生效思考等级 | codex 侧**没有任何生效思考等级的回读面** |
| F3 | codex 的思考等级取值由**厂商端点**校验：乱写值被拒（`invalid_request_error`，整格失败退 1）；本机目录之外但厂商接受的值照常通过、服务端如何处理不可见 | 客户端不校验（与探针结论 `effort_validated: false` 一致）；本机目录不是厂商口径的权威 |
| F4 | 本机 codex 目录的逐模型 effort 枚举可零配额取得（`debug models` 的 `supported_reasoning_levels`），但 qwen 目录写的是 `low/medium/high`，而厂商接受 `xhigh` | 修正演进设计 §3.1 / §5.4 的 qwen 枚举口径；「原生枚举」实际取自本机目录文件 |
| F5 | 本仓 codex 实际跑 `max` 的来源是 `kimi.config.toml` 的 `model_reasoning_effort = "max"` | 确认计划 §0 的推断 |
| F6 | claude CLI 2.1.291 **已有 `--effort`**（帮助文本列 `low, medium, high, xhigh, max`），但不校验取值（乱写值退 0），init 事件没有任何 effort 字段，`per_turn_effort_active` 五格恒 false | 推翻 M6 事实与 `types.ts:983`「claude 侧没有对应的 CLI 旗标」；claude 能透传、回读不到 |
| F7 | agy 的 `-low` / `-medium` slug 都被接受，回执的 `model` 字段如实回读出所请求的 slug；`-high` slug 加 `effort low` 时适配器不传 `--effort`、回执仍是 `-high` | 支持 r3 §3.8 的 gemini 口径（生效档位取回执 slug 后缀），前提是来源为 `envelope` |

**对 M11 契约的影响**（§5）：codex 与 claude 两家的 `effort_effective` 只能记 null，AC-23「生效思考等级回读入档」在这两家不可达成；本机目录作为原生枚举的校验基准要定严格度。这两件需要用户在第 2 步之前定。

---

## 1. 环境

| 项 | 值 |
| :--- | :--- |
| codex | `/opt/homebrew/bin/codex` 0.160.1 |
| agy | 1.3.0（`command -v agy`） |
| claude | `~/.local/bin/claude` 2.1.291 |
| codex profile | deepseek、glm、gpt、kimi、qwen（`probeCodexProfiles`） |
| 调用方式 | codex 经项目自己的 `prepareCodexHome`（裁剪后的凭据副本，建在 mkdtemp 目录、跑完即删）+ `invokeCodex`（`-s read-only`）；agy 经 `invokeAgy`（与 `buildAgyArgs` 同一组参数）；claude 以临时目录为 cwd、只载 project 设置源、`--tools ""`、`--strict-mcp-config`、`--no-session-persistence` |
| 提示语 | 每格只要求回一个词 `OK`，不读文件、不跑命令 |

凭据纪律：profile 文件只用正则取 `model_catalog_json` / `model` / `model_reasoning_effort` / `model_provider` 四个键的值，没有整份读出；证据只落抽出的字段，不落 stdout、stderr 与会话文件原文；补跑那一格的错误行做了长串打码。

---

## 2. codex

### 2.1 零配额：本机目录与 profile 基底（`codex-catalogs.json`）

| profile | 基底 `model` | 基底 `model_reasoning_effort` | 可见模型与 effort 枚举 |
| :--- | :--- | :--- | :--- |
| （config.toml） | qwen3.8-flash | medium | — |
| deepseek | deepseek-flash | high | deepseek-flash、deepseek-v4-pro：`low/high/max` |
| glm | glm-5.3-flash | low | glm-5.3、glm-5.3-flash：`low/high/max`；glm-5-turbo：空 |
| gpt | gpt-5.6-luna | medium | gpt-5.6-terra：`low/medium/high/xhigh/max/ultra`；gpt-5.6-luna：到 `max`；gpt-5.5、gpt-5.4-mini：到 `xhigh` |
| kimi | kimi-for-coding | **max** | k3、k3-256k、kimi-for-coding、kimi-for-coding-highspeed：`low/high/max` |
| qwen | qwen3.8-flash | medium | qwen3.8-max、qwen3.8-flash、qwen3.7-max、qwen3.7-plus、qwen3.6-flash：`low/medium/high` |

- 各家枚举彼此不同，且都不是统一的 `low/medium/high`——主设计 11.5 禁令 ① 的前提成立。
- `probes/codex.ts:321-331` 早已在解析这份枚举，只是算完即丢（计划 §2.3）；按 r3 §3.5 落盘即可，不需要新的调用。
- **F5**：本仓 `agents.codex.profile: kimi`，kimi 基底是 `max`，而 `agents.codex.effort` 从未下传——这就是计划 §0 里「配置写 high、实际 max」的成因。

### 2.2 花配额：逐格最小调用（`codex-effort-cells.json`、`codex-bogus-effort-reason.json`）

| 格 | profile / 模型 | 请求 effort | 退出码 | `turn_context.payload.effort` | 本机目录是否含该值 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| k0 | kimi / kimi-for-coding | 不传 | 0 | max | —（基底 max） |
| k1 | kimi / kimi-for-coding | low | 0 | low | 含 |
| k2 | kimi / kimi-for-coding | medium | 0 | medium | **不含** |
| k3 | kimi / kimi-for-coding | bogus | **1** | bogus | 不含 |
| d1 | deepseek / deepseek-flash | medium | 0 | medium | **不含**（演进设计记的归并场景） |
| d2 | deepseek / deepseek-flash | high | 0 | high | 含 |
| q1 | qwen / qwen3.8-flash | xhigh | 0 | xhigh | **不含**（演进设计记为合法） |
| q2 | qwen / qwen3.8-flash | low | 0 | low | 含 |

- **F1**：`turn_context.payload.effort` 与同行 `collaboration_mode.settings.reasoning_effort` 在全部 8 格都等于请求值（不传时等于 profile 基底），连 k3 那个厂商拒收的 `bogus` 也照写。它记录的是**客户端发出的请求**，不是生效值，也看不到 d1 那类服务端归并。
- **F2**：8 格的 stderr 都没有 header 行（`HEADER_LABELS` 一个都没匹配到）——header 只在非 `--json` 的形态下打印，审查调用走 `--json`。事件流里没有任何带 effort 字样的键。推理 token 数（k0 34、k1 22、k2 13、q1 27、q2 22、deepseek 两格 0）在单词回复的提示下太小，不能拿来反推生效档位。
- **F3**：k3 补跑抓到原因行：厂商端点返回 `invalid_request_error: reasoning.effort value "bogus" is not supported`，本格 `turn.failed`、退 1。k2、d1、q1 三个不在本机目录里的值都退 0。所以：①乱写值会在**运行期**让该侧整格失败（花一次调用），客户端不拦；②本机目录既不是上限也不是下限的权威——q1 证明厂商接受目录外的 `xhigh`，k2 / d1 证明厂商接受目录外的 `medium`（是否被归并、归并成什么，不可见）。
- q1 的最终文本出现了 `</think>` 片段：qwen 在 `xhigh` 下把思考标签漏进了正文。只记现象，与本主题无关。

---

## 3. claude（`claude-effort-cells.json`）

| 格 | 模型 | 请求 effort | 退出码 | init 的 `model` | effort 相关字段 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| c0 | claude-sonnet-5 | 不传 | 0 | claude-sonnet-5 | `per_turn_effort_active=false` |
| c1 | claude-sonnet-5 | low | 0 | claude-sonnet-5 | 同上 |
| c2 | claude-sonnet-5 | max | 0 | claude-sonnet-5 | 同上 |
| c3 | claude-haiku-4-5-20251001 | high | 0 | claude-haiku-4-5-20251001 | 同上；另有 `thinking_tokens=36` |
| c4 | claude-sonnet-5 | bogus | **0** | claude-sonnet-5 | 同上 |

- **F6**：`claude --help` 第 84-85 行：`--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)`（**勘误，2026-10-08**：这条引用把第 84、85 行排成了一行；原始形态是第 84 行只有 `--effort <level>` 与说明、取值列表在第 85 行的 40 格缩进续行上。M11 第 6 步的解析器样本照抄了这条引用，真机落 `null`——原文见夹具 `test/fixtures/claude-help-2.1.291.txt`，修复见主设计 v1.3.134。正文其余不改）。M6 探针（2026-09-14）记录时没有这个旗标，`types.ts:983` 的注释据此写「claude 侧没有对应的 CLI 旗标」——**这条事实已过期**。
- CLI 不校验取值：c4 的 `bogus` 退 0、正常作答。
- init 事件的全部 28 个键（证据里有清单）里没有 effort；唯一相关的 `per_turn_effort_active` 在五格都是 false，与是否传 `--effort` 无关。result 事件也没有 effort 字段。
- 结论：claude 侧**能透传、回读不到**。思考 token 只在 haiku 那格出现，单词回复下不足以反推档位。
- 每格的 `modelUsage` 里另有一笔 haiku 小额用量（CLI 后台的附带调用），与本主题无关。

---

## 4. agy（`agy-tier-cells.json`）

| 格 | 请求模型 | 请求 effort | 是否传了 `--effort` | 退出码 | 回执 `model` | 思考 token |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| a1 | gemini-3.8-flash-low | — | 否 | 0 | gemini-3.8-flash-low | 0 |
| a2 | gemini-3.8-flash-medium | — | 否 | 0 | gemini-3.8-flash-medium | 27 |
| a3 | gemini-3.8-flash-high | low | 否（slug 带后缀，P-16） | 0 | gemini-3.8-flash-high | 102 |

- **F7**：回执（适配器记 `model_effective_source: envelope` 的那一路，`agy.ts:364-369`）如实回读出请求的 slug，档位后缀随之可得；a3 说明 slug 带后缀时 `--effort` 不会下传，生效档位以 slug 为准，与 P-16 一致。思考 token 读数的方向（0、27、102）与档位一致，但单词回复下只作佐证。
- 适配器在回执缺 `model` 时会退到请求值并记 `model_effective_source: requested`。按 r3 §3.8「只取回读」，这种情况下 gemini 的 `effort_effective` 应记 null，不能从请求 slug 派生——第 6 步实现时要按来源分支。

---

## 5. 对 M11 契约的影响（第 2 步之前要定）

r3 前言写明「第 1 步的事实若推翻某一条，第 2 步按事实改写并写明偏离」。以下三条里，前两条改的是验收判据或校验严格度，按「拿不准先问」交用户定；第三条是能力补登，按事实直接改写。

### 5.1 codex 与 claude 的 `effort_effective`（推翻 r3 §3.8 的 codex 退路）

- **事实**：两家都没有生效思考等级的回读面（F1、F2、F6）。r3 §3.8 的退路「接受 `turn_context` 为生效值」会把请求值记成生效值，正是 AC-23 与 6.7.1 禁止的事。
- **候选**：(a) 两家 `effort_effective` 恒记 null、`effort_effective_source` 记 `unverified`；PRD AC-23 达成边界写明「生效思考等级只在 gemini 侧可回读；codex、claude 侧只记请求值；glm 无此概念」；(b) 另加一个字段如实记录 codex 的请求回显（`effort_echo`），同时 `effort_effective` 仍为 null。
- **建议 (a)**：回显与 `effort_requested` 在 8 格里逐字相同，多一个字段不增加信息，只增加误读的机会。
- **连带**：第 11 步 AC-23 验收原定「codex 两次 + gemini 一次」，codex 两次只能核 `tier` / `tier_source` / `model_effective` 与请求值入档，**生效思考等级只能在 gemini 那次核**。建议第 11 步改为 gemini 两种发起方式各一次（选档、精确指定 slug）+ codex 两种各一次，上限仍 4 次。

### 5.2 原生 effort 枚举的校验严格度（细化 r3 §3.5）

- **事实**：本机 codex 目录不是厂商口径的权威——目录外的 `xhigh`（qwen）、`medium`（kimi、deepseek）厂商都收，乱写值厂商才拒（F3、F4）。
- **候选**：(a) **照 slug 规则硬拒**：该模型在目录里有非空 effort 表、请求值不在其中 → 预检退 64 并列出目录值；表为空或目录缺失 → 跳过。代价：目录写窄了会拦下厂商其实接受的值，用户要改本机目录文件（如 `models-qwen.json` 补 `xhigh`）；(b) **只告警不拒**：目录外的值照发，靠厂商端点兜底（乱写值会在运行期让该侧失败、花一次调用）；(c) 不校验。
- **建议 (a)**：与 slug 校验同一口径，失败在预检、零工件；本机目录本来就是用户维护的「本机能用什么」，目录窄于厂商是目录的问题，改目录比让一个乱写值烧一次配额便宜。
- 本仓现状下 (a) 的直接后果：若档位里给 qwen 写 `xhigh`，要先在本机 qwen 目录补上。

### 5.3 claude 的透传（补登能力，按事实改写）

- claude 档位可以带 `effort`；取值集合取自 `claude --help` 的 `--effort` 行（CLI 级、不分模型），由探针解析落盘（与 codex 的目录同一做法，纪律 P7），CLI 本身不校验，所以预检按 5.2 定的严格度校验。
- 第 6 步 claude 适配器补 `--effort` 透传；`ClaudeCriticConfig` 的「刻意不加 effort」注释随之改写（它的理由——没有旗标——已不成立）。
- 主设计 3.7 事实表按 F6 回填（纪律 6a），第 2 步同版落盘。

---

## 6. 未覆盖

- glm（zcode）未测：按 D-9 不实测，档位只由模型承载。
- codex 的 glm、gpt 两个 profile 只采了目录，没有发起调用（本机配置未选用这两家）。
- 推理 token 数与档位的关系只在单词回复下观察，不构成判据；真实审查尺度下的差异要看第 11 步。
- claude 的 `--effort` 对 haiku 是否生效、各模型实际支持哪几档，CLI 层看不出来（不校验、不回读）。
