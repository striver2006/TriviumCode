---
schema: trivium.review.v2
topic: VSCode插件Phase0-1
stage: code
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
run_id: 20261105T182415Z
rerun_index: 1
snapshot_hash: sha256:ab15cd76be13a8a8f98de479eb8024835c769be25ea4a713d0f631357701659a
blind: true
started_at: 2026-11-05T18:24:23.837Z
finished_at: 2026-11-05T18:34:41.159Z
duration_s: 318
tool_calls:
  run_command: 37
  project_reads: 84
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 6
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
session_id: 01a1acf4-746d-7242-a937-5af686ed0b4a
---

# 代码审查：VSCode插件Phase0-1

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261105T182415Z`
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

补丁哈希核对一致。发现干净检出无法构建的交付阻断，以及跨仓运行混淆、初始监控遗漏、终态复核失效和资源泄漏等问题，需要修改后重新审查。已执行的 34 项纯单测全部通过。

**结论**：不通过（`reject`）

## 审查意见（共 8 条：阻断 1 ｜ 重要 6 ｜ 次要 1）

### CODEX-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/services.ts:8` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：插件必需的 env/config.ts、env/health.ts、env/versionCheck.ts 未进入补丁，也未被 Git 跟踪。它们仅存在于当前机器，干净检出后类型检查和打包都会因模块缺失失败。

**依据**：services.ts、ui/cockpit.ts、monitor/stateModel.ts 等直接导入这三个模块。本轮执行 git -c core.quotePath=false check-ignore -v extension/src/env/config.ts extension/src/env/health.ts extension/src/env/versionCheck.ts extension/out-test/src/env/config.js，均命中 .gitignore:102 的 ENV/；git ls-files 对该源码目录返回空。另执行 node -e 调用 esbuild.build({write:false})，限制源码只能来自送审补丁，明确报出三个 source omitted from reviewed patch 错误。

**建议**：修正目录命名或精确放开忽略规则，将三个源码模块纳入交付；从不含本机忽略文件的干净检出验证类型检查和打包。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/runDiscovery.ts:23` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：运行定位遍历所有仓库桶，仅凭 run_id 返回第一个命中。不同仓库可以合法产生同一秒的 run_id，插件因此可能显示另一仓库的状态和日志，而中止操作仍作用于当前仓库。

**依据**：src/trivium/meta.ts:42 的 newRunId 使用秒级时间戳；review.ts:994 只在当前 repoId 桶内排他占用，run-protocol.ts:80 的权威路径同时包含 projectRoot 和 runId。插件 locateRunDir 未接收或验证仓库身份。本轮执行 node -e 的虚拟文件系统复现：两个桶均含 20261106T000000Z，为 BRepo 查找时返回 ARepo-hash 下的目录。

**建议**：将运行目录定位绑定当前仓库身份；若保留扫描方式，必须验证候选目录的仓库归属，不能取跨桶首个同名目录。补两个仓库共享运行根且 run_id 相同的用例。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/stateWatch.ts:48` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：StateWatch 的初始扫描结果不会回放给晚订阅者。先打开环境健康视图、稍后打开驾驶舱时，已有运行会一直缺席，直到 state.json 再次变化；worker 的状态和心跳更新不一定修改该文件。

**依据**：services.ts:34 在插件激活时创建 StateWatch；stateWatch.ts:30 立即扫描，onChange 只加入监听集合。Cockpit 到构造时才订阅，open/sendInit 没有重扫或读取缓存。本轮执行 node -e 内存桩：等待初始扫描完成后订阅，结果 initialScanReads=1、lateSubscriberCallbacks=0。现有 monitor.test.ts 则在创建 watcher 后立即订阅，未覆盖该时序。

**建议**：订阅时回放最近有效快照，或在驾驶舱订阅完成后显式重扫。增加先激活健康视图、后打开驾驶舱的已有运行发现测试。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/statusWatch.ts:140` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：终态复核只生成说明文字，没有采用 CLI 返回的状态，却立即停止监控。文件快照为 failed、CLI 已回读 running 时，卡片仍为 failed 且不会继续更新，与“以复核为准”的承诺相反。

**依据**：crossCheck 最终调用 onFinal(render, note)，传入的仍是原始 render，然后 dispose。本轮执行 node -e 内存桩，输入 failed/old.md 快照、让 statusProbe 返回 running/fresh.md，得到 phase=failed、terminal=true、artifacts=[old.md]，且 monitor already disposed=true。另核实 src/trivium/cli.ts:584 将完整状态放在 status 字段中，插件 commands.ts 的 ReviewStatusOutput 却把 artifacts/sides 声明在根上。

**建议**：按真实 CLI JSON 形状读取并采用权威快照；复核仍在运行时恢复监控，只在确认终态后释放资源。覆盖状态不一致及复核失败场景。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:70` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：关闭驾驶舱后没有解除共享服务上的状态和终端监听。之后的状态变化仍会调用已关闭面板所属对象的 syncRuns，重新创建 watcher 和定时器；反复打开关闭会持续积累对象和后台监控。

**依据**：Cockpit 构造函数注册两个闭包；StateWatch.onChange 和 TerminalRelay.onSessionClosed 都只向 Set 添加回调，不提供解除订阅接口。Cockpit 的面板关闭回调及 dispose 只清理当前 runs。extension.ts 每次打开又创建新的 Cockpit。本轮执行 node -e 内存桩，在 c.dispose() 后触发保存的状态回调，syncRuns 仍被调用一次。

**建议**：让服务订阅返回 Disposable，并在面板关闭时解除订阅；同时防止关闭前已开始的异步发现操作在关闭后重新安装资源。增加关闭后再触发状态变化的生命周期测试。

### CODEX-06 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:342` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：同一 run 的并发发现没有占位或串行化。两个 state 事件都能在第一次 await 前通过 runs.has 检查，各自创建监控，随后 Map 覆盖其中一套；被覆盖的 watcher 和心跳定时器失去清理入口。

**依据**：构造函数以 void this.syncRuns(...) 分发事件；syncRuns 在 loadConfig 和 locateRunDirWithRetry 两个 await 之后才于第 396 行登记 Map。本轮执行 node -e 内存桩中的 Promise.all([c.syncRuns(active),c.syncRuns(active)])，随后 dispose，结果 watchersCreated=2、watchersDisposed=1。

**建议**：在异步发现开始前按 run_id 登记进行中的任务，或串行协调快照；安装资源前再次检查归属和生命周期。测试重复事件及发现等待期间的关闭、结束时序。

### CODEX-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:71` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：计划要求的版本不兼容降级没有贯通：state/status 解析器产生的 schemaReason 被调用方丢弃，未知主版本不会禁用点火，status 不兼容时甚至只会静默没有进度。

**依据**：已批准计划 D10′ 要求逐文件检查 config/state/status。Cockpit 状态回调只读取 snap.active；RunWatch.refresh 只解构 parseStatus 的 render。只有 sendInit 对非空 cfg.schema 设置 degradedBanner。本轮执行 node -e 内存桩，向驾驶舱状态回调传入 trivium.state.v2 的 schemaReason，degradedBanner 仍为 false。

**建议**：将三类文件的兼容性结果统一传递到驾驶舱能力状态，展示原因并在宿主侧阻止点火；增加 state/status 新主版本的端到端降级用例。

### CODEX-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/cli/triviumCli.ts:55` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：stdout/stderr 对每个 Buffer 独立执行 UTF-8 解码，跨 data 块的中文字符会被替换字符损坏。JSON 仍可能解析成功，使返回的中文主题名被悄悄改变并继续用于认领。

**依据**：TriviumCli.run 的两个 data 回调均直接调用 d.toString('utf8')。本轮执行 node -e，以内存子进程桩把包含 topic=中文主题 的 JSON 在“中”的第一个字节后分块，runJson 返回的 topic 为“���文主题”。commands.ts 和 prechain.ts 会继续消费该 topic。

**建议**：为两个输出流使用流式 UTF-8 解码，或收集 Buffer 后整体解码；补中文字符跨块边界的测试。

## 认为正确的部分

- 复用绝对路径 wrapper、以参数数组和 shell:false 调用核心 CLI，符合 GUI 环境边界。
- 插件独立包及本批仅承诺 macOS 的范围说明清楚。
- 心跳采用独立周期重估，日志文件句柄通过 finally 关闭；已执行的 34 项纯单测通过。

## 未覆盖范围（本侧盲区）

- 未运行会创建或修改夹具的完整 check、VS Code Extension Host 集成测试、e2e、真机 CLI 注入和 VSIX 安装验证。
- 未验证 Windows、Linux、远程工作区，以及四家真实 CLI 的当前交互兼容性。
- 未逐项审计依赖锁文件及全部生成的 JavaScript/source map；纯单测使用现场已有 out-test 产物，问题复现使用当前 TypeScript 源码内存转译。
- 三个被忽略的 env 源码仅作为现场上下文读取，不能视为已由本补丁交付。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T182415Z.diff`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `.gitignore`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/04_development/GUIDE_env_setup.md`
- `doc/08_project/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `extension/package.json`
- `extension/esbuild.mjs`
- `extension/.vscodeignore`
- `extension/README.md`
- `extension/tsconfig.json`
- `extension/src/extension.ts`
- `extension/src/services.ts`
- `extension/src/cli/commands.ts`
- `extension/src/cli/exitCodes.ts`
- `extension/src/cli/triviumCli.ts`
- `extension/src/env/config.ts`
- `extension/src/env/health.ts`
- `extension/src/env/versionCheck.ts`
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
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/ui/healthTree.ts`
- `extension/src/util/injectText.ts`
- `extension/src/util/yamlLoad.ts`
- `extension/scripts/runIntegration.mjs`
- `extension/scripts/runE2E.mjs`
- `extension/scripts/runReal.mjs`
- `extension/test/integration/disposable.test.ts`
- `extension/test/integration/monitor.test.ts`
- `extension/test/integration/prechain.test.ts`
- `extension/test/integration/terminalRelay.test.ts`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/e2e/fullflow.test.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/unit/carriers.test.ts`
- `extension/test/unit/health.test.ts`
- `extension/test/unit/runDiscovery.test.ts`
- `extension/test/unit/statusModel.test.ts`
- `src/trivium/cli.ts`
- `src/trivium/config.ts`
- `src/trivium/meta.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/state.ts`
- `src/trivium/status.ts`
- `src/trivium/probes/env.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":37,"project_reads":84}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
