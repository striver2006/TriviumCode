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
run_id: 20261105T185028Z
rerun_index: 2
snapshot_hash: sha256:71a79a61ba114c485216006a27fb9813c6650761e379429199e7f729b0a4acff
blind: true
started_at: 2026-11-05T18:50:37.627Z
finished_at: 2026-11-05T19:03:17.370Z
duration_s: 237
tool_calls:
  run_command: 27
  project_reads: 36
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 5
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
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
session_id: 01a1ad0c-77ae-7722-add7-04393ac0c8fe
---

# 代码审查：VSCode插件Phase0-1

> Critic-C · OpenAI Codex ｜ 回读模型 `gpt-6.1-sol` ｜ 请求模型 `gpt-6.1-sol`
> ｜ 运行 `20261105T185028Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

补丁哈希一致，61 个新增文件与工作树内容一致，类型检查通过。只读内存桩复现了驾驶舱无法重开、跨仓误定位、终态更新丢失、定时器泄漏及关闭后继续点火五个问题，需修复后重新审查。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：重要 5）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:116` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：关闭驾驶舱会永久销毁唯一 Cockpit 实例；再次执行打开命令直接返回，必须重载扩展才能恢复。

**依据**：extension/src/extension.ts:24 创建单例，第 29 行注册的命令始终调用该实例。cockpit.ts 的面板关闭回调调用 dispose，将 disposed 永久置为 true，而 open 首先检查该标志。本轮实际执行 node -e 内存复现脚本，以当前 TypeScript 源码和 vscode 桩运行 open→关闭回调→open，结果 panelsCreated=1、disposed=true。

**建议**：明确区分面板关闭与扩展销毁；关闭后允许重新建立面板及订阅，或由命令管理器重新创建已销毁的实例。增加关闭后再次打开的测试。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/runDiscovery.ts:70` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：运行归属修复仍会串仓：没有桶前缀匹配时保留所有候选，只有一个候选便直接返回，连期望主题也不检查。本仓目录尚未创建时，可能接管另一仓库同秒启动的运行。

**依据**：runDiscovery.ts:72 仅在 hinted 非空时过滤，第 74 行在主题校验前返回单一候选。cockpit.ts:410 起传入的是目录 basename 与主题，未传仓库身份。核心 src/trivium/review.ts:568 按完整路径哈希区分仓库，run-protocol.ts:80 按该身份定位。本轮实际执行 node -e，以内存文件系统仅提供 OtherRepo-12345678/R1，并请求 repoHint=MyRepo、expectTopic=MyTopic，仍返回 /virtual/runs/OtherRepo-12345678/R1。

**建议**：使用能够证明当前仓库归属的定位方式；前缀不匹配或归属不足时继续等待，不得退回跨仓候选。覆盖本仓目录晚于其他仓库出现，以及同名仓库的场景。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/statusWatch.ts:176` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：终态复核期间收到的文件事件会被丢弃。若复核返回仍在运行，而真正的最终快照已在复核期间落盘，恢复监控后不会重读，卡片可能永久停在 running。

**依据**：statusWatch.ts:112 在 crossChecked 为 true 时直接跳过 refresh；第 176～184 行恢复后只改内存状态，没有重读或回放遗漏事件。reassess 只计算心跳，不读取文件。本轮实际执行 node -e 内存复现：failed 快照启动延迟复核，期间将文件改为 success 并触发 watcher，等待去抖回调后让复核返回 running；结果 file=success、current=running、renders=[failed,running]。

**建议**：复核期间记录待刷新事件，并在恢复时立即读取最新快照；协调复核和刷新，避免丢失终态。增加复核未完成期间落盘最终状态且此后无写入的测试。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/statusWatch.ts:76` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：目录挂载失败时，每次重试都会再创建一个 interval，并覆盖唯一句柄。目录持续不存在时重试数量不断增长；dispose 也无法清除已丢失句柄的定时器。

**依据**：statusWatch.ts 的 interval 回调再次调用 mountWatcher，catch 分支无条件创建新 interval；stopMount 只能清除最后保存的句柄。该模块明确支持目录未建的窗口，目录定位与挂载之间也存在删除窗口。本轮实际执行 node -e，以 fs.watch 抛出 ENOENT、定时器用内存桩计数：三次挂载尝试后共有四个 interval，dispose 后仍剩两个。extension/test/integration/disposable.test.ts 未覆盖挂载失败路径。

**建议**：保持至多一个挂载重试任务，成功挂载时立即停止它；确保销毁后没有遗留任务继续运行。补连续失败、随后成功和失败期间销毁三种生命周期测试。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:288` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：点火链在 await 后没有检查生命周期。用户在认领等待期间关闭面板后，链路仍会创建终端并注入任务，已销毁的驾驶舱也会被切回 M1。

**依据**：cockpit.ts:288 等待 claimAfterConfirm，随后经 loadProbe、ensureSession 和 injectText 继续执行，没有 disposed 检查；dispose 也没有取消该链路。terminalRelay.ts 的延迟注入同样没有取消机制。本轮实际执行 node -e 内存复现：冻结合法表单，延迟 topicClaim，调用 dispose 后完成认领，结果 disposed=true、terminalsLaunched=1、messagesInjected=1、mode=M1。

**建议**：为点火及延迟注入建立可取消的操作生命周期，在关闭后阻止尚未发生的终端创建与发送。保留已经运行的 Driver 会话时，也应取消未完成的启动动作。增加认领等待和注入延迟期间关闭的测试。

## 认为正确的部分

- stdout/stderr 改为收集 Buffer 后统一解码，修复了跨块中文字符损坏。
- 初始状态回放及可释放订阅接口已实现，改善了晚订阅和退订行为。
- 终态复核已读取嵌套 status，且复核仍在运行时不再立即销毁监控。
- 独立包及本批仅承诺 macOS 的范围清楚；本轮 node extension/node_modules/typescript/bin/tsc -p extension/tsconfig.json --noEmit 通过。

## 未覆盖范围（本侧盲区）

- 未执行会写入夹具或产物的完整 check、Extension Host 集成测试、e2e、真机 CLI 注入或 VSIX 安装；问题复现使用当前源码的内存转译与依赖桩。
- 未验证 Windows、Linux、远程工作区及四家真实 CLI 的交互兼容性。
- 未逐项审计依赖锁文件、全部测试断言和生成产物；61 个新增文件仅完成补丁与工作树内容一致性比较。
- 本轮重点覆盖运行定位、异步监控及面板和点火生命周期，未穷尽所有表单参数与 UI 安全分支。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T185028Z.diff`
- `.reviews/VSCode插件Phase0-1/code/2026-11-06-VSCode插件Phase0-1-codex.md`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.gitignore`
- `extension/README.md`
- `extension/package.json`
- `extension/esbuild.mjs`
- `extension/.vscodeignore`
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
- `extension/scripts/runE2E.mjs`
- `extension/scripts/runIntegration.mjs`
- `extension/scripts/runReal.mjs`
- `extension/test/integration/activate.test.ts`
- `extension/test/integration/disposable.test.ts`
- `extension/test/integration/monitor.test.ts`
- `extension/test/unit/runDiscovery.test.ts`
- `extension/test/unit/triviumCli.test.ts`
- `extension/test/e2e/fullflow.test.ts`
- `extension/test/e2e/suite.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/real/suite.ts`
- `src/trivium/cli.ts`
- `src/trivium/meta.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/run-files.ts`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":27,"project_reads":36}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
