---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.5.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261107T033840Z
rerun_index: 5
snapshot_hash: sha256:30829124d144f05453f59d4a215c1d5bcdc007a475d58760e25be8d2e315abf6
blind: true
started_at: 2026-11-07T03:38:53.730Z
finished_at: 2026-11-07T03:47:48.722Z
duration_s: 335
tool_calls:
  read: 37
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 20
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
  minor: 1
  nit: 0
degraded: true
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: different-family
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: glm
    right: gemini
    status: different-family
    left_model: glm-5.3
    right_model: gemini-3.8-flash-high
    left_source: declared
    right_source: envelope
    reason: 模型族不同：glm / gemini
  - left: claude
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 模型族不同：glm / gemini
session_id: 5dbae424-75d3-4405-807e-7889be6e2ffa
---

# 代码审查：VSCode插件Phase3

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261107T033840Z` ｜ 第 5 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的问题是 SaveGuard 中引入的 savedBaseline 成员在 restore 流程中完全漏掉了与磁盘当前内容的比对逻辑，且缺乏生命周期回收：导致声明的「恢复前核对未被外部改动」防线成为假防护，且大文件原始 Buffer 会长期滞留内存（AGY-01）；此外 worktreeSummary 中重命名双段路径跳过漏判了未暂存重命名形态（AGY-02）。整体模块架构、契约生成与测试覆盖完备，修改上述问题后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 2 条：重要 1 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:52` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：SaveGuard.savedBaseline 记录了落盘基线但在 restore 时完全未被核对且未被释放：导致外部改动防护形同虚设，且完整文件字节 Buffer 长期滞留内存造成泄漏。

**依据**：在 extension/src/guard/saveGuard.ts 中，第 52-53 行声明了 savedBaseline：`private readonly savedBaseline = new Map<string, Buffer>();`，并在 JSDoc 中写明「恢复前核对未被外部改动，r4 CODEX-01」；第 193-198 行在 onDidSave 时通过 `this.savedBaseline.set(uri, await fs.readFile(doc.uri.fsPath))` 存入了保存完成瞬间的文件内容 Buffer。然而在执行恢复的 restore() 方法中（第 238-269 行），代码仅比对了 `this.snapshots.get(doc.uri.toString()) === snap`，完全没有读取或比对 this.savedBaseline 与当前磁盘内容，便直接原子写回 snap.bytes；同时在恢复完成（第 257 行）、放弃恢复（第 223 行）以及 dispose()（第 271-277 行）中均未清理 savedBaseline。

**建议**：在 restore() 开始写入磁盘前，读取磁盘当前内容与 this.savedBaseline.get(doc.uri.toString()) 比对（若被外部改动则弹窗提示并取消恢复）；并在恢复完成、用户放弃恢复以及 dispose() 时同步 delete/clear 对应的 savedBaseline。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/approval/worktreeSummary.ts:32` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：parsePorcelainZ 跳过重命名原路径段时仅判断了首字符 xy[0]，漏掉了工作树未暂存重命名（xy[1] 为 R/C）的形态，导致原路径被错误解析为独立文件并污染列表。

**依据**：在 extension/src/approval/worktreeSummary.ts 第 32 行中，对 git status -z 重命名/拷贝跳过原路径段的条件写为 `if (xy[0] === 'R' || xy[0] === 'C') i += 1;`。而在 Git porcelain v1 规范及同文件第 48-55 行的 statusText 实现中，工作树未暂存重命名的状态码形态为 ' R'（首位空格、次位为 R）。在此形态下由于 xy[0] 为空格，导致原路径段不会被跳过，而在下一次循环中被当作独立文件错误解析。

**建议**：将跳过判断条件扩展为包含 xy[1]（如 `if (xy.includes('R') || xy.includes('C')) i += 1;`）。

## 认为正确的部分

- FR-8 裁决台：区分首写与修复双形态，严格按 gate 输出缺口分类建表（含 fallback 期望集读 .fallback-items.md），通过 YAML 库安全序列化 front-matter，并以独占创建（wx）与带载入哈希校验的行级原文手术替换实现防并发覆盖；落盘后自动重跑 gate 形成校验闭环。
- FR-9 闸门区与人工审批：严格遵守带外审批约束，由宿主进程直调 CLI 动作不经模型上下文；一等展示 warnings 缺口，区分提示性与权威工作树摘要并滤除编排器保留目录。
- FR-10 保存防护与三色灯：诚实面对 VS Code 扩展宿主 API 约束（无取消保存接口、waitUntil 1.5s 预算），采用事前编辑期 modal 预警、事中 waitUntil 字节/权限快照与 toast、事后一键恢复（原子写回 + revert）三段式架构，辅以代次守卫（saveSeq/saveSeqDone）防乱序覆盖，状态不可读时红灯保守闭环。
- FR-11 装配预设：分层模型严格剔除主题与提示词正文，存储使用工作区与全局 memento 双作用域，杜绝污染 .vscode/settings.json 与 .trivium/ 配置文件；对陈旧路径做加载期校验与提示。
- 测试矩阵充实：覆盖了状态三态分流、裁决件原文手术、多列映射与表头升格、提示性摘要前缀过滤，以及对拍真实 gate --check 命令的端到端闭环用例。

## 未覆盖范围（本侧盲区）

- 真实 Electron 与 VS Code 客户端在桌面环境下的实际交互弹窗时序与 UI 视觉还原。
- Windows 原生路径与符号链接在 git status -z 下的极端边界表现（当前基线明确为 macOS）。
- 极高并发下文件系统与 VS Code 内部保存事件调度器的极端边缘竞态。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T033840Z.diff`
- `.reviews/VSCode插件Phase3/code/_meta/run-20261107T014536Z.json`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r4-gemini.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/README.md`
- `extension/README.md`
- `extension/package.json`
- `extension/src/approval/gateAreaModel.ts`
- `extension/src/approval/lampModel.ts`
- `extension/src/approval/worktreeSummary.ts`
- `extension/src/cli/commands.ts`
- `extension/src/disposition/dispositionDraft.ts`
- `extension/src/disposition/gateGapModel.ts`
- `extension/src/disposition/runMeta.ts`
- `extension/src/extension.ts`
- `extension/src/guard/saveGuard.ts`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/presets/presetModel.ts`
- `extension/src/presets/presetStore.ts`
- `extension/src/services.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/real/dispositionGate.test.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/test/unit/gateAreaModel.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":37,"grep":0,"glob":0,"run_command":0,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
