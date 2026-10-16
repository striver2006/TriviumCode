# 批 X 草案：Codex 主攻 plan，闸门期改业务文件（剧本 7 Codex 部分 + 剧本 9）

**草案，未发布。** 依赖批 Z 的 P 前置（夹具基线提交、agy 刷新）已完成。批准后落具名 `client-batch-x1.json`。

- 夹具：`/Users/chenzhenbo/Work/trivium-m11-step12-20261012`
- 新主题：`m11-s12-codex`；业务目标：为 BoundedStack 新增只读 `size` 访问器并补测试（只走 plan 阶段）
- 判据：7.1～7.5、7.7（Codex）、9.1～9.5；可选 X2 覆盖 9.6 与 9.4 第二子句

## 待用户定的一处

夹具里有一份 `.codex/hooks.json`（2026-10-13 05:13 出现，来源 unknown，内容是 Claude Hook 的拷贝，命令依赖 `CLAUDE_PROJECT_DIR`）。建议**原样保留并如实记录**：Codex 不设该变量时这些命令全部退 0，不影响 9.1；若实测出现任何 Hook 事件，就是关于 Codex L2 分级的新发现（另见 BACKLOG EV-237）。

## X1：Codex 主会话

1. 终端：`codex -s danger-full-access -C /Users/chenzhenbo/Work/trivium-m11-step12-20261012`
2. 第一条消息（**不要出现任何 `$名字`**，一提到就会注入 skill 全文）：

```text
继续 M11 第 12 步收口批 X1。本轮不要使用子代理。先读主仓库 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/client-batch.json，批次须为 X1-codex-plan，否则停报。然后执行 .trivium/bin/trivium topic claim --topic m11-s12-codex --stage plan --driver codex --json（期望退 0），再写计划原稿到 .reviews/m11-s12-codex/plan/ 下、文件名以当轮 Driver 后缀结尾。不运行 init / doctor，不直接调用厂商 CLI。完成后回报，不启动预检或审查。
```

3. 第二条消息（driver 模型按 Codex 当时实际填写）：

```text
$dual-review-plan 审查 size 访问器的只读语义、与 items.length 的一致性及测试覆盖 --topic m11-s12-codex --goal 为BoundedStack新增只读size访问器并补充测试 --critics gemini,glm --model-gemini gemini-3.8-flash-high --model-glm GLM-5.3 --driver-provider <provider> --driver-model <model>
```

4. 停点：`--await-approval` 的 **CLI 原文**整段留存（7.5、9.2）。
5. **闸门期**：让 Codex 会话在 `src/stack.js` 末尾加一行注释（9.1，预期不被拦）。
6. 用户终端：`.trivium/bin/trivium approve --topic m11-s12-codex --stage plan`，输出原文留存（9.3、9.4：应退 0，且工作树改动摘要列出 `src/stack.js`）。
7. 主会话只读核对：运行记录 `snapshot.drift.changed=false`（9.5）、`driver=codex`、`driver_guard_level`（7.2）、`critics_selected` 不含 codex（7.3）、阶段 Driver 记录（7.4）；把 `~/.codex/sessions/**/rollout-*.jsonl` 中本会话那份拷入证据前先脱敏扫描（7.7）。
8. 恢复：用户终端撤掉第 5 步那一行，主会话复核 `src/stack.js` hash 回到基线。

## X2（可选，需用户另行点头）

同主题第 2 轮：`--start` 之后、审查收尾之前由用户改 `src/stack.js`；核 `snapshot.drift.changed=true` 与 policy（9.6）。停点后**先提交该改动再审批**，核摘要照样列出（9.4 第二子句）。

## 停止条件

同批 Z。Codex 侧没有 Hook，第 5 步不被拦是预期（L2），不是缺陷。
