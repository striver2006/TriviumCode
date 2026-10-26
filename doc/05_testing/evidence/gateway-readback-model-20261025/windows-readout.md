# EV-257 Windows 真实网关验收判读

- 执行：用户，Windows 开发机，2026-10-26；构建 `f1ca93bb`（安装副本已重装）
- 网关：CC Switch，**Qwen**（qwen3.8 系列；EV-256 验收时是 Kimi，网关已换）
- 原始输出在 Windows 的 `%TEMP%\ev257\`，尚未拷进本目录；本文按用户贴回会话的终端输出整理

## 第 1 步：doctor——不通过（与第 2 步同因）

`doctor --only claude`：`ok: true`、`blockers: []`；只读与目录臂结论与 EV-256 验收时相同（`readonly_flags` 非空、`readonly_breach: false`、`directory_deny_verified` 三工具全 true）。注记为「网关 env 经子进程环境变量注入（12 键；不进命令行，**凭据值**不落留痕）」、构建标识 `f1ca93b`，确认装的是新构建。

| 项 | 期望 | 实测 |
| :--- | :--- | :--- |
| `model_flag`（顶层与 `routes.native`） | `true` | `null`（EV-256 验收时是 `false`）——回读被吞，按 EV-257 改为「没核对成」，兜底生效 |
| 探针原文 `system/init` 的 `model` | 网关模型名 | `<redacted-env>`（目录臂 7 次全部如此，均为 `--model opus`） |

探针原文里另有三处同一次调用的模型信息，可还原被吞的是什么：

- `result.modelUsage` 的键是 `<redacted-env>`，其 `canonicalModel` 是 `qwen3.8-max[1m]`；
- stderr 有一行 `[claude-code:unrecognized_model] {"model":"<redacted-env>",…}`；
- **assistant 消息的 `message.model` 是 `qwen3.8-max`（不带后缀），未被替换**——它恰等于豁免键 `ANTHROPIC_DEFAULT_OPUS_MODEL_NAME` 的值。

由此：`init.model` 是 CLI 把别名 `opus` 按 `ANTHROPIC_DEFAULT_OPUS_MODEL` 解析出的配置值 `qwen3.8-max[1m]`（带上下文窗口后缀），而网关在 API 响应里回报的模型名是 `qwen3.8-max`。两者不是同一个量：前者是「CLI 打算用什么」，后者才是「服务端说它用了什么」。EV-257 只读 `init.model`；EV-258 计划阶段应一并定下 AC-20 的回读口径取哪个（或两者如何组合）。

## 第 2 步：claude 作审核者的真实审查——不通过

临时主题 `ev257-win-claude`，codex 作 Driver、只选 claude 一侧（opus 档），审一个临时文件（run `20261026T104519Z`，HEAD `f1ca93bb`）。`review --wait` 退 0。

| 项 | 期望 | 实测 |
| :--- | :--- | :--- |
| `model_effective` | 网关模型名 | `null` |
| `model_effective_source` | `envelope` | `unverified` |
| `family_comparisons` 的 `right_model` / `right_source` | 同上 | `null` / `null` |
| 运行目录 `claude\out\trace.json` 第 4 行 | 网关模型名 | `"model": "<redacted-env>"` |

回读兜底按设计生效（占位符没有以 `envelope` 落盘），但网关回报的模型名仍被逐值替换吞掉。

## 诊断：settings.json env 段各键过四道守卫的情况

诊断脚本导入构建产物的 `extractSettingsEnv`、`isModelNameKey`、`looksLikeModelName`、`gatewayScrubPlan`，凭据类键只打印长度，模型名键打印守卫结果与「形状」（字母换 `a`、数字换 `9`），只有已豁免的键打印原值。终端输出因 PowerShell 5.1 按 GBK 读 UTF-8 文件成了乱码，字段顺序可辨，下表按字段顺序还原。

| 键 | 长度 | 形状 | 豁免 | 守卫2 | 守卫3 | 守卫4 | 推得的值 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ANTHROPIC_BASE_URL` | 62 | —（凭据类） | — | — | — | — | — |
| `ANTHROPIC_AUTH_TOKEN` | 116 | —（凭据类） | — | — | — | — | — |
| `ANTHROPIC_MODEL` | 17 | `aaaa9.9-aaaaa[9a]` | 否 | ✓ | ✗ | ✗ | `qwen3.8-flash[1m]` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 17 | `aaaa9.9-aaaaa[9a]` | 否 | ✓ | ✗ | ✗ | `qwen3.8-flash[1m]` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 15 | `aaaa9.9-aaa[9a]` | 否 | ✓ | ✗ | ✗ | `qwen3.8-max[1m]` |
| `ANTHROPIC_DEFAULT_FABLE_MODEL` | 15 | `aaaa9.9-aaa[9a]` | 否 | ✓ | ✗ | ✗ | `qwen3.8-max[1m]` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | 15 | `aaaa9.9-aaa[9a]` | 否 | ✓ | ✗ | ✗ | `qwen3.8-max[1m]` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 13 | `aaaa9.9-aaaaa` | 是 | ✓ | ✓ | ✓ | `qwen3.8-flash` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME` | 13 | `aaaa9.9-aaaaa` | 是 | ✓ | ✓ | ✓ | `qwen3.8-flash` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL_NAME` | 13 | `aaaa9.9-aaaaa` | 是 | ✓ | ✓ | ✓ | `qwen3.8-flash` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_NAME` | 11 | `aaaa9.9-aaa` | 是 | ✓ | ✓ | ✓ | `qwen3.8-max` |
| `ANTHROPIC_DEFAULT_FABLE_MODEL_NAME` | 11 | `aaaa9.9-aaa` | 是 | ✓ | ✓ | ✓ | `qwen3.8-max` |

## 结论

**根因：守卫 4（`looksLikeModelName`）的字符集 `[\w./:+-]` 不含方括号**，CC Switch 写进生效模型名键的 Claude Code 上下文窗口后缀 `[1m]` 被判为不像模型名，这几个键留在替换集。opus 档的审查里网关回报 `qwen3.8-max[1m]`，被整串替换成占位符，回读记 null 与 `unverified`。

守卫 3 显示 ✗ 不是独立原因：同值的几个模型名键都卡在守卫 4、被当作非豁免键，彼此「与凭据同值」；守卫 4 放行后它们会一并成为豁免候选，守卫 3 随之通过。

凭据类键（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`）照旧在替换集，本次未见凭据值泄漏（第 3 步落盘扫描读数待用户补）。

EV-257 的回归锚与 macOS 零配额对拍都没有覆盖带后缀的模型名形态，这一缺口登记为 BACKLOG **EV-258**（用户定新开条目、走 `/dual-run`）。第 1 步 doctor 已回传、同因（见上）；第 3 步扫描读数尚未回传。doctor 原始输出在 Windows 的 `%TEMP%\ev257\windows-doctor.json`，待第 4 步统一拷入本目录。
