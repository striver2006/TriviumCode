---
schema: trivium.disposition.v1
topic: 审核修复
stage: code
role: claude
kind: response
run_id: 20260912T060013Z
addresses:
  - 2026-09-12-审核修复-gemini.md
  - 2026-09-12-审核修复-glm.md
---

# 裁决：审核修复（code 阶段 · 第 1 轮）

两侧均判 `request-changes`，共 10 条（阻断 2 ｜ 重要 4 ｜ 次要 4）。
本次焦点是「闸门与留痕的绕过路径是否真的堵上」，**结论是没有完全堵上**：
两侧从不同入口指向同一处薄弱带——`hook-pre-bash` 这个出口。

我对每条依据都做了独立核实，其中 AGY-01 实跑复现：

```
实际正则 source: \.reviews\/[^s]*(?:\/_meta\/|\/task.json)
主题=session  : false      ← 保护失效
主题=auth_svc : false      ← 保护失效
主题=审核修复 : true
```

模板字面量里的 `[^\s]` 被 JS 解析为 `[^s]`（未识别转义丢反斜杠），`task\.json`
的点同样退化为通配。**主题名只要含 ASCII 字母 `s`，Bash 侧对 `_meta/` 与
`task.json` 的保护就完全失效。** 本次审查中我自己的一条验证命令被 Hook 正确拦下，
仅仅因为当前主题「审核修复」不含 ASCII `s`——护栏是否生效取决于主题名怎么起，
这条必须先修。

全部 10 条接受，无驳回、无暂缓。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 已实跑复现：正则实际为 `[^s]*`，主题名含 ASCII `s` 时 Bash 对 `_meta/`、`task.json` 的保护完全失效，裁决期可篡改审查结论。这是本轮焦点上最硬的一条。 | `src/trivium/hooks.ts:261` `bashTargetsProtected`：弃用模板拼正则，改为对命令文本做路径组件判定（与 GLM-04 的 cd 归一化合并实现）；补「主题名含 s」的回归用例进 `test/unit/hooks.test.ts` |
| AGY-02 | gemini | blocker | 接受 | 核实属实：`gate --check` 通过后落 `idle`（cli.ts:672-684），`--await-approval` 是独立一步；Driver 省略它则四个 Hook 全部视为 idle 放行，人工审批被静默旁路。原注释担心的「裁决补齐后仍误伤」可用 entry 区分解决，不必以取消停点为代价。 | `src/trivium/cli.ts` gate 分支：读 `run.json.entry`，B/C/D 时 `--check` 通过即原子迁到 `awaiting_approval` 并输出停点话术，不落回 `idle`；A 入口保持现状。补 gate-loop 集成用例覆盖「省略 --await-approval」 |
| AGY-03 | gemini | major | 接受 | 核实属实：`.claude/settings.json` 五处 Hook 均为 `test -x "$W" \|\| exit 0`，`rm -rf .trivium` 或 `chmod -x` 后整套护栏一次性 fail-open，而 `bashTargetsProtected` 的第三条正则只含 `state.json|lock`，不含 `bin`。 | `src/trivium/hooks.ts` `bashTargetsProtected`：保护集扩至 `.trivium` 目录本身与 `.trivium/bin`；`src/install.ts` / `init.ts` 生成的 hook 命令改为 wrapper 缺失时记审计而非静默 exit 0 |
| AGY-04 | gemini | minor | 接受 | 核实属实：`topic-args.ts:22-24` 的 NAMED_FLAGS 无 `only` / `allow-single` / `session-id`，三者会被吞进自由文本。BACKLOG:373 已记但代码未改。 | `src/trivium/topic-args.ts`：补三个旗标进 NAMED_FLAGS 并映射到 `TopicResolution`；`test/unit/topic-args.test.ts` 补用例；同步撤掉 BACKLOG 对应条目 |
| AGY-05 | gemini | minor | 接受 | 核实属实：`cmdApproval` 省略 `--stage` 时枚举全部开放闸门，含 `review_done_awaiting_disposition`，而 `approval.ts:52` 对 approved 严格要求 `awaiting_approval`，结果是抛 MISSING_ARTIFACT 而非友好提示。approve 与 abandon 语义本就不同。 | `src/trivium/cli.ts` `cmdApproval`：`decision === 'approved'` 时强制要求 `--stage`，缺失退 64 并列出可选阶段；abandon 保持批量语义 |
| GLM-01 | glm | major | 接受 | 核实属实且是本轮最根本的一条：`trivium approve` 是普通子命令，`recordApproval` 不校验来源，`hookPreBash` 对非写命令提前放行，而 skill 的 allowed-tools 预批准了 `Bash(.trivium/bin/trivium:*)`——模型自批无需用户确认。会话比对确实救不了（人工审批与自批同会话）。与 AGY-02 是同一条绕路的两端，须合并修。 | 与 AGY-02 配套：`--await-approval` 置闸时生成一次性确认码写入 `task.json` 并回显给用户，`approve` 必须携带 `--code` 才放行；确认码不落 stdout 之外的模型可读位置。同时在 `doc/06_deployment/RUNBOOK_pipeline_ops.md` 与 `CLAUDE.md` 明示「审批动作本身的信任边界」 |
| GLM-02 | glm | major | 接受 | 核实属实：`tokenize` 把引号内空格保留进同一 token，`sh -c 'git commit -m x'` 产出的 token 是 `git commit -m x`，`t === 'git'` 与 `endsWith('/git')` 双双失配，`parseGitSegment` 返回 null → `looksLikeCommit` 判否 → 在 pending 检查与 `checkArchiveIntegrity` 之前放行。**补充一处审查员未提及的加重因素**：`.claude/settings.json` 的 pre-commit hook 带 `"if": "Bash(git commit:*)"`，该形态在 harness 层可能根本不触发 Hook，故只修 `parseGitSegment` 不够。 | `src/trivium/hooks.ts:343` `parseGitSegment`：找不到字面 git token 时对整段兜底匹配 `/\bgit\b[^\|;&]*\bcommit\b` 按提交处理；同时放宽 `.claude/settings.json`（及 `install.ts` / `init.ts` 的生成模板）中 pre-commit 的 `if` 条件，使 `sh -c` 包裹形态也能触发；`test/unit/hooks.test.ts` 补漏拦方向用例 |
| GLM-03 | glm | major | 接受 | 核实属实：`hookPreBash:276` 先 `looksLikeWriteCommand(cmd)`（内部已剥 heredoc）再早退，规则 1、2 连评估机会都没有；且 `bashTargetsProtected` 收到的也是剥离后文本。被豁免的恰是无跑后兜底的对象——`judgeDrift` 把归档根与 `.trivium/` 整体排除。RUNBOOK「任何时候都挡」与 CLAUDE.md「绕过去也会被判成漂移」对这几类对象确实都不成立。 | `src/trivium/hooks.ts`：规则 1 改在**未剥离原文**上判保护目标（误报代价低，与本 Hook 保守取向一致）；存在 open gate 时规则 2 也不剥 heredoc；补「heredoc 正文写 state.json / _meta 必须被拦」用例；修正 RUNBOOK §三的表述 |
| GLM-04 | glm | minor | 接受 | 与 AGY-01 同一处，但指出了另一维度的缺口：依赖 `<archiveRel>/` 字面前缀，`cd .reviews && cat > t/plan/_meta/x` 不含前缀即漏过；且要求 `/_meta/` 带尾斜杠，重定向指向 `_meta` 目录本身不命中。`commitTargetsProject` 已有 cd 归一化可复用而未复用。 | 与 AGY-01 合并实现：`bashTargetsProtected` 复用 `commitTargetsProject`（hooks.ts:427-465）的 cd/目录跟踪做归一化前缀判定，并去掉对尾斜杠的依赖 |
| GLM-05 | glm | minor | 接受 | 核实属实：`ApprovalInput.sessionId` 从 CLI 就未传入、`recordApproval` 也未使用，`ApprovalRecord` 不含来源字段。整套锁都押在 session 身份上，唯独「谁解的闸」不留痕——接口在假装支持来源追踪。 | `src/trivium/approval.ts`：`ApprovalRecord` 落 `sessionId`（CLI 从 `--session-id` / `CLAUDE_SESSION_ID` 取，可为 null），`cmdApproval` 传入；与 GLM-01 的来源审计共用同一字段 |

## 修改方案（实施顺序）

绕过路径集中在 `hook-pre-bash` 与审批链两处，按依赖排序：

1. **第一梯队 · hook-pre-bash 出口（AGY-01 + GLM-04 + GLM-03 + AGY-03）**
   `bashTargetsProtected` 整体重写：路径组件判定取代手写正则、复用 cd 归一化、
   保护集扩到 `.trivium/bin`；`hookPreBash` 调整剥离时机使规则 1 看原文。
   这四条改同一个函数域，一并做、一并补测试。

2. **第二梯队 · 提交出口（GLM-02）**
   `parseGitSegment` 兜底 + `settings.json` 的 `if` 条件放宽（两处缺一不可）。

3. **第三梯队 · 审批链（AGY-02 + GLM-01 + GLM-05 + AGY-05）**
   `--check` 按 entry 直迁 `awaiting_approval`、一次性确认码、审批来源留痕、
   approve 强制 `--stage`。四条共用 `task.json.approvals` 与 gate 状态机，一并做。

4. **第四梯队 · 参数契约（AGY-04）**
   NAMED_FLAGS 补齐，独立无依赖，最后做。

跨梯队的文档同步：`RUNBOOK_pipeline_ops.md` §三的「任何时候都挡」表述、
`CLAUDE.md` 的信任边界说明、BACKLOG 对应条目撤销。
