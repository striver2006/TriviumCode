---
schema: trivium.review.v2
topic: VSCode插件Phase0-1
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
run_id: 20261105T182415Z
rerun_index: 1
snapshot_hash: sha256:ab15cd76be13a8a8f98de479eb8024835c769be25ea4a713d0f631357701659a
blind: true
started_at: 2026-11-05T18:24:23.837Z
finished_at: 2026-11-05T18:34:41.159Z
duration_s: 559
tool_calls:
  read: 70
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 60
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 2
  minor: 2
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
session_id: 2911d2c1-cff6-48c7-93a6-86f9b241c3bb
---

# 代码审查：VSCode插件Phase0-1

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261105T182415Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最需优先处理的问题是编译产物污染仓库与 Cockpit 面板生命周期及事件监听器泄漏：
1. extension/out-test/ 下 ~80 个测试编译产物未被 .gitignore 忽略，直接漏入提交（AGY-01）。
2. extension.ts 每次打开 Cockpit 均重复 new 实例且未单例化，Panel 关闭时未注销 StateWatch 与 TerminalRelay 监听器造成内存泄漏（AGY-02）。
3. TerminalRelay 终端复用未检查 exitStatus，进程已退出的终端会被误复用（AGY-03）。
4. 计划中约定的 state/status 契约主版本不兼容降级与 worstVerdict 逻辑未在 Cockpit 中实际生效（AGY-04）。
整套实现架构清晰、纯函数与 VS Code 隔离彻底、测试覆盖充分，修复上述四项后可通过。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 4 条：重要 2 ｜ 次要 2）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.gitignore:163` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：.gitignore 缺少 extension/out-test/ 忽略规则，导致约 80 个测试编译产物（.js 和 .js.map）被直接提交入仓，污染 diff 且违背计划书约定。

**依据**：查看 .gitignore:163 仅添加了 extension/.vscode-test/ 与 extension/*.vsix；而在 diff 文件中以及 extension/tsconfig.test.json:5 中定义 outDir 为 ./out-test，导致 extension/out-test/src/ 与 extension/out-test/test/ 下约 80 个编译文件被 git 追踪并提交，违背 doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md §七中的不入库产物约定。

**建议**：在根目录 .gitignore 中追加 extension/out-test/ 规则，并从 git 索引中移除 extension/out-test/（git rm -r --cached extension/out-test）。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/extension.ts:26-30` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：Cockpit 面板未做单例管理，每次执行 trivium.openCockpit 均新建实例与面板；且面板销毁时未注销 StateWatch 和 TerminalRelay 监听器，造成对象常驻与监听器泄漏。

**依据**：extension/src/extension.ts:26-30 中 registerCommand('trivium.openCockpit') 直接 new Cockpit(services)，若用户多次触发会打开多个重复面板并重复注册监听；在 extension/src/ui/cockpit.ts:70-80 中，Cockpit 构造时向 services.stateWatch.onChange 和 services.relay.onSessionClosed 添加回调，但 StateWatch 与 TerminalRelay 没有提供注销机制，在 cockpit.dispose() 中仅清理了 cockpit 自身的 reviewWatch，导致已关闭面板的 Cockpit 实例仍被全局 services 引用且持续接收广播。

**建议**：在 extension.ts 中维护 Cockpit 单例引用，已存在面板时执行 reveal()；同时在 StateWatch.onChange 与 TerminalRelay.onSessionClosed 中返回 vscode.Disposable 或注销函数并在 Cockpit.dispose 中调用。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/terminalRelay.ts:76-81` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：TerminalRelay 终端复用缺少终端存活判定，已退出的终端会被误复用导致后续注词失败。

**依据**：doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md §1(9) 与 §3(D2′) 明确要求『复用须键相同且终端存活』。在 extension/src/launch/terminalRelay.ts:76-81 的 ensureSession 实现中，仅通过 this.sessions.get(key) 检查 Map，若终端进程已退出/崩溃（existing.terminal.exitStatus !== undefined），该 session 仍然被直接返回并复用，后续向该终端 sendText 会失败。

**建议**：在 ensureSession 命中已有 session 时，检查 existing.terminal.exitStatus 是否为 undefined；若已退出，则从 this.sessions 移除该记录并新建活动终端。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:114-121` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：未接入 state.json 与 status.json 的 Schema 不兼容降级判定，versionCheck 中的 worstVerdict 成为死代码。

**依据**：doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md §3(D10′) 约定『主版本不兼容时降级只读监控并告警』。extension/src/env/versionCheck.ts 实现了 checkSchemaCompat 与 worstVerdict 并编写了单测，但在 extension/src/ui/cockpit.ts:114-121 中仅一次性检查了 config 的 schemaCompat，stateModel 与 statusModel 生成的 snap.schemaReason 被忽略，未在 Cockpit 中汇总 worstVerdict 并触发只读降级与告警提示。

**建议**：在 Cockpit 的状态刷新流程中，提取 state 与 status 的 Schema 校验结论，结合 config 结论调用 worstVerdict，若命中 unsupported-major 则在 Webview 顶部展示告警横幅并限制操作按钮。

## 认为正确的部分

- 纯函数模型设计清晰：stateModel、statusModel、injectText 与 versionCheck 彻底剥离 VS Code 运行时依赖，单元测试覆盖完备且执行高效。
- 严格遵守 D1′ 注入约束：injectText 完全摒弃外层引号与 -- 注入，支持单行压平与换行告警，有效规避载体交互式命令行解析漏洞。
- 启动方式精细适配：区分 direct（二进制 PATH）与 shellCommand（node + cjs 脚本），妥善解决 ZCode 等 CJS 启动器的同时避免提取登录 Shell 环境。
- 严密防范载体漂移：carriers.test.ts 自动化校验 registry 与 carriers/*.yaml 的一致性，保证插件配置与编排器核心不产生漂移。
- Webview 安全与架构规范：严格使用 CSP（vscode-webview-resource + nonce）隔离，采用纯 postMessage 单向通信保证界面异步响应。

## 未覆盖范围（本侧盲区）

- macOS 真实交互式 TUI 终端下的注词实际交互表现（审查环境无实时进程交互权限）。
- Windows 原生系统兼容性（依计划 CODEX-04 约定在后续阶段推进）。
- Webview 在 VS Code 多种不同颜色主题（High Contrast 等）下的视觉渲染一致性。

## 实际查阅的项目文件

- `.gitignore`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md`
- `CLAUDE.md`
- `README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/README.md`
- `extension/.vscodeignore`
- `extension/esbuild.mjs`
- `extension/package.json`
- `extension/src/cli/commands.ts`
- `extension/src/cli/exitCodes.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/env/config.ts`
- `extension/src/env/health.ts`
- `extension/src/env/versionCheck.ts`
- `extension/src/extension.ts`
- `extension/src/launch/carriers.ts`
- `extension/src/launch/entryCommand.ts`
- `extension/src/launch/prechain.ts`
- `extension/src/launch/terminalRelay.ts`
- `extension/src/monitor/reviewWatch.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/monitor/statusModel.ts`
- `extension/src/monitor/statusWatch.ts`
- `extension/src/services.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/ui/healthTree.ts`
- `extension/src/util/injectText.ts`
- `extension/src/util/yamlLoad.ts`
- `extension/test/unit/carriers.test.ts`
- `extension/test/unit/injectText.test.ts`
- `extension/test/unit/versionCheck.test.ts`
- `extension/tsconfig.json`
- `extension/tsconfig.test.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":70,"grep":0,"glob":0,"run_command":0,"project_reads":60}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
