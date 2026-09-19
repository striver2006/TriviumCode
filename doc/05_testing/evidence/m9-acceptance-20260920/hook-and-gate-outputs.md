# 零成本判据的原始输出（2026-09-20，M9 第 6 步第 2 轮验收，本会话照录）

来源：Claude Code 会话内经夹具 `./.trivium/bin/trivium` 直接调用。构建身份：全局 bundle
`~/.claude/skills/dual-critic/scripts/trivium.cjs` sha256 `c50d787863bebd334e8d4cc0acd104e1957ed7a0953c95fa0149042d8cdc2f38`，
由本仓 `a75ec43817c6116affa0ff7729b3a04e3119a303` **干净树**重建后逐字节相同。
夹具根 `<FX>` = `/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/8498a631-5c50-4055-b53d-336e61a51887/scratchpad/m9-acceptance`
（由 `build-fixture.sh` 重建，与第 1 轮入库的脚本 `cmp` 相同；夹具 HEAD `654877b0`，被审补丁 `subject_sha256 a3301d7d…`，与第 1 轮第 2 跑同值）。
下面的 JSON 是喂给 `gate hook-pre-write` 的 stdin，与 `hooks.json` 里 `PreToolUse` matcher 交给同一子命令的形状相同。

## 0. 夹具侧准入

```
$ ./.trivium/bin/trivium doctor --only claude
  [claude] 工具面干净、无未授权工具：Glob、Grep、Read
  [claude] headless 读文件通过（哨兵命中）；本次成本 $0.0095649
  …（其余各格与第 1 轮 fixture-config.local.yaml 相同，本轮副本同名入库）
✓ 未发现阻断级问题
exit=0

$ ./.trivium/bin/trivium preflight --stage code --critics claude --driver codex --json
  "ok": true … 7 项 checks 全 ok（当轮 Driver codex「仅用于选侧判定」；探针新鲜；claude 2.1.277；只读能力；slug（无目录可比对）；归档与 git；探活 4s）
exit=0

$ ./.trivium/bin/trivium topic resolve --stage code --json -- '<焦点>' --topic M9-验收-3812f4c --critics claude --driver codex
  "critics": ["claude"], "driver": "codex", "driver_enabled": false, "base": "HEAD", "diff_available": true
exit=0
```

## 1. 刻 A：`--start` 之前，该阶段无运行留痕

```
$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-claude.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
exit=0

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-gemini.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"禁止写入 2026-09-20-M9-验收-3812f4c-gemini.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。\n  本轮 Driver 判定为「claude」（该阶段尚无运行留痕，按缺省 Driver 判定），其余已登记角色的后缀均受保护。\n  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。"}}
exit=2

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-response-codex.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
（同上文案，「本轮 Driver 判定为「claude」（该阶段尚无运行留痕，按缺省 Driver 判定）」）
exit=2
```

## 2. 刻 B：`review --start` 返回之后（run `20260919T162144Z` 已落盘）

```
$ grep -o '"driver": *"[a-z]*"' .reviews/M9-验收-3812f4c/code/_meta/run-20260919T162144Z.json | head -1
"driver": "codex"

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-claude.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
禁止写入 2026-09-20-M9-验收-3812f4c-claude.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。
  本轮 Driver 判定为「codex」（取自该阶段最近一份运行留痕），其余已登记角色的后缀均受保护。
  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。
exit=2

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-response-codex.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
exit=0

$ printf '{"tool_name":"Write","tool_input":{"file_path":"<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-gemini.md"}}' | ./.trivium/bin/trivium gate hook-pre-write
（同上文案，「本轮 Driver 判定为「codex」（取自该阶段最近一份运行留痕）」）
exit=2
```

刻 B 在 `--start` 返回后、审查仍在运行时即成立（run.json 在派生工作进程前落盘）。

## 3. J8：Driver 缺省（claude）时选 claude 为审核者

```
$ ./.trivium/bin/trivium preflight --stage code --critics claude --json
✗ --critics 含当轮 Driver「claude」：它是本次运行的执笔者，不能同时充当独立审查员。
  自己审自己不构成二次审查——这条流水线存在的理由就是避免它。
  当前可用：codex | gemini | glm
exit=64
```

## 4. `gate --check` 三次（含 EV-66 真实会话面负例）与 readonly_breach 接线

裁决件 `2026-09-20-M9-验收-3812f4c-response-codex.md`，run `20260919T162144Z`，`run.json.guard.readonly_breach = false`。

校验 #1（`role: codex`，正常）：

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check --json
{
  "ok": true,
  "stage": "code",
  "rerun_index": 1,
  "run_id": "20260919T162144Z",
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
  "disposition": "<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-response-codex.md"
}
exit=0
```

- **J5 的两格**：侧级审查文档 front-matter **不含** `consulted_unverified`；上面的输出**没有**「claude 侧 consulted 无法与工具轨迹交叉核对」行。
- **readonly_breach 接线**：`failures` 为空——第 1 轮第 2 跑的同形留痕（`readonly_breach: true`，误判）在本构建上会判 `ok: false`（gate.test 正反例）；本轮真实链路上 `StructuredOutput` 调用 2 次而 `readonly_breach: false`，是 EV-75 豁免第一次在真实链路成立。
- `joint_check_degraded` 告警是单侧运行的预期形态（有效侧 1 家），与第 1 轮相同。

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check-artifacts --json
{ "ok": true, "stage": "code", "rerun_index": 1, "present": ["审查 …-claude.md", "裁决件 …-response-codex.md"], "missing": [] }
exit=0
```

校验 #2（front-matter 改 `role: claude`，文件名不变——负例，改的是被闸门定位的原件）：

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check --json
{
  "ok": false,
  "stage": "code",
  "rerun_index": 1,
  "run_id": "20260919T162144Z",
  "failures": [
    {
      "code": "bad_front_matter",
      "message": "裁决件 front-matter 与本轮不匹配：role=claude（当轮 Driver 是 codex；文件名后缀与 front-matter 的 role 必须同指一人，否则这份留痕的作者身份自相矛盾）"
    }
  ],
  "warnings": [ { "code": "joint_check_degraded", "…": "同上" } ],
  "structured_ids": ["CLAUDE-01", "CLAUDE-02"],
  "fallback_ids": [],
  "disposition": "<FX>/.reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-response-codex.md"
}
exit=2
```

校验 #3（改回 `role: codex`，复原确认）：

```
$ grep -n '^role:' .reviews/M9-验收-3812f4c/code/2026-09-20-M9-验收-3812f4c-response-codex.md
5:role: codex
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check --json
  "ok": true, … "failures": [], … "structured_ids": ["CLAUDE-01", "CLAUDE-02"]
exit=0
```

（#3 只截了判定行；完整形态与 #1 相同。）

## 5. 裁决件未写前的工件核对（对照）

```
$ ./.trivium/bin/trivium gate --stage code --topic M9-验收-3812f4c --check-artifacts --json
{ "ok": false, "stage": "code", "rerun_index": 1, "present": ["审查 …-claude.md"], "missing": ["裁决件 …-response-codex.md"] }
exit=65
```

## 6. 未存档的项

`run 20260919T162144Z` 的 `stdout.jsonl`（含本机 slash_commands 清单）与两份 `changes-*.diff`（= `git diff a8c7595 3812f4c -- src test`，可重建）刻意不收；
Grep 调用对的截取（`grep-tool-results-20260919T162144Z.jsonl`）由 `../m9-acceptance-20260919/extract-grep-pairs.py` 从原始流截出、根前缀改写为 `<ROOT>`。
