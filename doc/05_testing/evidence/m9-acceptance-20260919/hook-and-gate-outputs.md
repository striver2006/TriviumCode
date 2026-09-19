# 零成本判据的原始输出（2026-09-19，本会话照录）

> **时限声明**：本文件全部输出取自**接线前**的构建（全局 bundle sha256 `198fc87c…`，= 3617077 + `$schema` 剥离）。
> 此后代码双审把 `readonly_breach` 接进了 `gate --check` 失败面：同一份夹具留痕（run `20260919T120643Z`，
> `guard.readonly_breach: true`，属误判）在新构建上会判 `ok: false` 并列出 `readonly_breach`。
> §4 的三次输出因此**不可在新构建上原样复现**——复现要用干净留痕或修复后的适配器重跑。

来源：M9 第 6 步验收，Claude Code 会话内经夹具 `./.trivium/bin/trivium` 直接调用。
夹具根 `<FX>` = `/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/8498a631-5c50-4055-b53d-336e61a51887/scratchpad/m9-acceptance`。
下面的 JSON 是喂给 `gate hook-pre-write` 的 stdin，与 `hooks.json` 里 `PreToolUse` matcher 交给同一子命令的形状相同。

## 1. 刻 A：`--start` 之前，该阶段无运行留痕

```
$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收/code/2026-09-19-M9-验收-claude.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
exit=0

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收/code/2026-09-19-M9-验收-gemini.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"禁止写入 2026-09-19-M9-验收-gemini.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。\n  本轮 Driver 判定为「claude」（该阶段尚无运行留痕，按缺省 Driver 判定），其余已登记角色的后缀均受保护。\n  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。"}}
禁止写入 2026-09-19-M9-验收-gemini.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。
  本轮 Driver 判定为「claude」（该阶段尚无运行留痕，按缺省 Driver 判定），其余已登记角色的后缀均受保护。
  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。
exit=2

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收/code/2026-09-19-M9-验收-response-codex.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
禁止写入 2026-09-19-M9-验收-response-codex.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。
  本轮 Driver 判定为「claude」（该阶段尚无运行留痕，按缺省 Driver 判定），其余已登记角色的后缀均受保护。
  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。
exit=2
```

## 2. 刻 B：`review --start` 返回之后（run `20260919T120018Z` 已落盘，`run.json.driver = "codex"`）

```
$ grep -o '"driver": *"[a-z]*"' .reviews/M9-验收-3812f4c/code/_meta/run-20260919T120018Z.json | head -1
"driver": "codex"

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-claude.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
禁止写入 2026-09-19-M9-验收-3812f4c-claude.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。
  本轮 Driver 判定为「codex」（取自该阶段最近一份运行留痕），其余已登记角色的后缀均受保护。
  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。
exit=2

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-response-codex.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
exit=0

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-gemini.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
禁止写入 2026-09-19-M9-验收-3812f4c-gemini.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。
  本轮 Driver 判定为「codex」（取自该阶段最近一份运行留痕），其余已登记角色的后缀均受保护。
  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。
exit=2
```

刻 B 的判定在第 1 跑（失败）落盘后即成立，第 2 跑 `20260919T120643Z` 同一主题、同一 driver，判定不变。

## 3. J8：Driver 缺省（claude）时选 claude 为审核者

```
$ ./.trivium/bin/trivium preflight --stage code --critics claude --json
✗ --critics 含当轮 Driver「claude」：它是本次运行的执笔者，不能同时充当独立审查员。
  自己审自己不构成二次审查——这条流水线存在的理由就是避免它。
  当前可用：codex | gemini | glm
exit=64
```

## 4. EV-66 真实会话面：裁决件 `role` 与文件名后缀不一致

裁决件 `2026-09-19-M9-验收-3812f4c-response-codex.md`，run `20260919T120643Z`。

校验 #1（`role: codex`，正常）：

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check --json
{
  "ok": true,
  "stage": "code",
  "rerun_index": 1,
  "run_id": "20260919T120643Z",
  "failures": [],
  "warnings": [
    {
      "code": "joint_check_degraded",
      "message": "共同阻断这一档**未执行**：有效侧只剩 1 家（需要 2 家）——有侧未产出结构化结论（解析降级或失败）。本轮不享有「两家同时提出的 blocker 被驳回即报」这层保护——这不是「查过、没发现」，是「没查」。",
      "ids": []
    }
  ],
  "structured_ids": ["CLAUDE-01", "CLAUDE-02"],
  "fallback_ids": [],
  "disposition": "<FX>/.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-response-codex.md"
}

$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check-artifacts --json
{
  "ok": true,
  "stage": "code",
  "rerun_index": 1,
  "present": ["审查 …-claude.md", "裁决件 …-response-codex.md"],
  "missing": []
}
```

校验 #2（front-matter 改 `role: claude`，文件名不变——负例，改的是被闸门定位的原件）：

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check --json
{
  "ok": false,
  "stage": "code",
  "rerun_index": 1,
  "run_id": "20260919T120643Z",
  "failures": [
    {
      "code": "bad_front_matter",
      "message": "裁决件 front-matter 与本轮不匹配：role=claude（当轮 Driver 是 codex；文件名后缀与 front-matter 的 role 必须同指一人，否则这份留痕的作者身份自相矛盾）"
    }
  ],
  "warnings": [ { "code": "joint_check_degraded", "…": "同上" } ],
  "structured_ids": ["CLAUDE-01", "CLAUDE-02"],
  "fallback_ids": [],
  "disposition": "<FX>/.reviews/M9-验收-3812f4c/code/2026-09-19-M9-验收-3812f4c-response-codex.md"
}
```

校验 #3（改回 `role: codex`，复原确认）：

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check --json
  "ok": true,
  "stage": "code",
      "code": "joint_check_degraded",
```

（#3 只截了判定行；完整形态与 #1 相同。）

## 5. 未存档的项

`run 20260919T120643Z` 的 `stdout.jsonl`（含本机 slash_commands 清单）与两份 `changes-*.diff`（= `git diff a8c7595 3812f4c -- src test`，可重建）刻意不收。
