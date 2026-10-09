---
schema: trivium.disposition.v1
topic: 留痕与异构
stage: plan
role: codex
kind: revised
run_id: 20261009T125242Z
addresses:
  - 2026-10-09-留痕与异构-gemini.md
  - 2026-10-09-留痕与异构-glm.md
---

# 留痕与异构计划逐条裁决

| 编号 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- |
| AGY-01 | 接受 | 补齐不可逆 v3 的具体字段、层级与必填性。 | run.v3.json 与主设计 |
| AGY-02 | 接受 | 按原因聚合同一轮 unknown 告警；拒绝按载体注入猜测的 Driver 模型，缺声明仍告警。 | 比较告警聚合 |
| AGY-03 | 接受 | 内存形状保留历史布尔和 sourceSchema，旧记录没有新比较矩阵。 | meta 历史读取与报告 |
| AGY-04 | 接受 | 两个可选旗标入 NAMED_FLAGS、输出和入口透传；仅在场缺值退64。 | topic-args、CLI、skills-src、worker |
| AGY-05 | 驳回 | 本机 Opus 映射实际可为 qwen3.8-max，sonnet 也可为 Qwen；别名不能证明 Claude 族，按用户批准计划记unknown。 | 保留保守别名策略 |
| AGY-06 | 接受 | 新增 front-matter 键与 ECHOED_ORCHESTRATOR_KEYS 双向对账。 | parse、render、parse-degrade P9/P9′ |
| GLM-01 | 接受 | 核心 SKILL Schema 清单与 USAGE 同批更新。 | 核心 SKILL 和 CLI help |
| GLM-02 | 接受 | 明确缺席合法，出现但空值或畸形退64，入口共用判定。 | 声明参数校验 |
| GLM-03 | 接受 | 旧 requested 来源保留原值，显示旧版请求回填，不用它产生新比较。 | 历史夹具和报告 |
| GLM-04 | 接受 | status 进度与开场明确标注请求模型，不承诺运行前已有有效回读。 | status、PRD AC-19、入口播报 |
| GLM-05 | 接受 | 与 AGY-02 同步，逐对数据完整保留，用户告警按原因聚合。 | render/report 告警 |

所有接受项合入 2026-10-09-留痕与异构-r2-codex.md。审查结构告警保持编排器原留痕，不改审核者文件；入口期无业务修改。

