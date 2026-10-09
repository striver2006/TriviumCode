---
schema: trivium.disposition.v1
topic: 接入路由
stage: plan
role: codex
kind: revised
run_id: 20261009T125206Z
addresses:
  - 2026-10-09-接入路由-gemini.md
  - 2026-10-09-接入路由-glm.md
---

# 接入路由计划逐条裁决

| 编号 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- |
| AGY-01 | 接受 | 补齐运行时 Schema 落点，types 改动不能替代 ajv 契约。 | config.v2.json anthropic 支和共享 profile 档位形状 |
| AGY-02 | 接受 | 明确异构职责交给留痕与异构主题；本主题交付解析路线和声明证据。 | 修订计划的主题交接说明 |
| AGY-03 | 接受 | resolve 明确输出 null 并规定 null 转抄为 native 旗标，杜绝重新继承。 | topic-args、入口 A/B/C/D 透传 |
| AGY-04 | 接受 | 新增旗标需要入口源、渲染变量和产物一起改。 | skills-src、entry-render、render parity |
| AGY-05 | 接受 | 明确入口优先级并对取不到入口退69；不存在profile退64。 | Claude 路由解析及可执行检查 |
| AGY-06 | 接受 | 明确环境清理集合和订阅认证来源；native 指官方订阅，不保留可能来自供应商的 API-key 路由。 | Claude 子进程环境清理与离线测试 |
| GLM-01 | 接受 | 与 AGY-03/04 同步，入口和核心 SKILL 契约面一起补齐。 | skills-src、entry-render、核心 SKILL |
| GLM-02 | 接受 | 已有 profile_requested 从本主题起诚实记录请求值，失败同样记录。 | Claude 结果组装与 failedResult |
| GLM-03 | 接受 | 参数与存在性先查，缺新路线能力时 fail closed；不采用未认证路线告警放行建议。 | preflight 和 prepareRun 路线检查 |
| GLM-04 | 接受 | 与 AGY-06 同步，官方订阅与供应商凭据明确隔离，API-key 不作为 native 认证。 | 主设计环境清理清单 |

所有接受项合入 2026-10-09-接入路由-r2-codex.md。审查结构告警保持编排器原留痕，不改审核者文件；入口期无业务修改。

