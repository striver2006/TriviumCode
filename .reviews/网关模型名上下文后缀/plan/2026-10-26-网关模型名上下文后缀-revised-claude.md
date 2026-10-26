---
schema: trivium.disposition.v1
topic: 网关模型名上下文后缀
stage: plan
role: claude
kind: revised
run_id: 20261026T112757Z
addresses:
  - 2026-10-26-网关模型名上下文后缀-codex.md
  - 2026-10-26-网关模型名上下文后缀-gemini.md
  - 2026-10-26-网关模型名上下文后缀-glm.md
---

# 裁决：网关模型名上下文后缀 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-26-网关模型名上下文后缀-claude.md`（r1，基线 `bcd24640`）。
> 评审循环第 1/3 轮：codex `pass-after-changes`（3 minor），gemini `pass-after-changes`（1 minor、2 nit），glm `pass`（2 minor）。
> 共 8 条，全部接受。合入后的计划见 `plan/2026-10-26-网关模型名上下文后缀-r2-claude.md`。
> 裁决前核过的依据：`~/.local/bin/cld` 首行 `#!/usr/bin/env bash`、第 77 行 `source "$PROFILE_FILE"`（profile 由 bash 读）；在放有 `qwen1` 文件（能匹配通配模式 `qwen[1m]`）的目录里实跑 `/bin/sh`、`/bin/bash`、`/bin/zsh`、`/bin/dash` 四种 shell 的 `export M=qwen[1m]; printf "%s" "$M"`，都输出原串 `qwen[1m]`——赋值右侧不做路径名展开，CODEX-01 成立；`src/trivium/adapters/claude.ts:544` 替换集过滤 `v.length >= 8`，CODEX-02 成立；`claude-route.ts:95` 的行级正则值后面紧跟闭引号，带 `$` 的源拼进去不可能匹配，AGY-01 / GLM-01 成立；`test/integration/claude-directory-adapter.test.ts` 经 `claudeAdapter.run()` 落 `trace.json` 并逐键读取，AGY-03 成立。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| CODEX-01 | codex | minor | 接受 | 属实，r1 的理由错了：shell 对赋值右侧不做路径名展开，`export` 的赋值参数也一样（四种 shell 实测，见上）。包装器是 bash、用 `source` 读 profile，不加引号的 `ANTHROPIC_MODEL=qwen3.8-max[1m]` 就是静态字符串。改为三种形态（双引号、单引号、不加引号）都接受同一个可选后缀；§4.2 把「不加引号的带后缀形态」从反例挪到正例；M10 改为「三种形态里放行任意方括号内容」（过宽方向），由新增的「引号内 / 不加引号的后缀内容不符」反例咬住 | r2 §2.2；§4.2；§五 M10 |
| CODEX-02 | codex | minor | 接受 | 属实：只有后缀的 `[1m]` 4 个字符，不豁免但也不进替换集（≥ 8 阈值不动），「输出不含原值」这条断言照写必红。S11 拆成三层断言：全部反例 `looksLikeModelName` 为 false、`exemptKeys` 不含该键；替换断言只对长度 ≥ 8 的反例做；`[1m]` 一格另断言「不在 `replace` 里，与修复前相同」（短值行为不变） | r2 §4.1 S11 |
| CODEX-03 | codex | minor | 接受 | 属实：`claudeModelConsistency('qwen[1m][1m]', ['qwen[1m]'])` 按 r1 的写法得 true，与 S14 自己写的 false 矛盾。剥后缀分支加前提：只在 `init.model` 剥掉一个后缀之后的剩余部分不含方括号时才适用（即 init 恰好是「合法基名 + 一个后缀」）；不满足时只认逐字相等。S14 的双后缀格保留，M12 之外加一条变异「去掉这个前提」 | r2 §2.3；§4.1 S14；§五 M14 |
| AGY-01 | gemini | minor | 接受 | 属实（与 GLM-01 同一处）：带 `$` 锚的正则源拼进 profile 行级正则，`$` 落在闭引号之前，任何引号形态都匹配不上。拆成无锚片段字符串 `CONTEXT_WINDOW_SUFFIX_PATTERN`（`String.raw`），`CONTEXT_WINDOW_SUFFIX` 由它加 `$` 构造；profile 行级正则在三种形态里各用非捕获组 `(?:${片段})?` 包住，捕获组仍是整个值（含后缀），`m[2] ?? m[3] ?? m[4]` 的分组序号不变 | r2 §2.1 代码段；§2.2 |
| GLM-01 | glm | minor | 接受 | 与 AGY-01 同一处，处置相同；「共用一个正则源」改写为「同一个无锚片段派生，锚定由各使用点自定」 | r2 §2.1；§2.2 |
| AGY-02 | gemini | nit | 接受 | 合理：`message.model` 为空串时进 `reportedModels` 会让一致性误判 false。收集条件改为 `typeof m === 'string' && m.length > 0`；S14 加一格「空串被忽略」 | r2 §2.3；§4.1 S14 |
| AGY-03 | gemini | nit | 接受 | 属实：`claude-directory-adapter.test.ts` 经 `claudeAdapter.run()` 落 `trace.json` 并逐键读取。§4.4 定为在该文件追加断言：`modelReadback` 三键存在、`init` 等于该用例回读值、该假 CLI 不吐 assistant 事件所以 `reported: []`、`consistent: null`；删去「找不到就只写纯函数级锚」的退路 | r2 §4.4 |
| GLM-02 | glm | minor | 接受 | 属实：r1 的「reported 带一个不同名」格若选的不是 init 的前缀，`startsWith` 形态的过宽变异照样判 false、咬不住。S14 加一格「reported 是 init 的真前缀但不是剥后缀的结果 ⇒ false」（init `gw-a[1m]`、reported `gw-`），原「完全不同名」格保留（咬另一种过宽：不比内容）；新格列为 M11 的期望咬合点 | r2 §4.1 S14；§五 M11 |

## 本轮无驳回、无暂缓

8 条全部接受，均不改变实施方向。三家结论（两家修改后通过、一家通过）按编排器计票，下一步由闸门给出。
