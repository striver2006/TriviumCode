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
run_id: 20260919T154710Z
rerun_index: 2
snapshot_hash: sha256:84d7f2483d7a4941996aa63b47de9670ab783d9980edaae53c9049ef9008d654
blind: true
started_at: 2026-09-19T15:47:11.850Z
finished_at: 2026-09-19T15:54:27.779Z
duration_s: 270
tool_calls:
  read: 24
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 14
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 9109a036-5e80-4da7-9dee-a1b6a6ae2250
---

# 代码审查：M9-Grep命中计入读取面

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260919T154710Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本轮补丁整体质量良好，核心逻辑正确：
1. T12 四格并不逐格对应 dispose 的四个底层分支（④ 为置空变异守卫，未覆盖具名放行分支）；且 ③ 己方材料格全为负向/空集断言，单靠此用例无法区分「命中后 dispose 放行（不记）」与「压根没命中」；
2. toLogicalForm 正确处理了 rel === null || rel === '.' ? p : rel，项目外路径与运行根在代码实现上未被丢弃；
3. codex 侧「未采集」定性在 codex.ts、设计 §10.1、BACKLOG 及 guard.ts 中高度一致，但 diff 内的 types.ts:1507 遗漏了更正，仍残留「不进轨迹」旧表述。
综合评定为 approve-with-nits。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/grep-hits.test.ts:283` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：T12 己方材料分支仅有负向/空集断言，未能有效区分「命中后由 dispose 放行（不记）」与「压根没命中」

**依据**：在 test/unit/grep-hits.test.ts:283-287 的 T12 ③ 中，断言全部为负向/空集判定（peerArtifactRead === false、peerHits 为空、notedPaths 为空、typedHits 不含 ownRun）。如果人为破坏测试输入（例如将 req.deny_paths 中的 '/runs/proj-1/R1' 删去，或假设 toLogicalForm 错误丢弃了项目外路径），peerRaw.hits 将为空数组，上述四个断言仍然会 100% 全绿通过。该格无法单凭现有断言证伪「在 checkPeerLeak 中压根没命中」。

**建议**：在 T12 中为运行根补充对称的对端运行产物正向命中断言（如 peerRun = '/runs/proj-1/R1/glm/out/result.json'），先断言其在相同 deny_paths 下命中并触发 peerArtifactRead: true（分类为 peer-run-output）；再断言同目录下的己方材料 ownRun 因属于本侧被 dispose 放行且三集合不记。以此双向锁定「运行根能命中」与「己方材料命中后不记」。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:1507` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：types.ts 中 search_hit_paths 注释仍残留「codex 的命令输出不进轨迹」旧误称，与 codex.ts 及设计文档不一致

**依据**：在本次 diff 的 src/trivium/types.ts:1507 中，search_hit_paths 的文档注释仍写着「（agy / zcode 的流只有工具入参、codex 的命令输出不进轨迹、stub 不产真实输出）」，并将其归入「没有这种事实的族」。而 codex.ts:225、guard.ts:281、设计 §10.1 以及 BACKLOG EV-16/EV-76 均已根据第 1 轮 CODEX-01 纠正为「命令 stdout 就在轨迹里，适配器未做命中解析（未采集）」，二者直接矛盾。

**建议**：更新 src/trivium/types.ts:1507 注释，将「codex 的命令输出不进轨迹」修正为「codex 侧未做命中解析（未采集）」，消除类型定义与适配器、设计文档间的语义分叉。

## 认为正确的部分

- toLogicalForm 在相对路径折叠时显式处理了 rel === null || rel === '.' ? p : rel，项目外路径与运行根条目安全保留原始绝对路径，与 checkPeerLeak 内部的 normalizeAbs(p, projectRoot) 协同工作，代码实现层面没有丢失项目外路径与运行根命中。
- T13 构造 LINK 与 REAL 别名，严格覆盖了 CODEX-02 ≡ GLM-02 所指出的符号链接根下 Grep 命中逻辑形态与物理形态的不对称假阴性问题，变异守卫有效。
- codex 侧在 codex.ts:225、设计文档 §10.1、BACKLOG.md（EV-16、EV-76）以及 guard.ts:281 中，对 search_hit_paths 记 null 的定性均严格统一为「未做命中解析（未采集）」，并清晰区分了无工具事实与未做采集两种观测。

## 未覆盖范围（本侧盲区）

- 未在安装有真实 Claude Code CLI 的环境下执行端到端进程级调度实测。
- 未覆盖超深层软链循环嵌套等极端文件系统环境下的 realpath 异常分支。

## 实际查阅的项目文件

- `CLAUDE.md`
- `src/trivium/guard.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/claude-trace.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/brief.ts`
- `src/trivium/freeze.ts`
- `src/trivium/types.ts`
- `test/unit/grep-hits.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/M9-Grep命中计入读取面/code/2026-09-19-M9-Grep命中计入读取面-gemini.md`
- `.reviews/M9-Grep命中计入读取面/code/2026-09-19-M9-Grep命中计入读取面-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":24,"grep":7,"glob":0,"run_command":0,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
