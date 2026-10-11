---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261011T093157Z
addresses:
  - 2026-10-11-Agent双模式接入真实准入收口-r9-claude.md
  - 2026-10-11-Agent双模式接入真实准入收口-r9-gemini.md
  - 2026-10-11-Agent双模式接入真实准入收口-r9-glm.md
---

# 第16B逐条裁决与完整r20计划

三原件全文已读；三侧approve-with-nits，共5条。树前后f20da918a68e997ea4b3d00cfeb2b071ad10de82相同，subject f70191cd91b3e3b4b55b8c90ff85fea59cfb5729ef551d37bf55421ceaeefeaa未漂移，readonly_breach/peer_artifact_read/forged均false。Gemini consulted不可交叉核对、Driver族unknown、dirty安装构建告警及Gemini/GLM路径deny不生效保留，不重写原件。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | minor | 接受 | 旧第15补记是当时采样，但部分指南未明确最新口径引用；不能回写已冻结16B审前事实。修订计划先明确旧件的时点属性，普通plan批准后首件工作就是八份文档追加当前委托和报告指针，即使后续实施停止也保留正确现行记录。 | r20 §1/§5；设计/ADR/PROTOCOL/GUIDE/CASE/RUNBOOK/QUICKSTART及测试索引，旧补记保留。 |
| CLAUDE-02 | claude | minor | 接受 | 采用建议(a)，收窄保证：每轮须列于hash冻结授权文件，当前16B/17C确有界；批大小由发布核验与审查约定保证，v2守卫不检查未来批大小，不称其机械限制增量≤2。保持生产guard/precheck与发布原件字节不变。 | r20 §1/§3.4/§5及文档说明；不新增guard语义。 |
| AGY-01 | gemini | minor | 接受 | 全局旧outputInstruction不能改。显式agent=codex且arm=read才用独立新模板，其余共享模板、分支输出保持；定向验证已录制非目标prompt的完整hash。 | r20 §3.3；recipes/closeout精确分支及closeout/recovery测试。 |
| AGY-02 | gemini | nit | 接受 | 明确result.json顶层read_content_diagnostic，只用于Codex/read，缺匹配也保持固定对象及false/reasons；独立函数消费原配对函数，不修改codexCommandEvidence的既有返回或bool判据。 | r20 §3.2；独立helper及closeout顶层装配。 |
| GLM-01 | glm | minor | 接受 | 采用严格bytes/hash相等，文件自身尾换行属于正文；额外后缀/多一换行必须false并记录实际bytes和原因，不trim或隐式归一。诊断false不能改写原actual_read、Schema、首词或矩阵判据，故不把捕获差异误报为原标准失败。 | r20 §3.2新增尾部/后缀负例及固定comparison=byte-exact/no-normalization。 |

完整r20合入5个编号及每项落点。仍需gate核验和本轮委托普通plan批准；本文不是审批。批准不含准入判据变更，不用单侧approve恢复旧失败，旧15C批准与14C拒绝均保留。
