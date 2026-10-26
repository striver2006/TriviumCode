# 网关凭据改环境变量注入 · 测试报告（EV-256）

- **主题**：`网关凭据改环境变量注入`（`/dual-run` 命令 A 全流程，Driver claude，审核者 codex、gemini、glm）
- **日期**：2026-10-25
- **基线**：`40dbab4f`（下文行号取自该提交的源码）
- **留痕**：计划 `.reviews/网关凭据改环境变量注入/plan/`（定稿 r2）；代码审 `.reviews/网关凭据改环境变量注入/code/`；证据 [`evidence/gateway-env-injection-20261025/`](./evidence/gateway-env-injection-20261025/)
- **登记**：BACKLOG EV-256；Bug 清单 §3.1 第 14 条（闭合，Windows 真实网关形态已验）；主设计 v1.3.178（§12「第三方网关键的传法与次序」）
- **产品版本号**：不动（`package.json` 仍为 1.3.1，随 1.3.2 发版）

## 1. 问题

开了 `agents.claude.settings_env_source: user_settings` 时，`resolveClaudeRoute`（`src/trivium/adapters/claude-route.ts:119-135`）从 `~/.claude/settings.json` 的 env 段提取 `ANTHROPIC_` / `CLAUDE_` 前缀的网关键（CC Switch 写入，含凭据），`mergeSettingsEnv`（`src/trivium/adapters/claude.ts:113-131`）把它并进 `--settings` 的内联 JSON。内联载荷是 claude 子进程 argv 的一项，本机任何能列进程命令行的进程都看得到；日志与留痕里的 commandLine 已由 `scrubGatewayEnv` 逐值脱敏，进程表没有。缺省关闭，只在显式开启的机器上存在（1.2.0～1.3.1）。

带网关 env 的 claude 调用有两条执行出口、七类调用点（计划 r2 §0.1 有逐行表）：`invokeClaude`（审查调用、预检探活、目录臂 7 次、准入 / 收口脚本）与探针执行（execProbe 各臂、项目记忆两臂、verbose 阴性对照；env 都取自 `routeInvocation`）。`--version` / `--help` 只用清除补丁、不带网关键。

## 2. 修法（方案 A，2026-10-24 Windows 实测已定）

- **唯一注入函数** `claudeInvocationEnv(route)` = `{ ...route.env, ...route.settingsEnv }`（`claude-route.ts`）：先展开 `claudeRouteEnv` 的清除补丁、后展开提取出的网关键，同名键网关值胜出，父进程独有的 `ANTHROPIC_*` 仍被清除；`settingsEnv` 为空时与 `route.env` 逐键相同。`route.env` 本身不并网关键（它还给 `--version` / `--help` / 预检版本核对用）。
- **两条出口各调一次**：`invokeClaude` 的 `env` 改为 `opts.route ? claudeInvocationEnv(opts.route) : undefined`（无 route 时与修复前相同）；探针 `routeInvocation` 改为 `ctx ? claudeInvocationEnv(ctx.route) : claudeRouteEnv(null)`。
- **argv 构造器去掉网关通道**：删 `mergeSettingsEnv`、`ClaudeInvokeOptions.settingsEnv`；`buildClaudeArgs`、`probeArgs`、`projectMemoryArmArgs`、`verboseNegativeControlArgs` 不再收网关入参，`--settings` 只装 deny 规则——「某一臂仍内联」在类型层写不出来。
- doctor 注记改为「网关 env 经子进程环境变量注入（N 键；不进命令行，值不落留痕）」；相关注释与 `types.ts` 配置项说明同步。
- 不改：指纹组成与 `settingsEnvSha256`、`extractSettingsEnv` 的前缀口径、`--version` / `--help` 的 env、`scrubGatewayEnv` 对 stdout / stderr / commandLine 的脱敏。

## 3. 回归锚

### 3.1 集成套件 `test/integration/claude-gateway-env.test.ts`（新增，跨平台）

假 CLI 是 `.cjs`，路线入口取 `process.execPath`、`prefix: [脚本]`，不靠 shebang，win32 也跑。每次 spawn 记 argv、环境里 `ANTHROPIC_` / `CLAUDE_` 键名全集（只对夹具声明的键记值）与无前缀干扰键的有无，并把网关值回显进 stdout / stderr。装置先摘下宿主全部前缀变量、finally 原样放回（计划三审 CODEX-01：宿主真实令牌既不进子进程、也不进日志），再放两个父进程合成键：与 settings.json 同名的 `ANTHROPIC_AUTH_TOKEN`（钉次序）和 settings.json 没有的 `ANTHROPIC_PARENT_ONLY_EV256`（须被清除）。预期键集独立写死，不取被测提取函数的产出。

| 格 | 场景 | 断言要点 |
| :--- | :--- | :--- |
| E1–E4 | 开启：审查调用（带 deny）、探活（`settingsJson: null`）、`probeClaude` 全部探针臂、`probeClaudeDirectories` 7 次 | 每次 spawn：argv 无任何网关值、`--settings`（若有）无 `env` 段、环境前缀键恰为预期四键且值相等、干扰键不在；审查调用 argv 与 `buildClaudeArgs` 逐项相同；stdout / stderr 回显值被替换成 `<redacted-env>`、commandLine 不含网关值；探活无 `--settings`；探针臂覆盖四类按需 spawn 的臂（无 `--restricted` 的记忆对照臂、`--print` 且无 `--verbose` 的阴性对照、结构化臂、路径 deny 臂），任一缺席即红 |
| E5 | 未开启（settings.json 照样放着网关 env） | 四组调用每次 spawn：argv 无网关值、环境里没有任何前缀键（两个父进程合成键都被清除） |
| E6 | 开启但 env 段为空 / 文件不存在 | 同 E5（四组都断言，目录臂恰 7 次；代码审 GLM-02 补齐），且有注记 |
| E7 | 开启：直接调探针执行封装 `execArgv`（代码审 GLM-01 补，为此导出该函数作测试面） | 返回的 `raw`（stdout）与 `stderr` 不含任何网关值、含 `<redacted-env>`；该次 spawn 过同一谓词 |

### 3.2 单测

- `claude-adapter.test.ts`：原 G1–G4（断言内联）改写为 G1 `claudeInvocationEnv` 次序、G2 空 `settingsEnv` 时与 `route.env` 逐键相同、G3 `buildClaudeArgs` 的 `--settings` 与 deny 载荷逐字节相同；原 G4 随 `mergeSettingsEnv` 删除。G5 `extractSettingsEnv` 不动。
- `claude-events.test.ts`：原「probeArgs：settingsEnv 并进 --settings」改为 `--settings` 只装 deny、记忆两臂与阴性对照无 `--settings`。

## 4. 变异

规格由 `gen-mutation-spec.mjs` 从源码截锚点生成（每条 find 核唯一），逐条预跑（`claude-first-run-route-20261024/mutation-names.mjs`，带 `--test-timeout`、`--with-tests` 重建）后跑正式装置 `scripts/mutation-check.mjs`：**15 / 15 咬住**（`mutation-output.txt`，代码审后补 M12 / M12b 的那一轮），src 复原。各条红在对应的那句断言上（`mutation-names-output.json`；下表列首红断言，同一变异在别的格也红时不再列）：

| 编号 | 类别 | 变异 | 首红断言 |
| :--- | :--- | :--- | :--- |
| M1 / M1b | 次序颠倒 | `claudeInvocationEnv` 改为先注后清 | E1「环境前缀键须恰为提取出的那些」/ G1 |
| M2 | 出口漏注 | `invokeClaude` 只给清除补丁 | E1 同上 |
| M3 | 出口漏注 | `routeInvocation` 只给清除补丁 | E3 第 1 次探针调用的环境断言 |
| M4 | 某臂仍内联 | 记忆对照臂 `--settings` 带 env 段 | E3 第 9 次调用「argv 里出现了网关值」 |
| M5 | 某臂仍内联 | verbose 阴性对照 `--settings` 带 env 段 | E3 第 2 次调用同上 |
| M6 | 某臂仍内联 | 目录臂把网关 env 并进 deny 载荷 | E4 第 1 次同上 |
| M6b | 某臂漏注 | 目录臂拿到的路线丢了网关键 | E4 第 1 次的环境断言 |
| M7 | 某臂仍内联 | 探活形态补一份 `{"env":…}` | E2「argv 里出现了网关值」 |
| M8 | 某臂漏注 | 阴性对照绕过 `routeInvocation` 的注入 | E3 第 2 次的环境断言 |
| M9 | 键集外溢 | `extractSettingsEnv` 去掉前缀过滤 | E1「无前缀的干扰键不得注入」 |
| M10 | 脱敏丢失 | `invokeClaude` 的 stdout 不过 scrub | E1「输出与命令行不得含网关值」 |
| M11 | 零变化破坏 | 未注入时不清父进程路线变量 | E5「环境里不得有任何前缀键」 |
| M12 | 脱敏丢失 | 探针 `execArgv` 的 stdout 不过 scrub | E7「raw（stdout）：网关值须被替换」 |
| M12b | 脱敏丢失 | 探针 `execArgv` 的 stderr 不过 scrub | E7「stderr：网关值须被替换」 |

M4 / M5 / M6 在未开启格也红（变异写出的 `{"env":{}}` 同样是 env 段），属预期。代码审之前的第一轮装置是 13 / 13（无 M12 / M12b），代码审 GLM-01 指出探针侧脱敏无锚后补 E7 与这两条。

## 5. 本机零配额验收（macOS，假 CLI）

`accept-run.mjs` 对两棵树（`git archive 40dbab4f` 导出并构建的基线、当前工作树）各跑开启 / 未开启两态的四组调用，宿主前缀变量同样隔离；`accept-readout.mjs` 判读，读数 `accept-readout.txt`，全部断言通过：

- **A-1 未开启**：基线与新构建四组调用（审查 1、探活 1、探针 11（其中模型调用 9）、目录臂 7）的 argv、环境、干扰键**逐条相等**，环境里都没有前缀键——零变化。
- **A-1 开启**：基线每次模型调用的 argv 都含网关值（审查 1 / 探活 1 / 探针 9 / 目录臂 7，复现缺陷）、环境里没有网关键；新构建 argv 零含、环境前缀键恰为预期四键且值相等；**新构建 argv 恰等于「基线 argv 去掉 `--settings` 的 env 段（去完为空则连 `--settings` 一并去掉）」**——除了这一处，argv 没有别的变化。三份被测模块的 sha256 两树不同（对拍的是两份不同的产物）。
- **A-2 进程表**：假 CLI 每次多停 1.5 秒，期间每 300 ms 用 `ps -axww` 采样带本次标记的子进程命令行。基线 99 次采样采到 94 行，**89 行**带网关值、四个键全中；新构建 99 次采样采到 95 行，**零命中**。

## 6. 全量读数

代码审之前，`npm run check` 前台串行两次（开跑前确认无残留 `node --test`），读数 `check-1.txt`、`check-2.txt`：

| 次 | 用例 | 过 | 红 | 跳过 | 退出码 | 耗时 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 3989 | 3979 | 0 | 10 | 0 | 366 s |
| 2 | 3989 | 3979 | 0 | 10 | 0 | 360 s |
| 3（代码审补 E7、改 E6 与契约描述之后，`check-3.txt`） | 3990 | 3980 | 0 | 10 | 0 | 338 s |
| 4（Windows 验收判读回填文档之后，2026-10-25，`check-4.txt`） | 3990 | 3980 | 0 | 10 | 0 | 350 s |

用例数对基线 3987（EV-254 收口读数）：新增集成 3 格，删掉单测原 G4 一格，净增 2；第 3 次再多 E7 一格。

S10 `trivium verify`（`.reviews/网关凭据改环境变量注入/verify/`）：`npm run typecheck`、`npm run build`、`npm test` 三条命令均退 0，测试 3990 / 3980 / 0 / 10，349 秒。

### 6.0 双审读数

- 计划三审 1 轮（run `20261025T093105Z`）：codex 修改后通过（1 major、2 minor）、gemini 通过、glm 修改后通过（1 major、2 minor）；6 条全接受，合入 r2。
- 代码三审 1 轮（run `20261025T101812Z`）：codex 通过（零意见）、gemini 修改后通过（AGY-01：配置契约描述漂移）、glm 修改后通过（GLM-01：探针侧脱敏无锚；GLM-02：E6 未断言目录臂）；3 条全接受，按应答件改码（契约描述、E6 补断言、导出 `execArgv` 并补 E7、变异补 M12 / M12b）。

### 6.1 文档对账（计划三审 GLM-01）

同步改了七处描述网关通道的现行文档与契约：机读配置契约 `skills/dual-critic/schema/config.v2.json` 里 `settings_env_source` 的 description（代码审 AGY-01：首次对账论域只含 `skills-src/`、漏了手写的 `skills/` 契约，补改后把论域扩到 `skills/` 全目录（排除打包产物）复查，只此一处）、需求说明书第 61 行、系统设计说明书第 107 行、部署手册 §1a（第 25 行与配置片段注释）、RUNBOOK 十一节、发布包手册增补篇 `scripts/manual-supplement.md`、Bug 清单 §3.1 第 0 / 14 条；主设计新增「第三方网关键的传法与次序」一段并升 v1.3.178。收口前对 `doc/`（不含 `evidence/`）、`scripts/manual-supplement.md`、`skills-src/`、`skills/`、`README.md` 重跑「内联注入｜内联 JSON｜内联载荷｜mergeSettingsEnv｜settings_env_source」：现行文档的命中都已改成新通道，或是写明「1.2.0～1.3.1 曾经 `--settings` 内联」的历史说明；其余命中是历史测试报告、BACKLOG / 主设计变更记录里的旧条目，以及 `EV-12-实施计划.md` 里与本题无关的 `--json-schema` 内联。没有第四处遗漏。

## 7. 已知边界

1. **profile 路线与网关同开**（计划三审 GLM-03）：修复前网关键在 `--settings` 里、由 claude 进程启动后套用，网关胜出；修复后在子进程环境里，profile 路线的子进程是包装器，其 source 的 profile `export` 覆盖同名注入值，profile 胜出；profile 只覆盖部分键时可能出现「网关端点 + profile 令牌」一类混配、表现为 401。包装器行为属外部实现，**按机制推理、未实测**；只登记不改码，部署手册 §1a 写了排障第一步。该开关为 Windows 上 CC Switch 的 native 路线而设，同开没有已知使用者。
2. **暴露面**：从「本机全部进程可见的命令行」缩到「claude 子进程的环境块」。同一用户的进程仍可读（POSIX `/proc/〈pid〉/environ` 仅属主可读；macOS 读别的进程环境要更高权限；Windows 无便捷的跨进程环境读取）。
3. **`scrubGatewayEnv` 的残余**不变：截断 / 折行 / 再编码形态的泄漏不在原串替换射程内，与既有模式脱敏口径同一。
4. **Windows 自动回归**：新集成套件不靠 shebang，按设计在 win32 也跑；本次只在 macOS 跑过，Windows 全量时一并核对。

## 8. Windows 真实网关验收（2026-10-25，用户执行，通过）

本机 macOS 没开 `settings_env_source`，真实网关形态只能在 Windows 开发机验，会动用凭据、花少量配额。清单与只读检查脚本：[`evidence/gateway-env-injection-20261025/windows-acceptance.md`](./evidence/gateway-env-injection-20261025/windows-acceptance.md)、`check-gateway-exposure.ps1`（只输出键名与计数，不打印任何值；纯 ASCII，Windows PowerShell 5.1 可直接跑）。用户在 Windows 开发机（CC Switch 网关，claude 2.1.302，安装构建 `514eaca`）跑了第 0～3 步，原始输出在提交 `99cba8ec`，判读全文见 [`windows-readout.md`](./evidence/gateway-env-injection-20261025/windows-readout.md)：

| 项 | 读数 |
| :--- | :--- |
| `doctor --only claude` | ok、零 blocker；注记「网关 env 经子进程环境变量注入（12 键；不进命令行，值不落留痕）」；`readonly_flags` 为四项受限组合、`readonly_breach: false`、`headless_read_ok` / `json_schema_ok` / `stream_json_requires_verbose` / `project_memory_blocked` 均 true、目录臂 Read / Grep / Glob 均 true |
| 进程表采样（`-Watch 420`） | 314 次采样、19 个 claude 进程，12 个网关键零命中 |
| 落盘扫描（`.trivium`、doctor 输出） | `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 零命中；三个模型名键命中，取值是网关回报的模型名（`kimi-for-coding` 一族），探针本就记录，属合法出现 |
| 预检探活（`preflight --critics claude`） | ok、退 0，「Claude Code 已认证」探活通过 |

**两处如实登记**：①首轮输出按清单原写法（`*>` / 管道）存盘，Windows PowerShell 5.1 把 node 的 UTF-8 输出按 GBK 解码，两份 JSON 中文乱码、不可整份解析；判读用 `repair-gbk-mojibake.mjs` 还原后逐字段提取（判据字段均可读），清单已改为先设 UTF-8 控制台编码、用 `Out-File -Encoding utf8` 落盘。检查脚本当时把模型名键也报成 `LEAK`，已改为只报 `NOTE`。②这次 doctor 约 10 分钟，采样窗口 420 s 没盖全，目录臂尾段约 3 分钟未采样（同一代码路径，两条出口均已在真实网关下采到）；清单已把窗口改为 900 s。第 4 步（claude 作审核者的真实审查）随后补做（用户提交 `b6cf09fa`）：claude 侧 opus 档 584 s 正常交卷、`verdict: pass-after-changes`；进程表 671 次采样、5 个 claude 进程零命中；本次运行目录与归档扫描零命中。那次运行本身被判作废（「被审对象在审查期间被修改」），根因是我给的步骤把采样与发起输出写进了仓库工作树、送审补丁把它们一起冻结，与 EV-256 无关；清单已补「审查期间输出写到仓库外」。附带观察到一条既有行为：网关回报的模型名等于 `ANTHROPIC_MODEL` 等键的值时，`invokeClaude` 的逐值脱敏先于 `init.model` 解析，`model_effective` 被记成 `<redacted-env>` 而来源仍写 `envelope`（1.2.2 起），已登记 BACKLOG EV-257。详见 `windows-readout.md` 末节。
