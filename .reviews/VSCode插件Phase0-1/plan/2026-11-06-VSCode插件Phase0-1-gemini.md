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
run_id: 20261105T163451Z
rerun_index: 1
snapshot_hash: sha256:c9e7c621fdd71a03a5410071e00109fa4fcb78b6d674718148ae03acd86ec2f8
blind: true
started_at: 2026-11-05T16:35:01.504Z
finished_at: 2026-11-05T16:44:35.772Z
duration_s: 574
tool_calls:
  read: 58
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 26
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 2
  major: 2
  minor: 1
  nit: 0
degraded: true
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
override_reason: 左侧模型信息缺失
session_id: 328516cf-bc53-4140-9217-86a5224d9ec3
---

# 计划审查：VSCode插件Phase0-1

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261105T163451Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的一条：D1 命令组装在旗标与正文间硬塞 '--'，违反 skill 调用契约，导致各阶段 brief 与任务目标被永久污染注入 '-- ' 前缀；
其次：D2 终端直启使用 probe entrypoint，在 ZCode（.cjs 脚本）下无法直接执行报错；
D6 擅自向主仓 .trivium/config.yaml 注入扩展校验命令，违背需求隔离约定并拖慢所有非扩展任务；
D4 状态过滤包含历史终态锁，会导致监视器误触发与幽灵状态。
总体架构方向良好，修改上述缺陷后即可直接进入实施阶段。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：阻断 2 ｜ 重要 2 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D1 第 ④ 步` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D1 命令组装在命令旗标与正文之间插入了 '--' 分隔符（组装形如「<prefix><命令> [旗标] -- <正文>」），与各载体入口 skill 契约冲突，会导致任务目标和提示词正文被注入多余的 '-- ' 前缀。

**依据**：查阅 plan §三 D1 步骤 ④ 规定「组装 <prefix><命令> [旗标] -- <正文>」；核对 skills/dual-run/SKILL.md、skills/dual-critic/entry/codex/dual-run/SKILL.md、skills/dual-critic/entry/glm/dual-run/SKILL.md 与 skills/dual-critic/entry/gemini/dual-run/SKILL.md，所有入口命令契约的参数形态均为「<任务目标> [旗标]」或「<审查焦点> [旗标]」，未定义 '--' 分隔符。核对 src/trivium/topic-args.ts:121-131 的 splitArguments 逻辑，当传入裸 '--' 时并不作为旗标识别，而会被推入 restParts；导致 TV topic resolve 解析出的 task_goal / prompt_hint 永久带有 '-- ' 前缀，污染后续各阶段 BRIEF。

**建议**：去掉组装逻辑中的 '--' 分隔符。对于包含空格或特殊字符的正文，由 util/shellQuote.ts 整体单引号转义后直接追加在命令与旗标之后（形如 <prefix><命令> [旗标] '<正文>' 或 <prefix><命令> '<正文>' [旗标]），与 skill 契约保持一致。

### AGY-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D2 第 ① 步` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D2 终端直启直接将 probe.cli[cliKey].entrypoint 传给 vscode.window.createTerminal 的 shellPath，在 ZCode 等非原生可执行二进制的载体上会直接拉起失败。

**依据**：查阅 plan §三 D2 步骤 ① 指定「vscode.window.createTerminal({ name, shellPath: probe.cli[cliKey].entrypoint, cwd: workspaceRoot })」；查阅 src/trivium/probes/zcode.ts:68-81，ZCode 的 entrypoint 为 Node 脚本（如 /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs），无独立 shell 可执行权限，作为 shellPath 传入 VS Code 终端将抛出 ENOEXEC/EACCES 错误；在 Windows 上，各家 CLI entrypoint 亦可能为 .cmd / .ps1 包装脚本。

**建议**：不宜将 entrypoint 直接作为 shellPath。对于有环境依赖或解释型脚本的 CLI，应以系统缺省 Shell 拉起终端后，在终端初始化时通过命令行（如 node <entrypoint> 或包装脚本路径）激活交互会话；或在 carriers.ts 声明各载体在终端中的正规启动方式。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D6 及 §五 交付物列表` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：D6 计划向主仓根目录 .trivium/config.yaml 的 verify.test 追加 extension 测试命令，违背了需求文档中插件独立隔离、不并入主仓闸门的架构约束，且严重拖慢非插件任务的验证速度。

**依据**：查阅 plan §三 D6 提议「向根 .trivium/config.yaml 追加 verify.test: npm install --prefix extension && npm run check --prefix extension」；比对需求基线 doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md §6.0（「不并入主仓 npm run check」）与 §9（「工程位置：extension/ 独立包，不并入主仓闸门」），主仓与扩展明确解耦；且 extension check 包含 @vscode/test-electron 集成测试，放入主仓 config.yaml 会导致所有日常 verify 耗时剧增且依赖 GUI/网络环境。

**建议**：撤销修改工作区根 .trivium/config.yaml 的计划。保持 extension/ 作为完全独立的 npm package，扩展的编译与测试仅在其自身 npm 脚本及未来独立的 CI 流程中执行，主仓 verify 保持原状。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D4 第 ① 步` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | high |

**问题**：D4 监视器状态变更时以「state ≠ idle」作为活跃 run 发现条件，会错误匹配历史残留的 approved、rejected、abandoned 等终态锁。

**依据**：查阅 plan §三 D4 步骤 ①：「stateWatch 变更时取 gates 中 state ≠ idle 的条目（含 running / review_done_awaiting_disposition / awaiting_approval），提取 {topic, stage, run_id}」；查阅 src/trivium/state.ts 与计划自身§一.4事实基线，gates 中条目不会在审批完成后被自动删除，存在大量 approved、rejected、abandoned 残留。state !== 'idle' 会将这些历史终态条目全部判为活跃 run 并触发无谓的 run 目录扫描与监视。

**建议**：收紧活跃运行的判定条件，明确使用白名单判断：仅当 gate.state 属于 running、review_done_awaiting_disposition、awaiting_approval 等非终态状态时才提取并触发 runDiscovery 与状态监控。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §二 架构设计及 §三 D4` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：实施计划缺少 statusWatch 和 logTail 文件监视器在运行结束或主题切换时的资源释放（dispose）生命周期设计，可能在长时间会话中造成文件句柄泄漏。

**依据**：查阅 plan §二 模块划分与 §三 D4，statusWatch 与 logTail 负责监听运行目录下的 status.json 与 worker.log；但计划未明确在监视到终态（success/failed/cancelled）、用户显式取消、或驾驶舱切换监控主题时，如何清理和注销已注册的 fs.FSWatcher 或 VS Code FileSystemWatcher。

**建议**：在 monitor 模块中为 statusWatch 和 logTail 补充完整的 Disposable 契约。当收到终态通知或切换监控目标时，显式调用 dispose 释放文件监视器并清理节流定时器。

## 认为正确的部分

- 架构分层清晰，extension/ 目录保持独立 npm 包设计，不污染主仓构建产物
- 严谨遵循纯前端/只读原则，所有 CLI 交互一律走 wrapper（.trivium/bin/trivium），不硬编码 PATH 与全局 CLI 调用
- D1 从渲染产物推导调用前缀（$ vs /）与旗标语法的思路，避免了在扩展中二次硬编码 Agent 语法的重复事实
- 测试分层设计完备，包含单元测试（node:test）、Webview 协议消息单测与基于 @vscode/test-electron 的真实宿主集成测试
- 健康检查面板基于探针结果驱动，并在未探测或缺少 Agent 时给出清晰的语义引导与置灰处理

## 未覆盖范围（本侧盲区）

- Webview 驾驶舱在 Windows 平台上的路径兼容性与换行符渲染表现
- VS Code 插件各主题颜色变量在深浅色高对比度主题下的视觉可访问性
- Phase 2 及后续规划中裁决台（FR-8）与行内批注（FR-6）的详细交互原型

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-glm.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/08_project/README.md`
- `CLAUDE.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `skills/dual-run/SKILL.md`
- `skills/dual-review-plan/SKILL.md`
- `skills/dual-critic/entry/codex/dual-run/SKILL.md`
- `skills/dual-critic/entry/glm/dual-run/SKILL.md`
- `skills/dual-critic/entry/gemini/dual-run/SKILL.md`
- `src/trivium/cli.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/run-files.ts`
- `src/trivium/state.ts`
- `src/trivium/probes/env.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/critics.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/parse.ts`
- `src/trivium/types.ts`
- `test/unit/parse.test.ts`
- `test/unit/topic-args.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":58,"grep":0,"glob":0,"run_command":0,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
