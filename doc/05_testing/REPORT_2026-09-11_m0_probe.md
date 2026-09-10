# M0 探针本机实测报告（本机坑清单）

> - **作者 / 负责人**：Chen Zhenbo（由 Claude Code 执行实测）
> - **创建日期**：2026-09-11
> - **当前版本**：v1.0.0
> - **状态**：草稿(Draft) —— Antigravity 侧全部完成（已由 `trivium doctor` 代码化复现），ZCode 侧阻塞待解
> - **依据**：[设计 v1.2.0](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md) §3.5 探针必测清单、§16.1 里程碑 M0
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
| `zcode` | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` **0.16.5** | ⚠️ CLI 未配置模型 provider |
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
| `zcode.model_override` | ⚠️ **`config_copy`**（`env` 档已证伪，见 C-07；`--settings` 被拒，见 C-09 → 只能靠 `ZCODE_HOME`） | 见 §6 |
| `zcode.trace_source` | 候选已定位：`~/.zcode/cli/log/zcode-<YYYY-MM-DD>.jsonl`（JSONL，含 `sessionId`/`turnId`/`traceId`/`context.model`），**已用它定位到两次失败根因**，可用性强 | 见 §6 |
| `zcode.response_field` | ⏳ 未测（headless 未跑通） | — |
| `zcode.path_deny` | ⏳ 未测（阻塞） | — |
| `zcode.scratch_paths` | ⏳ 未测（阻塞） | — |
| `verify.commands` | ⏳ 未测 | — |

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

## 6. ZCode 侧：阻塞

### 6.1 阻塞原因

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

### 6.2 阻塞前已确立的结论

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
| **P-10** | ZCode「已登录」不等于「可用」：凭据与桌面端共享，但模型 provider 配置 CLI 侧独立且可能缺失 | 预检若只查凭据会漏判，跑到一半才失败 | 预检必须真跑一次最小 headless（P-08 的加强版）；错误分类要区分 `provider_not_configured` 与鉴权失败 |
| **P-09** | `~/.zcode/v2/config.json` 内的 provider **apiKey 为明文**，且其中一个正是 `<id>.<secret>` 形态 | 该形态若混入归档就是安全事故 | 已作为 `archive` 密钥扫描器（§10.5）的真实用例；扫描器只存正则不存值。**另：已建议用户轮换该批 key** |

## 8. 与设计文档的冲突项（待回补修订）

| # | 设计记载 | 实测 | 处置 |
| :--- | :--- | :--- | :--- |
| C-01 | §3.3「`--max-turns <n>`」列为可用参数 | 被拒绝 | 从 §11.3 调用模板删除；改由探针结论决定 |
| C-02 | §11.5 profiles 中 ZCode 模型写作 `GLM-5.3` | 必须 `<providerId>/GLM-5.3` | profiles 保留人类可读短名，由适配层按探针的 `model_id_form` 补全前缀 |
| C-03 | §3.5「`agy.pty_required`：管道下 stdout 是否为空」 | 本机 stdout 正常，`false` | 探针保留（其它机器可能不同），但不再是必经路径 |
| C-04 | §10.1 第 ③ 道假定路径级 deny「探针可用时注入」 | agy 侧不可用 | 按 §18.1 #12 默认降级；plugin hook 方案列为 M3 候选 |
| C-05 | §3.5「`zcode.trace_source`：`~/.zcode/**/rollout/*.jsonl` 或 `log/*.jsonl`」 | 确认为 `~/.zcode/cli/log/zcode-<date>.jsonl` | 钉死路径模板 |
| C-06 | §12.2「Antigravity 侧同时设置 `--print-timeout`（进程内）与脚本级 timeout」 | `--print-timeout` 到期 exit 0 | 脚本级超时成为唯一可靠判据（P-07） |
| **C-07** | §3.3 与 §11.3 要点 1：「**`ZCODE_MODEL` 环境变量优先于配置文件**」，且列为模型覆盖三档的**首选** `env` 档 | **zcode.cjs 0.16.5 中不存在裸 `ZCODE_MODEL`**，只有 `ZCODE_MODEL_RETRY_*` 与 `ZCODE_MODEL_TELEMETRY_ENABLED` | **`env` 档作废**。模型覆盖降为两档：`config_copy`（首选）→ `global`。§11.3 调用模板中的 `ZCODE_MODEL=...` 前缀须删除；仓库 `.env.example` 中的 `ZCODE_MODEL` 已改为注释并标注失效 |
| **C-09** | §3.3「`--allowed-tools` 在 `--help` 中列出但**实测报 Unknown option**（版本相关）」——只点名了这一个 | 实测**四个** flag 均被拒绝：`--allowed-tools`、`--max-turns`、`--permission-mode`、**`--settings`** | `--settings` 被拒是新增的关键约束：ZCode 的独立配置副本**不能**用 `--settings <path>` 注入，只能靠 `ZCODE_HOME` 环境变量。§11.3 调用模板须相应修改 |
| **C-08** | §3.5「`zcode.home_isolation`：实测独立 `HOME` / `ZCODE_HOME` / 独立 settings 路径中首个可用者」列为**仅按需启用** | `ZCODE_HOME`、`ZCODE_DATA_BASE_DIR`、`ZCODE_STORAGE_DIR`、`ZCODE_LOG_DIR`、`ZCODE_API_KEY`、`ZCODE_BASE_URL` 均存在 | 因 C-07 使 `env` 档作废，`config_copy` 成为模型覆盖的**唯一可用手段**，故 `zcode.isolation` 从「按需」升为**必需**。附带收益：`ZCODE_LOG_DIR` 可让每次运行的会话日志天然隔离，轨迹提取不再需要按 `sessionId` 匹配 |

## 9. 下一步

1. **需要用户动作**：配置 ZCode CLI 的模型 provider（`~/.zcode/cli/config.json`，或 `zcode login`），
   之后才能完成 `zcode.*` 六项探针与契约样本录制。
2. 补完 `agy.json_schema_ok`（`--json-schema` 强制结构化输出）。
3. ~~把本报告的结论编码进 `src/trivium/doctor.ts`~~ **已完成**：`trivium doctor [--only agy|zcode|env] [--no-model-calls]`
   已可复现全部结论并增量落盘到 `.trivium/config.local.yaml`。
   两处实现要点值得记录：
   - `--only` 必须以**已落盘结论为基线增量合并**，否则会清空未探测那一侧的结论；
   - ZCode 的 flag 探针把 `ZCODE_HOME` 指向空目录，使配置解析必然失败，
     从而在**零配额消耗**下拿到参数接受性矩阵。
4. 录制两侧真实 stdout 样本到 `test/fixtures/recordings/`，供契约测试回放（§17.1）。
