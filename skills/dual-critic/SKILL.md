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

历史plan-r3/v1契约（已被当前r9补充修订，旧采样保留）：2026-10-11 plan-r3/run20261010T175354Z获批目录整改：Claude目录事实另带真实项目sensitive_globs稳定hash（排序去重字符串集合的JSON/SHA256）与受测形态版本；事实缺值、项目配置变更、TTL或路线/版本/入口/native不匹配时逐文件回退。v1受测范围限制为ASCII目录段^[A-Za-z0-9_-]+$、根1至4段及后代0至2级；特殊文件名证据不扩展到中文/空格/逗号/点目录。无候选事实不读二进制；同一精确路径仅本次调用复用hash，不设跨运行缓存，性能未实测。peer_deny_applied的Claude压缩分项是输入防御不变式，不是独立模型能力证明。目录后置臂预期失败保留主probe并清空目录事实、脱敏留痕及清理；未定义内部错误继续抛。

历史r7送审前边界（已被当前r9补充修订，旧采样保留）：补充边界：原生产压缩根实际为5段，超出当前批准范围，静态回放回退settings为2,898,308字节。扩到5段尚待新增正式计划审查授权；不得因自动plan/code审批或CLI扩容自行扩大正式轮数或消费域。原生产写负对照标准始终保留；四个无新取证机制的Claude写组合在spawn前拒绝，无准入通过结论。当前状态见[恢复报告](../../doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md)（skills说明从仓库doc/05_testing定位该报告）。
历史plan-r4/run20261010T224543Z获批r9契约（当时总7轮）：目录形态为ascii-root1-5-depth0-2-v2，目录段^[A-Za-z0-9_-]+$、根1至5段、后代0至2级；仅真实新拓扑doctor通过且项目hash/时间/路线/版本/入口/native一致才消费，v1旧事实失效。五种根的七臂每工具文件30、目录5、共同正对照4，180秒每臂保持，失败保存主probe并清空目录事实。总7轮例外已独立授权，第6次补充计划已批准、第7次完整代码重审待执行；CLI额度与轮数分列。第7次启动前用最终构建、生产完整禁读枚举及实际可消费事实计算settings，超过既有131072字节软线则任务包装器拒绝正式启动，不删除禁读项、不改产品软线、不借旧安装绕过。原生产写四缺口仍未测，判据替代未采用，M11前置未完成。

当前目录事实与敏感枚举规范统一见[设计§3.5](../../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)：消费仅限受测ASCII形态、绑定实际项目及入口，失配回退逐文件。正式授权、实施、真实取证和未测状态见[恢复报告](../../doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md)，不以本节历史计划采样替代当前验收。
