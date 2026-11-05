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
run_id: 20261105T185028Z
rerun_index: 2
snapshot_hash: sha256:71a79a61ba114c485216006a27fb9813c6650761e379429199e7f729b0a4acff
blind: true
started_at: 2026-11-05T18:50:37.627Z
finished_at: 2026-11-05T19:03:17.370Z
duration_s: 759
tool_calls:
  read: 83
  grep: 17
  glob: 0
  run_command: 0
  project_reads: 76
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 4
  minor: 2
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
session_id: f0410f70-42e1-4f2d-9bf6-14bbffa94b47
---

# 代码审查：VSCode插件Phase0-1

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3.1-pro` ｜ 请求模型 `k3.1-pro`
> ｜ 运行 `20261105T185028Z` ｜ 第 2 轮
> ｜ 本轮审核者 claude、gemini、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的是 run 定位在特定跨仓撞号场景会绕过 topic 校验，把其他仓库的运行接入看板并提供中止入口。
驾驶舱单例在首次关闭后被永久 dispose，之后再次执行打开命令无效。
preflight 仍漏传 --driver-model/--driver-provider，和入口契约要求的同组声明不一致。
启动失败且无有效 status.json 时，闸门回落路径既不复核终态也不释放 watcher。
另有两处小问题：未初始化引导永不显示、过期监控提示不会清除。
上一轮的主要问题大多已针对性修复；本轮问题均有局部修法与明确补测点，修改后可通过，无需因架构原因再审。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 6 条：重要 4 ｜ 次要 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/extension.ts:23-29；extension/src/ui/cockpit.ts:104-131` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：Cockpit 被做成全局单例，但面板 onDidDispose 又调用实例的永久 dispose。首次关闭面板后 disposed=true，之后 trivium.openCockpit 仍调用同一实例的 open()，在首行直接返回，用户只能重载窗口/扩展才能再次打开驾驶舱。

**依据**：读了 extension/src/extension.ts:23-29，确认 Cockpit 只构造一次并由命令长期复用；extension/src/ui/cockpit.ts:104-131 确认 open() 对 disposed 直接返回、onDidDispose 调用 dispose() 且该标志没有重置路径。extension/test/integration/activate.test.ts 只检查命令注册，没有打开—关闭—再打开用例。

**建议**：区分「面板关闭时的临时清理」与「扩展停用时的最终 dispose」，让再次 open 能重建面板及所需监听，或改为关闭后由工厂创建新实例。补打开→关闭→再打开的集成测试，同时断言监听数不重复、旧 watcher 不残留。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/monitor/runDiscovery.ts:68-85` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：归属校验在两个 pool.length===1 分支提前返回，完全绕开 expectTopic。若本仓闸门已 running、目录尚未创建，而另一个仓库恰有同秒 run_id 且桶前缀不匹配，pool 仍只有那个他仓候选，第 74 行会立即接管它；即使执行了 topic 比对且 matched=0，第 85 行也会返回这个不匹配的候选。看板因此可能展示他仓运行，并对该 runId 提供中止操作。

**依据**：读了 extension/src/monitor/runDiscovery.ts:63-85 的完整分支；extension/src/ui/cockpit.ts:400-407 确认生产调用同时传 repoHint 与 expectTopic。文件头注释明确承诺「无法唯一确定即不接管，绝不取跨桶首个同名目录」。extension/test/unit/runDiscovery.test.ts:73-119 覆盖了两候选正向判别，但没有「仅一个他仓候选且 topic 不同」的反例。

**建议**：凡提供 expectTopic，候选只有在 topic 匹配或无法判读但归属已由可靠本仓证据确定时才可返回；topic 明确不匹配必须排除，且桶前缀零命中时不得把唯一他仓候选当作本仓兜底。补单候选跨仓撞号及 matched=0 的负向单测。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/prechain.ts:132-157` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：preflightFlagList 的白名单漏掉 --driver-model 与 --driver-provider。用户可在高级额外旗标中输入这两项，resolve 与最终入口注入会携带它们，但插件预检把它们删掉，导致预检与后续实际运行使用的 Driver 声明不同，仍违反「预检校验本轮实际配置」的承诺。

**依据**：读了 extension/src/ui/cockpit.ts:630-636，extraFlags 会原样进入 extra；extension/src/launch/prechain.ts:49-70 与 132-157 证明只有列出的前缀进入 preflight。核心 src/trivium/cli.ts:993-1000 明确把这两项传入 runPreflight；skills-src/partials/review/body.md:63,82-88 要求它们与 review --start 逐项同源透传。extension/test/integration/prechain.test.ts:92-121 只覆盖 profile 和模型覆盖，没有这两项。

**建议**：把两个带值旗标纳入同一透传面，最好按契约在 TopicResolveOutput 声明 driver_model/driver_provider 并从 resolve 结果组 preflight 参数，避免两处各拼一份。补参数断言，验证 resolve、preflight 与最终注入三处一致。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:418-424,524-530,533-546` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：闸门回落的复核与清理以 entry.render 非空为前提。若运行已 attach，但启动失败发生在任何有效 status.json 产生之前，render 为 null：syncRuns 不 dispose，markEnded 也只写提示；RunWatch 又只在读到终态快照时才 crossCheck。卡片会长期显示 unknown（已结束，待终态复核），实际上从未调用 --status，watcher 与心跳定时器也继续残留。

**依据**：读了 extension/src/ui/cockpit.ts:418-424 的回落条件、524-530 的 markEnded 和 533-546 的卡片文案；extension/src/monitor/statusWatch.ts:111-129,151-188 确认复核仅由终态 render 触发。现有 extension/test/integration/monitor.test.ts:44-59 只验证 StateWatch 产生 ended 事件，没有覆盖 Cockpit 在无快照时的收尾。

**建议**：把闸门回落收尾独立成一条路径：无论是否已有 render，都调用一次 reviewStatus；成功则按 CLI 构造终稿，失败则明确标注复核失败，随后统一 dispose RunWatch/ReviewWatch。补「已 attach、零有效快照、闸门回 idle」的集成测试，并断言不再残留定时器。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/package.json:39-43；extension/src/ui/healthTree.ts:26-40,74-80` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：未初始化工作区的 viewsWelcome 实际不会出现。viewsWelcome 在树视图为空时展示，但 HealthProvider 即使未 init 也总返回「未初始化」meta、wrapper 状态及四个 Agent 项，树永远非空，因此部署手册/使用手册链接不会按 FR-1 与验收计划展示。

**依据**：读了 extension/package.json:39-43 的静态 viewsWelcome 配置；extension/src/ui/healthTree.ts:26-40 在未 init 时仍写 meta，74-80 无条件返回 meta 与 agents。r2 计划 .reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md:197-200 把「未 init 仓库显示引导（链接真实存在）」列为 Phase 0 验收项；现有 health.test.ts 只测 inited 布尔与配置读取。

**建议**：未 init 时让树为空以启用 viewsWelcome，或改为显式的未初始化视图/单条带命令链接的引导项，并用上下文控制显示条件。补未 init 的视图层测试，验证两个文档命令链接确实可见且可触发。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/ui/cockpit.ts:495-505` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：RunEntry.note 只在新 note 非空时更新，从不清空。心跳从失联恢复新鲜、或「文件终态但 CLI 仍运行」随后恢复正常后，旧警示仍留在卡片上；stale 虽已变 false，文案却仍声称心跳超时或快照异常，造成过期状态误导。

**依据**：读了 extension/src/ui/cockpit.ts:495-505，确认 onRender 仅在 extra.note 为真时写 entry.note，endNote 是另一字段；extension/src/monitor/statusWatch.ts:123-138 在正常刷新及 stale→fresh 时会发 note:null，正好多出来的清除信号被 Cockpit 忽略。现有监控测试只断言 stale 出现，没有恢复后的卡片 note。

**建议**：每次 onRender 都用 extra.note 全量替换当前瞬态 note，终态/闸门信息继续放独立 endNote。补失联→恢复与抢跑→恢复→终态的消息模型测试，断言旧提示消失。

## 认为正确的部分

- `.gitignore` 已显式反忽略 extension/src/env/，本轮补丁也实际包含 config/health/versionCheck 三份源文件，上一轮干净应用缺文件的问题已消除。
- ZCode 解释器现在只接受绝对 runner，否则解析 wrapper，拿不到即明示失败，不再静默依赖 PATH。
- 前置链成功后的表单与主题被冻结，宿主在点火前再次逐字段比较，确认后编辑不能绕过校验。
- run 发现增加低频重试、StateWatch 晚订阅回放、Cockpit 全局监听退订，方向与生命周期要求一致。
- 终态复核已按真实 --status 的嵌套 status 读取 phase/artifacts，并处理 CLI 仍运行的抢跑分支。
- CLI stdout/stderr 改为 Buffer 汇总后整体 UTF-8 解码，并有逐字节中文输出单测，避免跨块乱码。

## 未覆盖范围（本侧盲区）

- 本侧没有执行任何命令；typecheck、unit/integration/e2e/real、vsce package 的真实结果均未验证，结论全部来自静态阅读与调用链推理。
- 四家真实 TUI 的启动、注入、续话和入口解析保真未做真机验证；真机测试只读其实现，未评价矩阵实测是否已完成。
- extension/package-lock.json 未逐行审查，依赖完整性与供应链审计未覆盖。
- Windows 不在本批承诺范围，未评估。
- 未逐行通读全部 63 文件补丁；重点通读了扩展全部 TypeScript 源、相关测试和核心契约，构建脚本与文档按关联抽查。

## 实际查阅的项目文件

- `.reviews/VSCode插件Phase0-1/code/_meta/changes-20261105T185028Z.diff`
- `.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md`
- `.reviews/VSCode插件Phase0-1/code/2026-11-06-VSCode插件Phase0-1-claude.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.gitignore`
- `extension/package.json`
- `extension/README.md`
- `extension/esbuild.mjs`
- `extension/.vscodeignore`
- `extension/scripts/runIntegration.mjs`
- `extension/scripts/runE2E.mjs`
- `extension/scripts/runReal.mjs`
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
- `extension/test/e2e/fullflow.test.ts`
- `extension/test/real/launch.test.ts`
- `extension/test/integration/activate.test.ts`
- `extension/test/integration/disposable.test.ts`
- `extension/test/integration/fixtureLib.ts`
- `extension/test/integration/health.test.ts`
- `extension/test/integration/monitor.test.ts`
- `extension/test/integration/prechain.test.ts`
- `extension/test/integration/suite.ts`
- `extension/test/integration/terminalRelay.test.ts`
- `extension/test/integration/testHelper.ts`
- `extension/test/unit/carriers.test.ts`
- `extension/test/unit/entryCommand.test.ts`
- `extension/test/unit/exitCodes.test.ts`
- `extension/test/unit/health.test.ts`
- `extension/test/unit/injectText.test.ts`
- `extension/test/unit/runDiscovery.test.ts`
- `extension/test/unit/stateModel.test.ts`
- `extension/test/unit/statusModel.test.ts`
- `extension/test/unit/triviumCli.test.ts`
- `extension/test/unit/versionCheck.test.ts`
- `extension/test/unit/yamlLoad.test.ts`
- `src/trivium/cli.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/run-files.ts`
- `src/trivium/status.ts`
- `src/trivium/types.ts`
- `src/trivium/archive.ts`
- `skills-src/partials/review/body.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":83,"grep":17,"glob":0,"run_command":0,"project_reads":76}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
