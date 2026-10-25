# EV-256 Windows 真实网关验收 · 判读（2026-10-25）

- 执行人：用户，Windows 开发机（`D:\Work\TriviumCode`，CC Switch 网关，本机层已开 `settings_env_source: user_settings`），安装的构建标识 `514eaca`。
- 原始输出（用户提交 `99cba8ec`）：`windows-doctor.json`、`windows-preflight.json`、`windows-watch-doctor.txt`、`windows-scan-doctor.txt`。第 4 步（真实审查）未做（可选）。
- 判读人：claude（macOS 会话），2026-10-25。

## 乱码与还原

两份 JSON 是按清单原写法 `*>` / 管道存的：Windows PowerShell 5.1 把 node 的 UTF-8 输出按 GBK 解码后再存盘，中文成了乱码，部分字节被吞，JSON 不再可解析。两份 txt 是检查脚本的纯 ASCII 输出，不受影响。判读前先用仓库自带的 `scanSecrets` 扫过四个文件：零命中。`repair-gbk-mojibake.mjs` 按 GBK 反向编码还原中文（doctor 输出 585 个字符无法还原，集中在被吞的奇数字节处），判据字段都是 ASCII 或已还原，逐行提取，不依赖整份 JSON 可解析。清单已改为先把控制台编码设成 UTF-8 再落盘。

## 第 1 步：`doctor --only claude`

| 判据 | 期望 | 读数 |
| :--- | :--- | :--- |
| 整体 | 通过 | `"ok": true`，`"blockers": []`（退出码用户未单独回报；ok 且零 blocker 即退 0 的形态） |
| 注入通道注记 | 「经子进程环境变量注入」 | `[claude] 网关 env 经子进程环境变量注入（12 键；不进命令行，值不落留痕）：受限模式在第三方网关下保住鉴权` |
| 构建 | 新构建 | notes：`编排器构建标识：514eaca …` |
| claude 版本 | — | 2.1.302 |
| `readonly_flags` | 非空 | `--restricted`、`--strict-mcp-config`、`--tools`、`Read,Grep,Glob` |
| `readonly_breach` | 不为 true | `false`（只读负对照成立、未落文件） |
| `headless_read_ok` / `json_schema_ok` | — | `true` / `true` |
| `stream_json_requires_verbose` | — | `true`（网关下阴性对照仍被干净拒绝，不是鉴权失败） |
| `project_memory_blocked` | — | `true`（记忆两臂单变量对照成立） |
| `directory_deny_verified` | 有结论 | `{ Read: true, Grep: true, Glob: true }`，目录臂 7 次调用合计约 480 s |

结论：网关键只走子进程环境变量时，`--restricted --strict-mcp-config --tools Read,Grep,Glob` 下探针各臂与目录臂在真实网关上鉴权通过、只读不变量保持。网关在事件流里回报的模型名是 `kimi-for-coding` 一族（本机 claude 网关当前为 Kimi）。

## 第 1 步同时：进程表采样（`-Watch 420`）

`process table: 314 samples; 21 processes checked, 19 of them claude executables`，`RESULT: no leak`——12 个网关键（含 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`）在采到的全部命令行里零命中。

**覆盖边界**：这次 doctor 约 10 分钟（主探针 + 目录臂约 480 s），采样窗口 420 s 没盖全。按耗时推算，采到的是主探针各臂（`routeInvocation` 出口）与目录臂的前几次（`invokeClaude` 出口）——两条出口在真实网关下都被采到、零命中；目录臂最后约 3 分钟未采样，走的是同一条代码路径。各臂逐条的进程表覆盖由 macOS 零配额 A-2 承担。清单已把采样窗口改为 900 s。

## 第 2 步：扫描落盘

`-Scan .trivium,windows-doctor.json`：`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 零命中。命中的只有三个**模型名键**：`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME`、`ANTHROPIC_DEFAULT_SONNET_MODEL_NAME`，位置是 `.trivium\config.local.yaml` 与 doctor 输出。它们的取值是网关回报的模型名，探针本来就把它记进 `models` 并落盘，属于合法出现、不是凭据。检查脚本当时对 12 个键一视同仁，所以判了 `RESULT: leak seen`；已改为模型名键（`_MODEL` / `_MODEL_NAME` 结尾）只报 `NOTE`、不计入泄漏。

## 第 3 步：预检探活

`preflight --stage code --driver codex --critics claude`：`"ok": true`、`"exit_code": 0`，「Claude Code 已认证」一格 `ok: true`、探活通过——`invokeClaude` 的探活形态（无 `--settings`）在真实网关下鉴权通过。

## 总结论

Windows 真实网关形态验收通过：env 注入下鉴权正常、只读不变量保持，进程表与落盘均未见凭据键值。第 4 步（claude 作审核者的真实审查）随后补做，见下节；未覆盖的只剩 doctor 尾段约 3 分钟的进程表采样。

## 第 4 步补做：claude 作审核者的真实审查（2026-10-25，用户提交 `b6cf09fa`）

临时主题 `ev256-win-claude`，codex 作 Driver、只选 claude 一侧，审一个临时文件（run `20261025T131133Z`，HEAD `920b63cc`）。原始输出：`windows-review-start.json`、`windows-review-wait.txt`、`windows-watch-review.txt`、`windows-scan-review.txt`、`windows-review-claude.md`（claude 审查文档的副本）。这次按 UTF-8 写法落盘，没有乱码；四个文件过 `scanSecrets` 零命中。

| 项 | 读数 |
| :--- | :--- |
| 审查调用（`claudeAdapter.run` → `invokeClaude`） | claude 侧 `state: ok`，opus 档、`agent_cli: claude/2.1.302`，用时 584 s 正常交卷；`verdict: pass-after-changes`、`evidence_ok: true`、工具调用 read 13 / grep 6 / glob 1、`run_command: 0` |
| 进程表采样（`-Watch 900`） | 671 次采样、5 个 claude 进程（含拉起前探活与审查本体），12 个网关键零命中，`RESULT: no leak` |
| 落盘扫描（本次运行目录 7 个文件、`.reviews\ev256-win-claude` 7 个文件） | 零命中（连模型名 `NOTE` 也没有，原因见下条），`RESULT: no leak` |

**运行被判作废，与 EV-256 无关**：`review --wait` 最终 `phase: failed`、退 1，原因是「被审对象在审查期间被修改」。根因在我给的步骤：采样输出 `windows-watch-review.txt` 与发起输出 `windows-review-start.json` 都写在仓库工作树里，送审补丁（3 个文件、1.7 KB）把它们一起冻结了，审查期间采样文件还在增长，跑后复算判漂移。claude 审查员本身也看到了这一点：它的 CLAUDE-01 指出送审的采样文件「只有首行、缺汇总与结论行」，`drift: true`。验收清单已补「审查期间输出写到仓库外、审完再拷进证据目录」。作废只影响这次审查结论的效力，不影响本步要验的事实：审查调用在真实网关的 env 注入下鉴权通过、跑完、命令行与落盘无凭据。

**附带观察（既有行为，不是本次引入）**：审查文档里 `model_effective` 与 `family_comparisons.right_model` 都是 `<redacted-env>`。原因是 `invokeClaude` 先对 stdout 做网关值逐值脱敏（1.2.2，`8c2d573f` 起），适配器再从脱敏后的事件流解析 `init.model`，而网关回报的模型名恰好等于 `ANTHROPIC_MODEL` 等键的值（≥ 8 字符）。后果：网关机器上回读模型丢失，却仍记 `model_effective_source: envelope`，看起来像回读成功。这正是扫描里模型名键这次零命中的原因。已登记 BACKLOG EV-257（2026-10-25，用户定走 `/dual-run` 修）。
