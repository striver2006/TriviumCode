---
name: dual-review-code
description: 对已有代码变更做背靠背双审，并产出逐条应答与修改方案（命令 C）
argument-hint: <审查焦点提示语> [--goal <任务目标>] [--topic <主题>] [--context <路径,…>] [--profile <名称>] [--model-gemini <slug>] [--model-glm <id>] [--base <ref>] [--critics <id,…>] [--only gemini|glm] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit, Glob, Grep
@ENTRY: C
@STAGE: code
@SUBJECT_NOUN: 代码变更
@SUBJECT_FLAG: --base
@SUBJECT_SLOT: [--base <ref>]
@SUBJECT_KIND: diff
@DISPOSITION: response
@AFTER_GATE: **此后不得自动改代码、不得合入。** 等用户 `{{cmd:dual-approve}}` 之后才能继续。
---

{{> review/body}}
