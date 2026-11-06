---
schema: trivium.review.v2
topic: VSCode插件Phase2
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.166.0
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
run_id: 20261105T230457Z
rerun_index: 1
snapshot_hash: sha256:cd0473aae7ccf956909e83279a8cdd2d0b7eb796f8c76056460333dcd1e79f01
blind: true
started_at: 2026-11-05T23:05:08.164Z
finished_at: 2026-11-05T23:15:35.690Z
duration_s: 185
tool_calls:
  run_command: 18
  project_reads: 32
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 5
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /opt/homebrew/bin/codex
  launcher_effective: /opt/homebrew/bin/codex
  wrapper_sha256: null
  configuration_sha256: 159c9e2cff1fa3a527487bfc83473387b35f5a0de36ef7014bad96c646e274fe
  provider_declared: openai
  provider_declared_source: config
  provider_effective: openai
  provider_effective_source: trace
family_comparisons:
  - left: glm
    right: codex
    status: unknown
    left_model: null
    right_model: gpt-6.1-sol
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 左侧模型信息缺失
session_id: 01a1adf5-7b0b-7ac0-8f00-df528822c7e7
---

# 计划审查：VSCode插件Phase2

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261105T230457Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

不通过。历史 Diff 与漂移判定尚未绑定被审轮次的冻结内容，按现方案实施会展示错误变更或静默错位。批注监控的生命周期与 P1 验收路径也存在缺口。建议修订这些设计后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 6 条：重要 5 ｜ 次要 1）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 D5：103-105 行` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：Diff 固定比较当前 HEAD 与当前工作区，不能表示指定 run 的被审变更。使用 --base 送审、审查后提交或继续编辑时，历史回放会打开无关甚至为空的 Diff。

**依据**：源码静态核对：src/trivium/review.ts:1015-1043 按 opts.diffBase 生成并逐轮冻结补丁；src/trivium/code-stage.ts:132-168 保存 base/head 与补丁正文。被审计划 D5 仅读清单和 hunk，却使用 gitUri(HEAD) 与工作区 URI，未消费该轮内容。

**建议**：明确 Diff 两侧如何对应该轮冻结基线与被审内容，以及历史 Git 对象缺失、新增、删除、重命名文件的降级方式；增加自定义 base、提交后回放和工作区继续编辑的测试。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 D2：79-84 行` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：无反引号锚文本时，只要行号未越界就直接挂行级批注，会静默接受已经变化的文件。这不满足快照失配降级及漂移不得静默的要求，历史回放尤其容易错位。

**依据**：doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md:220 要求对照快照 hash，失配降为文件级并标注漂移；skills/dual-critic/schema/run.v3.json:238-264 已提供 snapshot.tree_hash。计划 D2 没有快照一致性检查，D9 也没有覆盖无锚文本且文件变化但行数仍足够的场景。此结论为静态推理。

**建议**：定义当前文件与被审快照的一致性判据；无法确认一致且无可靠锚点时显式降级。补充无锚文本、行数不变但内容替换，以及批注挂载后继续编辑的验证。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 D3、D4、D7：92、98、118 行` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：计划声明批注独立于驾驶舱面板，却把 metaWatch 接在 Cockpit.attachRun，尚未明确面板关闭后由谁继续持有并刷新意见监控。仅保留 Hub 中已有数据，会漏掉之后完成的审查侧。

**依据**：extension/src/ui/cockpit.ts:119-122 在面板关闭时调用 disposeRuns；该方法在 642 行附近释放 run watcher 并清空 runs。计划 D7 将新 watcher 接入同一 run 生命周期，D4 仅规定已有批注保留，未规定监控资源的服务级所有权。

**建议**：明确 metaWatch、run 发现与焦点切换的所有权，使批注服务在面板关闭后仍能消费后续侧完成事件；增加关闭面板后落盘意见、再次打开不重复挂载的集成测试。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 D10：144 行` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：用本主题从 ZCode 桌面端发起的 dual-run 比对 goal，不能验证插件的入口注入保真。该路径没有经过插件装配、正文整形和 sendText，无法关闭 P1 注入矩阵中的入口解析遗留项。

**依据**：extension/src/launch/entryCommand.ts 的 assembleEntryCommand 调用 prepareBody 后组装注入文本；extension/src/util/injectText.ts:10-12 会压缩全部连续空白；extension/src/ui/cockpit.ts 的 handleIgnite 再经 TerminalRelay 注入。计划只比较桌面端主题 task.json，未说明经过这些环节。第一批交付说明第二节登记的遗留项属于真机注入矩阵。

**建议**：安排一次有预算的单载体插件真实点火，记录输入原文、预期整形文本与最终 task_goal 的对照；其余链路继续用桩，避免为该验收重复跑完整开发任务。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 D10、验收清单：145、173 行` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：任务要求本批执行并记录 P1 人工验收，计划却把完成条件改成提交清单和模板、允许全部待人工。诚实标记未测是正确的，但不能据此视为满足本批指定交付范围。

**依据**：任务目标原文第 6 项明确要求 F5 走查、四家延迟标定和 sendText 定档并记录结论。第一批交付说明第四节确认这些仍是遗留项；被审计划 D10 与最终验收清单只要求材料入档，没有保留执行结果这一完成条件。

**建议**：将清单与模板列为验收准备材料，保留人工执行及结果记录作为本批验收条件；如需延期，应明确列为范围调整并取得用户决定。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 D4、D9：98、137 行` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：生命周期只覆盖 run/scope 切换与工作区关闭，没有覆盖任务硬约束中的文件关闭清理，也没有定义重新打开文件后的恢复行为。

**依据**：任务目标原文要求文件关闭、工作区切换、run 切换时正确清理。被审计划 D4 仅列面板、run 结束与扩展停用；D9 的集成断言仅列 scope 切换。extension/src/services.ts 当前固定使用首个 workspace root，也不能单凭 deactivate 覆盖全部工作区变化。

**建议**：补齐文件关闭及工作区变化的清理、恢复规则，并分别验证关闭文件和切换工作区后无旧线程及孤儿 Diagnostics。

## 认为正确的部分

- 扩展保持独立包，只读消费归档，不改核心编排逻辑和用户全局配置，实施与回退成本可控。
- review.v2 按文件降级、不污染 config/state/status 的全局点火判定，符合现有 versionCheck 的职责边界。
- Comments 与 Diagnostics 共用定位模型、逐家过滤并设置线程数量上限，方向合理。
- git.toGitUri 在扩展声明的最低 VS Code 1.85 接口中已存在，软依赖选型成立：[官方接口](https://github.com/microsoft/vscode/blob/1.85.0/extensions/git/src/api/git.d.ts)。

## 未覆盖范围（本侧盲区）

- 本次仅执行只读源码与文档核对，未运行会生成文件的构建、测试、打包或安装命令。
- 未执行 F5 GUI、真实 CLI 注入、Comments 实际呈现或大规模性能测试。
- 未读取其他审查员运行目录或结构化审查产出；未验证历史 Git 对象在垃圾回收后的可得性。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-glm.md`
- `.reviews/VSCode插件Phase0-1/code/2026-11-06-VSCode插件Phase0-1-交付说明-glm.md`
- `extension/package.json`
- `extension/src/env/versionCheck.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/monitor/reviewWatch.ts`
- `extension/src/services.ts`
- `extension/src/extension.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/launch/entryCommand.ts`
- `extension/src/launch/terminalRelay.ts`
- `extension/src/util/injectText.ts`
- `extension/test/e2e/fullflow.test.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/integration/disposable.test.ts`
- `extension/test/integration/cockpitLifecycle.test.ts`
- `extension/scripts/runE2E.mjs`
- `src/trivium/code-stage.ts`
- `src/trivium/review.ts`
- `src/trivium/freeze.ts`
- `src/trivium/types.ts`
- `skills/dual-critic/schema/review.v2.json`
- `skills/dual-critic/schema/run.v3.json`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":18,"project_reads":32}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
