---
schema: trivium.review.v2
topic: VSCode插件Phase0-1
stage: plan
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
run_id: 20261105T170023Z
rerun_index: 2
snapshot_hash: sha256:c9e7c621fdd71a03a5410071e00109fa4fcb78b6d674718148ae03acd86ec2f8
blind: true
started_at: 2026-11-05T17:00:33.653Z
finished_at: 2026-11-05T17:25:52.316Z
duration_s: 307
tool_calls:
  read: 32
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 2
  major: 2
  minor: 1
  nit: 0
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
session_id: ea892617-f94d-4a2a-820d-be9ab567780a
---

# 计划审查：VSCode插件Phase0-1

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261105T170023Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的一条：D1 命令组装在旗标与正文间插入 '--' 分隔符，违反 skill 调用契约，导致各阶段 brief 与任务目标被注入多余的 '-- ' 前缀；
其次：D2 终端直启直接将 probe entrypoint 传给 VS Code shellPath，在 ZCode（.cjs 脚本）下会直接拉起失败；
D6 擅自向根目录 .trivium/config.yaml 追加 extension 检查，破坏插件独立隔离边界并拖慢主仓日常 verify；
D4 状态监视器以 state !== 'idle' 作为活跃 run 发现条件，会错误匹配并触发对历史终态锁的无谓扫描；
D4/D5 监视器缺少 Disposable 生命周期释放设计。
总体架构分层清晰，修改上述问题后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：阻断 2 ｜ 重要 2 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D1 第 ④ 步` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D1 命令组装在命令旗标与正文之间插入了 '--' 分隔符（组装形如「<prefix><命令> [旗标] -- '<正文>'」），与各载体入口 skill 契约冲突，会导致任务目标和审查焦点被注入多余的 '-- ' 前缀。

**依据**：查阅 plan §三 D1 步骤 ④ 规定「组装 <prefix><命令> [旗标] -- '<正文>'」；查阅 skills/dual-run/SKILL.md、skills/dual-critic/entry/codex/dual-run/SKILL.md 与 skills/dual-review-plan/SKILL.md，入口命令的参数规范均为「<任务目标> [旗标]」或「<审查焦点> [旗标]」，未定义 '--' 作为正文前缀或分隔符。核对 src/trivium/topic-args.ts:121-131 的 splitArguments 逻辑，传入裸 '--' 不会被识别为已知旗标（NAMED_FLAGS），而是作为位置参数推入 restParts；导致 TV topic resolve 解析出的 task_goal / prompt_hint 永久带有 '-- ' 前缀，污染后续各阶段 BRIEF 与 task.json。

**建议**：去掉组装逻辑中的 '--' 分隔符。对于包含空格或特殊字符的正文，由 util/shellQuote.ts 整体单引号包裹转义后直接追加在命令与旗标之后（形如 <prefix><命令> [旗标] '<正文>'），与既有各载体 skill 契约保持一致。

### AGY-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D2` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D2 终端拉起直接将 probe.cli[cliKey].entrypoint 传给 vscode.window.createTerminal 的 shellPath，在 ZCode 等基于 Node 脚本（.cjs）的载体上会直接拉起失败。

**依据**：查阅 plan §三 D2 指定「主路径：vscode.window.createTerminal({ name, shellPath: probe.cli[cliKey].entrypoint, cwd: workspaceRoot })」；查阅 src/trivium/probes/zcode.ts:68-81 与 src/trivium/adapters/zcode.ts:457-465，ZCode 的 entrypoint 为 CommonJS 脚本（如 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs），无独立可执行二进制或 shell 属性，作为 shellPath 传入 VS Code 终端将抛出 spawn 错误（ENOEXEC/EACCES）；且在 D2 的兜底路径中，在普通 shell 里执行 sendText(entrypoint) 同样会因缺少 node 运行时前缀和可执行权限而报 Permission denied。

**建议**：终端拉起不能盲目将 entrypoint 作为 shellPath。对于 .cjs 脚本或需要特定解释器的载体，应以系统缺省 Shell 拉起终端后，在终端初始化时通过命令行（如 node "<entrypoint>"）激活交互会话；或在 carriers.ts 中针对各载体声明正规的终端启动方式。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D6 及 §五 交付物` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：D6 计划修改工作区根 .trivium/config.yaml 的 verify.test 追加 extension 检查，破坏了插件独立包隔离的架构约束，并会严重拖慢甚至阻断主仓所有非插件任务的日常验证。

**依据**：查阅 plan §三 D6 提议「.trivium/config.yaml 的 verify.test 追加：npm install --prefix extension 与 npm run check --prefix extension」；比对需求基线 doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md §6.0（「extension/ 独立包（独立 package.json/tsconfig，不并入主仓 npm run check，自带 check 脚本）」）与 §9（「工程位置：extension/ 独立包，不并入主仓闸门」），两者明确要求解耦。且 extension check 包含 @vscode/test-electron 集成测试，依赖 GUI/网络环境与运行时下载，一旦写入全局 verify.test，会导致日常 CLI 双审及无头环境下的 trivium verify 变慢或失败。

**建议**：撤销修改工作区根 .trivium/config.yaml 的计划。保持 extension/ 作为完全独立的 npm package，扩展的编译与测试仅在其自身目录的 npm run check 中执行，主仓 verify 保持原样。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D4 第 ① 步` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：D4 监视器状态变更时以「state ≠ idle」作为活跃 run 发现条件，会错误匹配并触发对历史残留 approved / rejected / abandoned 终态条目的无谓扫描。

**依据**：查阅 plan §三 D4 步骤 ①：「stateWatch 变更时取 gates 中 state ≠ idle 的条目（含 running / review_done_awaiting_disposition / awaiting_approval），提取 {topic, stage, run_id}」；查阅 src/trivium/state.ts:37-46，GateState 包含 approved、rejected、abandoned 等终态，且 plan 自身 §一.4 也承认「历史样例含大量 idle/approved 残留——插件发现逻辑不得假设条目会被清理」。若仅过滤 state !== 'idle'，历史终态锁都会被重新提取，触发不必要的 runDiscovery 浅扫描与状态混淆。

**建议**：收紧活跃状态的过滤逻辑，采用明确的白名单判断：仅当 gate.state 属于 'running'、'review_done_awaiting_disposition'、'awaiting_approval' 等活跃或待决状态时才提取并监控。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §二 架构设计 及 §三 D4/D5` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：monitor 模块中各 watcher（statusWatch、logTail）缺少基于 VS Code Disposable 契约的释放与生命周期管理设计，易在长周期会话中产生句柄或定时器泄漏。

**依据**：查阅 plan §二 模块结构与 §三 D4/D5，statusWatch 与 logTail 负责监听运行目录下的 status.json 与 worker.log；但计划未明确在监视到终态（success/failed/cancelled）、用户中止任务、或驾驶舱切换监控主题时，如何清理已注册的 fs.FSWatcher 或 VS Code FileSystemWatcher 以及节流定时器。

**建议**：为 statusWatch 与 logTail 显式定义 Disposable 释放契约，并在驾驶舱生命周期、主题切换和终态复核完成后统一执行 dispose 清理。

## 认为正确的部分

- 分层架构清晰，extension/ 目录保持独立 npm 包结构，未将 VS Code 依赖侵入主仓
- 严格遵守纯只读与 CLI 面隔离原则，所有与编排器交互一律经 .trivium/bin/trivium wrapper，零复制代码核心逻辑
- D1 从渲染产物推导前缀（$ vs /）与旗标语法的单源推导思路，避免在插件中硬编码第二份载体语法
- D3 在就绪探测不依赖 unstable proposed API 的前提下，设计了可复制命令条的兜底保障，确保交互不阻塞
- 测试底座分层完备，包含纯逻辑单元测试、@vscode/test-electron 真实宿主集成测试与桩全流程 e2e
- 环境健康面板探针驱动与 viewsWelcome 未 init 引导设计完备

## 未覆盖范围（本侧盲区）

- Webview 驾驶舱在 Windows 平台上的路径展示与换行符渲染表现
- VS Code 各类深浅色及高对比度主题下的视觉与色彩变量适配
- Phase 2 及后续规划中裁决台（FR-8）与行内批注（FR-6）的详细交互设计原型

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-glm.md`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-gemini.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/08_project/README.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `skills/dual-run/SKILL.md`
- `skills/dual-review-plan/SKILL.md`
- `skills/dual-critic/entry/codex/dual-run/SKILL.md`
- `src/trivium/topic-args.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/init.ts`
- `src/trivium/state.ts`
- `src/trivium/cli.ts`
- `doc/04_development/GUIDE_local_pitfalls.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":32,"grep":0,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
