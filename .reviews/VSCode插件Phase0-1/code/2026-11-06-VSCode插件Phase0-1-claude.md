---
schema: trivium.review.v2
topic: VSCode插件Phase0-1
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
run_id: 20261105T182415Z
rerun_index: 1
snapshot_hash: sha256:ab15cd76be13a8a8f98de479eb8024835c769be25ea4a713d0f631357701659a
blind: true
started_at: 2026-11-05T18:24:23.837Z
finished_at: 2026-11-05T18:34:41.159Z
duration_s: 617
tool_calls:
  read: 83
  grep: 24
  glob: 3
  run_command: 0
  project_reads: 80
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 7
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
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
    status: unknown
    left_model: null
    right_model: k3.1-pro
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
  - left: claude
    right: codex
    status: different-family
    left_model: k3.1-pro
    right_model: gpt-6.1-sol
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / gpt
override_reason: 左侧模型信息缺失
session_id: e9f25665-29e7-4787-9776-b50558e4ebc3
---

# 代码审查：VSCode插件Phase0-1

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261105T182415Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

阻断：通用 `.gitignore` 的 `env/` 规则把 `extension/src/env/` 三个必需模块及对应 out-test 排除在补丁外，干净应用无法编译。
另发现 ZCode 解释器回退失效、预检丢失高级旗标、运行发现重试后无持续 watcher、终态复核不采用 CLI 结果等主路径问题。
点火确认可被后续编辑绕过，失败回落提示未接 UI，面板监听也未随 dispose 解绑。
必须修复后重新评审。

**结论**：不通过（`reject`）

## 审查意见（共 8 条：阻断 1 ｜ 重要 7）

### CLAUDE-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.gitignore:99；extension/src/env/` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：必需的 `extension/src/env/config.ts`、`health.ts`、`versionCheck.ts` 被既有 `env/` 规则忽略，未进入本次补丁；对应 `out-test/src/env/` 也同样缺失。干净应用该补丁后，`services.ts`、`stateModel.ts` 等处的这些 import 无文件可解析，扩展无法编译或启动。

**依据**：读了 `.gitignore:93-105`，其中无目录限定的 `env/` 会匹配任意层级的 env 目录；读补丁 `.reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T182415Z.diff:106-125` 的 src 文件清单，确实没有任何 `src/env/` 项；同时 `extension/src/services.ts:7`、`extension/src/monitor/stateModel.ts:6` 均引用这些缺失模块。

**建议**：为 `extension/src/env/` 及其源文件加精确反忽略规则，确保三份 TS 源进入变更；out-test 则应统一决定是全部忽略生成物还是全部纳入，不要再让 env 子树成为特殊漏项。补一次从干净检出安装依赖并 typecheck 的验证。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:262-273；extension/src/launch/terminalRelay.ts:181-184` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：ZCode 的 wrapper node 兜底在真实探针数据下不会触发：代码把 `version_probe.runner` 直接当解释器路径，真实值却是字符串 `node`，因此最终执行 `"node" "<zcode.cjs>"`，重新依赖 PATH，而不是计划承诺的绝对 node 路径。GUI 终端没有相应 PATH 时 ZCode 无法拉起。

**依据**：读 `src/trivium/probes/zcode.ts:1332-1342`，注释明确 `runner: 'node'` 只表示需要 node，具体解释器应取 runtime/wrapper；`extension/src/ui/cockpit.ts:265-270` 仅在 runner 为空时解析 wrapper；`extension/src/launch/terminalRelay.ts:181-183` 原样使用该值。r2 计划 D2′ 也要求解释器为绝对路径。

**建议**：只把绝对路径形式的 runner 当作可执行解释器；`node` 这种能力标识应继续走 wrapper 内嵌路径或配置中的 runtime.node 解析，找不到时明确报错，不要静默回落 PATH。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/prechain.ts:62-67；extension/src/cli/commands.ts:104-115` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：前置链的 preflight 丢失表单高级旗标。`--profile`、模型/tier/effort 等 extra 只传给 resolve，preflight 仅收到 stage/driver/critics，因此它校验的不是本轮实际运行配置，可能出现插件显示预检通过、终端会话按同一表单再次预检却失败。

**依据**：读 `extension/src/ui/cockpit.ts:506-513`，profile 与其他旗标进入 extra；`extension/src/launch/prechain.ts:49-67` 证明 extra 只用于 resolve；核心 `src/trivium/cli.ts:954-1000` 明确 preflight 会应用 `--profile` 并收集 model/tier 旗标，且注释要求校验本次实际档位；`skills-src/commands/run.contract.md:67-75` 要求这些旗标与后续运行同一组。

**建议**：让 preflight 封装接收并透传与 resolve 相同的 profile/model/tier/effort/vendor-profile 等运行旗标，max-rounds 等非 preflight 旗标不必传。增加至少一个 profile 与一个模型覆盖经过桩 wrapper 的参数断言。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:338-349` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：run 目录重试耗尽后没有持续发现机制。代码仅提示“将继续重试发现”后 `continue`，既没有监听 run_root 创建事件，也没有定时重试；只有 state.json 再次变化才可能重进 syncRuns。目录若在约 60 秒后才创建，该运行会长期甚至永久不出现在看板。

**依据**：读 `extension/src/ui/cockpit.ts:338-349`，缺失分支只 post banner；`extension/src/monitor/stateWatch.ts:27-30` 只监听 state.json；`extension/src/monitor/runDiscovery.ts:39-53` 的 retry 在返回 null 后即结束。r2 计划 D4′ 明确要求重试失败后仍保持 watcher 盯目录创建。

**建议**：为重试耗尽的 run 登记持续的 run_root/桶目录 watcher 或低频重试任务，目录出现后原子地接入 RunWatch，并在 Cockpit dispose 时统一清理；提示文案在机制补齐前不要承诺会继续发现。

### CLAUDE-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/statusWatch.ts:139-153；extension/src/cli/commands.ts:37-44` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：终态复核声称“以 CLI 为准”，实现却只比较 phase 并把原文件快照原样交给 onFinal；CLI 的 phase 与 artifacts 都没有用于最终渲染。并且 `ReviewStatusOutput.artifacts` 声明在根字段，而真实 `--status` JSON 将其放在 `status` 内，cockpit 的 statusProbe 因而恒取不到 artifacts。

**依据**：读 `extension/src/monitor/statusWatch.ts:145-153`，不一致仅写 note，`onFinal(render, note)` 仍传旧 render；`extension/src/ui/cockpit.ts:359-362` 读取 `r.out.artifacts`；核心 `src/trivium/cli.ts:580-592` 显示输出根上有 phase/status，artifacts 位于 `status` 对象中（同文件 560-570 的 wait 分支也在 status 内）。现有 `extension/test/integration/monitor.test.ts:63-100` 只测同 phase，未覆盖不一致。

**建议**：按真实 `--status` 输出声明并读取嵌套 status，复核后用 CLI 的 phase/artifacts 构造最终 render；probe 返回 null 或失败也要给出复核失败提示。增加“文件终态与 CLI 不一致”及 artifacts 链接的测试。

### CLAUDE-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:398-411；extension/src/ui/cockpitHtml.ts:233-248` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：闸门回落产生的结束提示没有实际 UI 消费。endNote 虽被拼进 RunCard.note，但 Webview 仅在 `r.stale` 为真时显示 note；同时回落分支只 dispose watcher，不把卡片标为终态，卡片会继续显示运行中并提供“中止”按钮。

**依据**：读 `extension/src/ui/cockpit.ts:398-411`，消失分支只设置 endNote 并 dispose；`runCards` 在 433 行拼接 note；`extension/src/ui/cockpitHtml.ts:233-248` 的中止按钮由 terminal 决定，而 note 只在 stale 分支渲染。r2 计划 D4′/验收要求失败回 idle 时给出已结束提示。

**建议**：将 endNote 作为独立、始终可见的卡片状态展示，并在确认回落后停止呈现可操作的中止按钮；若尚未取得 CLI 终态，应明确标为“待终态复核”而不是继续伪装 running。补 Webview 或消息模型测试覆盖该路径。

### CLAUDE-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/extension.ts:26-29；extension/src/ui/cockpit.ts:70-80,456-468` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：Cockpit 对全局 StateWatch/TerminalRelay 的监听没有退订，且每次 openCockpit 都新建实例。关闭面板只清理当前 runs，旧实例仍留在全局 listener Set 中；后续 state 事件可让已关闭实例重新创建 watcher。反复打开还会产生多面板、多份监控和重复注入风险，不符合 Disposable 契约。

**依据**：读 `extension/src/extension.ts:26-29`，命令每次 new Cockpit；`extension/src/monitor/stateWatch.ts:48-50` 与 `extension/src/launch/terminalRelay.ts:66-68` 的注册接口均不返回 Disposable；`extension/src/ui/cockpit.ts:95-98,456-468` 的关闭和 dispose 都没有移除这两个监听。集成测试 `extension/test/integration/disposable.test.ts` 只覆盖 RunWatch，没有覆盖 Cockpit。

**建议**：让 onChange/onSessionClosed 返回可释放句柄并纳入 Cockpit.dispose，面板 onDidDispose 走同一完整清理；openCockpit 复用单例并 reveal 已有面板。增加关闭后 state 事件不再建 watch、重复打开不增加监听数的测试。

### CLAUDE-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpitHtml.ts:199-210,274-295；extension/src/ui/cockpit.ts:233-258` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：主题确认与最终注入的表单没有绑定。用户完成 prechain 后仍可修改正文、topic、Driver 或旗标；点击点火时 Webview 用旧 state.topic，却重新 collect 当前表单，宿主按旧主题 claim、按新表单组装命令。结果可以是认领主题 A、实际注入主题 B，确认环节形同虚设。

**依据**：读 `extension/src/ui/cockpitHtml.ts:199-210`，state.topic 只在 prechain-result 时更新；275 行点火重新 collect，且普通正文/topic 编辑没有使点火失效。`extension/src/ui/cockpit.ts:233-258` 分别使用传入的旧 topic 做 claim、使用新 form 做 assembleEntryCommand，未比较 resolve 快照。

**建议**：在 prechain 成功时冻结已解析表单快照，点火只能使用该快照及其 resolve 返回主题；或任何相关字段变化都禁用点火并强制重新 prechain。至少增加“prechain 后修改 topic/正文不得点火”的测试。

## 认为正确的部分

- CLI 调用统一经 wrapper、参数使用 argv 数组且 `shell:false`，没有引入 shell 拼接注入面，方向与仓库 GUI 调用约束一致。
- 入口 A/B/C/D 映射、正文单行化以及不在聊天注入中添加 `--` 或 shell 引号的实现，与核心 topic-args 契约和入口 skill 的参数语义一致。
- status/state 的纯函数解析、独立心跳重估定时器、ReviewWatch 侧完成正文入口，以及 RunWatch 的清理设计，分层清晰并有对应单测/集成测试。
- 载体调用模板通过注册表与 carriers YAML 对账，避免把 ZCode CLI 的 `/skill` 形态误写成桌面端形态，这种防漂移机制值得保留。
- Webview 对动态文本集中使用 textContent 或 escapeHtml，CSP 限定 nonce 脚本，基础安全边界处理得当。

## 未覆盖范围（本侧盲区）

- 本侧未执行任何命令；typecheck、unit/integration/e2e、`vsce package` 的真实结果均未验证，以上结论全部来自静态阅读与调用链推理。
- 四家真实 TUI 的启动、注入、续话、入口解析保真与配额矩阵未做真机验证。
- v2 总需求文档和 145 文件补丁未逐行通读；重点审读了全部扩展 TS 源、相关测试及核心 CLI/探针/状态契约，source map 未逐文件核对。
- Windows 适配不在本批承诺范围内，本次未评估。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T182415Z.diff`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/README.md`
- `.gitignore`
- `extension/package.json`
- `extension/README.md`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/cli/commands.ts`
- `extension/src/cli/exitCodes.ts`
- `extension/src/env/config.ts`
- `extension/src/env/health.ts`
- `extension/src/env/versionCheck.ts`
- `extension/src/launch/carriers.ts`
- `extension/src/launch/entryCommand.ts`
- `extension/src/launch/prechain.ts`
- `extension/src/launch/terminalRelay.ts`
- `extension/src/monitor/runDiscovery.ts`
- `extension/src/monitor/stateModel.ts`
- `extension/src/monitor/stateWatch.ts`
- `extension/src/monitor/statusModel.ts`
- `extension/src/monitor/statusWatch.ts`
- `extension/src/monitor/reviewWatch.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/ui/healthTree.ts`
- `extension/src/util/injectText.ts`
- `extension/src/util/yamlLoad.ts`
- `extension/test/integration/monitor.test.ts`
- `extension/test/integration/disposable.test.ts`
- `extension/test/integration/prechain.test.ts`
- `extension/test/integration/terminalRelay.test.ts`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/e2e/fullflow.test.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/unit/carriers.test.ts`
- `extension/test/unit/runDiscovery.test.ts`
- `extension/test/unit/statusModel.test.ts`
- `extension/test/unit/stateModel.test.ts`
- `extension/test/unit/versionCheck.test.ts`
- `src/trivium/cli.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/state.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/types.ts`
- `src/trivium/adapters/stub.ts`
- `skills-src/commands/run.contract.md`
- `test/helpers/fixture.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":83,"grep":24,"glob":3,"run_command":0,"project_reads":80}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
