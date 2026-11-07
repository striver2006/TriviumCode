---
schema: trivium.review.v2
topic: VSCode插件Phase3
stage: code
role: codex
vendor: openai
agent_cli: codex/0.167.0
model_requested: gpt-6.1-sol
model_effective: gpt-6.1-sol
model_effective_source: trace
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
model_route: config_copy
run_id: 20261107T033840Z
rerun_index: 5
snapshot_hash: sha256:30829124d144f05453f59d4a215c1d5bcdc007a475d58760e25be8d2e315abf6
blind: true
started_at: 2026-11-07T03:38:53.730Z
finished_at: 2026-11-07T03:47:48.722Z
duration_s: 239
tool_calls:
  run_command: 23
  project_reads: 36
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 0
degraded: true
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: different-family
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: 9d165553c2d4830a0a82cf4b86bf9680e2d8dee2f18f1cff28db60a2fb0667f2
  provider_declared: openai
  provider_declared_source: config
  provider_effective: openai
  provider_effective_source: trace
family_comparisons:
  - left: glm
    right: codex
    status: different-family
    left_model: glm-5.3
    right_model: gpt-6.1-sol
    left_source: declared
    right_source: trace
    reason: 模型族不同：glm / gpt
  - left: claude
    right: codex
    status: unknown
    left_model: null
    right_model: gpt-6.1-sol
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 模型族不同：glm / gpt
session_id: 01a1b416-7a1f-7233-85dc-962b4457eef8
---

# 代码审查：VSCode插件Phase3

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261107T033840Z` ｜ 第 5 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

补丁 SHA-256 与 HEAD 均符合任务书。类型检查、生成的 Webview 脚本语法检查通过；八份相关单测经内存转译执行，67/67 通过。额外内存复现仍确认两处内容丢失问题，以及新增基线缓存的资源泄漏，需要修复后重审。

**结论**：不通过（`reject`）

## 审查意见（共 3 条：重要 2 ｜ 次要 1）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:193-199,238-262` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：恢复前仍未检查通知等待期间的磁盘修改或文档继续编辑。本轮新增 savedBaseline 只负责记录，从未参与恢复校验，文档版本也未记录；点击旧恢复提示仍会覆盖外部修改并执行 revert。上一轮本侧 CODEX-01 尚未解决。

**依据**：实际读取 SaveGuard 的完整实现。本轮执行 node -e，使用 typescript.transpileModule 内存转译实际源码并注入内存 fs/vscode：保存前 A、保存后 B，通知等待期间磁盘改为 EXTERNAL-C，文档版本递增且置 dirty；点击恢复后 RESTORE_CONFLICT 输出 disk="A"、writes=1、reverts=1，而 recordedBaseline="B"。没有发生真实文件写入。

**建议**：将保存完成基线和文档版本绑定到对应保存代次，恢复前实际核对；发现后续修改时取消旧恢复或进入明确的冲突处理。补充外部修改及继续编辑的时序回归。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:1013-1024` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：为无落点列的裁决表增加落点时，新分支直接用文件头和标准六列表重建整份文档，删除表前、表后的全部正文及额外列。plan/bug 的 revised 件可能包含完整修订方案，因此补一个 missing_action 就会丢失方案内容；这也违反修复模式保留正文与合法行的承诺。

**依据**：实际读取 cockpit.ts、dispositionDraft.ts、编排器 src/trivium/disposition.ts 和批准计划 r2 §D1。本轮执行 node -e，内存转译并调用实际 renderDeskDraft，输入含完整计划正文、验收附录和额外列的既有表，补写接受项落点。UPGRADE_PRESERVATION 输出 bodyRetained=false、appendixRetained=false、extraColumnRetained=false、actionRetained=true。saveDesk 随后会将该文本写回既有路径。

**建议**：基于原文只扩展目标表的表头、对齐行和数据行，保留表外正文、原有列及合法行内容。增加含正文、附录和额外列的缺落点列修复验证。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/guard/saveGuard.ts:188-200,271-276` |
| 类别 | performance ｜ 层次 code |
| 置信度 | high |

**问题**：onDidSave 在确认存在待恢复快照之前，无条件读取并缓存每个保存文件的完整 Buffer。因此绿灯、关闭防护或保存工作区外文件时也会积累 savedBaseline；通知结束、文档关闭及 dispose 均未清理该缓存。长期会话的内存占用会随保存过的不同文件持续增长。

**依据**：实际读取 saveGuard.ts。本轮执行 node -e 内存桩，在 enabled=false 且无快照时保存三个工作区外文档，UNGUARDED_BASELINES 输出 newReads=3、cached=3；调用 dispose 后 BASELINES_AFTER_DISPOSE 仍为 3。

**建议**：保留关闭保存代次窗口的处理，但仅对有效待恢复快照读取保存后基线；在恢复、保留、失效、文档关闭及 dispose 时清理对应缓存，并限制总体缓存大小。

## 认为正确的部分

- 保存完成时新增代次关闭检查有效；本轮内存时序验证确认 did-save 后返回的迟到读取不再发布快照。
- 追加裁决行已使用已知行锚点，相关重排列序回归单测通过；可识别表头的 unparsable 修复也不再无条件更换表头。
- 保存快照保留原始字节及权限，状态读取失败采用保守锁闭，方向正确。
- 审批通过宿主参数数组调用 CLI，abandon 显式限定阶段；预设采用双 memento 且不包含主题与正文。

## 未覆盖范围（本侧盲区）

- 未启动真实 VS Code Extension Host；额外复现采用实际源码内存转译与依赖桩，不能替代真实宿主验证。
- 未执行会构建或写入夹具的完整 check、集成测试及 test/real 流程；67 个单测通过内存转译执行。
- 未验证 Windows、最低支持 VS Code 版本、真实子进程超时收尾及真实磁盘恢复。
- 未重新计算工作树 tree 指纹；已核对补丁 SHA-256 与 HEAD，未逐项执行全部新增交互测试。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `.reviews/VSCode插件Phase3/plan/2026-11-07-VSCode插件Phase3-r2-glm.md`
- `.reviews/VSCode插件Phase3/code/_meta/changes-20261107T033840Z.diff`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r2-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r3-codex.md`
- `.reviews/VSCode插件Phase3/code/2026-11-07-VSCode插件Phase3-r4-codex.md`
- `extension/package.json`
- `extension/tsconfig.json`
- `extension/esbuild.mjs`
- `extension/src/extension.ts`
- `extension/src/services.ts`
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
- `extension/test/integration/saveGuard.test.ts`
- `extension/test/real/dispositionGate.test.ts`
- `extension/test/unit/dispositionDraft.test.ts`
- `extension/test/unit/gateAreaModel.test.ts`
- `extension/test/unit/gateGapModel.test.ts`
- `extension/test/unit/lampModel.test.ts`
- `extension/test/unit/presetModel.test.ts`
- `extension/test/unit/runMeta.test.ts`
- `extension/test/unit/stateModel.test.ts`
- `extension/test/unit/worktreeSummary.test.ts`
- `extension/node_modules/@types/vscode/index.d.ts`
- `src/trivium/disposition.ts`
- `src/trivium/gate.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":23,"project_reads":36}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
