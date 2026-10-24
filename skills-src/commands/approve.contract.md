---
name: dual-approve
description: 人工审批双审闸门：通过或拒绝。两种结论均解除业务写锁，工件一律保留（辅助命令）
argument-hint: --topic <主题> --stage plan|code|bug [--reject --reason <理由>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit
@ARG_KIND: flags
---

{{> args/line@ARG_MODE}}

运行：

```
.trivium/bin/trivium approve {{ARGS}}
```

把输出原样转述给用户。输出里的工作树改动摘要只告知，不改变审批结论；不得据此改文件、拒绝放行或代替用户判断。
退 2 且输出点名审批正本 task.json 读不出时，审批没有记录、闸门没有动；恢复由用户在终端做，恢复后再审批。

**批之前想再看一眼改动**：`approve` 没有确认步骤，摘要打印出来时审批已经落下。用户只是想先看改动、
还没决定批不批时，**不要跑 `approve`**，改跑：

```
.trivium/bin/trivium gate --stage <阶段> --topic <主题> --await-approval
```

它与 `approve` 走同一份复核、同样打印工作树改动摘要，但不落审批，闸门保持等待审批（只按原值刷新一次闸门项的会话与时间）。
把输出原样转述给用户，等用户看完、明确要求审批时再运行上面的 `approve`。

- 通过：`--topic <主题> --stage <阶段> [--reason <附言>]`。**`--stage` 必填**：一次放行哪一道闸门要说清楚。
- 拒绝：追加 `--reject --reason <理由>`。**拒绝必须给理由。** 拒绝与放弃可以省略 `--stage`。
- **用户在指令后写的自由文字是审批附言，传 `--reason '<原文>'`**（整段单引号包住），它会写进
  审批记录的 `reason` 字段。**不要**把它原样拼进命令当位置参数：`approve` 不接受多余的
  位置参数，会退 64 并列出被丢的内容——那不是 CLI 坏了，是附言没走对字段。
  `--reject` 不接受值：`--reject 理由` 同样退 64，理由一律走 `--reason`。

**只在用户明确要求时运行这条命令。** `approve` 不校验调用来源，你自己跑得通——
所以这道关靠的是你守规矩：审批是解除护栏的动作，发起权在用户手里。
审批记录会写进 `task.json.approvals`（含时间与会话来源）供事后对账。

两种结论都会解除业务写锁并保留全部工件。**拒绝之后流水线不会自动继续**——
你可以按用户意见改写归档内的修订件（改完重跑 `gate --check`），
但不得自动进入编码、改码或修复。改写用 Read / Write / Edit，重跑校验用
`.trivium/bin/trivium gate --stage <阶段> --topic <主题> --check`。
