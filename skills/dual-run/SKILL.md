---
name: dual-run
description: 全流程双审：出方案 → 双审 → 修订 → 编码 → 双审 → 应答 → 改码 → 真实执行编译测试（命令 A）
argument-hint: <任务目标> [--topic <主题>] [--focus <提示语>] [--context <路径,…>] [--profile <名称>] [--model-gemini <slug>] [--model-glm <id>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Bash, Read, Write, Edit, Glob, Grep
---

参数：$ARGUMENTS

# 命令 A · 全流程

下文 `TV` 指 `.trivium/bin/trivium`。若该文件不存在，提示用户先 `trivium init` 并停止。

**命令 A 不设人工闸门**（PRD 4.4），但仍受两条护栏约束：审查期禁写业务文件、
裁决未完成不得收工。两者都由 Hook 强制，不靠你自觉。

## 状态机 S0～S10（设计 §8.2）

### S0 预检
`TV preflight --stage all --json`

`--stage all` 是命令 A 专用的范围：它校验 active profile 下**全部三个阶段**两侧的
模型 slug，并执行「`verify.build` / `verify.test` 皆空则拒绝启动」检查——
跑完全流程却无法收口是不可接受的（§14.1）。跳过单阶段专属项（此时原稿还不存在）。

失败则**原样转述**并停止。预检失败时不会产生任何工件，可以放心重试。

### S1 起草计划
把方案写成 `.reviews/<主题>/plan/<日期>-<主题>-claude.md`。用 Write 落盘。

### S2 计划双审
按 `/dual-review-plan` 的第 3 步执行 `--start` / `--wait` 循环。
**把本命令的首参（任务目标）原样传给 `--goal`**——它在这里落进 `task.json`，
之后 S6 代码双审、乃至后续 bug 定位都会自动复用，审查员才知道这次改动要达成什么（§9.4）。
**每次 `--wait` 的 Bash 调用工具超时设为返回的 `bash_timeout_ms`（600000）。**

### S3 修订计划
读两份审查全文，写 `…-revised-claude.md`，逐条裁决（接受/驳回/暂缓 + 理由，接受写落点）。

### S4 裁决校验
`TV gate --stage plan --topic <主题> --check --json`。有缺口则回到 S3 补齐，最多 3 次。

### S5 编码实现
按**已批准的修订计划**改代码。你是唯一有权改业务代码的角色（FR-01）。

### S6 代码双审
同 S2，但 `--stage code`。被审对象是 `git diff`，不是文档。

### S7 应答确认
写 `…-response-claude.md`，逐条「接受/驳回/暂缓 + 理由 + 修改计划」。

### S8 裁决校验
`TV gate --stage code --topic <主题> --check --json`。有缺口回到 S7。

### S9 按已接受项改代码
**只改已接受的项。** 驳回与暂缓的不要动。

### S10 编译测试（出口）
`TV verify --topic <主题>`。它**真实执行** `.trivium/config.yaml` 里显式配置的命令。

> **失败不得宣称成功。** 任一命令非零退出 → 全流程状态为 `failed`，
> 已产生的全部工件保留（FR-21 / AC-10）。如实向用户报告失败与退出码。

## 遇到 Bug 根因材料时

命令 A 的链路**不含**独立根因审阶段。若运行中产出了待审的根因材料，
引导用户改用 `/dual-review-bug`，并**不得**把未送审的根因标为已完成双审（FR-22）。
