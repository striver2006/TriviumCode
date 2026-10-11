---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261011T031230Z
addresses:
  - 2026-10-11-Agent双模式接入真实准入收口-r7-claude.md
  - 2026-10-11-Agent双模式接入真实准入收口-r7-gemini.md
  - 2026-10-11-Agent双模式接入真实准入收口-r7-glm.md
---

# 第11次正式计划三审逐条裁决

三家原件全文已读。运行success、三侧evidence_ok=true、无fallback/degraded、snapshot tree前后相同、subject/related零漂移、readonly_breach/peer_artifact_read/forged=false。Gemini/GLM的路径级deny未生效与Driver模型族unknown警告保留，不把三审形式有效外推为全部准入实测。十一项意见均在r16具名合入，原BRIEF扩禁与两项候选判据未获采用。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 实时测试当前读v5却仍断言v4，分离当前与不可变v4历史边界 | r16测试与权威；agent-access-recovery.test.ts |
| CLAUDE-02 | claude | minor | 接受 | v7已用于11B，保留字节并具时刻勘误，新v8才修注释与v2接线 | r16生产接线；恢复报告与launch-v8.mjs |
| CLAUDE-03 | claude | minor | 接受 | 总10现行指针已失时，更新报告及双README并核跨文档口径 | r16文档时序；REPORT、05_testing/README、r3/README |
| AGY-01 | gemini | minor | 接受 | v4九/十边界必须固定为历史回归，v5实时壳独立 | r16测试与权威；agent-access-recovery.test.ts |
| AGY-02 | gemini | nit | 接受 | 新正式入口具名v8并和quiet-v6/v2守卫一致 | r16生产接线；launch-v8.mjs/quiet-launch-v6.mjs |
| AGY-03 | gemini | nit | 接受 | recipes改安装输入后应先重装核两类匹配再启12C | r16文档安装时序；formal-start-precheck-v2实测 |
| GLM-01 | glm | minor | 接受 | v2若无生产调用即无修复，新v8列为必交付物 | r16生产接线；launch-v8.mjs及12C diff |
| GLM-02 | glm | minor | 接受 | 共享七入口曾未知来源复现，安装后须再次读盘 | r16安装时序；七目录与备份hash核查工件 |
| GLM-03 | glm | minor | 接受 | v7误述保留审计原件而在报告勘误，v8首行准确 | r16生产接线；恢复报告沿革 |
| GLM-04 | glm | nit | 接受 | 定义白名单token前缀及必需旗标层级，产品CLI仍校验值 | r16生产接线；quiet-v6正反测试 |
| GLM-05 | glm | nit | 接受 | 扩BRIEF守卫需额外轮数且不附着12C | r16扩禁轮数；后续独立授权停点 |

本轮plan普通审批不改变准入标准；旧10C code拒绝保留，第12次只有实施/核验完成后才能正式启动。
