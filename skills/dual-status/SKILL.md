---
name: dual-status
description: 查询双审流水线状态：未关闭闸门、运行次数、降级记录与争议项（辅助命令）
argument-hint: [--topic <主题>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*)
---

参数：$ARGUMENTS

运行：

```
.trivium/bin/trivium status $ARGUMENTS
```

把输出原样转述给用户。

若看到 `双审进行中`，提醒用户可以用 `trivium review --wait <run_id>` 继续等待，
或 `trivium review --cancel <run_id>` 取消。
