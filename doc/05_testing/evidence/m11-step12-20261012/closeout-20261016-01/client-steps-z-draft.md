# 批 Z 草案：Claude 主攻 plan → ZCode 主攻 code（剧本 7 ZCode 部分 + 剧本 10）

**状态（2026-10-16）**：用户已批准（user-decision-02.json），收口池不设额度；P 前置已由 Claude 执行完（README「前置执行」节）；**Z1 已发布**（`client-batch.json` = `client-batch-z1.json`）。Z2 等 Z1 审批后再发布。

- 夹具：`/Users/chenzhenbo/Work/trivium-m11-step12-20261012`（沿用；预算外壳不变，不跑 init）
- 新主题：`m11-s12-cross`；业务目标：为 BoundedStack 新增 `clear()`（清空且不改 capacity，返回被清掉的元素个数）并补测试
- 判据：7.1～7.8（ZCode）、10.1～10.7

## P 前置（用户终端，零厂商）

1. 夹具现有未提交改动（`AGENTS.md`、`src/stack.js`、`test/stack.test.js`、两主题归档）先提交成新基线，code 阶段的 `git diff` 才只含 `clear()`。提交说明自定，例如「固定剧本 1～6 验收后的夹具基线」。
2. 主会话（零厂商）记录前置快照：夹具文件清单 hash、安装 bundle 与四目标入口 hash、预算 838/401。
3. R0：`doctor --only agy --json` 一次（硬限 admission 6），刷新后主会话回读 agy 段，不启动其它探针。

## Z1：Claude Code（VS Code，Sonnet 5.5）主攻 plan

第一条消息（只准备）：

```text
继续 M11 第 12 步收口批 Z1。先读主仓库 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/client-batch.json，批次须为 Z1-claude-plan，否则停报。确认当前项目与 Driver 模型（claude-sonnet-5-5 / anthropic），不一致就停。本轮不要使用子代理，不直接调用厂商 CLI，不运行 init / doctor。准备完回报，不启动预检或审查。
```

第二条消息（正式入口）：

```text
/dual-review-plan 审查 clear() 的语义边界：返回值、capacity 不变、清空后 push/pop/peek 行为与测试覆盖 --topic m11-s12-cross --goal 为BoundedStack新增clear()：清空元素、capacity不变、返回被清掉的元素个数，并补充测试 --critics gemini,glm --model-gemini gemini-3.8-flash-high --model-glm GLM-5.3 --driver-provider anthropic --driver-model claude-sonnet-5-5
```

停在 awaiting_approval 后：用户决定是否 `/dual-approve --topic m11-s12-cross --stage plan`（审批权在用户）。

## 10.1 负对照（主会话或用户终端，零厂商）

```bash
TV=.trivium/bin/trivium   # 在夹具根执行
$TV topic claim --topic m11-s12-cross --stage plan --driver glm --json   # 期望退 64
```

## Z2：ZCode 桌面端主攻 code

**已发布（2026-10-16）**：`client-batch.json` = `client-batch-z2.json`；plan 已批准（`approval-z1.json`）。

1. ZCode 桌面端打开夹具，**先点信任、再新建会话**；第一句只发：「本轮不要使用子代理（Agent 工具），所有操作由你直接执行。」
2. 第二句（准备 + 实现）：

```text
继续 M11 第 12 步收口批 Z2。先读主仓库 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/client-batch.json，批次须为 Z2-zcode-code，否则停报。回报你当前的模型名与供应商（后面要原样填进 --driver-model / --driver-provider），自报不出就停。然后执行 .trivium/bin/trivium topic claim --topic m11-s12-cross --stage code --driver glm --json（期望退 0）。按批次 plan_final 指向的 r2 计划定稿实现 BoundedStack.clear() 并补测试，跑 npm test 确认通过。不运行 init / doctor，不直接调用厂商 CLI。完成后回报改了哪些文件，等下一条正式入口，此条不启动预检或审查。
```

3. 第三句（正式入口；把两个尖括号换成第 2 步自报的值）：

```text
/dual-review-code 审查 clear() 实现与测试：返回值、capacity 不变、原地清空、清空后栈操作 --topic m11-s12-cross --critics gemini,codex --profile-codex deepseek --model-codex deepseek-flash --model-gemini gemini-3.8-flash-high --driver-model <自报模型> --driver-provider <自报供应商>
```

   预检若转入后台，只等它的完成通知，**不要另起一次**（Z1 重试时多起过一次，见 z1-retry-deviation.json）。

4. 会话写 `…-response-glm.md`、`gate --check`、走到停点；**停点 CLI 原文**整段留存（7.5）。
5. 会话结束后**立刻**把 `~/.zcode/cli/rollout/model-io-sess_<id>.jsonl` 交主会话拷走（只留最近 3 个会话），主会话拷入证据目录前先跑脱敏扫描。
6. 7.6（用户终端，主会话事先备脚本，含 hash 备份与恢复核对）：移走一份审查件 → `approve` 期望退 2 → 恢复 → 改一份审查件一个字节 → `approve` 期望退 2 → 恢复，复核 hash 一致。
7. 用户决定是否审批 code 阶段。
8. 报告：`$TV report --topic m11-s12-cross` 与 `--json`（零厂商，主会话可代跑）。

## 停止条件

首个失败、69、漂移或预算拒绝即停，不重试；任何意外放行（7.6 退 0）立即停，不自行恢复。
