# M0 探针本机实测报告（本机坑清单）

> - **作者 / 负责人**：Chen Zhenbo（由 Claude Code 执行实测）
> - **创建日期**：2026-09-11
> - **当前版本**：v1.1.0
> - **状态**：评审中(In-Review) —— **两侧探针全部完成**，均已由 `trivium doctor` 代码化复现
> - **依据**：[设计 v1.2.0](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) §3.5 探针必测清单、§16.1 里程碑 M0
> - **机读副本**：`.trivium/config.local.yaml` 的 `probe:` 段（不进 Git）

## 0. 为什么有这份报告

设计原则 **P7「能力靠探针，不靠记忆」**：三家 CLI 的参数与行为随版本漂移，实现代码一律读 `trivium doctor` 的探针结论，**不得把设计文档里的命令行硬编码进代码**。本报告是探针结论的人读副本，同时记录实测与设计第 3 章记载不一致之处——按 §16.2 纪律 1，这类冲突**改适配层，不改外部产品，也不改验收口径**，并回补修订设计文档。

## 1. 环境基线

| 项 | 实测值 | 判定 |
| :--- | :--- | :--- |
| 平台 | darwin 25.6.0 / arm64 (Apple Silicon) | ✅ |
| `node` | `/opt/homebrew/bin/node` **v25.2.1** | ✅ ≥ 18 |
| `git` | 2.50.1 (Apple Git-155) | ✅ |
| `agy` | `/Users/chenzhenbo/.local/bin/agy` **1.2.0** | ✅ |
| `zcode` | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` **0.16.5** | ✅（需手工创建 CLI 侧 `config.json`，见 §6.3） |
| `timeout` / `gtimeout` | **不存在**（本机无 GNU coreutils） | ⚠️ 见坑 P-01 |

## 2. 探针结论总表

| 探针项 | 结论 | 证据 |
| :--- | :--- | :--- |
| `node` | `/opt/homebrew/bin/node`，v25.2.1 | `node -v` |
| `git` | 2.50.1 | `git --version` |
| `agy.bin` | `/Users/chenzhenbo/.local/bin/agy` | `agy --version` |
| `agy.version` | **1.2.0**（实测期间从 1.1.27 自升级） | 见坑 P-02 |
| `agy.models` | 15 个 slug，设计 §11.5 profiles 引用的 `gemini-3.1-pro-high` / `gemini-3.8-flash-high` / `gemini-3.8-flash-low` **全部真实存在** | `agy models` |
| **`agy.headless_read_ok`** | ✅ **true**（有前提，见坑 P-03） | 见 §3 |
| `agy.pty_required` | **false** —— 管道下 stdout 正常，无需 `script -q /dev/null` 包装 | 5 次运行均拿到完整 stream-json |
| `agy.json_schema_ok` | ✅ **true** —— `--json-schema` 能强制出可解析的结构化输出，agy 侧**不需要** `parse_fallback` 降级路径 | `trivium doctor --only agy` |
| **`agy.path_deny`** | ❌ **supported: false** | 见 §4 |
| **`agy.scratch_paths`** | ✅ **`[]`**（项目根零污染） | 见 §5 |
| `agy.isolation` | `shared`（无需独立 HOME） | 见 §4 |
| `agy.trace_source` | **`stream-json` 自身**，无需外部日志 | 见 §3.2 |
| `zcode.entry` | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` | `zcode.cjs version` |
| `zcode.version` | 0.16.5 | 同上 |
| `zcode.readonly_flags` | ✅ **接受**：`--mode plan` / `--mode yolo` / `--disallowed-tools` / `--cwd` / `--json` / `--no-color`；**拒绝**：`--allowed-tools` / `--max-turns` / `--permission-mode` / `--settings`（见坑 P-05、冲突 C-09） | `trivium doctor --only zcode` |
| `zcode.model_override` | ✅ **`config_copy`**，`isolation` = **`home_copy`**。rollout 回读到 `model.source=config`，直接印证该档位 | 见 §6.4、冲突 C-07 / C-08 / C-09 |
| `zcode.trace_source` | ✅ `~/.zcode/cli/log/zcode-<date>.jsonl` —— 提供工具**名**、调用计数、`context.model`、结构化失败根因。**不含任何路径字段** | 见 §6.4 |
| `zcode.trace_args_source`（新增） | ✅ `~/.zcode/cli/rollout/model-io-<sessionId>.jsonl` —— 提供工具**参数**（含文件路径）与 `model.source`。AC-04 轨迹核验与 AC-11 `consulted` 交叉核对的**唯一**取值点 | 见 §6.4、冲突 C-12 |
| `zcode.response_field` | ✅ **`response`**（设计记载正确）。envelope 字段全集：`sessionId` / `traceId` / `turnId` / `response` / `usage` / `eventCount` / `projection`——**无 `model` 字段** | `trivium doctor --only zcode` |
| `zcode.path_deny` | ❌ **supported: false** —— denylist 是**工具级**而非路径级，封掉一条读路径模型会换另一条 | 见 §6.5 |
| `zcode.scratch_paths` | ✅ **`[]`**（项目根零污染，与 agy 侧一致） | `trivium doctor --only zcode` |
| `verify.commands` | ✅ 候选 `build=[npm run build, npm run typecheck]` / `test=[npm test]`。**只探测不执行**，须经 `init` 逐条确认 | `trivium doctor` |

## 3. Antigravity headless 只读审查：可用配方（重要）

### 3.1 issue #548 在本机确认复现，且已被化解

**默认调用会产生「exit 0 但一个文件都没读」的空审查**——正是设计 R1 的头号风险：

```
stderr: jetski: no output produced — a tool required the "command" permission that
        headless mode cannot prompt for, so it was auto-denied.
result: {"status":"SUCCESS","response":"","denied_actions":[{"action":"command","display_name":"RunCommand"}]}
```

模型选择了 `run_command`（`pwd`）而非读文件工具，该工具在 headless 下被软拒绝。

**化解配方（不使用 `--dangerously-skip-permissions`，符合 AD-07；不改动用户的日常 settings，符合 §16.2 纪律 5）：**

1. **自定义只读 Agent** `~/.gemini/config/agents/trivium-critic/agent.md`，`tools:` 白名单只含
   `view_file` / `grep_search` / `find_by_name` / `list_dir` / `finish`。
   **不含 `run_command`** —— 从根上避开被软拒绝的命令权限。
2. **BRIEF 必须给绝对路径**。实测 `find_by_name` 传 `SearchDirectory: "."` 直接 `ERROR`，
   工具**只接受绝对路径**。且模型不知道自己的 cwd（无 `run_command` 就无法 `pwd`），
   不给绝对路径它会跑到 `/Users/<you>/` 乱翻。
   这与设计 §9.4 第 3 段「被审对象的**真实路径**」本就一致，现在有了硬性理由。

验证结果（第 3 次尝试）：

```
轨迹: view_file(AbsolutePath=<fixture>/README.md) ACTIVE → DONE
result: status=SUCCESS, denied_actions=None
response: "SENTINEL_OPEN_7f3a2b themis fixture readme\n"   ← 哨兵命中
```

### 3.2 `stream-json` 就是工具轨迹来源

无需另找日志文件。事件形状：

| 事件 | 关键字段 |
| :--- | :--- |
| `init` | `conversation_id`、`init.model`、`init.cwd`、`init.tools[]`、`init.permission_mode` |
| `step_update` | `step_index`、`state`(`ACTIVE`/`DONE`/`ERROR`)、`step_type`(`user_input`/`agent_response`/`tool`)、`tool_name`、`tool_info.parameters`、`duration_seconds`、`usage` |
| `result` | `status`、`response`、`duration_seconds`、`num_turns`、`usage`、**`denied_actions[]`** |

对设计的直接价值：
- `step_type == "tool"` 的事件即 §11.4 的工具轨迹，`tool_info.parameters.AbsolutePath` 可直接用于 `deny_paths` 轨迹核验与 `consulted` 交叉核对；
- **`denied_actions[]` 是官方的机读软拒绝信号**（1.1.27 引入），比「响应为空」更可靠，应作为 `evidence_ok=false` 的一级判据；
- `init.tools[]` 报告的是**完整注册表**而非 Agent 白名单，**不能**用它证明只读——只读证明必须靠轨迹中实际出现的工具名。

## 4. `agy.path_deny` = 不支持（结论有据）

Antigravity 的权限授权语法是 `action(target)`，实测/反编译得到的合法 action 为
`command` / `unsandboxed` / `mcp` / `url` / `read`。其中 **`read` 是 GitHub 集成的仓库读取授权**
（校验消息为 `invalid grant: org and repo are required`、`reads are repo-wide`），**不是文件系统路径**。

文件访问相关的控制项只有粗粒度的：

| 机制 | 粒度 | 能否用于 deny 单个文件 |
| :--- | :--- | :--- |
| `settings.fileAccessPolicy` | 枚举 `AGENT_SETTING_POLICY_{ALLOW,ASK,DENY,UNSPECIFIED}`，作用于整个作用域 | ❌ 过粗，会连被审对象一起挡掉 |
| `allowNonWorkspaceAccess` / `isWorkspaceOnly` | 工作区边界 | ❌ `deny_paths` 就在项目根内，边界挡不住 |
| `allow_agent_access_gitignore_files` | `.gitignore` 命中的文件 | ❌ 对方产出必须进 Git，不能靠 gitignore |
| Agent `tools:` 白名单 | 工具级 | ❌ 不区分路径 |

否定对照已做：不加任何 deny 时，agy **确实**读到了对方产出（哨兵 `SENTINEL_PEER_9c4d1e` 出现在响应里）。

**记录**：`probe.agy.path_deny = {supported: false, rule_syntax: null}`。
按设计 §18.1 #12 的默认，**不阻断启动**：第 ③ 道屏蔽退化为「BRIEF 禁读清单 + 事后轨迹核验」两层，
`run.json.guard.peer_deny_applied.gemini = false`，审查文档 front-matter 标 `peer_deny: false`。

**尚未排除的一条路（留给 M3）**：agy 支持 `PreToolUse` / `PostToolUse` 生命周期 Hook，
但**只能通过 plugin 注册**（`plugins/<name>/hooks.json`），且二进制中存在 `unknown pre-tool hook decision %q`
（说明 Hook 可以返回 deny 决定）。这是一条真正的路径级 deny 载体，但需要向用户的 plugin 集安装一个
TriviumCode plugin。**本次未测**，作为 M3 的候选加固项，需先征得用户同意。

## 5. `agy.scratch_paths` = `[]`

夹具仓库跑完 5 次 agy（含一次模型在文件系统里到处乱翻的运行）后：

```
git status --porcelain -uall   → 空
baseline tree = eca0c88e2e93e6564a6cbc30629497db10e4637c
current  tree = eca0c88e2e93e6564a6cbc30629497db10e4637c   ← 完全一致
```

会话缓存、trajectory、conversation 全部落在 `~/.gemini/antigravity-cli/` 下（项目外）。

**结论**：Antigravity 侧的只读指纹比对**不需要任何白名单**，任何项目根内的新增/修改都可直接判定为
`readonly_breach` 或开发者漂移。这比设计预期（需要白名单）更干净。

## 6. ZCode 侧

### 6.1 曾经的阻塞与解法

ZCode **CLI 的凭据与模型配置独立于桌面端**（设计 §3.3 记载属实），而本机 CLI 侧未配置：

```
Error: Model config is missing. Create /Users/chenzhenbo/.zcode/cli/config.json
       with an explicit model provider before running ZCode.
```

传 `ZCODE_MODEL` 时错误变为 `Model provider is missing an API key: <providerId>`。
桌面端的 provider 配置在 `~/.zcode/v2/config.json`，CLI 读的是 `~/.zcode/cli/config.json`，两者不通。

**注意这不是登录问题**：`~/.zcode/v2/credentials.json` 中 `oauth:bigmodel:access_token` 与
`oauth:active_provider` 均在，且 CLI 于 2026-09-10T21:03 成功跑过
`builtin:bigmodel-coding-plan/GLM-5.3-Flash`（见 `~/.zcode/cli/log/`）。
`~/.zcode/cli/` 下 `agents/ artifacts/ db/ exec/ log/ rollout/` 俱全，**唯独缺 `config.json`**。
所以 `zcode login` 并不能解开，需要的是让 CLI 侧落一份模型 provider 配置
（最省事的做法：开一次 TUI 用 `/model` 选定模型）。

**这正是设计 §8.1 预检应当拦截的情形**（「ZCode 已认证」检查失败 → 中止，退出码 69），
预检逻辑无需修改。但预检的实现必须**真跑一次最小 headless**，
只检查凭据文件存在会漏判（凭据在、配置缺，照样跑不通）。

### 6.2 参数与模型覆盖

- `--mode plan` / `--mode yolo` / `--disallowed-tools` / `--cwd` / `--json` / `--no-color` / `--prompt` **被接受**；
- **`--max-turns`、`--allowed-tools`、`--permission-mode`、`--settings` 四个均被拒绝**（`Unknown option '<flag>'`），
  尽管它们都出现在 `--help` 中。其中 `--settings` 被拒直接影响隔离方案（见 C-09）；
- 参数解析发生在配置解析与模型调用**之前**，因此 flag 探针把 `ZCODE_HOME` 指向空目录即可
  在零配额消耗下拿到完整的接受/拒绝矩阵——这一手法已固化进 `probeReadonlyFlags`；
- `ZCODE_MODEL` 环境变量**确实进入模型解析链路**（日志 `context.model` 回读到了传入值），
  即 `model_override = env` 档可用，但值必须是 `<providerId>/<modelName>` 全限定形态；
- `~/.zcode/cli/log/zcode-<date>.jsonl` 作为 `trace_source` **可用性已验证**：
  两次失败的根因都是从中定位的，日志含 `traceId` / `sessionId` / `turnId` / `context.model` / 结构化 `error.cause`；
- 另发现更丰富的轨迹源 `~/.zcode/cli/rollout/model-io-sess_<sessionId>.jsonl`（单会话可达 11MB 的完整模型 I/O），
  设计 §3.3 猜测的 `~/.zcode/**/rollout/*.jsonl` **确认存在**；
- **`ZCODE_MODEL` 环境变量在 0.16.5 中不存在**（见冲突项 C-07）；
- 但 `ZCODE_HOME` / `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` / `ZCODE_LOG_DIR` / `ZCODE_API_KEY` / `ZCODE_BASE_URL`
  **均存在**，`model_override` 的 `config_copy` 档与 `isolation` 的独立配置副本方案因此可行（见 C-08）;
- 模型来源枚举在二进制中为 `{Default, Config, Env, Cli, Session, Agent, Tool}`——`Env` 档存在，
  但对应的不是 `ZCODE_MODEL`，具体键名待 CLI 跑通后回读确认。

### 6.3 已实测验证的 CLI 配置最小结构

在隔离的临时 `HOME` 下以**占位 key** 验证过：错误从 `Model config is missing`
变为 `Unauthorized` / `Provider authentication failed`（`cause.code = provider_not_configured`），
说明配置被正确解析、provider 被解析、请求已发出，仅 key 无效。**结构因此确认可用**。

```json
{
  "provider": {
    "bigmodel-coding-plan": {
      "name": "BigModel / 智谱 Coding Plan",
      "kind": "anthropic",
      "options": {
        "apiKey": "<由用户填写，编排器不经手>",
        "baseURL": "https://open.bigmodel.cn/api/anthropic"
      },
      "source": "custom",
      "models": { "GLM-5.3": {}, "GLM-5.3-Flash": {} }
    }
  },
  "model": {
    "main": "bigmodel-coding-plan/GLM-5.3",
    "lite": "bigmodel-coding-plan/GLM-5.3-Flash"
  }
}
```

- 路径：`<HOME>/.zcode/cli/config.json`（默认 HOME 即 `~/.zcode/cli/config.json`）。
- `provider` 各字段的取值可从应用内置目录
  `/Applications/ZCode.app/Contents/Resources/model-providers/models_catalog_*.json`
  查到（`schemaVersion: zcode.model-providers.v1`，含 `bigmodel` / `bigmodel-coding-plan` /
  `zai` / `zai-coding-plan` 等 provider 的 `endpoints` 与模型列表）。
- `model.main` / `model.lite` 必须是 `<providerId>/<modelName>` 全限定形态（坑 P-06）。
- 这同时就是模型覆盖的实现形态：编排器为每次运行生成一份独立 HOME + `config.json` 副本
  （`isolation: home_copy`），把该次要用的模型写进 `model.main`。

### 6.4 证据链需要**两个**文件

这是 ZCode 侧最容易踩的坑：单一日志不足以支撑验收。

| 文件 | 提供 | 缺什么 |
| :--- | :--- | :--- |
| `~/.zcode/cli/log/zcode-<date>.jsonl` | 工具**名**、`tool.call.{started,completed,failed}` 状态、调用计数、`context.model`、结构化 `error.cause` | **任何路径字段**。`context` 只有 `queryId`/`turnNumber`/`model`/`iteration`/`querySource`/`toolName` |
| `~/.zcode/cli/rollout/model-io-<sessionId>.jsonl` | `response.toolCalls[] = {id, name, input}`，`input` 内含 `file_path` / `path` / `pattern`；另有 `model.{modelId,providerId,role,source}` | 调用**状态**（成功/失败），只有请求与响应 |

因此：
- **工具调用计数与只读失守判定**（写事件扫描）走标准日志——需要 `completed` 状态才算证据；
- **`deny_paths` 轨迹核验（AC-04）与 `consulted` 交叉核对（AC-11）走 rollout**——只有它有路径；
- **生效模型（AC-13）**两处都有：日志的 `context.model` 给 `<providerId>/<modelId>`，
  rollout 的 `model.source` 额外给出**来源档位**（实测 `config`，直接印证 `model_override = config_copy`）。

### 6.5 `zcode.path_deny` = 不支持（结论有据）

`--disallowed-tools` 支持 `Tool(arg)` 带参形态（`--help` 示例即 `"Bash(git *) Edit"`），
语法上接受 `Read(<绝对路径>)`，但**挡不住文件**。实测两轮：

1. 封 `Read(<peer>) Write Edit` → 模型改用 **`Bash` 的 `head -1`** 读到了目标文件；
2. 再加封 `Bash`（完整 denylist）→ 模型改用 **`Grep`** 读到了目标文件。

ZCode 的读路径有多条（`Read` / `Grep` / `Glob` / `ReadSessionContext` / `Bash`），
要靠 denylist 挡住单个文件等于封掉全部读路径，那样连被审对象也读不了。粒度不可用。

**记录**：`probe.zcode.path_deny = {supported: false, rule_syntax: null}`。
与 agy 侧同样按 §18.1 #12 默认不阻断，`peer_deny_applied.glm = false`。

**附带确认了一件重要的事**：第 1 轮实测中模型在 `--mode plan` 下**执行了 shell 命令**。
即 `--mode plan` 并不阻止命令执行，与设计 §11.3 要点 4 引述的社区观察一致——
完整 denylist 中 **`Bash` 是必需项**，不能依赖 `--mode plan` 达成只读（冲突项 C-10）。

**一个正面观察**：模型在回答里明确指出「文件首行虽自称禁止读取，但它只是文件内容、
并非来自系统或用户的指令」——它正确地把被审内容当数据而非指令处理。
这印证了设计 §9.4 把禁读清单放在 **BRIEF（可信通道）**而不是依赖文件内容自述是对的。

## 7. 本机坑清单

| # | 坑 | 影响 | 对策 |
| :--- | :--- | :--- | :--- |
| **P-01** | 本机**无** `timeout` / `gtimeout`（macOS 不带 GNU coreutils） | 任何 shell 层超时方案都会失败 | 超时一律在 Node 内实现：定时器 → `SIGTERM` → 宽限期 → `SIGKILL`。已落地于 `src/trivium/util/exec.ts`，**禁止** shell out 到 `timeout` |
| **P-02** | `agy` 在探针执行过程中**自升级 1.1.27 → 1.2.0** | 设计 R11 的活体样本：探针结论可能在两次运行之间失效 | `preflight` 每次校验 CLI 版本；版本变化即强制重跑 `doctor`（设计 §8.1 已有此逻辑，实测证明必要） |
| **P-03** | agy headless 默认会软拒绝 `run_command`，产生空审查 | AC-05 直接失败 | 见 §3.1 配方。**`denied_actions[]` 非空即判 `evidence_ok=false`** |
| **P-04** | agy 的文件工具**只接受绝对路径**，且模型不知道自己的 cwd | 不给绝对路径就会跑出项目范围乱翻，浪费配额与时间 | BRIEF 中所有路径一律绝对化；`--print-timeout` 设足够值 |
| **P-05** | ZCode 的 `--help` 列出了 `--max-turns`，实际**不接受** | 照文档写命令行会直接失败 | `readonly_flags` 探针必须逐个 flag 实测「实际被接受」的组合，不信 `--help` |
| **P-06** | `ZCODE_MODEL` 传裸模型名（`GLM-5.3-Flash`）会落到错误 provider 并报缺 `ANTHROPIC_API_KEY` | 模型路由静默走错，AC-13 失败 | 必须传 `<providerId>/<modelName>` 全限定 id；`doctor` 需回读并记录本机的规范写法 |
| **P-07** | agy 1.1.28 起 **`--print-timeout` 到期不再非零退出**，而是返回部分输出并 exit 0 + stderr 警告 | 编排器若靠退出码判超时会把超时当成功 | 超时判定必须靠编排器自己的墙钟计时 + stderr 警告匹配，**不能**只看退出码 |
| **P-08** | ZCode CLI 凭据/模型配置与桌面端**完全隔离** | 桌面端能用不代表 CLI 能用 | `preflight` 的「ZCode 已认证」检查必须真跑一次最小 headless，不能只检查桌面端配置 |
| **P-13** | ZCode `--json` 的 stdout **不是纯 JSON**：前面可能有 `AI SDK Warning System: …` 等告警行 | `JSON.parse(stdout.trim())` 必然失败，会被误判为「输出不可解析」而触发无谓的 `parse_fallback` | 必须做括号配平扫描把 envelope 抠出来（已实现为 `extractJsonEnvelope`，含字符串内花括号与转义引号的用例） |
| **P-14** | rollout 文件名是 `model-io-<sessionId>.jsonl`，而 `sessionId` **本身已带 `sess_` 前缀** | 拼成 `model-io-sess_${sessionId}` 会得到 `model-io-sess_sess_…` 而永远找不到文件（本次实现真的踩了一次） | 路径模板固定为 `model-io-{sessionId}.jsonl` |
| **P-15** | ZCode envelope 里**没有 `model` 字段** | 无法从返回值直接回读生效模型，AC-13 会缺证据 | 生效模型从日志 `context.model` 或 rollout `model.{providerId,modelId}` 回读；两者皆不可得时记 `unverified`，不采信请求值 |
| **P-11** | `zcode.cjs` **无法单独拉起 TUI**：报 `Cannot find package '@zcode/tui'`。TUI 只存在于桌面应用的 `app.asar` 内，磁盘上既无 `zcode-tui-runtime/`，也无 SEA 单文件可执行版 | 「开一次 TUI 生成配置」这条路走不通 | CLI 侧配置必须**手工创建**。已实测验证的最小结构见 §6.3 |
| **P-12** | ZCode 的配置根**只认 `HOME`**。`ZCODE_HOME` 等专用变量看似存在（二进制中有该字符串）但对配置解析无效 | 按变量名推断隔离方案会失败 | 隔离一律走独立 `HOME`（`home_copy`），并把凭据写入该 HOME 下的 `config.json` 副本 |
| **P-10** | ZCode「已登录」不等于「可用」：凭据与桌面端共享，但模型 provider 配置 CLI 侧独立且可能缺失 | 预检若只查凭据会漏判，跑到一半才失败 | 预检必须真跑一次最小 headless（P-08 的加强版）；错误分类要区分 `provider_not_configured` 与鉴权失败 |
| **P-16** | agy 1.2.0 拒绝「自带档位的模型 slug + `--effort`」组合：`--model gemini-3.8-flash-high --effort medium` 直接非零退出，报 `conflicts with --effort=medium` | 一次真实代码审在 5.6s 内失败、白烧一次调用。**plan 阶段恰好 slug 与 effort 都是 `high`，一致所以从未暴露**；code 阶段配的是 `medium`，一跑就中 | slug 自带 `-high\|-medium\|-low` 后缀时**不传** `--effort`（slug 是权威，它来自探针回读的模型目录；`critics.gemini.effort` 只是配置意图）。见 `adapters/agy.ts` 的 `modelEncodesEffort` |
| **P-17** | agy headless 的 `-p` 进程**只存活约 10 秒**，随后工作转交给一个常驻 **hub 进程**（`agy --hub --hub-port=<n> --app_data_dir=antigravity --add-dir=<项目根>`）。该 hub 在本次运行之前**就已存在**（实测启动时间早于本次运行 8.5 小时） | 「运行期间 `ps` 能看到 agy 进程」这条验收判据按字面理解会失败；更重要的是：hub 跨运行复用，**独立 `HOME` 之类的隔离手段对它不生效** | 验收改看 hub 的 `--add-dir` 与 cwd；隔离结论以 `probe.agy.isolation` 为准，不要假设每次运行都有独立的 agy 进程空间 |
| **P-18** | ZCode 的 headless 进程把进程名改成 **`zcode-cli`**（另有 `zcode-node-repl-mcp` 辅助进程），`ps`/`pgrep` 里**看不到 `zcode.cjs`** | `pgrep -f 'zcode\.cjs'` 恒为空，按它做存活检查或验收会误判「没跑起来」 | 认 `zcode-cli` 这个进程名；cwd 实测确为项目根（`lsof -a -d cwd`）|
| **P-09** | `~/.zcode/v2/config.json` 内的 provider **apiKey 为明文**，且其中一个正是 `<id>.<secret>` 形态 | 该形态若混入归档就是安全事故 | 已作为 `archive` 密钥扫描器（§10.5）的真实用例；扫描器只存正则不存值。**另：已建议用户轮换该批 key** |

## 8. 与设计文档的冲突项

> **回补状态**：C-01～C-12 已于 2026-09-11 全部回补进设计 v1.2.1（第 3、10、11、12 章），见该文变更记录。本节保留为实测证据与判定过程的原始记录。

| # | 设计记载 | 实测 | 处置 |
| :--- | :--- | :--- | :--- |
| C-01 | §3.3「`--max-turns <n>`」列为可用参数 | 被拒绝 | 从 §11.3 调用模板删除；改由探针结论决定 |
| C-02 | §11.5 profiles 中 ZCode 模型写作 `GLM-5.3` | 必须 `<providerId>/GLM-5.3` | profiles 保留人类可读短名，由适配层按探针的 `model_id_form` 补全前缀 |
| C-03 | §3.5「`agy.pty_required`：管道下 stdout 是否为空」 | 本机 stdout 正常，`false` | 探针保留（其它机器可能不同），但不再是必经路径 |
| C-04 | §10.1 第 ③ 道假定路径级 deny「探针可用时注入」 | agy 侧不可用 | 按 §18.1 #12 默认降级；plugin hook 方案列为 M3 候选 |
| C-05 | §3.5「`zcode.trace_source`：`~/.zcode/**/rollout/*.jsonl` 或 `log/*.jsonl`」 | 确认为 `~/.zcode/cli/log/zcode-<date>.jsonl` | 钉死路径模板 |
| C-06 | §12.2「Antigravity 侧同时设置 `--print-timeout`（进程内）与脚本级 timeout」 | `--print-timeout` 到期 exit 0 | 脚本级超时成为唯一可靠判据（P-07） |
| **C-07** | §3.3 与 §11.3 要点 1：「**`ZCODE_MODEL` 环境变量优先于配置文件**」，且列为模型覆盖三档的**首选** `env` 档 | **zcode.cjs 0.16.5 中不存在裸 `ZCODE_MODEL`**，只有 `ZCODE_MODEL_RETRY_*` 与 `ZCODE_MODEL_TELEMETRY_ENABLED` | **`env` 档作废**。模型覆盖降为两档：`config_copy`（首选）→ `global`。§11.3 调用模板中的 `ZCODE_MODEL=...` 前缀须删除；仓库 `.env.example` 中的 `ZCODE_MODEL` 已改为注释并标注失效 |
| **C-10** | §11.3 要点 4 把「`--mode plan` 仍允许子 Agent 探索」标为「社区观察，中，必须探针」 | **实测证实**：`--mode plan` 下模型执行了 `head -1` shell 命令 | `--mode plan` 不可作为只读手段单独使用，完整 denylist 中 `Bash` 为**必需项**；`readonly_flags` 固定为 `--mode plan` + 含 `Bash` 的完整 denylist |
| **C-11** | §3.5「`zcode.path_deny`：同上，实测 `--disallowed-tools` / 配置文件 / `AGENTS.md` 之外是否存在路径级读取拒绝机制」 | 不存在。denylist 为**工具级**，封一条读路径模型换另一条（实测 `Bash` → `Grep`） | `supported: false`，与 agy 侧一同按 §18.1 #12 默认降级 |
| **C-12** | §3.3「一期从会话日志（`~/.zcode/**/rollout/*.jsonl` 或 `log/*.jsonl`，探针钉死路径）提取读文件次数」——把两者当作**二选一** | 两者**都需要**：`log/` 有工具名与状态但无路径，`rollout/` 有路径但无状态 | `probe.zcode` 新增 `trace_args_source` 字段，适配层同时读两处（详见 §6.4） |
| **C-09** | §3.3「`--allowed-tools` 在 `--help` 中列出但**实测报 Unknown option**（版本相关）」——只点名了这一个 | 实测**四个** flag 均被拒绝：`--allowed-tools`、`--max-turns`、`--permission-mode`、**`--settings`** | `--settings` 被拒是新增的关键约束：ZCode 的独立配置副本**不能**用 `--settings <path>` 注入，只能靠 `ZCODE_HOME` 环境变量。§11.3 调用模板须相应修改 |
| **C-08** | §3.5「`zcode.home_isolation`：实测独立 `HOME` / `ZCODE_HOME` / 独立 settings 路径中首个可用者」列为**仅按需启用** | 实测**只有 `HOME` 生效**。`ZCODE_HOME`、`ZCODE_DATA_BASE_DIR`、`ZCODE_STORAGE_DIR` 对配置解析**全部无效**（错误信息仍指向 `~/.zcode/cli/config.json`）；`--settings` 参数被拒（C-09） | 因 C-07 使 `env` 档作废、C-09 使 `--settings` 不可用，`config_copy` 成为模型覆盖的**唯一**手段，而它只能靠**独立 `HOME`** 实现。故 `zcode.isolation` 从「按需」升为**必需**，且取值锁定为 `home_copy`。代价：独立 HOME 下 `~/.zcode` 凭据不存在，必须把 `apiKey` 写进该 HOME 的 `config.json` 副本 |

## 9. M0 完成情况与下一步

**M0 完成判据（设计 §16.1）逐条核对**：

| 判据 | 状态 |
| :--- | :--- |
| 拿到两侧**真实可用**的 headless 命令模板 | ✅ 均已跑通并固化进适配层（agy 见 §3.1，zcode 见 §6.2） |
| 只读生效 | ⚠️ 部分：工具层可裁剪（agy 靠 Agent 白名单、zcode 靠完整 denylist 含 `Bash`），但**两侧都无文件系统级事前阻断**，按 ADR-001 由事后指纹与轨迹核验兜底 |
| 能读文件 | ✅ 两侧哨兵均命中 |
| 能换模型 | ✅ agy 用 `--model`（未知 slug 直接非零退出）；zcode 用独立 HOME 的 `config.json` 副本，且 `model.source` 可回读 |
| 能拿轨迹 | ✅ agy 用 `stream-json` 自身；zcode 需**两个**文件（§6.4） |
| 路径 deny 是否可用**已知** | ✅ 两侧均为 `false`，且各自跑过否定对照 |
| 临时文件白名单**已知** | ✅ 两侧均为 `[]` |

**下一步**：

1. 录制两侧真实 stdout 样本到 `test/fixtures/recordings/`，供契约测试回放（§17.1）。
   目前契约测试用的是**手工构造但取自实测形状**的样本，已覆盖两侧解析器的关键分支。
3. ~~把本报告的结论编码进 `src/trivium/doctor.ts`~~ **已完成**：`trivium doctor [--only agy|zcode|env] [--no-model-calls]`
   已可复现全部结论并增量落盘到 `.trivium/config.local.yaml`。
   两处实现要点值得记录：
   - `--only` 必须以**已落盘结论为基线增量合并**，否则会清空未探测那一侧的结论；
   - ZCode 的 flag 探针把 `ZCODE_HOME` 指向空目录，使配置解析必然失败，
     从而在**零配额消耗**下拿到参数接受性矩阵。
4. 录制两侧真实 stdout 样本到 `test/fixtures/recordings/`，供契约测试回放（§17.1）。
