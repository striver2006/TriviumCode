---
name: dual-review-code
description: 对已有代码变更做背靠背双审，并产出逐条应答与修改方案（命令 C）
argument-hint: <审查焦点提示语> [--goal <任务目标>] [--topic <主题>] [--context <路径,…>] [--profile <名称>] {{MODEL_HINT}} {{TIER_HINT}} {{EFFORT_HINT}}{{VENDOR_PROFILE_HINT}} [--base <ref>] [--max-rounds <n>] [--critics <id,…>] [--only {{ONLY_CHOICES}}] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Bash, Read, Write, Edit, Glob, Grep
@ENTRY: C
@STAGE: code
@SUBJECT_NOUN: 代码变更
@SUBJECT_FLAG: --base
@SUBJECT_SLOT: [--base <ref>]
@SUBJECT_KIND: diff
@DISPOSITION: response
@AFTER_GATE: **代码已在第 5.5 步按裁决改好；此后不得再改代码、不得合入。** 等用户 `{{cmd:dual-approve}}` 之后才能继续。
@ARG_KIND: text
@QUOTE_RULE_AT: 第 1 步
---

{{> review/body}}
