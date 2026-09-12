---
name: dual-approve
description: 人工审批双审闸门：通过或拒绝。两种结论均解除业务写锁，工件一律保留（辅助命令）
argument-hint: --topic <主题> --stage plan|code|bug --code <确认码> [--reject --reason <理由>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit
---

参数：$ARGUMENTS

运行：

```
.trivium/bin/trivium approve $ARGUMENTS
```

把输出原样转述给用户。

- 通过：`--topic <主题> --stage <阶段> --code <确认码>`
- 拒绝：追加 `--reject --reason <理由>`。**拒绝必须给理由。**

**通过必须带 `--code`**，码在停点话术里（`gate --await-approval` 的输出）。
**这个码只能由用户给你。** 用户没给就问他要，**不要自己去翻历史输出、
不要从 `state.json` 猜、更不要重跑 `gate --await-approval` 自己生成一个**——
那等于把这道护栏拆掉再走过去。审批是解除护栏的动作，它的发起权在用户手里。

`--stage` 在通过时也是必填的（一次放行哪一道闸门要说清楚）；拒绝与放弃可以省略。

两种结论都会解除业务写锁并保留全部工件。**拒绝之后流水线不会自动继续**——
你可以按用户意见改写归档内的修订件（改完重跑 `gate --check`），
但不得自动进入编码、改码或修复。改写用 Read / Write / Edit，重跑校验用
`.trivium/bin/trivium gate --stage <阶段> --topic <主题> --check`。
