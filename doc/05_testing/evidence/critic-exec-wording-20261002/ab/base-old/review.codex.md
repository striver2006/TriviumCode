---
schema: trivium.review.v1
topic: exec-wording-ab
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.159.2
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20261002T014420Z
rerun_index: 1
snapshot_hash: sha256:6e47b7e5af6b81c110086767e5c2361cf4bc482f06acc93241fa0f7d2c17afe5
blind: true
started_at: 2026-10-02T01:44:20.800Z
finished_at: 2026-10-02T01:54:18.026Z
duration_s: 167
tool_calls:
  run_command: 7
  project_reads: 2
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 2
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0fa48-a8fd-74c1-a964-4436dd94142e
---

# 计划审查：exec-wording-ab

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20261002T014420Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

已结合实际仓库与本机 shell 独立复测原稿 §2 的核心断言：在 macOS 自带 /bin/bash 3.2.57(1)-release（arm64-apple-darwin26）默认模式（posix off、errexit off）下，`true 2>&/dev/null` 的退出码是 **1**，且标准错误打印 “/dev/null: ambiguous redirect”——原稿「退出码是 0（与 zsh 一致）」的说法不成立（zsh 下实测确为 0，正是该差异被错误外推）。此断言是计划「不需要改成 2>/dev/null」的唯一依据，方向性错误。另按 §4 在当前工作树验证会立即失败：Makefile 并无 quiet 目标（仅 run 目标），`make quiet` 实测 rc=2；现行 scripts/quiet.sh 包装任何命令都返回 1 并吞掉其全部输出，§1「静音 stderr、只透传退出码」的目标在现写法下双双落空。全部复测只用只读命令，未修改任何文件。

**结论**：`request-changes`

## 审查意见（共 4 条：阻断 1 ｜ 重要 2 ｜ 次要 1）

### CODEX-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§2 关键断言（「在 macOS 自带的 /bin/bash 3.2 默认模式下，`true 2>&/dev/null` 的退出码是 0」）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：退出码断言与实测不符。我得到的退出码是 1：bash 把 `2>&/dev/null` 解析为重定向符 `>&` 后跟非法目标，报 ambiguous redirect，重定向失败导致命令不执行，$? 为 1；zsh 则把 `2>&word` 解析为「stdout 重定向到 word 并 dup stderr」，得到 0。该断言是计划拒绝修正写法的唯一论据，计划在前提层面即错，实施后必然返工。

**依据**：实测（只读）：`/bin/bash -p -c 'true 2>&/dev/null; echo rc=$?; echo $BASH_VERSION; set -o'` → rc=1、ambiguous redirect、BASH_VERSION=3.2.57(1)-release、posix off；带 `set -o posix` 复测仍 rc=1；对照 `/bin/zsh -c 'true 2>&/dev/null'` → rc=0。被审文档 §2 与 scripts/quiet.sh 第 4 行。

**建议**：更正 §2：如实记录 bash 3.2 下实测退出码为 1 并给出 ambiguous redirect 证据；据此要么采纳 `2>/dev/null`，要么给出另一种经 bash 3.2 实测通过的重定向写法后再决策，不得以「与 zsh 一致」作为保留现写法的理由。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/quiet.sh 第 4 行 "$@" 2>&/dev/null；对照 §1 目标` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：按现写法实施后 §1 两个目标同时落空：重定向在包装命令执行前就失败，被包装命令根本不会运行（stdout/stderr 全丢），且任何退出码都被统一变成 1——「只透传退出码」不成立；泄漏到标准错误的还是脚本自身的报错而非被包装命令的，「静音」同样不成立。计划因 §2 的错误断言完全没有察觉这一点。

**依据**：实测（只读）：`/bin/bash -p ./scripts/quiet.sh true` → rc=1、stderr 输出 ambiguous redirect；`/bin/bash -p ./scripts/quiet.sh sh -c 'echo out; echo err >&2; exit 7'` → rc=1 且无任何输出（7 被吞）；对照 `/bin/bash -p -c 'true 2>/dev/null'` rc=0。README.md 声明「运行环境：macOS 自带的 /bin/bash（3.2）」，即该缺陷覆盖项目声明的全部目标环境。

**建议**：计划应把第 4 行改为经 bash 3.2 实测验证的写法（如 `2>/dev/null`），并以实测证据（成功/失败两类被包装命令的退出码）写进关键断言一节，而不是停留在推理。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§3 变更（「Makefile 新增 quiet 目标（已存在，见 Makefile）」）、§4 验证（「`make quiet` 退出码为 0 即通过」）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§3 对现状的描述不实：Makefile 只有 run 目标，不存在 quiet 目标，「已存在」系误读。因此 §4 的验收动作在当前工作树直接失败（No rule to make target 'quiet'，实测 rc=2），按字面执行永远过不了；计划也没有决策 quiet 目标应包什么命令、以何种参数调用 quiet.sh，属未决策项。

**依据**：实测（只读）：读取仓库 Makefile，内容仅 `run:` 一个目标（`./scripts/quiet.sh true`）；`make quiet` 与 `make -n quiet` 均 rc=2。被审文档 §3、§4。

**建议**：§3 如实改为「新增 quiet 目标」并给出该目标的具体行为定义；§4 的验证方式需要能真正跑通一条从 make quiet 到 quiet.sh 的完整链路。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `§4 验证` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：验证只覆盖「退出码 0 即通过」的单一分支，没有覆盖被包装命令失败返回非零码、双流出错、以及无参数调用——而「透传退出码」恰恰只在非零场景才可证伪。现实现下这些场景全部返回 1，单靠 make quiet=0 的验收即使碰巧通过也无法证明语义正确。

**依据**：被审文档 §4 仅一条验证；实测（只读）：`/bin/bash -p ./scripts/quiet.sh`（无参数）rc=1；`/bin/bash -p ./scripts/quiet.sh sh -c 'exit 7'` rc=1 而非 7。

**建议**：§4 至少补一条「被包装命令以非零码退出，脚本退出码应等于该码」的用例；该用例按现写法会当场失败，正好与 CODEX-01/02 的修正形成闭环。

## 认为正确的部分

- §1 的目标定义本身清晰、可实现，且与 README.md 的项目定位（静音 stderr、只透传退出码）一致。
- §2 已经点名了正确等价写法 `2>/dev/null`，「必须在目标 shell 实测」的思路也对，错的只是把 zsh 的行为当成了 bash 3.2 的事实。
- §3 中「README 补一段用法」方向无需修改。
- scripts/quiet.sh 的整体结构（#!/bin/bash、set -u、"$@" 包装、exit $?）合理，问题集中在第 4 行的重定向写法。

## 未覆盖范围（本侧盲区）

- 未复测 Linux 或用户自装的 bash 4.x/5.x 下的行为，只覆盖 macOS 自带 /bin/bash 3.2（项目 README 声明的目标环境即此，故未扩展）。
- 未评估 dash/fish/sh 等其他 shell 上 `2>&word` 语义的可移植性。
- 本仓库无数据模型、对外契约、迁移/回滚、第三方依赖，成本/配额镜头仅落在「环境假设」一项上。
- 未验证修复后的代码（审查只读，不代写补丁）；回滚侧未覆盖 git 历史操作建议。

## 实际查阅的项目文件

- `README.md`
- `Makefile`
- `scripts/quiet.sh`
- `.reviews/exec-wording-ab/plan/2026-10-02-exec-wording-ab-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":7,"project_reads":2}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
