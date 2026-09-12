---
name: dual-approve
description: 人工审批双审闸门：通过或拒绝。两种结论均解除业务写锁，工件一律保留（辅助命令）
argument-hint: --topic <主题> --stage plan|code|bug [--reject --reason <理由>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit
---

参数：$ARGUMENTS

运行：

```
.trivium/bin/trivium approve $ARGUMENTS
```

把输出原样转述给用户。

- 通过：`--topic <主题> --stage <阶段>`
- 拒绝：追加 `--reject --reason <理由>`。**拒绝必须给理由。**

两种结论都会解除业务写锁并保留全部工件。**拒绝之后流水线不会自动继续**——
你可以按用户意见改写归档内的修订件（改完重跑 `gate --check`），
但不得自动进入编码、改码或修复。改写用 Read / Write / Edit，重跑校验用
`.trivium/bin/trivium gate --stage <阶段> --topic <主题> --check`。
