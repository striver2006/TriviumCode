---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261011T142848Z
addresses:
  - 2026-10-11-Agent双模式接入真实准入收口-r11-claude.md
  - 2026-10-11-Agent双模式接入真实准入收口-r11-gemini.md
  - 2026-10-11-Agent双模式接入真实准入收口-r11-glm.md
---

# 第22B逐条裁决

三侧原件全文已读，11条均接受并落到计划定稿；业务尚未实施。302静态、551业务、10原审查工件hash一致，subject/tree无漂移，readonly_breach=false、peer_artifact_read=false。新定稿Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r24-codex.md，SHA 1c7c4ffff68bff0644f2f156e4afcce064e0cfb40e4afcfe532790934130cee7。原稿r23仍保留，r24仅文件序号，正式22/23不变。

Gemini evidence引用audit-read-denial-variant5.mjs但未列consulted，GLM evidence引用agent-access-recipes.mjs但未列consulted：原告警保留，不补写原件或宣称该侧实际查阅。guard.ts既有逻辑把这两类转为告警，不修改guard/gate来通过本轮；是否放行以本轮裁决后gate实返为准。Driver模型/会话未声明null，Gemini/GLM路径级deny未生效保留，服务端身份null。原失败run20261010T170416Z不恢复。

|意见编号|来源|严重度|裁决|理由|落点|
|---|---|---|---|---|---|
|CLAUDE-01|Claude|major|接受|保留deny_pass/per_file_deny原名原形，新事实伴随；旧结果不回算，核summary消费者。|定稿§3/§4|
|CLAUDE-02|Claude|major|接受|采用6cc3最新完整指纹12未测；4c87四通过只历史，49预估刷新不追认。|定稿§1/§5|
|CLAUDE-03|Claude|minor|接受|明确生产normalizeAbs宽初筛与脚本normalizedPath最终严复核，逐腿不新增tmp别名。|定稿§3/§4|
|CLAUDE-04|Claude|minor|接受|明确调用judgeDirectoryArm kind=files、verdict真必要非充分、null/false拒绝，probe面不改。|定稿§3|
|AGY-01|Gemini|nit|接受|采用精确已录制旧携路径/新目录错误白名单；任意异常不能冒充拒绝，Grep仍须独立实测。|定稿§3/§4|
|AGY-02|Gemini|nit|接受|新函数放冻结切片外，独立锚定Codex原hash和write谓词。|定稿§3/§4|
|AGY-03|Gemini|nit|接受|结果保持path/attempts/id/paired_error/error及布尔deny_pass，增加伴随deny_evidence。|定稿§3/§4|
|GLM-01|GLM|major|接受|采建议第二分支：本轮plan审批reason明确绑定定稿hash和敏感范围；轮次criteria字段仍false，不授权判据替代。|定稿§2|
|GLM-02|GLM|minor|接受|禁读目标成功腿才拒绝；允许文件成功读取正例不误杀，哨兵仍全raw扫描。|定稿§3/§4|
|GLM-03|GLM|minor|接受|追加canonical实际deny分支及返回字段的源契约接线守卫，不只测试纯函数。|定稿§4|
|GLM-04|GLM|minor|接受|normalizedPath是最终路径权威；helper宽初筛不放宽最终域，特殊/private/tmp边界单测。|定稿§3/§4|

待gate和await-approval成功，建议依Bob本轮明确普通审批委托批准定稿§2至§4敏感取证守卫范围，审批reason绑定run及定稿SHA。轮次委托不改变判据、正式审查资格不以approve类意见替代；旧结果/证据不改，生产写替代仍未授权。
