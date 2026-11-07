---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.318
model_requested: k3.1-pro
model_effective: k3.1-pro
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261107T031826Z
rerun_index: 4
snapshot_hash: sha256:6eb0283a11d0ef0d0e553932098c8a957578741b0bda056b030dd78640e1f467
blind: true
started_at: 2026-11-07T03:18:39.310Z
finished_at: 2026-11-07T03:33:03.756Z
duration_s: 864
tool_calls:
  read: 50
  grep: 12
  glob: 1
  run_command: 0
  project_reads: 40
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 2
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: different-family
access:
  requested_mode: profile
  profile: kimi
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 302204616262eadfddb0f255aac8b9d2768d9db4ddf5a3bd5c5d84925f2c82b8
  provider_declared: kimi
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: glm
    right: claude
    status: different-family
    left_model: glm-5.3
    right_model: k3.1-pro
    left_source: declared
    right_source: envelope
    reason: 模型族不同：glm / kimi
  - left: claude
    right: gemini
    status: different-family
    left_model: k3.1-pro
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：kimi / gemini
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
override_reason: 模型族不同：glm / kimi
session_id: 9458aaf0-6099-4b88-802e-c6bbf5d04087
---

# 代码审查：VSCode插件Phase3

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261107T031826Z` ｜ 第 4 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。

## 总判断

最危险的是保存快照跨保存代次失效：第二次保存取基线失败后，旧快照仍会被当成第二次的保存前内容，恢复会连前一次修改也一并覆盖。
真实闭环测试仍未走到零意见与无表头修复的生产分支，且缺少 JSON 的用例继续静默通过，与本轮应答的验收声明不符。
saveDraft 声称 replaceExclusive 内还有二次核对，实际没有；无表头重建也仍保留声称已剔除的坏表原文。
上述保存恢复的数据损失问题需要修复后重新评审。本侧仅静态审查，未运行测试。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：重要 2 ｜ 次要 3）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:147-196` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：旧快照没有与保存代次绑定。第一次保存得到快照 A 后，第二次保存若读取失败或超时，catch 不会使 A 失效；onDidSave 随后仍取出 A 并提供恢复，用户点击后会回到第一次保存之前，而不是仅撤销第二次保存。新保存开始或后续保存已不再受防护时也没有清理旧快照，存在同类陈旧恢复入口。

**依据**：extension/src/guard/saveGuard.ts:81-85 只递增 saveSeq；147-173 的失败分支不清理或作废旧快照；178-196 的 onDidSave 不携带也不核对保存序号，只比较 map 中对象身份，因此失败保存仍复用旧对象。extension/test/integration/saveGuard.test.ts:93-120 只覆盖单次成功保存后立即恢复，没有成功保存后再次保存失败的链路。.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-response-glm.md:33 对 CODEX-03 写的是「超时清理限定代次」，当前实现没有兑现。结论按代码事件链推理，未运行。

**建议**：把快照记录与 seq 显式绑定：新保存开始即作废旧快照，失败时只清理对应代次，onDidSave 与 restore 都要求快照 seq 等于该次保存；不受防护的保存也不得继续提供旧恢复入口。补「成功保存 A → 第二次保存读取失败 → 不得恢复 A」及连续保存故障注入。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/test/real/dispositionGate.test.ts:53-57,195-220` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本轮关键修复的真实验收仍有多处空档：无 JSON 时第二个契约用例直接 return 并通过；无表头用例直接调用通用 renderDisposition，没有经过 cockpit 的 surgery=null 生产分支；零意见首写以及 unparsable_table 与 unknown_findings 组合也没有对应用例。因而这些路径再次回归时，现有测试不会报警。

**依据**：extension/test/real/dispositionGate.test.ts:53-57 保留 if (!r.json) return；195-220 的无表头用例调用的是 renderDisposition。实际被修分支在 extension/src/ui/cockpit.ts:917-920（emptyDraft）与 979-989（surgery=null）。extension/test/unit/dispositionDraft.test.ts 全件 240 行只有正常表头的原文手术，没有零意见宿主链路或 unparsable+unknown 组合；extension/test/integration/dispositionDesk.test.ts 也未覆盖它们。.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-response-glm.md:22,28 却分别声称零意见「单测覆盖」和「无 JSON 直接失败不跳过」。

**建议**：让真实对拍调用生产渲染入口（或抽出并共用同一渲染函数），覆盖零意见 missing_disposition、无表头且带 missing_findings、unparsable+unknown 的落盘后 gate 闭环；所有应产出 JSON 的断言在缺失时直接失败，不要静默跳过。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/dispositionDraft.ts:350-380` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：注释声称「二次核对在 replaceExclusive 内部收窄窗口」，但生产 replaceExclusive 只有写临时文件与 rename，没有第二次内容核对；模块头和 README 仍使用「hash 防并发覆盖」的强口径。这与本轮已接受的「仅冲突检测、如实标注残余窗口」处置不一致，会让维护者误以为多了一层实际不存在的防护。

**依据**：extension/src/disposition/dispositionDraft.ts:350-380 写明存在二次核对；extension/src/ui/cockpit.ts:1034-1038 的 replaceExclusive 仅 writeFile 后 rename。extension/README.md:44-45 与 dispositionDraft.ts:8-11 仍称防并发覆盖。.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-response-glm.md:27 对 CLAUDE-08 选择的是语义降级为冲突检测并注明残余风险，而不是新增第二次核对。

**建议**：删除不存在的二次核对表述，把模块注释、函数说明和 README 统一为「载入 hash 冲突检测，替换前仍有竞态窗口」；若仍承诺防止该窗口覆盖，则需要协作锁或真正的原子比较替换机制，而不是补文案。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:979-988` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：surgery=null 的注释与裁决应答都称「坏表原文剔除」，实际 base 只移除文件开头的第一个 --- 行，原坏表以及原 front-matter 的其余内容会整体追加到新表之后。新件可能同时带着过期 front-matter 文本和坏表内容，虽然空行通常可让 gate 只读新表，审计正文却与「已剔除」不符，也会误导后续人工修复。

**依据**：extension/src/ui/cockpit.ts:979-988 的 base 只执行一次开头分隔行 replace，随后把 base.trim() 拼回新表后；没有识别或删除旧 front-matter 余段、坏表。extension/test/real/dispositionGate.test.ts:195-220 只验证通用 renderDisposition 能过 gate，没有检查该生产分支的保留内容。.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-response-glm.md:20 明确承诺坏表原文剔除。

**建议**：区分可保留的表外正文与应丢弃的旧 front-matter、坏表片段，只把确认属于表外说明的内容带入重建件；补断言旧坏表行和旧 role/run_id 文本不出现在重建结果中。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/disposition/runMeta.ts:38-50` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：新增 PREFIX_TO_CRITIC 再登记了一份 CLAUDE/CODEX/AGY/GLM 与 Agent id 的映射，形成注册表之外的第二份身份事实源。新增或调整 Agent 时这里不会自动跟随，来源展示与后续依赖 criticOfId 的逻辑会静默失真。

**依据**：extension/src/disposition/runMeta.ts:38-50 硬编码四个前缀及映射；src/trivium/agents/registry.ts:1-7 与 AGENTS.md:132-135 明确要求编号前缀和 Agent 差异只由注册表派生，禁止其它模块另写字面集。

**建议**：通过共享的只读生成资产、CLI 查询或运行元数据提供前缀映射，避免插件维护第二份表；若跨包复用暂时不可行，至少建立与注册表的机器对账并显式记录例外。

## 认为正确的部分

- approve/reject/abandon 的 argv 与 CLI 契约一致，拒绝理由非空拦截、abandon 显式 --stage 和审批动作防重入均已接线。
- 闸门缓存包含 runId 且有 epoch 与状态复核，审批结果及权威摘要独立展示；state.json 的 ENOENT、读失败与非法 JSON 根值已分流到 unreadable 保守灯态。
- 裁决表单控件变更会回传并使预览失效，落盘绑定已确认预览；零意见首写在宿主校验上已放行。
- 无表头分支现在会把本次表单裁决行全部写入新表，renderRepaired 的删除也已先于表头替换，前两轮的两处核心断点已修复。
- 预设使用 globalState/workspaceState，主题与正文不入库，名称输入与删除确认移到宿主侧。

## 未覆盖范围（本侧盲区）

- 本侧未执行任何命令，未运行 extension 的 typecheck、compile、单元、集成或 real 测试；竞态结论均按代码事件链推理。
- 未在真实 Webview DOM 中验证渲染、预览后编辑、modal/toast 与保存恢复时序。
- 未覆盖真实四家 Driver、真实三审主题及真实 CLI 输出复跑。
- Windows、多根工作区、非 UTF-8 文件、符号链接、权限与外部修改文件的边界未验证。
- Phase 2 既有功能只检查本次改动触及的调用链，未做完整回归审查；本轮已明确接受的 hash/恢复原子替换残余 TOCTOU 窗口未重复列为问题。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T031826Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-claude.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r2-claude.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-claude.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-response-glm.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `extension/README.md`
- `extension/package.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/cli/commands.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/approval/gateAreaModel.ts`
- `extension/src/approval/lampModel.ts`
- `extension/src/approval/worktreeSummary.ts`
- `extension/src/disposition/dispositionDraft.ts`
- `extension/src/disposition/gateGapModel.ts`
- `extension/src/disposition/runMeta.ts`
- `extension/src/guard/saveGuard.ts`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/presets/presetModel.ts`
- `extension/src/presets/presetStore.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/env/config.ts`
- `extension/src/reviews/reviewParse.ts`
- `extension/test/integration/dispositionDesk.test.ts`
- `extension/test/integration/gateApproval.test.ts`
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/real/dispositionGate.test.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/cli.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`
- `src/trivium/naming.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":50,"grep":12,"glob":1,"run_command":0,"project_reads":40}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
