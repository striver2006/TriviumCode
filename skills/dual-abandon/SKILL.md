---
name: dual-abandon
description: 放弃未关闭的双审闸门，解除业务写锁；已有工件全部保留（辅助命令）
argument-hint: --topic <主题> [--stage plan|code|bug] [--reason <理由>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*)
---

参数：$ARGUMENTS

运行：

```
.trivium/bin/trivium abandon $ARGUMENTS
```

把输出原样转述给用户。

不带 `--stage` 时放弃该主题下全部未关闭闸门，但**跳过 `running` 的那些**：
审查还在跑，闸门不能就地作废。要停掉进行中的审查，先 `.trivium/bin/trivium review --cancel <run_id>`，
再放弃。对 `running` 闸门显式指定 `--stage` 会退 2。
审批正本 task.json 读不出时也退 2，哪道闸门都不动；恢复由用户在终端做，恢复后再放弃。
放弃会解除业务写锁，但**已有工件一律保留**（PRD 第 10 章）——
放弃的是闸门，不是留痕。
