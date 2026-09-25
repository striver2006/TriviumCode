---
name: dual-status
description: 查询双审流水线状态：未关闭闸门、运行次数、降级记录与争议项（辅助命令）
argument-hint: [--topic <主题>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*)
@ARG_KIND: flags
---

{{> args/line@ARG_MODE}}

运行：

```
.trivium/bin/trivium status {{ARGS}}
```

把输出原样转述给用户。

**本命令给的是闸门概览**——各主题的未关闭闸门、运行次数、降级与争议项，
**不含**某次运行的实时进度（已用时、预算、两侧各自状态）。

若看到 `双审进行中`：

- 想看**这次运行跑到哪了**，用 `.trivium/bin/trivium review --status <run_id> --json`——
  它给出已用时、预算百分比、第几次等待与两侧逐个状态；
- 想继续等，用 `.trivium/bin/trivium review --wait <run_id>`；
- 想取消，用 `.trivium/bin/trivium review --cancel <run_id>`。

（`trivium` 不在 PATH 上，一律用项目相对路径。）
