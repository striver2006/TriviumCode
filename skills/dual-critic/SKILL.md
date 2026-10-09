---
name: dual-critic
description: TriviumCode 双审流水线的核心资产容器：编排器脚本、JSON Schema、审查提示词、只读 Agent 定义、Hook 配置与文档模板。不含任何流程，不应被直接调用。
user-invocable: false
disable-model-invocation: true
---

# TriviumCode 核心 skill

本 skill **只是容器**，不含流程。全部确定性编排都在 `scripts/trivium.cjs` 内
（设计原则 P1、AD-13）：并行、超时、心跳、指纹、轨迹核验、防覆盖命名、裁决校验
都不在任何 SKILL.md 里。

## 目录

| 路径 | 用途 |
| :--- | :--- |
| `scripts/trivium.cjs` | 编排器本体（esbuild 单文件产物，不进 Git） |
| `schema/` | 当前写契约 `review.v1` / `disposition.v1` / `run.v3` / `config.v2`；只读保留 `run.v1` / `run.v2` / `config.v1` 历史契约。运行期先校形状，再按注册表校身份 |

run.v3 的 requested_routes 在执行前按入选侧记录 model、effort、tier、tier_source、access。取消与 worker 启动失败不丢请求；worker 与交接逐项比对后执行，报告保留无结果侧的请求注记。历史 v1/v2 不补写。
| `prompts/` | 各阶段的审查提示词模板 |
| `lenses.yaml` | 两侧差异化审查镜头（§9.3），避免双审退化成同审 |
| `agents/trivium-critic.md` | Antigravity 只读审查 Agent 定义 → 安装到 `~/.gemini/config/agents/` |
| `hooks/hooks.json` | Hook 配置 → 由 `trivium init` 合并进目标项目 `.claude/settings.json`，并以 ZCode 形态合并进 `.zcode/config.json`（`trivium hooks --agent <id>` 可单独渲染一家；codex / gemini 没有 Hook 机制） |
| `entry/<agent>/`（只在仓库里） | codex / gemini / glm 三家的入口 skill 渲染产物，由安装器装进各家的 skill 根；**不随本目录安装**——codex 会递归枚举 skill 根，嵌套在这里会让别家入口被它调起（设计 7.4.1） |
| `templates/` | 计划 / 根因 / 裁决 / 应答 / 验证 五类文档模板 |
| `protocol/` | `CLAUDE.md` / `AGENTS.md` / `.gitignore` 的幂等追加片段 |

## 为什么入口是 `.trivium/bin/trivium` 而不是本目录

目标项目里的 Hook 与入口 skill 一律经项目内的 `.trivium/bin/trivium` 调用编排器：Hook（Claude Code 与 ZCode 两种形态是同一条命令）写作 `${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium`，四家的入口 skill 用项目相对路径。
那个 wrapper 由 `trivium init` 生成，内含 `doctor` 探测到的 **node 绝对路径**——
GUI 进程不读 `~/.zshrc`，依赖 `PATH` 会在 VS Code 里失效（设计 §10.5）。
也因此不依赖 `${CLAUDE_SKILL_DIR}`。
