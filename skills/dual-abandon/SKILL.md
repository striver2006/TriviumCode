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

不带 `--stage` 时放弃该主题下**全部**未关闭闸门。
放弃会解除业务写锁，但**已有工件一律保留**（PRD 第 10 章）——
放弃的是闸门，不是留痕。
