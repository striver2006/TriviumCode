# D单次恢复：原稿复用，正式预检后审查

仅在主会话发布`client-batch.json.id=D-Claude-recovery-01`后消费本步骤。原Claude Code测试会话、项目`/Users/chenzhenbo/Work/trivium-m11-step12-20261012`，Driver仍为claude/qwen3.8-flash/qwen。恢复授权不是裁决审批。

预算起点admission832/review397，新增硬限6/4，绝对上限838/401；原总80和44/36分池不变。此次最坏累计71/80，之后仅余admission1/review8，后续批次须重新估算。

## 第一条消息：仅准备

```text
继续M11命令D单次恢复。先读取主仓库 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/client-batch.json 和同目录 client-steps-d-recovery01.md、d-recovery01-user-decision.json。批次必须为D-Claude-recovery-01，预算起点832/397、硬限6/4、绝对上限838/401；否则停报。确认当前项目为 /Users/chenzhenbo/Work/trivium-m11-step12-20261012，Driver仍claude/qwen3.8-flash/qwen；模型不同就停止。只读核对已有bug原稿 .reviews/m11-s12-capacity/bug/2026-10-15-m11-s12-capacity-claude.md 与批次hash一致，复用它，不新建主题、不重写原稿。保留上次预检69及4次版本查询记录；agy刷新另耗5次。保持原预算外壳，不运行init、doctor、不直接调用厂商CLI或子代理。准备结束后回传批次、原稿路径，等待下一条正式入口；此条不启动preflight或审查。
```

## 第二条消息：正式入口

```text
/dual-review-bug 核对容量非法输入的复现与构造器缺校验根因，检查类型错误与取值错误边界；本轮仅根因审查，不实施容量修复 --topic m11-s12-capacity --critics gemini,glm --model-gemini gemini-3.8-flash-high --effort-gemini low --model-glm GLM-5.3 --driver-provider qwen --driver-model qwen3.8-flash
```

正式preflight与review --start各最多一次，按入口要求执行，不跳认证、不改探针或版本字段。agy刷新doctor总体69来自预算wrapper形态；这不是预检豁免，不执行init消除此提示。首个失败、69、漂移或预算拒绝立即停，不重试。原稿已经过阶段认领，入口的幂等claim不创建新主题或轮次；本轮仍为bug首个正式运行。

成功后逐条裁决，按archive.ts出口归档bug裁决件；停在awaiting_approval，返回run_id、裁决路径、gate结果与停点。不得自行approve、实施容量修复或提交。旧C批准及此次恢复授权均不代替根因裁决的当次审批。
