# EV-258 第二轮 Windows 真实网关验收判读

- 执行：用户，Windows 开发机，2026-10-26 至 10-27；构建 `935e9a8`（doctor 注记：安装副本与当前工作树一致，作用面与构建时一致）；claude 2.1.302
- 网关：CC Switch，Qwen
- 原始输出：同目录 `windows-*`（用户提交 `6ca03bad` 第 0、1 步，`f93af4f4` 第 2～4 步）。判读前对全部 9 份跑过 `scanSecrets`，零命中；`windows-doctor.json`（686 KB）只按字段读取，未整份打印。
- 清单：同目录 `windows-acceptance.md`

**结论：四步全部通过。** 大写 `[1M]` 后缀的模型名键全部豁免，凭据类键照旧替换；探针原文与审查文档的 `init.model` / `model_effective` 逐字为 `qwen3.8-max[1M]`、来源 `envelope`；`trace.json` 的 `modelReadback` 判为一致；落盘零泄漏。

## 第 0 步：两个自检——通过

- 扫描器自检（`windows-scan-self-test.txt`）：三格全 `✓`，末行 `SELF-TEST PASS`。
- 码点诊断自检（`windows-diag-self-test.txt`）：17 格全 `✓`，首格「构建自证为『是』」，末行 `SELF-TEST PASS`。

## 第 1 步：逐键诊断——通过

| 项 | 期望 | 实测 |
| :--- | :--- | :--- |
| 首行 | `dist/test 含第二轮代码：是` | 是 |
| 带后缀的模型名键 | 两列 `Y`，码点 `U+005B U+0031 U+004D U+005D` | **6 个**键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE,HAIKU}_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`）全部「像模型名」`Y`、「豁免」`Y`，码点逐个一致；值 `qwen3.8-max[1M]`（OPUS / FABLE / SUBAGENT）、`qwen3.8-flash[1M]`（MODEL / SONNET / HAIKU） |
| `*_MODEL_NAME` 四键 | 豁免 `Y`、无后缀 | 符合 |
| 凭据类键 | 豁免 `N`、只有长度 | `ANTHROPIC_BASE_URL` 62、`ANTHROPIC_AUTH_TOKEN` 116 |
| 替换集 | 恰为两个凭据值的长度 | `116, 62`（第一轮验收时是 4 个值，多出的两个正是被吞的模型名） |
| 「已按产品口径脱敏」标注 | 无 | 无 |

与清单的一处差异：`ANTHROPIC_DEFAULT_HAIKU_MODEL` 这次也带 `[1M]`（前两次判读里不带后缀，清单把它和 `*_MODEL_NAME` 归为一类），所以带后缀的键是 6 个而非 5 个。推断是两次验收之间 CC Switch 配置变了（未核实）。它同样豁免、码点一致，不影响判定。〈OPUS 值〉= `qwen3.8-max[1M]`。

## 第 2 步：doctor——通过

| 项 | 期望 | 实测 |
| :--- | :--- | :--- |
| doctor 结论 | 退 0 | 文件里 `ok: true`、`blockers: []`（退出码打在控制台、未进文件） |
| 探针原文 `\"model\":\"<redacted-env>\"` | 0 处 | **0 处**（EV-257 验收时目录臂 7 次全是它） |
| 探针原文 `\"model\":\"…\"` | `init.model` 等于〈OPUS 值〉，另有不带后缀的名 | `qwen3.8-max[1M]` 14 处、`qwen3.8-max` 140 处，无其它取值 |
| `model_flag` | 不为 `null` | `false`（按别名 `opus` 选模型、回读全名，既有口径） |
| `readonly_flags` / `readonly_breach` / `directory_deny_verified` | 非空 / 不为 true / 有结论 | `--restricted --strict-mcp-config --tools Read,Grep,Glob` / `false` / Read、Grep、Glob 均 `true` |

唯一告警「Claude native 被拒操作留痕未证实……」是既有口径，与本题无关。doctor 注记写明「网关 env 经子进程环境变量注入（12 键；不进命令行，凭据值不落留痕）」。

## 第 3 步：claude 作审核者的真实审查——通过

run `20261026T162541Z`（主题 `ev258b-win-claude`，Driver codex、只选 claude、opus 档），约 5 分 36 秒，claude 侧 `pass`。启动输出里那段 `NativeCommandError` 是 PowerShell 把 stderr 上的「本轮只跑 claude 一侧」提示包装成错误记录，返回 `ok: true`，不是失败。

| 项 | 期望 | 实测 |
| :--- | :--- | :--- |
| claude 侧 | 正常交卷 | `verdict: pass`、`evidence_ok: true`、`degraded: false`、`drift: false` |
| `model_effective` | 逐字等于〈OPUS 值〉 | `qwen3.8-max[1M]` |
| `model_effective_source` | `envelope` | `envelope` |
| `family_comparisons` 的 `right_model` / `right_source` | 同上 | `qwen3.8-max[1M]` / `envelope`（`status: unknown` 是因为左侧 codex 作 Driver 未声明模型） |
| `trace.json` 的 `modelReadback` | `init` 为〈OPUS 值〉、`reported` 去后缀、`consistent` true | `{ init: "qwen3.8-max[1M]", reported: ["qwen3.8-max"], consistent: true }` |

清单第 3 步那段「打印 `model_effective` 后缀码点」的输出没有进交回的文件；`model_effective` 的值与第 1 步逐字相同，可替代。

## 第 4 步：落盘扫描——通过

`windows-scan.txt`：首行「凭据类键 2 个、豁免模型名键 10 个」，10 个豁免键含第 1 步那 6 个带后缀的键；无 `LEAK` 行；末行 `RESULT: no leak`。扫描范围含 `.trivium`、运行目录（`stdout.jsonl`、`trace.json`、`worker.log`）、临时主题归档与 `%TEMP%\ev258b`，`NOTE` 行都是模型名键的值，预期内。

## 收口

EV-258 两轮修复在 Windows 真实网关上验收通过。第一轮失败的根因（CC Switch 写大写 `[1M]`、片段只认小写）已由第二轮修掉；本次第 1 步码点逐字核过，期望值没有再从形状推断。
