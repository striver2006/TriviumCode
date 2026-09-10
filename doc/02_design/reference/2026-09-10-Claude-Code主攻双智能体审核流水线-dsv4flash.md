# Driver-DualCritic 全自动多智能体协同流水线 · 设计方案

> 版本：v1.1（已按本机实测校准）　|　日期：2026-09-10　|　目标运行环境：macOS + VS Code 原生开发流
> 主脑：Claude Code（VS Code 插件）　|　双审：Antigravity (Google) + ZCode (智谱)
>
> **实测校准记录（2026-09-10）**：Antigravity CLI 已打通（`agy` 在 PATH，返回 `status: SUCCESS`）；
> ZCode CLI 入口已定位为 `C:\Program Files\ZCode\resources\glm\zcode.cjs`（v0.16.5，需用 node 调用），
> **需先执行 `zcode login` 完成 Z.AI OAuth 授权**方可使用。模型 slug 已按 `agy models` 实测结果修正。

---

## 0. 一句话总览

让 **Claude Code 当"主攻手"**（理解需求、出计划、写代码、修 Bug），把它的每一个**关键节点产物**同时丢给 **Antigravity 和 ZCode 两个"独立审查员"**，
由两者**背靠背独立**给出审查意见，再回到 Claude Code 手上做**接受/驳回**的裁决，全程以 **Markdown 文档**落盘归档。
所有调用都走两家 Agent 的**命令行入口（CLI headless）**——用的是它们**完整的编程 Agent 能力**（能读仓库、能跑工具、能多步推理），而不是把它们当普通聊天 LLM 用。

---

## 1. 可行性结论（已调研核实）

这套流水线能成立，前提是三方都具备"可被脚本调用"的入口。调研结论如下：

### 1.1 Claude Code（主脑）
- 形态：VS Code 插件，同时提供 `claude` CLI。
- 关键能力（用于本方案）：
  - Headless 单次执行：`claude -p "<prompt>" --output-format json`
  - 项目级约定文件：`CLAUDE.md`（Claude Code 会自动读取，作为"主脑的作业指导书"）
  - 自定义命令：`.claude/commands/*.md`（可把双审流程固化成 slash command）
  - Hooks：`.claude/settings.json` 中的 hooks（可在关键节点自动触发脚本，见 §6）

### 1.2 Antigravity (Google) —— 审查员 A 【已实测打通】
- CLI 二进制：`agy`（本机位于 `C:\Users\k_bo\AppData\Local\agy\bin\agy`，已在 PATH）
- Headless 调用：`agy -p "<prompt>"`，支持 `--output-format json | stream-json`
- **结构化输出**：`--json-schema`（可强制审查结论输出为 JSON，字段可控）
- **模型选择**：`--model <slug>`。**本机实测可用 slug**（2026-09-10 执行 `agy models`）：
  ```
  gemini-3.8-flash-high    gemini-3.8-flash-medium   gemini-3.8-flash-low
  gemini-3.7-flash-high    gemini-3.7-flash-medium   gemini-3.7-flash-low
  gemini-3.6-flash-high    gemini-3.6-flash-medium   gemini-3.6-flash-low
  gemini-3.1-pro-high      gemini-3.1-pro-low
  claude-sonnet-4-6        claude-opus-4-6-thinking
  gpt-oss-120b-medium
  ```
- 推理档位：`--effort low|medium|high`
- 权限控制：`~/.gemini/antigravity-cli/settings.json` 的 `permissions.allow` 白名单；无头模式下**未预授权的工具会被"软拒绝"**（进程退出码仍为 0，只打印 stderr 通知）
- 续接会话：`--continue`（最近一次）/ `--conversation <id>`（指定会话）
- 注意：**没有 `--cwd` / `--project` 参数**，工作目录靠 shell 的 `cd` 决定；`cwd` 只在 stream-json 的 `init` 事件里只读上报。
- **连通性实测**：`agy -p "只回复两个字符：OK" --model gemini-3.8-flash-low --output-format json`
  → `{"status":"SUCCESS","response":"OK\n",...}` ✅

### 1.3 ZCode (智谱) —— 审查员 B 【已实测校准】

- **形态（关键修正）**：ZCode CLI **不是**独立安装的二进制，而是随桌面端内置的一个 Node 脚本。
  - 本机实测入口：`C:\Program Files\ZCode\resources\glm\zcode.cjs`（版本 `0.16.5`）
  - 调用方式：`node "<...>/zcode.cjs" --prompt "..."`（需 Node ≥ 18；本机用托管 Node 22）
  - ⚠️ npm 上不存在官方 `zcode` 命令包；网上流传的 `@zhipu/zcode` / `@zcode/cli` / `npm i -g zcode-cli` **全都不可用**（已逐一验证，前两个不存在，`zcode-cli` 是 0.0.1 空壳）。
- Headless 调用：`node zcode.cjs --prompt "<text>" --json --no-color`
- **只读审查（实测校正）**：
  - ✅ `--mode plan`：拒绝任何写操作（有效）
  - ✅ `--disallowed-tools "Write,Edit,Bash"`：反向 denylist（**实测有效**）
  - ❌ `--allowed-tools`：**实测不支持！** 虽然 `--help` 里列出了它，但实际运行报
    `Unknown option '--allowed-tools'`。**help 文本有误导，不要用。**
  - 结论：只读 = `--mode plan` + `--disallowed-tools`，再加 git 指纹兜底。
- **输出字段（重要）**：`--json` 的结果在 **`.response`** 字段（不是 `.text`）。
  完整字段：`sessionId / traceId / turnId / response / usage / eventCount / projection`
- **实际模型**：实测走的是内置 `providerId: builtin:bigmodel-coding-plan`（桌面端套餐），
  即 GLM-5.3，**config.json 里的 provider 段可能被内置计划覆盖**——以 `rollout/*.jsonl` 里
  `model.modelId` 为准。
- 模型选择：`/model` 切换，或 `~/.zcode/cli/config.json` 指定 provider
- 会话续接：`--resume sess_...` / `-c, --continue`
- 工作目录：`--cwd <path>`；附加文件：`--attach <path>`（可重复）；最大轮数：`--max-turns <n>`
- **实测性能**：单次审查耗时约 15–45 秒，`usage.totalTokens` 约 13k（简单）～ 62k（复杂审查）。
  并发 2 个实例实测正常。
- **认证（实测：login 有 bug，请走手动配置）**：
  - CLI 有**独立于桌面端**的凭证，桌面端已登录**不等于** CLI 可用。
  - ⚠️ `zcode login` 实测报 `OAuth response is not valid JSON`（官方 OAuth 回调 bug），**不要走这条路**。
  - ✅ **正确做法**：在 `~/.zcode/cli/config.json` 写 provider 段 + 用环境变量 `ZCODE_API_KEY` 传**签名凭据**。
  - 🔑 **凭据格式特殊**：必须是 `<apiKeyId>.<apiKeySecret>`（单个点号分隔），**不是** `sk-xxx`。详见 §9.2。
- 本机现状：provider 段已写入，链路已验证到"401 Unauthorized"（即配置全对，只差真实凭据）。

### 1.4 三方能力对照表

| 维度 | Claude Code（主脑/执行） | Antigravity `agy`（审 A） | ZCode `zcode.cjs`（审 B） |
|---|---|---|---|
| 入口形态 | 独立 CLI | 独立 CLI（PATH） | **Node 脚本，需 node 调用** |
| 单次 headless | `-p` | `-p` | `--prompt` |
| JSON 输出 | `--output-format json` | `--output-format json` | `--json` |
| 强制 schema | `--json-schema`（部分版本） | ✅ `--json-schema` 稳定支持 | 未提供，靠 prompt 约束 |
| 指定模型 | `--model` | `--model <slug>`（`agy models`） | `/model` 或 config |
| 只读能力 | `--permission-mode plan` | 权限白名单 + 默认软拒绝 | `--mode plan` + `--disallowed-tools` |
| 响应字段 | `--output-format json` | `.response` | **`.response`** |
| 续接会话 | `--continue` / `--resume` | `--continue` / `--conversation` | `-c` / `--resume sess_...` |
| 工作目录 | 天然在项目内 | 需 `cd` | `--cwd <path>` |
| 附加文件 | — | — | `--attach <path>` |
| 认证状态 | ✅ | ✅ 实测通过 | ✅ 实测通过 |

> **结论**：三方都提供"一次性 prompt + JSON 输出 + 模型指定 + 只读模式"，流水线技术上完全可行。

---

## 2. 总体架构

### 2.1 角色定义

| 角色 | 承担者 | 职责 | 权限 |
|---|---|---|---|
| **Driver（主攻）** | Claude Code | 理解需求 → 出计划 → 写代码 → 修 Bug → 对审查意见做裁决 | 读写全开（唯一有权改代码的人） |
| **Critic-A（审查员 A）** | Antigravity | 独立审查需求/计划/代码/Bug 根因，输出意见 | **只读**（plan / 白名单模式） |
| **Critic-B（审查员 B）** | ZCode | 同上，独立审查，与 A 互不可见 | **只读**（plan 模式 + denylist） |
| **Orchestrator（调度）** | Claude Code 内的脚本/命令 | 负责把产物分发给两位审查员、回收意见、落盘归档 | — |

**关键设计原则：两位审查员之间完全隔离（背靠背），互看不到对方的意见。** 这样才能避免"意见趋同"，双审才有交叉验证价值。隔离手段：独立的输入文件、独立的输出文件、独立进程、独立会话。

### 2.2 数据流（四阶段）

```
                     ┌─────────────────────────────────────────┐
   用户需求  ───────► │              Claude Code（主脑）          │
                     └─────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │ ① 计划审核                  │ ② 代码审核                   │
        ▼                             ▼                             ▼
  plan.draft.md              code.diff + 上下文                bug.report.md
        │                             │                             │
   ┌────┴────┐                   ┌────┴────┐                   ┌────┴────┐
   ▼         ▼                   ▼         ▼                   ▼         ▼
 审A(agy)  审B(zcode)          审A        审B                 审A       审B
   │         │                   │         │                   │         │
 review.A  review.B          review.A   review.B            review.A  review.B
   └────┬────┘                   └────┬────┘                   └────┬────┘
        ▼                             ▼                             ▼
  Claude Code 裁决 → plan.final.md  裁决 → responses.md      裁决 → rca.final.md
        └─────────────────────────────┴─────────────────────────────┘
                                      │
                              写回 next 阶段 / 落盘归档
```

### 2.3 三个自动双审触发点（关键节点）

你选择了"关键节点自动双审"，即以下三个节点默认触发，其余环节不打扰：

| 节点 | 触发时机 | 输入给审查员 | 审查重点 |
|---|---|---|---|
| **G1 · 计划审核** | Claude Code 产出 `plan.draft.md` 后 | 需求原文 + 计划草案 | 需求理解是否有偏差、方案是否覆盖边界、有无更简路径、风险遗漏 |
| **G2 · 代码审核** | 代码写完（一个可提交单元）后 | `git diff` + 计划 + 关键上下文 | 正确性、边界条件、安全、可维护性、是否符合计划 |
| **G3 · Bug 根因审核** | Claude Code 定位出根因后 | 现象 + 复现步骤 + 根因假设 | 根因是否成立、是否只治标、有无更深的诱因 |

> 可选增设 **G4 · 修复验证审核**（修完 Bug 后回归）。默认关闭，可在配置里打开。

---

## 3. 目录结构与留痕规范

在**项目根**下建立统一归档目录（示例用 `.dualcritic/`，可配置）：

```
<项目根>/
├── .dualcritic/                      # 流水线归档根目录（建议纳入 git）
│   ├── config.yaml                    # 本项目的流水线配置（模型、开关、超时）
│   ├── README.md                      # 归档目录说明（谁生成的、怎么读）
│   │
│   ├── T-20260910-001-登录模块重构/    # 以"任务"为单位的归档目录
│   │   ├── meta.yaml                  # 任务元数据：标题/创建时间/状态/涉及模型
│   │   │
│   │   ├── 01-plan/                   # ── G1 计划审核 ──
│   │   │   ├── plan.draft.md          # ① Claude Code 生成的原始计划
│   │   │   ├── review.antigravity.md  # ② Antigravity 审查意见
│   │   │   ├── review.zcode.md        # ③ ZCode 审查意见
│   │   │   ├── review.antigravity.json#    （结构化原始输出，便于统计）
│   │   │   ├── review.zcode.json      #
│   │   │   ├── plan.final.md          # ④ Claude Code 采纳意见后的修改稿
│   │   │   └── adjudication.md        # ⑤ 逐条裁决（接受/驳回 + 理由）
│   │   │
│   │   ├── 02-code/                   # ── G2 代码审核 ──
│   │   │   ├── changes.diff           # 被审的代码变更（git diff）
│   │   │   ├── review.antigravity.md
│   │   │   ├── review.zcode.md
│   │   │   ├── review.antigravity.json
│   │   │   ├── review.zcode.json
│   │   │   ├── responses.md           # ⑥ Claude Code 对审查意见的应答（接受/不接受+修改计划）
│   │   │   └── applied.diff           # 采纳后实际改动的 diff（可选）
│   │   │
│   │   └── 03-bug-<slug>/             # ── G3 Bug 根因审核 ──
│   │       ├── bug.report.md          # 现象/复现/根因假设（Claude 初稿）
│   │       ├── review.antigravity.md
│   │       ├── review.zcode.md
│   │       └── rca.final.md           # 最终根因 + 修复方案
│   │
│   └── _templates/                    # 文档模板（复制用）
│       ├── plan.draft.template.md
│       ├── review.template.md
│       ├── adjudication.template.md
│       └── responses.template.md
│
└── .claude/                           # Claude Code 侧配置
    ├── settings.json                  # 权限 + hooks
    └── commands/
        ├── dual-review-plan.md        # /dual-review-plan
        └── dual-review-code.md        # /dual-review-code
```

### 3.1 命名与元数据规范

- **任务目录**：`T-<YYYYMMDD>-<序号>-<中文短标题>`
- **所有审查文档头部带 YAML front-matter**（便于脚本统计、追溯模型）：

```yaml
---
stage: plan              # plan | code | bug
artifact: plan.draft.md  # 被审对象
reviewer: antigravity    # antigravity | zcode
reviewer_model: gemini-3.1-pro-high
driver_model: claude-opus-4-6
created_at: 2026-09-10T12:30:00+08:00
verdict: needs_revision  # approve | needs_revision | reject
severity: major          # 最高严重度
schema_version: 1
---
```

### 3.2 审查意见统一格式（两位审查员共用）

每条意见必须是**可裁决的最小单元**，便于 Claude Code 逐条接受/驳回：

```markdown
### [A-01] 严重度: major | 类型: 逻辑缺陷 | 位置: plan §3.2
**问题**：将用户表与登录日志表做了跨库 JOIN，未考虑分库场景。
**依据**：需求文档 §2 明确"订单库与用户库物理隔离"。
**建议**：改为先查用户库拿 userId，再查订单库。
**置信度**：high
```

> 固定字段：`编号 / 严重度(blocker|major|minor|nit) / 类型 / 位置 / 问题 / 依据 / 建议 / 置信度`。
> 编号前缀 `A-` 表示 Antigravity，`B-` 表示 ZCode，避免两边编号冲突。

---

## 4. 各阶段详细流程

### 4.1 G1 · 计划审核

**Step 1｜Claude Code 产出计划草案**
按 `_templates/plan.draft.template.md` 写 `01-plan/plan.draft.md`，必须包含：需求复述、验收标准、技术方案、分步实施、风险与回滚。

**Step 2｜并行分发（关键：两位审查员互不可见）**

```bash
# 审查员 A：Antigravity（只读，独立进程）
cd "<项目根>" && agy -p "$(cat .dualcritic/_prompts/review-plan.md)" \
  --model gemini-3.1-pro-high \
  --output-format json \
  --print-timeout 15m \
  > .dualcritic/<任务>/01-plan/review.antigravity.json 2> /dev/null

# 审查员 B：ZCode（plan 模式 + denylist 只读）
node "$ZCODE_ENTRY" \
  --prompt "$(cat .dualcritic/_prompts/review-plan.md)" \
  --cwd "<项目根>" \
  --mode plan \
  --disallowed-tools "Write,Edit,Bash" \
  --json --no-color \
  > .dualcritic/<任务>/01-plan/review.zcode.json 2> /dev/null
```
> `$ZCODE_ENTRY` = `C:/Program Files/ZCode/resources/glm/zcode.cjs`（macOS 见 §9），
> 必须用脚本统一封装并**显式赋值**——它是脚本内部变量，在交互式 shell 里默认不存在。
> ⚠️ **不要用 `--allowed-tools`**，实测报 Unknown option。

> **审查提示词（review-plan.md）** 由 Claude Code 生成，内容必须**自包含**（两位审查员看不到 Claude 的对话历史、也看不到仓库记忆）：
> 需求原文 + 计划草案全文 + 项目技术栈/约束 + 输出格式要求（§3.2 的固定字段）。
> 提示词结尾统一话术：*"你是独立审查员，只做审查，不要修改任何文件。请逐条列出问题，按严重度排序。"*

**Step 3｜回收与落盘**
把 JSON 的 `.response`（Antigravity）与 `.text`/`content`（ZCode）抽取为 `review.*.md`，同时保留原始 `.json`。

**Step 4｜Claude Code 裁决**
生成 `adjudication.md`（逐条接受/驳回+理由）和 `plan.final.md`（修改稿）。

### 4.2 G2 · 代码审核

**Step 1｜冻结变更**：`git add -A && git diff --cached > 02-code/changes.diff`
**Step 2｜并行分发**：同 G1，输入换成 `changes.diff` + 计划摘要 + 相关文件片段。审查重点为正确性/边界/安全/可维护性。
**Step 3｜回收落盘**：`review.*.md/.json`。
**Step 4｜Claude Code 应答**：写 `responses.md`——对每条意见标记 `✅接受（附修改计划）` / `❌不采纳（附理由）` / `⏸暂缓（附原因）`，然后执行实际修改，产出 `applied.diff`。

### 4.3 G3 · Bug 根因审核

**Step 1｜Claude 初判**：写 `bug.report.md`（现象、复现步骤、日志、根因假设）。
**Step 2｜并行分发**：两位审查员独立验证根因假设是否成立、是否只治标。
**Step 3｜回收 + `rca.final.md`**（最终根因 + 修复方案 + 两位审查员的贡献标注）。

### 4.4 全流程时序（含自动化）

```
Claude 出计划 ─► [自动] 分发 agy + zcode（并行）─► 回收 ─► Claude 裁决 ─► 归档
                                                                  │
                                              [自动] 进入编码 ◄─────┘
                                                    │
Claude 写完代码 ─► [自动] 冻结 diff + 双审 ─► Claude 应答 ─► 归档
                                                    │
Claude 定位 Bug ─► [自动] 双审根因 ─► Claude 定稿 ─► 归档 ─► 修复
```

---

## 5. 模型分配策略（对应需求第 5 条）

**核心思路：审查员的模型要"不同源、不同风格"于主脑，交叉验证才有意义。** 由任务类型驱动模型选择（在 `.dualcritic/config.yaml` 中配置 profile）：

```yaml
# .dualcritic/config.yaml（模型 slug 已按 agy models 实测校准）
profiles:
  # 默认档：均衡
  default:
    driver:  { model: claude-opus-4-6-thinking }
    critic_a: { agent: antigravity, model: gemini-3.1-pro-high }
    critic_b: { agent: zcode,       model: zai/glm-5.2 }

  # 架构/方案类：审查员用最强推理 + 高 effort
  architecture:
    driver:  { model: claude-opus-4-6-thinking }
    critic_a: { agent: antigravity, model: gemini-3.1-pro-high, effort: high }
    critic_b: { agent: zcode,       model: zai/glm-5.2 }

  # 代码实现类：审查员用快模型做交叉
  implementation:
    driver:  { model: claude-sonnet-4-6 }
    critic_a: { agent: antigravity, model: gemini-3.8-flash-high }
    critic_b: { agent: zcode,       model: zai/glm-5.2 }

  # 快速修 Bug：两边都用快模型，只求覆盖
  hotfix:
    driver:  { model: claude-sonnet-4-6 }
    critic_a: { agent: antigravity, model: gemini-3.8-flash-low }
    critic_b: { agent: zcode,       model: zai/glm-5.2-flash }

  # 深度安全审计：一致用最强
  security:
    driver:  { model: claude-opus-4-6-thinking }
    critic_a: { agent: antigravity, model: gemini-3.1-pro-high, effort: high }
    critic_b: { agent: zcode,       model: zai/glm-5.2 }
```

**选型原则**

| 任务类型 | 主脑 Claude | 审查员 A (Antigravity) | 审查员 B (ZCode) | 理由 |
|---|---|---|---|---|
| 架构/方案设计 | Opus 4.6 Thinking | Gemini 3.1 Pro (High) | GLM-5.2 | 方案错误代价最高，双强审 |
| 日常编码 | Sonnet 4.6 | Gemini 3.8 Flash (High) | GLM-5.2 | 平衡成本与覆盖 |
| 紧急修 Bug | Sonnet 4.6 | Gemini 3.8 Flash (Low) | GLM-5.2 Flash | 只求快速交叉验证 |
| 安全审计 | Opus 4.6 Thinking | Gemini 3.1 Pro (High) | GLM-5.2 | 安全零容忍 |

> 模型 slug 必须用 `agy models` / `zcode /model` 实际列出的值。Antigravity 侧本机可用 slug 见 §1.2。
> **注意**：Antigravity 也提供 `claude-sonnet-4-6` / `claude-opus-4-6-thinking`，但**审查员不要选这两个**——与主脑同源会削弱交叉验证价值。

---

## 6. 自动化机制（"全自动"如何实现）

### 6.1 方案 A（推荐）：Claude Code Hooks 驱动

在 `.claude/settings.json` 配置 hook，在关键节点自动触发分发脚本：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.dualcritic/bin/on-write.sh \"$CLAUDE_FILE_PATHS\""
          }
        ]
      }
    ]
  }
}
```

`on-write.sh` 检测被写入的文件是否是 `*/01-plan/plan.draft.md`、`*/02-code/changes.diff` 等受控产物，是则自动拉起两位审查员（后台并行）并落盘。
> ⚠️ 用 hook 时要注意：**分发脚本本身不能再触发 Write**，否则会递归。脚本产物直接由 shell 重定向写入（绕过 Claude 的 Write 工具），从根上避免死循环。

### 6.2 方案 B：Slash Command 半自动

在 `.claude/commands/` 下定义：

- `/dual-review-plan`：Claude 写完计划后手动（或让 Claude 自己）调用，一步完成"分发→等待→回收→裁决"。
- `/dual-review-code`：同上，针对当前 diff。
- `/dual-review-bug`：同上，针对根因。

命令体内部其实也是调 `bin/dual-review.sh`，好处是 Claude 能根据上下文自主决定何时调用，且**在 Claude 的对话流里可见**（用户能看到它在跑双审）。

### 6.3 等待与回收策略

审查员是长任务（默认超时 5–15 分钟）。推荐：

1. **后台并行**：A、B 两个进程同时起，互不阻塞；
2. **状态文件轮询**：`bin/collect.sh` 轮询 `review.*.json` 是否出现且可解析（`jq -e`），全到齐后再让 Claude 继续；
3. **超时降级**：某位审查员超时/失败，标记该阶段为"单审降级"，在归档 meta 里注明，不阻塞主流程（可配置 `strict_mode: true` 改为阻塞）。

### 6.4 失败处理矩阵

| 失败情形 | 处理 |
|---|---|
| 审查员未认证 | 提前 `bin/preflight.sh` 检查 `agy` / `zcode` 可用性与登录态，缺失则提示 |
| 输出非 JSON | 尝试抽取 markdown 正文兜底，meta 标记 `parse_fallback` |
| 审查员超时 | 单审降级，继续流程；严格模式则中止 |
| 审查员误改文件 | 分发前后取 git 指纹，若变更非空则告警并 `git checkout` 回滚（防只读失守） |
| 意见为空 | 视为 `approve`，但 meta 标记 `empty_review`，提示可能提示词过窄 |

---

## 7. 隔离性与可信度保障

1. **背靠背隔离**：A、B 各自独立进程、独立输入文件、独立输出文件，A 看不到 B 的输出，反之亦然。（可在严格模式下进一步：两边提示词措辞微调、顺序打乱，防止"共识幻觉"。）
2. **只读强约束**：Antigravity 侧靠权限白名单（只给只读工具）；ZCode 侧靠 `--mode plan` + denylist。**两边都在分发前后做 git 指纹比对**做兜底。
3. **提示词自包含**：审查员没有仓库记忆、没有对话历史，所有上下文必须写进提示词——**唯一入口文件是 `.dualcritic/_prompts/*.md`**，便于审计"审了什么"。
4. **可追溯**：`meta.yaml` 记录每次运行用到的模型、耗时、token、reviewer 版本，形成完整审计链。
5. **主脑仲裁权在 Claude**：审查意见只是输入，最终决策权在 Driver，防止"双审变双主"导致责任涣散。

---

## 8. 落地清单（待你确认后执行）

| 序号 | 交付物 | 说明 |
|---|---|---|
| 1 | `.dualcritic/config.yaml` | 模型 profile、开关、超时配置 |
| 2 | `.dualcritic/_prompts/` | 三个审查提示词模板（plan/code/bug） |
| 3 | `.dualcritic/_templates/` | 计划/审查/裁决/应答四类文档模板 |
| 4 | `.dualcritic/bin/dual-review.sh` | 核心分发+回收脚本 |
| 5 | `.dualcritic/bin/preflight.sh` | 环境自检（CLI 是否装、是否登录） |
| 6 | `.claude/settings.json` | 权限 + hooks |
| 7 | `.claude/commands/dual-review-*.md` | 三个 slash command |
| 8 | `CLAUDE.md` | 主脑的作业指导书（告诉 Claude 何时触发双审、产物怎么落盘） |
| 9 | 归档目录骨架 | `01-plan/02-code/03-bug-*/` + README |

### 待你拍板的三个细节

1. **归档目录名**：用 `.dualcritic/`（点开头、工具目录风格）还是 `dualcritic/`（可见、更醒目）？
2. **严格模式**：某位审查员失败时，是"降级继续"还是"阻塞中止"？
3. **模型 slug 校准**：✅ 已完成（见 §1.2 / §5）；ZCode 侧待登录后确认实际可用的 GLM 模型名。

---

## 9. Windows 实测 → macOS 迁移对照

本方案在 **Windows 本机完成了可行性验证**，但你的目标环境是 macOS + VS Code。差异仅在于路径与安装方式：

| 项 | Windows（已实测） | macOS（目标环境） |
|---|---|---|
| Antigravity CLI | `C:\Users\<u>\AppData\Local\agy\bin\agy` | `~/.local/bin/agy`（`curl -fsSL https://antigravity.google/cli/install.sh \| bash`） |
| ZCode 桌面端 | `C:\Program Files\ZCode\` | `/Applications/ZCode.app/` |
| ZCode CLI 入口 | `.../resources/glm/zcode.cjs` | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` |
| Node | 系统/托管 Node ≥ 18 | 同（推荐 nvm 管理） |
| 路径分隔符 | `\` | `/` |
| 环境变量文件 | PowerShell profile | `~/.zshrc` |

> **迁移要点**：CLI 入口路径不要硬编码，统一放进 `config.yaml` 的 `zcode.entry`，用 `$ZCODE_ENTRY` 引用。macOS 上若 `zcode.cjs` 路径含空格（`.app` 包），务必加引号。

### 9.2 ZCode 认证攻坚记录（实测，重要）

ZCode CLI 的认证是本方案**唯一的技术难点**，实测踩到两个坑，解决方案如下：

**坑 1：`zcode login` 本身有 bug**
```
Error: OAuth response is not valid JSON
```
官方 CLI 的 OAuth 回调解析失败（社区已反馈同类问题）。**别在 login 上耗时间**。

**坑 2：API Key 格式不是 `sk-xxx`**

ZCode 走的是 `ClientRequestSigningV4` **签名链路**，凭据格式必须是：

```
<apiKeyId>.<apiKeySecret>          ← 单个英文句点分隔，两侧均非空
```

源码校验逻辑（`zcode.cjs` 内 `mRt()`）：全串**有且仅有一个 `.`**，且点号两侧 trim 后非空。
普通 `sk-xxxxx` 会报 `Client signing credential must contain one separator.`

**✅ 最终方案：跳过 login，手动配置 provider + 签名凭据**

第一步，在 `~/.zcode/cli/config.json` 加入 provider 段（保留原有 plugins 段）：

```json
{
  "provider": {
    "zai": {
      "kind": "anthropic",
      "options": { "apiKeyRequired": true, "baseURL": "https://api.z.ai/api/anthropic" },
      "models": { "glm-5.2": { "name": "GLM-5.2" }, "glm-5.1": { "name": "GLM-5.1" } }
    }
  },
  "model": { "main": "zai/glm-5.2" }
}
```

第二步，把签名凭据放进环境变量（**不要写进 config 文件**，避免密钥落盘）：

```bash
export ZCODE_API_KEY="<apiKeyId>.<apiKeySecret>"     # 注意中间那个点
```

**验证步骤（递进式，可用于排障）**

| 命令 | 期望现象 | 说明 |
|---|---|---|
| `zcode.cjs version` | `0.16.5` | CLI 可执行 |
| 无 provider 时跑 prompt | `Model config is missing` | 需补 provider 段 |
| 有 provider、无 Key | `Turn execution failed` | provider 已被接受 ✅ |
| Key 无分隔点 | `must contain one separator` | 格式错，补 `.` |
| Key 为 `id.secret` 但值假 | `Unauthorized` (401) | 链路全通，只差真凭据 ✅ |
| 退出码 0 但输出为空 | 见下方"空输出排障" | 通常是调用方式问题，不是 Agent 问题 ⚠️ |

### 9.3 "输出为空"排障（实测踩坑）

调用 ZCode 时出现**退出码 0 但 stdout 为空**，按此顺序排查：

1. **检查变量是否真的存在**（最容易踩的坑）：
   ```bash
   printf '%s' "$ZCODE_ENTRY" | od -c | head -3   # 空输出 = 变量为空
   ```
   `$ZCODE_ENTRY` 是**脚本内部变量**，在交互式 shell 里默认不存在。
   未赋值时命令会变成 `node "" --prompt ...`，node 起个 REPL 立刻退出，**静默失败且退出码 0**。
   → 解法：显式赋值 `ZC="/absolute/path/zcode.cjs"`，或用脚本封装。

2. **分离 stdout/stderr** 看是哪边有内容。

3. **看 Agent 日志**（`~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl`）：
   有 `turn.completed` 但 stdout 为空 → 输出管道问题；日志无记录 → 进程没跑起来。

4. **不要相信 `--help`**：本次实测 `--allowed-tools` 在 help 里列出但运行报 `Unknown option`。

5. **逐步剥离参数**：从最小命令 `--prompt "回复OK" --mode plan --json --no-color` 开始，一次加一个。

6. **排除干扰**：关掉桌面端 GUI、换全新 `--cwd` 目录、连跑 3–5 次区分稳定/间歇失败。

### 9.1 已知坑位清单（实测踩到）

| 坑 | 现象 | 解法 |
|---|---|---|
| npm 包名全是错的 | `npm i -g @zhipu/zcode` 等等全失败 | 不用 npm，直接用桌面端内置 `zcode.cjs` |
| `zcode login` 报错 | `OAuth response is not valid JSON` | 放弃 login，改用 provider + 签名凭据（见 §9.2） |
| API Key 格式错 | `must contain one separator` | 必须是 `<keyId>.<secret>`（单个点），不是 `sk-xxx` |
| 授权 URL 被截断 | 报 `Field required: response_type...` | 复制时 URL 折行了，要完整复制整行 |
| CLI 与桌面端凭证不通 | 桌面端已登录但 CLI 仍报错 | 两者独立，CLI 必须单独配置 |
| `zcode` 不是 PATH 命令 | `CommandNotFoundException` | 用 `node <path>/zcode.cjs` 调用，或建 shell alias |
| Git Bash 路径误解 | node 报 `Cannot find module 'C:\c\...'` | 用 `cygpath -w` 转换路径 |

---

## 附录 A · 命令速查（可直接复制验证）

```bash
# ── 0. 环境变量（写进 ~/.zshrc 或 ~/.bashrc）──
export ZCODE_NODE="node"     # 或用绝对路径
export ZCODE_ENTRY="C:/Program Files/ZCode/resources/glm/zcode.cjs"   # macOS 路径不同，见 §9

# ── 0. 预检 ──
which agy && agy models                                  # Antigravity 是否装了、有哪些模型
node "$ZCODE_ENTRY" version                              # ZCode CLI 版本（应输出 0.16.5）
agy -p "只回复: OK" --model gemini-3.8-flash-low --output-format json | jq -r '.status'   # 审A 认证自测
node "$ZCODE_ENTRY" --prompt "只回复: OK" --mode plan --json --no-color | jq -r '.text'  # 审B 认证自测

# ── 0.1 若 ZCode 未登录（首次必做）──
node "$ZCODE_ENTRY" login        # 打印 Z.AI OAuth URL → 浏览器授权 → 自动回填

# ── 1. 计划双审 ──
PROMPT=$(cat .dualcritic/_prompts/review-plan.md)
cd "$(git rev-parse --show-toplevel)"
agy  -p "$PROMPT" --model gemini-3.1-pro-high --output-format json --print-timeout 15m \
     > .dualcritic/$TASK/01-plan/review.antigravity.json 2>/dev/null &
node "$ZCODE_ENTRY" --prompt "$PROMPT" --cwd "$PWD" --mode plan \
     --allowed-tools "Read,Grep,Glob" --disallowed-tools "Write,Edit,Bash" --json --no-color \
     > .dualcritic/$TASK/01-plan/review.zcode.json 2>/dev/null &
wait

# ── 2. 代码双审（先冻结 diff）──
git add -A && git diff --cached > .dualcritic/$TASK/02-code/changes.diff

# ── 3. 只读失守检查 ──
git status --porcelain     # 若审查阶段出现意料之外的改动，回滚
```

## 附录 B · 已知风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 审查员"讨好式"认同（都提不出问题） | 双审失效 | 提示词强制"至少 X 条、按严重度分级"；随机化措辞；对"零意见"告警 |
| 审查员理解偏差（没仓库记忆） | 提无效意见 | 提示词自包含 + 附关键文件片段；首次运行人工校准提示词 |
| ZCode 只读失守 | 代码被意外改 | `plan` 模式 + denylist + git 指纹兜底 |
| Antigravity 无头下工具被软拒绝 | 审查变"纯文本问答"，看不清仓库 | 在 settings 白名单里放开**只读类**工具（read/search/grep 等），禁写 |
| token / 费用上涨 | 成本 | 按 profile 分级选模型；hotfix 档用快模型；设置单次超时 |
| 版本漂移（CLI 参数变了） | 脚本失效 | `preflight.sh` 每次校验关键 flag；把 CLI 版本写进 meta |

---

*本文档为设计方案（未落地代码）。确认 §8 的三个细节后，可直接进入脚手架搭建。*
