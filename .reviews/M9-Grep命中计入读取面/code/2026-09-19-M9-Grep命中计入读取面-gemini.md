---
schema: trivium.review.v1
topic: M9-Grep命中计入读取面
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260919T150901Z
rerun_index: 1
snapshot_hash: sha256:05c38932f0f2caa859247991915e2db8ed8c848cf342d6b71e40d3fe3deae8fa
blind: true
started_at: 2026-09-19T15:09:02.854Z
finished_at: 2026-09-19T15:19:22.534Z
duration_s: 593
tool_calls:
  read: 37
  grep: 16
  glob: 3
  run_command: 0
  project_reads: 27
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 339e89db-9c95-4534-889e-6edac3da123d
---

# 代码审查：M9-Grep命中计入读取面

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260919T150901Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

整体实现质量高，完整兑现了修订计划中的 17 项裁决。
重点焦点审查结论：
1. content 进 hits/search_hit_paths 与另两档进 listed/trace.json 在解析器与判定面严格一致，listed 绝无路径漏入判定；
2. 措施 a 并入搜索命中后与 10.1.1 分档逻辑闭环，命中对端审查件可确凿触发作废类处置；
3. T7 集合断言（15/15 严格全量）与两次变异验证记录与代码事实完全相符。
唯一遗留轻微瑕疵：全仓缺少针对「search_hit_paths 命中对端审查件触发措施 a 作废」的单测变异守卫（AGY-01）。建议补齐守卫用例后收工。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：次要 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/grep-hits.test.ts:170` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：缺少针对「search_hit_paths 命中对端审查件触发措施 a 作废」的直接变异守卫测试

**依据**：在 src/trivium/guard.ts:284 中，措施 a 并入了 search_hit_paths：`checkPeerLeak([...result.read_paths, ...(result.search_hit_paths ?? [])], req.deny_paths, opts.projectRoot)`。但在现有单测中，test/unit/grep-hits.test.ts 的 REQ.deny_paths 恒为 []，全仓没有测试断言过经由 search_hit_paths 触发 peerArtifactRead: true 及 typedHits 记录。若在 guard.ts:284 中删掉 `...(result.search_hit_paths ?? [])`（退回修前口径），全量单元测试仍可全绿通过。

**建议**：在 test/unit/grep-hits.test.ts 中为措施 a 追加一条测试（如 T12），构造包含对端审查件（如 .reviews/topic/plan/peer-glm.md）的 search_hit_paths 与对应 deny_paths，断言 judgeSide 返回 peerArtifactRead: true、peerHits 包含该路径且 typedHits 分类为 peer-artifact；若将 search_hit_paths 置空则 peerArtifactRead 恢复为 false。

## 认为正确的部分

- content 与另两档在解析器与判定面分档严格一致：parseGrepResults 仅将 content 提取出的路径放入 hits，count 与 files_with_matches/缺省模式仅进入 listed；CriticResult.search_hit_paths 仅接收 hits，listed 仅落盘于 trace.json.grep.listed，未从任何链路（包括 read_paths、effectiveReadPaths 与 checkEvidence）漏入判定面。
- 措施 a 并入搜索命中后与 10.1.1 分档逻辑接线闭环：guard.ts 中 search_hit_paths 与 read_paths 合并传入 checkPeerLeak，命中的对端审查件经 classifyDenyPath 归入 peer-artifact（或运行根下的 peer-run-output），isVoidingCategory 判定为作废类，peerHits 收集命中并置真 peerArtifactRead，进而由 review.ts 的 jointCheckRunState 排除有效侧、由 gate.ts 的 voidedSides 排除联合决策，完整兑现作废类处置。
- T7 集合断言与两次变异记录与代码事实完全相符：T7 对 matchConsulted 的 missing 为空与 matched 长度为 15 做了严格集合断言（修前口径精确为 10），未退化为 80% 宽松布尔检查；GREP_CONTENT_LINE 变异确实导致 T1a/T1b/T2/T3/T7/T8/T10 七条红，toProjectRelative 退化为 bare startsWith 确实导致 T11 将 /repository 解析为 ../repository/… 而变红。
- base.ts 扩展 toProjectRelative 复用既有 normalizeAbs 与 isUnder，既消除了 /tmp 与 /private/tmp 以及相对绝对写法的别名假阴性，又保证了目录分隔符边界安全，未引入冗余归一化逻辑。

## 未覆盖范围（本侧盲区）

- 本次审查未在真实环境拉起 claude CLI 2.1.277 进行端到端进程调度验证，Grep 输出格式的解析正确性基于录制的截取夹具。
- 未覆盖跨磁盘挂载或多层软链穿透下 realpath 的极端 I/O 异常路径。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `src/trivium/adapters/claude-trace.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/guard.ts`
- `src/trivium/types.ts`
- `src/trivium/brief.ts`
- `src/trivium/freeze.ts`
- `src/trivium/gate.ts`
- `src/trivium/review.ts`
- `src/trivium/runner.ts`
- `test/unit/grep-hits.test.ts`
- `test/unit/guard-capability.test.ts`
- `test/unit/deny-category.test.ts`
- `test/fixtures/claude-events/README.md`
- `test/fixtures/claude-events/grep-content-absolute-path.jsonl`
- `test/fixtures/claude-events/grep-three-modes-relative-path.jsonl`
- `doc/08_project/BACKLOG.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `.reviews/M9-Grep命中计入读取面/plan/2026-09-19-M9-Grep命中计入读取面-revised-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":37,"grep":16,"glob":3,"run_command":0,"project_reads":27}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
