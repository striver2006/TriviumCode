---
name: dual-review-plan
description: 对已有计划做背靠背双审，并产出逐条裁决的修订计划（命令 B）
argument-hint: <审查焦点提示语> [--goal <任务目标>] [--topic <主题>] [--context <路径,…>] [--profile <名称>] {{MODEL_HINT}} [--plan-file <路径>] [--critics <id,…>] [--only {{ONLY_CHOICES}}] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit, Glob, Grep
@ENTRY: B
@STAGE: plan
@SUBJECT_NOUN: 计划
@SUBJECT_FLAG: --plan-file
@SUBJECT_SLOT: [--plan-file <路径>]
@SUBJECT_KIND: file
@DISPOSITION: revised
@AFTER_GATE: **此后不得开始编写或修改任何业务代码。** 等用户 `{{cmd:dual-approve}}` 之后才能继续。
@ARG_KIND: text
@QUOTE_RULE_AT: 第 2 步
---

{{> review/body}}
