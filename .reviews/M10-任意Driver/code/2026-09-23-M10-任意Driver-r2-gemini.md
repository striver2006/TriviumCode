---
schema: trivium.review.v1
topic: M10-任意Driver
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.8
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260923T030441Z
rerun_index: 2
snapshot_hash: sha256:73b915eedcef9511b0c85c92dda2ce547159ab83b5dd8333a55e291624ff6fb0
blind: true
started_at: 2026-09-23T03:04:43.109Z
finished_at: 2026-09-23T03:24:51.990Z
duration_s: 184
tool_calls:
  read: 26
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 15
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: b5b551e2-4123-46e0-87a3-085201fd85e5
---

# 代码审查：M10-任意Driver

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260923T030441Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本轮实现忠实落实了原稿登记时点后移（作废轮门控）与提交锚 _meta/ 位置判据重写，但存在关键测试缺口：原稿成功登记后被改动是否真能被提交锚阻断未做闭环测试，作废轮改稿放行亦未设用例，存在安全网与防死锁工作流的验证真空（AGY-01）；同时 subjectArtifactRelPath 域判据缺少空路径与绝对路径防御，单测甚至将返回空串误作为合法期望（AGY-02）；新增的字符窗口扫描测试依赖前置代码字面量巧合触发，且正则剥注释存在误伤盲区（AGY-03）；裁决件原地改可提交与归档外文档端到端留痕用例尚未补齐（AGY-04）。建议补齐闭环测试与边界防护后再行合入。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 1 ｜ 次要 3）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/fault-injection.test.ts:113` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：送审原稿防篡改提交拦截（EV-55 核心闭环）与作废轮原稿改动放行未进行端到端提交测试，关键安全网与防死锁工作流存在验证真空。

**依据**：test/integration/fault-injection.test.ts:113-130 仅断言了 meta.artifacts 包含了原稿路径与 sha256，但从未修改原稿并调用 hookPreCommit（或在测试仓库中执行 commit）以验证 EXIT.GATE_BLOCK 真实触发；同时，计划 §3.3 明确要求的「作废轮（subject_drift / 超时）之后原稿原地改 ⇒ 可提交」亦完全未设测试。若 checkArchiveIntegrity 遍历或 checkRecordedArtifacts 解析原稿相对路径存在隐性缺陷，原稿篡改将无法被阻断；反之若作废轮误绑提交锚，则会导致全仓提交死锁。

**建议**：在 fault-injection.test.ts 或 hooks.test.ts 中补齐两项用例：① 成功收尾后原地修改原稿，调用 hookPreCommit 验证被拦下（返回 EXIT.GATE_BLOCK 且 stderr 包含原稿路径）；② 模拟作废轮（如注入 drift 或超时），验证原稿未入 artifacts，原地改动后 hookPreCommit 返回 EXIT.OK。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/review.ts:485` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：subjectArtifactRelPath 域判据缺少空路径与绝对路径防御，单测将返回空字符串误锁为合法期望，存在异常路径进 artifacts 导致提交锚崩溃风险。

**依据**：review.ts:485-488 实现为 const rel = path.relative(archiveRoot, subjectPath); return rel.startsWith('..') ? null : rel;。当 subjectPath === archiveRoot 时返回 ''（且 test/unit/subject-artifact.test.ts:24-27 将其作为正确断言）；若 rel 为空字符串或意外为绝对路径（path.isAbsolute(rel)），review.ts:1540 会将其登记入 meta.artifacts，后续 archive.ts:447 的 path.join(archiveRoot, '') 会解析为归档目录本身，sha256File 抛出 EISDIR 并在 checkRecordedArtifacts 中被误判为 missing 导致提交阻断。同仓 hooks.ts:466（isOrchestratorOwned）及 hooks.ts:439（stageSegmentsUnder）均统一采用 if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel))。

**建议**：将 subjectArtifactRelPath 的排除条件对齐同仓规范：if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;，并修正 subject-artifact.test.ts:24 的断言期望为 null。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/contract/bash-recovery-wording.test.ts:22` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：机械扫描测试存在正则剥注释与字符窗口盲区，核心恢复文案的看守依赖前置代码中的字面量巧合。

**依据**：bash-recovery-wording.test.ts:34-36 的 stripComments 使用 /\/\/.*$/gm，若字符串中包含 URL（https://）或双斜杠，会将该行后续代码/提示整段误剥；更关键的是，hooks.ts:1302 的提交锚错误文案正文中并未出现 _meta、task.json 等字面量（写的是「上面列出的受保护路径」），之所以能命中该测试，完全是因为 1273 行前置代码中恰好出现了 task.json 且落在 400 字符窗口内。若后续函数重构导致两处距离超过 400 字符，测试将把该真实恢复文案视为「不在论域」直接跳过，丧失看守能力。

**建议**：将扫描判据的论域识别从「仅匹配保护文件具体字面」扩宽为包含「受保护路径」等通用恢复语境，或者直接针对关键错误生成函数（如 checkArchiveIntegrity、hookPreBash）的实际输出做直接的断言，避免纯字符窗口巧合匹配。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/hooks.test.ts:980` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：裁决件改动可提交的回归锁与归档外被审对象端到端留痕测试缺失，计划承诺的测试矩阵存在缺口。

**依据**：计划 §3.3 明确列出「裁决件原地改 ⇒ 可提交（正例）」以及「归档外被审对象（--plan-file doc/…）⇒ 不产生登记条目且 run.json 有标注；随后被改 ⇒ 可提交」。改动说明中已承认裁决件用例未补。若无测试盯防，后续若 hasRoleSuffixCrossTime 或位置判据调整，可能误将裁决件（-response- / -revised-）判为不可变；归档外原稿的警告流转也缺乏集成测试支撑。

**建议**：在 hooks.test.ts 中补齐裁决件已提交后修改并放行提交的正例测试，以及在集成测试中补齐 --plan-file 场景下 run.json 带有「不在保护集」标注且不影响后续提交的用例。

## 认为正确的部分

- 原稿登记时点准确后移至 executeRun 成功判定之后，作废轮（drift/fail/abort）被正确门控拦截，彻底规避了作废轮原稿误绑提交锚的风险。
- stage !== 'code' 显式门控生效，code 阶段补丁工件在 prepareRun 阶段已有 pendingDiff 登记，未发生重复登记。
- hooks.ts 中 run-*.json running 态例外分支严格排在 _meta/ 通用位置判据之前求值，收尾回写不受误拦，且成功态改动被精准阻断。
- hasRoleSuffixCrossTime 首行跨时间判定逻辑保持完整，未受新增位置判据干扰。
- gate.ts 删去会话内无法执行的 git restore 建议、聚焦重跑一轮出口，闭环且不留坏路径；CLAUDE.md 与 protocol snippet 终端提示同步一致。
- hooks.test.ts 新增的三条真实 git 仓库测试精确覆盖了旧枚举未知文件拦截、便利副本放行与 run.json 状态求值次序。

## 未覆盖范围（本侧盲区）

- 真实 Agent 载体（agy / zcode / codex）的 headless 运行时资产加载与真 Hook 触发（归属 M10b 范围）。
- 非缺省 Driver（如 glm / codex）在真实多阶段切换下的裁决件提交行为（因本步未启用 driverEnabled，主要验证缺省 driver 场景）。
- 除 hooks 与 review 模块之外的其余底层 git 与 exec 辅助工具内部异常未作逐行全量覆盖审查。

## 实际查阅的项目文件

- `.reviews/M10-任意Driver/code/2026-09-22-M10-任意Driver-gemini.md`
- `.reviews/M10-任意Driver/code/2026-09-22-M10-任意Driver-response-claude.md`
- `.reviews/M10-任意Driver/code/_meta/changes-20260923T030441Z.diff`
- `.reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r7-claude.md`
- `AGENTS.md`
- `CLAUDE.md`
- `skills/dual-critic/protocol/CLAUDE.md.snippet`
- `src/trivium/archive.ts`
- `src/trivium/gate.ts`
- `src/trivium/guard.ts`
- `src/trivium/hooks.ts`
- `src/trivium/review.ts`
- `src/trivium/topic.ts`
- `test/contract/bash-recovery-wording.test.ts`
- `test/integration/fault-injection.test.ts`
- `test/unit/gate.test.ts`
- `test/unit/hooks.test.ts`
- `test/unit/subject-artifact.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":26,"grep":7,"glob":0,"run_command":0,"project_reads":15}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
