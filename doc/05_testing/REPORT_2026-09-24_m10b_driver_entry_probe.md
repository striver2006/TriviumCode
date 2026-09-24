# M10b 第 1 步 · 准入实测报告（进行中）

> **状态**：进行中。本稿只收已取得的读数；每格三态（true / false / null），未测的格记「未测」。
> **上位**：`.reviews/M10b-入口资产与真载体验收/plan/2026-09-24-M10b-入口资产与真载体验收-r5-claude.md` §4
> **日期**：2026-09-24（首次落笔）

## 0. 抬头：版本

| 项 | 值 | 取法 |
| :--- | :--- | :--- |
| 本仓 HEAD | `de5fb76` | `git rev-parse HEAD` |
| Claude Code | 2.1.280 | `preflight` |
| Codex CLI | 0.156.1 | `preflight` |
| Antigravity（agy） | 1.2.9 | `preflight` |
| ZCode CLI | 0.16.9 | `preflight` |
| ZCode 桌面端 | 3.14.3 | `Info.plist` `CFBundleShortVersionString` |
| ZCode CLI 入口 | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，14 820 819 字节，mtime 2026-09-22 11:10:24，sha256 前 16 位 `b1df2ef3e5bd76c4` | `stat`、`shasum -a 256` |

> 入口文件的 mtime 晚于 EV-82 判失效的运行（2026-09-21 14:53Z），版本串未变。EV-82 诊断说明已据此加注「环境漂移不可排除」。

## 1. agy：skills 加载行为（§4.1）

未测。

## 2. codex：`$ARGUMENTS` 展开（§4.2）

未测。

## 3. zcode

### 3.1 Hook 形态（§4.3.1）：静态核（**已测**）

扫描对象是上述入口文件，只读，用 python 按字面检索（本机 `grep` 为 ugrep，长上下文模式超出其复杂度限制）。
符号名是打包后的混淆名，只作定位用，**不作判据**；判据是字面量与结构。

| 问题 | 读数 | 三态 |
| :--- | :--- | :--- |
| 是否支持 Hook | `PreToolUse` 27 处、`hookEventName` 58 处、`permissionDecision` 11 处；事件枚举 `SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop`，每项带 `matcher` 字符串 | **true**（静态） |
| Hook 配置从哪里来 | ①插件目录下的 `hooks/hooks.json`（`listPluginHookSources` / `loadPluginHookSource`），与 Claude Code 插件、本仓 `skills/dual-critic/hooks/hooks.json` 同形；②分层设置的 `hooks` 键，层级 System / User / Project / Session / Env / Cli；Project 层文件疑为 `<项目>/.zcode/config.json`（`".zcode/config.json"` 3 处）；workspace 级 hooks 设置带审阅流程（`settingsSection:"hooks"`、`settingsScope:"workspace"`、`reviewFlowId`），疑需用户信任确认 | 来源 ① **true**（静态）；Project 层路径 **null**（待行为实测） |
| 读不读 `.claude/settings.json` | 字面 `.claude/settings` 零处、`settings.local.json` 零处 | **false**（静态）：ZCode 不会自动沿用本仓 `.claude/settings.json` 里的 Hook |
| 命令型 Hook 的 stdin 负载形态 | 兼容层（混淆名 `T0n`）把内部负载转成 Claude Code 蛇形字段：`hook_event_name`、`permission_mode`、`session_id`、`tool_name`、`tool_input`、`tool_use_id`、`transcript_path`（写到临时目录 `zcode-claude-hook-*` 下）；PostToolUse 另加 `tool_response` | **true**（静态）：`hooks.ts` 读的 `tool_input` / `tool_name` 能拿到 |
| 命令型 Hook 的环境变量 | `CLAUDE_CODE_SESSION_ID`、`CLAUDE_PROJECT_DIR`（取 `cwd` 或工作目录）、`CLAUDE_SESSION_ID`、`ZCODE_PROJECT_DIR`、`ZCODE_SESSION_ID`；插件型另加 `CLAUDE_PLUGIN_ROOT` / `ZCODE_PLUGIN_ROOT` 等 | **true**（静态）：本仓守卫脚本依赖的 `${CLAUDE_PROJECT_DIR}` 有值 |
| 拒写语义（`exit 2` 是否拒） | 未测 | **null**（待行为实测：注册一条 `exit 2` 的 Hook，触发一次写工具调用） |
| 超时语义（r5 §4.3.1 新增） | 未测 | **null**（待行为实测） |

### 3.2 写类工具全集（§4.3.3）：来源 ①二进制字面（**已测**）；来源 ②会话实测（未测）

| 读数 | 出处（字面） |
| :--- | :--- |
| 工具注册表：`Read, Write, Edit, ApplyPatch, Bash, Glob, Grep, WebFetch, WebSearch, web_search, TodoRead, TodoWrite, GoalRead, ReadSessionContext, AskUserQuestion, SendMessage, RespondToCoordinator, TaskOutput, TaskStop, …` | 工具名数组 |
| 分类表：`Write` / `Edit` / `ApplyPatch` ⇒ `file-write`；`Bash` ⇒ `shell` | 工具分类映射 |
| `isWriteTool` = `Write, Edit, ApplyPatch, Bash`；`isDestructiveTool` = `Bash` | 能力判定函数 |
| **Hook matcher 别名**：`hookMatcherToolNamesForTool` 的映射含 `["ApplyPatch", ["Write","Edit"]]`，调用处以 `matchValues: RNe(t.name)` 传入。即 ApplyPatch 触发 Hook 时同时按 `ApplyPatch`、`Write`、`Edit` 三个名字匹配 matcher | 匹配值映射 |
| `MultiEdit` 字面**零处**；`NotebookEdit` 2 处但**不在**工具注册表内 | 全文检索 |

**对 r5 的影响**（只报告，不改计划）：

1. 本仓 `zcode-trace.ts` 的 `ZCODE_WRITE_TOOLS` 登记了 `MultiEdit` 与 `NotebookEdit`，按本入口它们不存在。那是 headless 轨迹用的只读 denylist，多登记不会漏拦，**不构成缺陷**；但 §4.3.3「全集」以来源 ① 为准时，写类工具是 **Write / Edit / ApplyPatch（file-write）+ Bash（shell）**。
2. matcher 别名意味着：沿用 `Edit|Write` 形态的 matcher，名字层面**可能已经覆盖** ApplyPatch。§6.1 条件 2(i) 仍以行为实测为准。
3. **ApplyPatch 的 `tool_input` 键形态未取到**：注册表里有名字，但静态检索没有定位到它的输入 schema。这正是 §6.1 条件 2(ii)「按目标判」要实测的一格：若它只带 patch 正文、不带 `extractTargetPath` 认得的路径键，写侧会对它**静默放行**。**null**，待来源 ② 实测。

### 3.3 真载体（P-a）：**true**

- **做法**：用户在 ZCode 桌面端打开工作区 `/Users/chenzhenbo/Work/TriviumCode`，新建会话，要求它用终端工具执行
  `.trivium/bin/trivium preflight --stage plan --json; echo "EXIT=$?"` 并原样贴出输出。
- **原始输出**（用户贴回，2026-09-24）：`"ok": true`、`"scope": "plan"`，11 项检查全部 `ok: true`，末行 `EXIT=0`，JSON 内 `"exit_code": 0`。
- **边界**：三家「已认证」一格都走了缓存（「0.61h 前探活通过」），本次没有真实探活。P-a 只验「一条只读 CLI 调用能在 ZCode 会话里跑通」（r5 §3.2），走缓存不影响结论。
- **留痕佐证**：见 3.4，调用本体、时间与退出码都能在 ZCode 本地留痕里对上，不只凭用户转贴。

**P-a 成立。** r5 §3.2：第 2 步的开工前提满足。

### 3.4 会话留痕与会话标识（§4.3.2）

| 问题 | 读数 | 三态 |
| :--- | :--- | :--- |
| 1 交互会话把工具调用记在哪里、记不记命令原文 | **与 headless 同一处**：`~/.zcode/cli/rollout/model-io-sess_<会话 ID>.jsonl`。本次会话 `sess_13624e01-2592-42f6-9a85-f19c23a69637`，3 行、每行一次模型请求，字段 `startedAt / completedAt / durationMs / requestId / model / request / response / sessionId / querySource / traceId / turnId`。第 0 行响应里有工具调用 `Bash`，输入 `{"command": ".trivium/bin/trivium preflight --stage plan --json; echo \"EXIT=$?\"", "description": "在项目根目录执行 trivium preflight 阶段检查"}`；第 1 行请求里带回的工具结果含 `EXIT=0`。时间 03:34:52Z～03:35:06Z | **true** |
| 1′（**超出预期**）留痕记不记 Driver 实际用的模型 | **记**：每行 `model` 为 `GLM-5.3` | **true**。r5 §4.3.2 末段写「会话留痕证明不了该会话的模型就是 GLM」，对 ZCode 这一家**不再成立**：rollout 逐请求记模型。这是 EV-107 根本解（采集 Driver 生效模型）在 zcode 侧的一个现成数据源，只登记、不在本里程碑展开 |
| 2 会不会向 shell 工具注入会话标识环境变量 | 未测。静态读到的只是**命令型 Hook** 的环境注入 `CLAUDE_SESSION_ID` / `ZCODE_SESSION_ID`；shell 工具环境未核 | **null**（下次让会话执行 `env \| grep -i session` 一类只读命令即可判） |
| 3 留痕里有没有凭据字段 | 本次只按字段名抽取了时间、模型、工具调用三类，没有整份读 `request` / `response` 正文；是否含凭据**未核** | **null**。§7.1 摘录照旧只取工具调用那几行 |

**对 J4 的意义**：J4 的载体证据可以落在这份 rollout 上：同一 run_id 的 `review --start` 工具调用 + 每条请求的 `model`。r5 §10.3 R-o（载体证据拿不到）的风险**基本解除**，剩「会话标识是否进 shell 环境」一格。

**对 §4.3.3 的顺带读数**：交互会话的 shell 工具名是 `Bash`（与 headless 注册表同名），输入键是 `command`（不是路径键），D3 的 Bash 侧判据按 `command` 文本判，与 Claude Code 同形。

## 4. claude

基线，无需实测（§4.5）。

## 5. 嵌套枚举一臂（§4.4）

未测。
