---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261011T020308Z
addresses:
  - 2026-10-11-Agent双模式接入真实准入收口-r6-claude.md
  - 2026-10-11-Agent双模式接入真实准入收口-r6-gemini.md
  - 2026-10-11-Agent双模式接入真实准入收口-r6-glm.md
---

# 第9次正式计划三审逐条裁决

三家全文均已读取。run success、三家evidence_ok=true、fallback/degraded=false；readonly_breach/peer_artifact_read/forged均false，快照前后tree相同、无subject/related漂移。模型族unknown和embedded历史dirty告警保留，Gemini/GLM无路径级CLI deny不冒充拦截。Claude未展开两判据实质可行性，GLM未逐项展开组件材料，各侧盲区保留，不将三审形式有效当作所有新机制已实测。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 有效性/审批链与计数是不同边界，明确停止且不声称guard强制 | r14§6及后续10C操作核验 |
| CLAUDE-02 | claude | minor | 接受 | 新增摘要包装器必须具名纳范围，警告须读取原件原样反馈 | r14§6；正式start/wait/status仅launch-v5或后续新版本 |
| CLAUDE-03 | claude | minor | 接受 | 权威状态锚必须追加当前采样，原句不覆盖 | r14§7；批准后恢复报告及句族核对 |
| AGY-01 | gemini | minor | 接受 | 两处动态测试分别是实时权威与历史固定断言 | r14§3；agent-access-recovery.test.ts两用例 |
| AGY-02 | gemini | minor | 接受 | scripts属于生产安装输入，不为只读诊断使38臂失配 | r14§4；r4内适用性诊断脚本 |
| AGY-03 | gemini | nit | 接受 | 当前HEAD已含原整改，默认HEAD将漏累积diff | r14§7；10C resolve/start显式base39ed2053 |
| GLM-01 | glm | minor | 接受 | 接受前置约束补齐；9B已发生不补造事前检查，实际26960/skip0仅事后核验；历史第7次阶段说法保留原件不采信 | r14§6/7；新增stage-aware测量/launcher版本，旧v5不改 |
| GLM-02 | glm | minor | 接受 | 诊断与采用分支明确：未答复/拒绝也可诊断，不能消费准入 | r14§3/4/5/7；r4 ledger始终显式审批缺席/accepted=false |
| GLM-03 | glm | nit | 接受 | 旧脚本已参与冻结不能回改，后续新版本注释准确 | r14§7；新launcher入口注释；保留v5及旧件 |

九项合入完整r14。普通plan委托审批与component-scoped-evidence-v1/restricted-tool-surface-v1采用独立；原矩阵6通过/6未测、原生产写标准不变，M11前置尚未完成。
