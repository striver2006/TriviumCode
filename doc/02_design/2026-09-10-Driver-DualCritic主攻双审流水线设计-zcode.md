# Driver-DualCritic 主攻双审流水线设计

| | |
|---|---|
| **日期** | 2026-09-10 |
| **作者** | ZCode（GLM-5.3）独立调研与设计 |
| **状态** | 设计完成，待确认后实施 |
| **目标环境** | macOS + VS Code（Claude Code 扩展为主脑） |
| **构建位置** | `C:\ai_work\dualcritic\`（本机先行构建与验证，拷贝部署至 macOS） |

---

## 1. 背景与目标

单人开发者以 Claude Code（VS Code 扩展）为主力开发 Agent。为提高任务执行的准确度，引入另外两家厂商的编程 Agent——Antigravity (Google) 与 ZCode (智谱)——作为相互独立的审查员，对 Claude Code 的**需求理解、开发计划、代码实现、Bug 根因定位**做二次审查，形成"主攻 + 双审"的质量闭环。审查过程对开发者透明（全自动触发），且全部过程文档落盘备查。

## 2. 需求解读 → 设计原则

把原始五条需求翻译成可执行的设计约束：

| 需求 | 推导出的设计原则 |
|---|---|
| R1 Claude Code 是主脑，以 VS Code 插件形态工作 | **P1 原生扩展点集成**：双审必须挂在 Claude Code 自己的 hook/skill 机制上，不换壳、不旁路，否则破坏原生开发流 |
| R2 两家审查员**独立**审查后回传意见 | **P2 独立性**：审查员各自独立进程、独立上下文、不共享 Claude 的会话历史，亲自读仓库得出结论——意见的价值正来自不共享偏见 |
| R3 利用厂商的**编程 Agent 能力**而非裸 LLM | **P3 Agent 级调用**：走两家官方 headless CLI，工作目录指向项目，让它们用自己的 Read/Grep/检索 harness 核实问题，而不是喂一段 diff 给 API |
| R4 过程留痕（原始计划/审查报告/修改后计划/应答文档） | **P4 留痕即契约**：固定目录 + 编号文件名，主脑与审查员都只往这套结构里写；文档既是审计材料，也是 Claude 逐条应答的对象 |
| R5 按任务指定不同 LLM | **P5 模型按 stage 可配**：深审用 Pro 级、快审用 Flash 级，配置文件驱动 |
| （隐含）R6 "全自动"必须可持续运行 | **P6 防死循环与故障降级**是一等设计目标：审查闸门不能把开发卡死，基础设施故障不能阻塞流水线 |

## 3. 关键技术事实（2026-09 调研，含本机实测）

设计建立在这些已核实的事实上：

### 3.1 Antigravity：官方 CLI `agy`，headless 完备

- 2026-05-19 随 Antigravity 2.0 发布；与桌面版共享同一 agent harness 与设置。
- headless：`agy -p "<指令>" --output-format json --json-schema <schema> --model <slug> --agent <name> --effort <level> --print-timeout <s>`；JSON envelope 含 `status/response/structured_output/usage/duration_seconds`，成功退出码 0。
- **`--model` 原生支持按次切换模型**（Gemini 3.1 Pro、Gemini 3.8 Flash、Claude、GPT-OSS 等）。
- 自定义 agent：`~/.gemini/config/agents/<name>/agent.md`（frontmatter 限 `tools`、`model: flash|pro`、`commandExecutionPolicy: off`）→ 可把审查员约束成只读。
- headless 下未获批准的写操作自动 soft-deny（不传 `--dangerously-skip-permissions` 时）。
- **只能作 MCP client，无 server 模式** → 决定了集成方式只能是子进程调用（见决策 D1）。
- 认证：OAuth 登录一次；或 CI 场景 `GEMINI_API_KEY` + settings `modelProvider:"gemini"`。

### 3.2 ZCode：headless 可用，但无按次模型切换

- 本机实测（v0.16.5，Windows）：入口为 Node 包 `zcode.cjs`，headless 形态
  `node <zcode.cjs> --prompt "<指令>" --cwd <项目> --json --max-turns N --allowed-tools Read,Glob,Grep --attach <文件>`
- `--allowed-tools` 白名单可将审查员限制为只读。
- **无 `--model` flag**；模型在 `~/.zcode/v2/config.json` 配置（本机可选：GLM-5.2 / GLM-5.3 / GLM-5.3-Flash / GLM-5-Turbo）或 TUI 内 `/model` 切换 → 按任务指定模型需探针验证旁路（见决策 D6）。
- macOS 上的 `zcode.cjs` 安装路径需 `doctor` 探测（候选：`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 及 PATH shim）。

### 3.3 Claude Code：三个挂载点，VS Code 扩展中同样生效

- hooks 在终端/VS Code 扩展/Desktop 全形态触发；扩展与 CLI 共享 `~/.claude` 配置与会话。
- **`PreToolUse` + matcher `ExitPlanMode`**：Claude 把计划呈现给用户批准**之前**触发；exit 2 可阻断并把审查意见喂回 Claude（`tool_input.plan` 即计划全文）。
- **`Stop`**：Claude 结束回合时触发；输出 `{"decision":"block","reason":...}` 可强制其继续处理；支持 `async:true + asyncRewake:true`（后台长审查跑完再唤醒）；入参带 `stop_hook_active` 防递归；内建连续 8 次 block 硬上限。
- **`UserPromptSubmit`**：用户提交需求时触发，可捕获原始 prompt 做任务留痕。
- 自定义 skill（`.claude/skills/`）支持内嵌 shell 执行与参数，用于手动兜底命令 `/dc-review`。

## 4. 架构总览

```
用户需求 ──UserPromptSubmit──► task-tag：分配任务号 T###，00-task.md 留痕
   │
Claude Code 起草计划（plan mode）
   │
调用 ExitPlanMode ──PreToolUse──► 【计划闸门 plan-gate】（同步，statusMessage 显示进度）
   │                               ├ 01-plan-original.md 落盘
   │                               ├ 并行双审：agy + zcode 以只读 Agent 身份读库核查
   │                               ├ 02-review-antigravity.md / 02-review-zcode.md 落盘
   │                               ├ 有 critical/high 发现 → exit 2 阻断，意见喂回 Claude
   │                               │    Claude 写 03-response.md（逐条接受/不接受+理由）
   │                               │         → 修订计划 04-plan-revised.md → 重新提交（≤2轮）
   │                               └ 通过 / 达轮次上限 → 放行
   ▼
计划呈现给用户批准（机器闸门 → 人工闸门，两级）
   │
Claude Code 写码 / 修 Bug（Bug 场景按协议先写 bug/01-rca.md 根因分析）
   │
回合结束 ──Stop(async+asyncRewake)──► 【代码闸门 code-gate】
   │                               ├ 守卫：stop_hook_active / diff 哈希未变则跳过 / 轮次上限
   │                               ├ 05-diff.patch 快照 → 并行双审（含任务上下文+计划+RCA）
   │                               ├ 06-review-antigravity.md / 06-review-zcode.md 落盘
   │                               ├ 有阻断级发现 → decision:block
   │                               │    Claude 修复代码，或写 07-response.md 说明不接受理由（≤2轮）
   │                               └ 通过 → 更新 diff 哈希，收工
   ▼
.dc/tasks/T###/ 完整留痕（建议随 git 提交备查）
```

### 完整任务时序走查（示例：修复登录偶发超时 Bug）

1. 用户输入"修复登录偶发超时的 Bug" → `task-tag` 生成 `T007`，`00-task.md` 落盘。
2. Claude 进入 plan mode，产出根因分析与修复计划，调用 `ExitPlanMode`。
3. `plan-gate` 第 1 轮：`01-plan-original.md` 落盘；agy（模型 gemini-3.1-pro）与 zcode（glm-5.3）并行审查，两者各自用检索工具阅读 `src/auth/`、超时与锁相关代码；zcode 报 high："计划把超时归因为网络抖动，实际是 `src/auth/lock.rs:88` 的锁竞争，建议……"。聚合判定=阻断 → exit 2，stderr 携带两份报告路径与摘要、以及行动指令。
4. Claude 读报告 → 写 `plan/03-response.md`（接受 zcode 发现 #1；不接受 agy 发现 #2，理由……）→ 修订计划写 `plan/04-plan-revised.md` → 再次调用 `ExitPlanMode`。
5. `plan-gate` 第 2 轮：双审通过 → 放行 → 修订后的计划才呈现给用户批准。
6. 用户批准 → Claude 按修订计划实施修复。
7. Claude 回合结束 → `code-gate`（后台异步）：diff 哈希变化 → `05-diff.patch` 快照 → 双审；agy 报 critical："修复在错误分支引入了锁未释放路径" → `decision:block` 唤醒 Claude。
8. Claude 补修复 → 写 `code/07-response.md` → 再次 Stop → 第 2 轮通过 → 哈希更新，收工。
9. `.dc/tasks/T007-登录超时/` 留下完整链条：需求、两版计划、四份审查报告、两份应答、diff、RCA。

## 5. 模块设计

### 5.1 `dc` 编排器（bash，装于 `~/.dualcritic/bin/dc`）

| 子命令 | 职责 |
|---|---|
| `dc init` | 在项目生成 `.dc/config.json`、`state.json`，合入 CLAUDE.md 协议片段 |
| `dc doctor` | 自检：git/jq/agy（存在+登录态）；探测 zcode.cjs 路径（macOS/Windows 候选）；zcode headless 冒烟；**模型覆盖探针**（实测 `--settings` 指定模型 / prompt 首行 `/model <id>` 哪种生效，结论写回 config） |
| `dc hook plan-gate` | 读 stdin 的 PreToolUse(ExitPlanMode) JSON → 存 `01-plan-original.md` → 并行双审 → 落盘报告 → 聚合判定：有 critical/high 则 exit 2（stderr=摘要+行动指令），否则放行；`.dc/config.json` 不存在或 stage 关闭时静默放行 |
| `dc hook code-gate` | 读 stdin 的 Stop JSON → 三重守卫（`stop_hook_active` 早退 / diff 哈希未变跳过 / 轮次上限）→ 快照 diff → 双审 → block（`decision:block`）或放行并更新哈希 |
| `dc hook task-tag` | UserPromptSubmit：捕获原始需求，生成/维护 T### 任务号 |
| `dc review --stage plan\|code\|bug [--model-agy X --model-zcode Y]` | 手动入口（`/dc-review` 调用），与 hook 共用核心逻辑 |

**调用细则**：两审查员并行执行；各自超时（默认 600s：agy 用 `--print-timeout`，zcode 用 `--max-turns` + 脚本级 timeout）；原始 stdout JSON 存 `.dc/logs/<时间戳>-<审查员>.json`；**fail-open**——单审查员故障/超时只生成故障报告并降级为单审继续，绝不卡死开发；阻断判定 = 任一审查员存在 severity ∈ `block_severities`（默认 `critical,high`）的发现。

### 5.2 审查员适配层

**报告 schema**（两家统一）：

```json
{ "verdict": "pass | revise",
  "findings": [ { "id": 1, "severity": "critical|high|medium|low",
                  "title": "...", "detail": "...", "location": "文件:行",
                  "suggestion": "..." } ] }
```

- **agy**：`cd <项目> && agy -p "<模板渲染的指令>" --agent dc-reviewer --output-format json --json-schema <schema> --model <stage模型> --print-timeout <s>`。`--json-schema` 强制结构化输出，取 `structured_output` 渲染报告。
- **zcode**：`node <zcode.cjs> --prompt "<指令>" --cwd <项目> --json --max-turns 40 --allowed-tools Read,Glob,Grep --attach <01-plan-original.md / 05-diff.patch>`。提示词内约定同一 schema，脚本解析；**解析失败降级**：原文落盘、标记低置信、该报告按"仅提示不阻断"处理。
- **只读物理约束**：agy 侧由 `dc-reviewer/agent.md` 限定只读工具 + 不传 skip-permissions（写操作 soft-deny）；zcode 侧由 `--allowed-tools Read,Glob,Grep` 白名单。审查员不可能改动代码。
- **审查提示词模板**（`assets/prompts/{plan,code,bug}-review.md`，中文）：角色=独立资深审查员；输入=产物绝对路径；要求亲自检索仓库核实（发挥 Agent 能力）；输出=上述 schema；禁止修改任何文件。

### 5.3 Claude Code 挂载层

**hooks**（`install.sh` 注入项目 `.claude/settings.json`；脚本在无 `.dc` 配置的项目一律 no-op，全局安装亦安全）：

```json
{ "hooks": {
    "PreToolUse": [
      { "matcher": "ExitPlanMode",
        "hooks": [{ "type": "command", "command": "$HOME/.dualcritic/bin/dc hook plan-gate",
                    "timeout": 900, "statusMessage": "双审进行中：Antigravity + ZCode 正在审查计划…" }] } ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "$HOME/.dualcritic/bin/dc hook code-gate",
                    "timeout": 900, "async": true, "asyncRewake": true }] } ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "$HOME/.dualcritic/bin/dc hook task-tag",
                    "timeout": 10 }] } ]
} }
```

计划闸门同步执行（必须在计划呈现用户前出结论），用 statusMessage 缓解等待；代码闸门异步后台执行避免冻结 UI。

**skill**（手动兜底）：`.claude/skills/dc-review/SKILL.md` → `/dc-review [plan|code|bug] [--model-agy …] [--model-zcode …]`。

**CLAUDE.md 协议**（`dc init` 合入）：告诉 Claude 被闸门阻断后的标准动作——先写 `03/07-response.md` 逐条应答（接受/不接受+理由+行动），修订计划写 `04-plan-revised.md`，修 Bug 先写 `bug/01-rca.md`；文档路径一律在 `.dc/tasks/<当前任务>/`。

### 5.4 留痕与状态（每项目 `.dc/`）

```
.dc/
├── config.json / state.json            # state: 当前任务号、diff 哈希、各闸门轮次计数
├── tasks/T001-<slug>/
│   ├── 00-task.md                      # 原始需求快照
│   ├── plan/  01-plan-original.md → 02-review-{antigravity,zcode}.md
│   │         → 03-response.md → 04-plan-revised.md
│   ├── code/  05-diff.patch → 06-review-{antigravity,zcode}.md → 07-response.md
│   └── bug/   01-rca.md（+ 同套审查/应答编号）
└── logs/                               # 审查员原始输出与运行日志
```

编号文件名即流程顺序；每份报告头部带元数据（审查员、实际使用模型、耗时、status、轮次）。

### 5.5 配置（`.dc/config.json` 全量示例）

```json
{
  "plan_review": { "enabled": true, "max_rounds": 2 },
  "code_review": { "enabled": true, "max_rounds": 2, "block_severities": ["critical", "high"] },
  "critics": {
    "antigravity": { "enabled": true, "cmd": "agy", "agent": "dc-reviewer", "timeout_s": 600,
                     "models": { "plan": "gemini-3.1-pro", "code": "gemini-3.8-flash", "bug": "gemini-3.1-pro" } },
    "zcode": { "enabled": true, "cmd": "node <doctor探测路径>", "timeout_s": 600, "max_turns": 40,
               "model_override_mode": "auto",
               "models": { "plan": "glm-5.3", "code": "glm-5.3-flash", "bug": "glm-5.2" } }
  },
  "fail_open": true
}
```

## 6. 关键决策记录（备选方案与取舍）

| # | 决策 | 备选 | 取舍理由 |
|---|---|---|---|
| D1 | 集成方式 = **shell 子进程调 headless CLI** | MCP server 化；文件信箱+定时轮询 | Antigravity 官方只有 MCP client 模式，无法被 Claude Code 当 server 调用；CLI 是两家共同的官方自动化路径，同步拿结果最直接；文件信箱无法做到"闸门"语义 |
| D2 | 计划审时点 = **PreToolUse(ExitPlanMode)，用户批准前** | PostToolUse（批准后审）；纯手动 | 用户看到的第一版计划就是被双审修订过的，形成"机器闸门→人工闸门"两级；批准后再审会造成"用户已批准却又回炉"的反复体验 |
| D3 | 代码审时点 = **Stop（按回合）** | PostToolUse(Edit\|Write)（按次编辑）；手动 | 按回合审查上下文完整、噪音低；按编辑触发会反复审查半成品 |
| D4 | **阻断式**（强制应答） | 仅提示注入 | "仅提示"容易被礼貌性忽略，违背"提高准确度"的目标；用每任务 2 轮上限 + fail-open 兜底可控性 |
| D5 | 审查员只读 = **工具白名单物理约束** | 仅提示词约束 | 提示词可被绕过；白名单让"审查员不可能改代码"成为硬保证 |
| D6 | zcode 模型指定 = **探针三档降级**（`--settings` → prompt 内 `/model` → 全局默认） | 放弃按次切换 | 无官方 `--model`；实测哪种旁路有效用哪种，最差退化为全局默认并在报告头注明 |
| D7 | 报告结构化 = **agy `--json-schema` + zcode 提示词约定**，解析失败降级原文 | 只收自由文本 | 结构化才能做严重度聚合判定；降级路径保证鲁棒 |
| D8 | 套件全局装 `~/.dualcritic` + 项目 `.dc/` 开关 | 每项目拷贝一套脚本 | hooks 脚本路径稳定；未 init 的项目自动 no-op，全局安装不误伤 |

## 7. 实施计划

**构建**（本机 Windows/Git Bash，`C:\ai_work\dualcritic\`）：

```
dualcritic/
├── install.sh                 # macOS 安装器（拷贝套件、注入 hooks、装 agy agent、跑 doctor）
├── bin/dc + bin/lib/          # 编排器与核心库（critics/render/state/common）
├── hooks/hooks.json           # hook 配置模板
├── skills/dc-review/SKILL.md  # 手动兜底命令
├── assets/prompts/            # 三份审查提示词模板
├── assets/dc-reviewer.antigravity.md
├── assets/CLAUDE.md.snippet   # 协议片段
└── README.md                  # 中文文档
```

**本机验证清单**：

1. `dc doctor`：zcode.cjs 定位 + headless 冒烟（`--json` 可解析）+ 模型覆盖探针实测结论。
2. toy git 仓库跑 `dc review --stage code`：ZCode 真实产出结构化报告并渲染 `06-review-zcode.md`。
3. 样例 stdin JSON 模拟三种 hook 载荷：验证放行 / 阻断（exit 2 与 `decision:block`）/ 防死循环守卫。
4. `agy` 本机未装 → doctor 降级 WARN（按官方 flags 编码，macOS 首次实测）。

**macOS 部署**：拷贝套件 → 安装 `agy`（`curl -fsSL https://antigravity.google/cli/install.sh | bash`）并登录一次 → `./install.sh`（装 `~/.dualcritic` + `~/.gemini/config/agents/dc-reviewer/`，注入 hooks，doctor 自检）→ 目标项目 `dc init` → 小任务端到端验证。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| Stop hook 死循环 | `stop_hook_active` 早退 + diff 哈希比对（无新改动不触发）+ 每任务 2 轮上限 + 内建 8 次 block 硬上限 |
| 审查员超时/故障 | fail-open：故障报告落盘，降级单审继续 |
| 计划闸门同步等待过长 | statusMessage 显示进度；timeout（900s）与轮次可配 |
| zcode 模型旁路全部失效 | 退化为全局默认模型，报告头注明，功能不受损 |
| 报告 JSON 解析失败 | 原文落盘 + 低置信标记 + 该报告不参与阻断判定 |
| agy 未安装/未登录 | doctor 检出即禁用该审查员并 WARN |
| 用户计划模式未启用（小任务直改） | 计划闸门自然不触发，代码闸门仍兜底覆盖 |

## 9. 待确认项（当前按推荐默认，实施前可改）

1. **部署方式**：默认"本机构建+手动拷贝部署"；可选 SSH 经 Tailscale 远程部署到 macmini。
2. **计划评审时机**：默认"先双审再给用户确认"（D2）；可选批准后审或纯手动。
3. **代码评审强度**：默认"全自动阻断式"（D4）；可选仅提示或手动。
