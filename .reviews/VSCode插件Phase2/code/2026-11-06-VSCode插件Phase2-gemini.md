---
schema: trivium.review.v2
topic: VSCode插件Phase2
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.5.1
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261106T002819Z
rerun_index: 1
snapshot_hash: sha256:0d33a004dd86ead5218f8dcfe23bfc83e28f38ba9f6959c74d3fee91d63680e3
blind: true
started_at: 2026-11-06T00:28:31.014Z
finished_at: 2026-11-06T00:40:34.242Z
duration_s: 420
tool_calls:
  read: 57
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 38
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
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
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: k3.1-pro
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：kimi / gemini
  - left: gemini
    right: codex
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / gpt
override_reason: 左侧模型信息缺失
session_id: 63323e37-e4df-4eb9-8938-8472405b7b37
---

# 代码审查：VSCode插件Phase2

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261106T002819Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

驾驶舱 Webview 中缺少 relPath 映射导致 Diff 按钮完全失效且位置前缀缺失（AGY-01，Major）。
locationResolve 对非正整数行号（0 与负数）未按 D2′ 约定降级为文件级，产生非法批注或 ENOENT（AGY-02，Minor）。
diffParse 对无 git 头的简化 patch 新增文件判定失效（AGY-03，Minor）；package.json 遗漏历史视图激活事件（AGY-04，Nit）。
核心纯函数架构（解析、定位、模型、Diff）分层清晰且与 VS Code API 彻底解耦，双层快照一致性判定严谨。
AnnotationHub 多轮状态同步与 metaWatch 文件监听设计完备，集成测试覆盖了关键审查链路。
经修复上述契约遗漏与行号边界后整体即可交付，结论为 pass-after-changes。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 4 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:703-716` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：Cockpit.runCards() 向 Webview 传递的意见数据中遗漏 relPath 字段，导致驾驶舱意见列表中 Diff 按钮静默失效且位置显示缺少文件名。

**依据**：在 extension/src/ui/cockpit.ts 第 703-716 行，runCards() 将 hub.findingsOfFocusRun() 映射为 RunCard['findings'] 时，未包含 relPath 字段；在 extension/src/ui/cockpitHtml.ts 第 341-351 行，位置文本格式化依赖 f.relPath 导致渲染丢失文件名，且点击 Diff 按钮向宿主派发 { type: 'open-diff', runId, relPath: f.relPath, ... } 消息时 relPath 为 undefined；在 cockpit.ts 第 277-281 行的 open-diff 消息处理中，因 if (!relPath) break 而直接静默丢弃。extension/test/integration/cockpitFindings.test.ts 未测试完整的 open-diff 消息分发，未能暴露该断裂。

**建议**：在 cockpit.ts 的 runCards() 映射中补齐 relPath: f.relPath 传递，并在测试中验证 open-diff 消息携带真实相对路径且能通过参数守卫。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/locationResolve.ts:242-265` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：resolveLocation 未正确处理小于 1 的非正整数行号，偏离计划 D2′ 约定的「未给行号」文件级降级契约。

**依据**：计划 2026-11-06-VSCode插件Phase2-r2-glm.md §2.4 (D2′) 与 D9′ 约定「无行号/line<1/非数字 → 文件级（标注『未给行号』，非漂移）」。而在 extension/src/reviews/locationResolve.ts 第 242-265 行的 resolveLocation 中，仅判断了 raw.start > lineCount（越界漂移），未校验 raw.start < 1：当行号为 0 时，作为有效行级进入 level: 'line' 且 drift/label 均为 null，产生第 0 行批注；当行号为负数时，parseRanges 未匹配导致 normalizeSegment 将 ranges 设为 null，保留形如 src/a.ts:-1 的 relPath，最终被 fs.readFile 捕获返回 missing-file 降级，偏离既定契约。extension/test/unit/locationResolve.test.ts 遗漏了 0 和负行号的测试。

**建议**：在 resolveLocation 中增加 raw.start < 1 的校验分支，将其统一降级为文件级定位 level: 'file' 并标记标签为「未给行号」，并补充相关单测。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/reviews/diffParse.ts:69` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：diffParse 在解析无 diff --git 头的简化 patch 时，无法正确识别 /dev/null 新增文件标记。

**依据**：在 extension/src/reviews/diffParse.ts 第 69 行，/^--- \/dev\/null/.test(raw) && current 要求 current 必须非空才会设置 current.added = true。如果输入的补丁没有 diff --git 前导头（即第 72-77 行支持的以 --- 开头的简化 patch），遇到新增文件的第一行 --- /dev/null 时 current 仍为 null，导致 added 标记丢失，后续 +++ b/file.ts 创建的 FileDiff 中 added 仍为 false。

**建议**：允许在 current 为空时记录待处理的 added 标记（如 pendingAdded 状态），并在解析随后的 +++ 行创建 FileDiff 时赋予 added 属性。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/package.json:20-30` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：package.json activationEvents 遗漏了运行历史视图 triviumHistory 的激活事件。

**依据**：extension/package.json 的 activationEvents 列表中包含 onView:triviumHealth 与多个命令，但未声明 Phase 2 在 contributes.views 中新增的 triviumHistory 视图激活事件 onView:triviumHistory。

**建议**：在 extension/package.json 的 activationEvents 数组中添加 onView:triviumHistory。

## 认为正确的部分

- 纯函数架构解耦彻底：reviewParse、annotationModel、diffParse、locationResolve 均无外部状态与 VS Code 依赖，测试独立性与执行速度极高。
- 双层快照一致性判定（snapshotCommit 与 baseGit 哈希）严格遵从计划 D1′ 契约，对代码漂移采取显式标注而非静默丢弃，兼顾安全性与审查可溯性。
- AnnotationHub 的服务级单例管理及与 metaWatch 配合良好，文件监控与周期轮询兜底协同保障了审查结论的准实时感知与多轮切换。
- 集成测试基于统一 fixtureLib 规范构造，全面覆盖了多审查者折叠、严重度映射、快照不一致降级与 Diff 视图呈现等核心链路。

## 未覆盖范围（本侧盲区）

- 真实 VS Code 桌面端界面上的图形化交互（如点击批注展开、在 Problems 面板跳转等实机行为）。
- Windows 环境下反斜杠路径和盘符在文件读写及 Git 差异比对中的跨平台表现（本轮按计划限制在 macOS 平台验证）。
- 多工作区（Multi-root workspaces）下的项目发现与监听（依据计划边界 D10，当前仅覆盖单根工作区）。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-r2-glm.md`
- `CLAUDE.md`
- `README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/README.md`
- `extension/README.md`
- `extension/package.json`
- `extension/src/env/versionCheck.ts`
- `extension/src/extension.ts`
- `extension/src/history/historyProvider.ts`
- `extension/src/history/runHistory.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/reviews/annotationHub.ts`
- `extension/src/reviews/annotationModel.ts`
- `extension/src/reviews/diffParse.ts`
- `extension/src/reviews/diffView.ts`
- `extension/src/reviews/locationResolve.ts`
- `extension/src/reviews/metaWatch.ts`
- `extension/src/reviews/reviewParse.ts`
- `extension/src/services.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/test/integration/annotations.test.ts`
- `extension/test/integration/cockpitFindings.test.ts`
- `extension/test/integration/cockpitLifecycle.test.ts`
- `extension/test/integration/diffView.test.ts`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/integration/health.test.ts`
- `extension/test/integration/history.test.ts`
- `extension/test/integration/suite.ts`
- `extension/test/unit/annotationModel.test.ts`
- `extension/test/unit/diffParse.test.ts`
- `extension/test/unit/locationResolve.test.ts`
- `extension/test/unit/reviewParse.test.ts`
- `extension/test/unit/runHistory.test.ts`
- `extension/test/unit/versionCheck.test.ts`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/cli.ts`
- `src/trivium/parse.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":57,"grep":0,"glob":0,"run_command":0,"project_reads":38}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
