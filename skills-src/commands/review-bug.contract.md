---
name: dual-review-bug
description: 对已有 Bug 根因定位材料做背靠背双审，并产出修订后的根因结论（命令 D）
argument-hint: <审查焦点提示语> [--goal <任务目标>] [--topic <主题>] [--context <路径,…>] [--profile <名称>] {{MODEL_HINT}} [--rca-file <路径>] [--critics <id,…>] [--only {{ONLY_CHOICES}}] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit, Glob, Grep
@ENTRY: D
@STAGE: bug
@SUBJECT_NOUN: 根因材料
@SUBJECT_FLAG: --rca-file
@SUBJECT_SLOT: [--rca-file <路径>]
@SUBJECT_KIND: file
@DISPOSITION: revised
@AFTER_GATE: **此后不得自动实施修复。** 等用户 `{{cmd:dual-approve}}` 之后才能继续。
@ARG_KIND: text
@QUOTE_RULE_AT: 第 1 步
---

{{> review/body}}
