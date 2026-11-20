---
schema: trivium.review.v2
topic: 驾驶舱GLM主攻交互入口
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.5.13
model_requested: gemini-4-neon-high
model_effective: gemini-4-neon-high
model_effective_source: envelope
effort_requested: null
effort_effective: high
effort_effective_source: envelope
tier: medium
tier_source: profile
run_id: 20261120T065315Z
rerun_index: 1
snapshot_hash: sha256:eba138bff0d653b8eca2ec2bec9ba591d4f3a402088404fa915d472fdb548c9f
blind: true
started_at: 2026-11-20T06:53:23.074Z
finished_at: 2026-11-20T07:02:17.639Z
duration_s: 409
tool_calls:
  read: 46
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 39
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 4
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
  - left: codex
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-4-neon-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: glm
    right: gemini
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: gemini-4-neon-high
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / gemini
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-4-neon-high
    right_model: qwen4-max
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / qwen
override_reason: 左侧模型信息缺失
session_id: 4267c8e5-6dc6-4647-bd48-8d944fe22792
---

# 代码审查：驾驶舱GLM主攻交互入口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-4-neon-high` ｜ 请求模型 `gemini-4-neon-high`
> ｜ 运行 `20261120T065315Z`
> ｜ 本轮审核者 glm、gemini、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本次变更完成了 GLM 主攻交互入口的独立解析、设置项贡献、工作区信任校验、活会话复用、后台探针隔离及文档同步，整体结构清晰、与既有核心审核链解耦良好。但在实现中新增的 120s 启动日志等待（bootstrap.app.startup.completed）引入了显著的状态机与并发漏洞（超时后重注无法恢复 M1、未关终端再点火会误走活会话复用跳过注入、等待期点重注会导致重复注入），且该门控既未在已批准计划与配置说明中显式体现，也完全缺少自动化测试覆盖；此外纳入 diff 的验收报告仍保留多处待回填的占位结论。建议修复状态机与容错缺陷、补齐测试并完成终态验收回填后重审。

**结论**：不通过（`reject`）

## 审查意见（共 7 条：重要 4 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/terminalRelay.ts:128-149; extension/src/ui/cockpit.ts:584-595,620-628,662-692` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：独立 GLM 首次启动新增的 120s 启动日志等待（bootstrap.app.startup.completed）与驾驶舱的会话复用/重注状态机存在三处联动缺陷：（1）等待超时抛出错误时，terminalRelay.ts:135 引导用户确认就绪后点「重新注入」，cockpit.ts:590 将模式切为 M3，但用户点击重注走 handleResend()（cockpit.ts:679-692）成功后从未调用 this.setMode('M1')，界面徽章永久停留在 M3 纯监控；（2）超时后终端并未关闭且 session 仍在 relay.sessions 中，若用户未关终端而再次点「点火」，cockpit.ts:620-628 会命中 existing 活会话、切回 M1 并提示「已返回原 GLM 会话」而跳过注入，导致入口命令从未送入该终端却对外宣称就绪；（3）cockpit.ts:662 在 await injectText 之前已设置 currentSessionKey，且前置链完成后 #cmdbar 已可见，若用户在 120s 等待期内手动点「重新注入」，handleResend() 既不检查 session.injecting 也不中止在途等待，待启动完成事件到达后原 injectText 仍会继续发送，造成入口命令被重复注入同一终端。

**依据**：extension/src/launch/terminalRelay.ts:129-138 在 firstLaunch 等待超时时抛错且不移除 session；extension/src/ui/cockpit.ts:589-592 捕获异常后 setMode('M3')；cockpit.ts:620-628 只要 existing 存活即直接返回并 setMode('M1')；cockpit.ts:662-663 在 injectText 前写入 currentSessionKey；cockpit.ts:679-692 的 handleResend 未检查 session.injecting、未取消在途等待、成功时未 setMode('M1')。

**建议**：在 Session 上显式跟踪入口是否已送达以及在途首次注入的取消令牌/代次：handleResend 执行时中止尚未完成的首次启动等待，注入成功且终端存活时恢复 setMode('M1')；首次注入超时而未送达的活会话在再次点火时不得按「已就绪活会话」静默跳过，应提示重注或关闭重建。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/terminalRelay.ts:8,128-138; extension/package.json:123` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：实现新增了「独立 GLM（source !== '探针'）在默认 auto 模式下首次启动必须轮询等待 ZCODE_LOG_DIR 中出现 bootstrap.app.startup.completed（上限 120s）才注入」的强耦合门控。这是对已批准计划（2026-11-20-驾驶舱GLM主攻交互入口-r2-codex.md）的未显式声明偏离，且造成两处契约摩擦：（1）用户经 glmInteractivePath 或自动发现指向不写该特定内部事件名的 ZCode 版本或包装脚本时，默认 auto 模式下每次首次点火都会硬等满 120 秒后报错；（2）extension/package.json:123 与 terminalRelay.ts:8 仍声明「就绪探测无事件驱动，此值为经验值」，与当前事件驱动等待 + 固定延迟叠加的实际行为漂移。

**依据**：对照 .reviews/驾驶舱GLM主攻交互入口/plan/2026-11-20-驾驶舱GLM主攻交互入口-r2-codex.md 全文无 bootstrap.app.startup.completed 120s 门控约定；extension/src/launch/terminalRelay.ts:8 注释与 extension/package.json:123 均写「就绪探测无事件驱动，此值为经验值」，而 terminalRelay.ts:129-138 实际对所有 source !== '探针' 的 GLM 会话强制等待该日志事件。

**建议**：将该事件等待机制显式同步回设计/计划说明以及 package.json 的 readyDelayMs 与 terminalRelay.ts 头注；同时评估缩短等待超时、允许可配置或结合 turn.started/退出快速感知，避免非 3.18.2 独立包在默认模式下长时间卡死。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/test/integration/terminalRelay.test.ts:68-100; extension/test/unit/glmInteractive.test.ts:1-56` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本次新增的核心路径存在明显自动化测试缺口：（1）terminalRelay.test.ts:68-100 仅测试了 ensureSession 的 argv/cwd/node/ZCODE_LOG_DIR 与复用，全程未调用 injectText(..., firstLaunch=true)，导致新增的「非探针 GLM 等待 bootstrap.app.startup.completed 后注入」「探针来源跳过等待」「等待期间终端提前退出返回 false」「等待超时抛错」四条关键分支零覆盖；（2）glmInteractive.test.ts 始终传入 searchDirs: [root]，未覆盖 version_probe.runner 为绝对路径优先于 wrapper（glmInteractive.ts:51-52）、searchDirs 含空串或相对路径过滤、glmNodePath 不可执行及全部 Node 来源失效报错（glmInteractive.ts:47-56）；（3）未按计划补入非 GLM Driver 不受 ZCODE_LOG_DIR 等新逻辑干扰的断言。

**依据**：extension/test/integration/terminalRelay.test.ts:68-100 无 injectText 调用、无非 GLM 环境变量隔离断言；extension/test/unit/glmInteractive.test.ts:19-20 只测了 runner: 'node' 与单元素 searchDirs，未测 runner 绝对路径分支与无 Node 失败分支；对比计划 r2 第 39 行明确要求覆盖这些分支并增加防干扰断言。

**建议**：在 terminalRelay.test.ts 中补齐 injectText 首次启动等待事件放行、探针来源跳过、等待期关闭返回 false、超时抛错（可通过可选参数注入短超时）及非 GLM Driver 未注入 ZCODE_LOG_DIR 的集成断言；在 glmInteractive.test.ts 补齐 runner 绝对路径、非法 searchDirs 过滤与 Node 失败路径单测。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/REPORT_2026-11-20_VSCode驱动GLM交互入口.md:19` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：已纳入本次补丁并登记进 doc/05_testing/README.md 的验收报告仍为未闭合的阶段性草稿：第 19 行明确写着「运行号、两次回答、M3 与最终交付包须按终态回填」，尚未给出入口 A 的实际 run_id、忙/闲两次不同回答、M3 接续结果、最终交付包 trivium-cockpit-0.3.0-glm-entry-e1.vsix 及其触发的安装态 E1 回归结果；同时计划 CLAUDE-06 要求的脚本形态（bin/zcode.mjs + glmNodePath）采样或「未测」明示、以及既有三个 0.3.0 包的哈希比对均缺失。

**依据**：doc/05_testing/REPORT_2026-11-20_VSCode驱动GLM交互入口.md:19 原文「运行号、两次回答、M3 与最终交付包须按终态回填。」；对照计划 .reviews/驾驶舱GLM主攻交互入口/plan/2026-11-20-驾驶舱GLM主攻交互入口-r2-codex.md:11,17,40-42 的交付与报告口径要求。

**建议**：在最终交付前完成真实入口 A 终态验收与安装态 E1 回归，将 run_id、忙/闲两次不同回答与 turnId、M3 接续、最终 VSIX 与既有三个 0.3.0 包哈希比对以及脚本形态实测或未测声明完整回填至报告。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/zcodeTurns.ts:40-48` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：observe() 在命中 line.includes('"bootstrap.app.startup.completed"') 或 turn 事件正则后直接执行 JSON.parse(line) 且立即读取属性，既没有 try/catch 容错，也没有校验解析结果是否为非空对象。一旦日志文件中出现包含该字面量片段的非 JSON 行、损坏行或原始字符串/null JSON，会直接抛出未捕获的 SyntaxError/TypeError，打断首次启动等待循环或续话等待队列。

**依据**：extension/src/launch/zcodeTurns.ts:41-48 未对 JSON.parse(line) 做 try/catch，也未在访问 event.module / e.module 前判断其为非空对象；调用方 terminalRelay.ts:133,164 均直接 await refresh()。

**建议**：在 observe() 中将 JSON.parse 包裹于 try/catch（解析失败直接忽略该行），并在访问字段前校验解析结果为非空对象。

### AGY-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/scripts/runGlmEntry.mjs:30-35,71-86,104` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：新增验收脚本 runGlmEntry.mjs 存在两处容易导致偶发误失败的实现瑕疵：（1）logFile() 对匹配 zcode-<id>/zcode-YYYY-MM-DD.jsonl 的文件数断言 files.length <= 1 并仅返回 files[0]；若采样跨零点生成两个日期文件，会误报「此新窗口应只有一个 GLM 协同终端」，且后续 rows(file) 会漏读新日期文件中的 turn.completed；（2）收到首条 turn.started 后立即点击 busy 续话，未先等待 #modeBadge.m1 就绪，也未像 runM1.mjs 那样在点击前复核首轮仍处于忙态，存在竞态导致 clicked < Date.parse(opening.completedAt) 误失败的风险。

**依据**：extension/scripts/runGlmEntry.mjs:32-34 对文件数而非 zcode-* 目录数做 <= 1 断言且只读单个 file；runGlmEntry.mjs:71-86 在发送 questions[0]（busy）前未等待 #modeBadge.m1 也未确认首轮未完成；对比 extension/scripts/runM1.mjs:115-116,131-132。

**建议**：logFile() 改为对 zcode-* 父目录去重断言唯一终端，并在读取日志行时按文件名升序合并该目录下全部 zcode-*.jsonl；发送 busy 续话前等待 #modeBadge.m1 并确认首轮尚未记录 turn.completed。

### AGY-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `extension/src/launch/terminalRelay.ts:100-105` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：ensureSession() 先在 logRoot 下调用 mkdirSync/mkdtempSync 创建了 zcode-* 独占日志目录，之后才在第 105 行校验 opts.launchMode === 'shellCommand' && !opts.nodePath。当该参数校验失败抛错时，会在 logRoot 下残留空临时目录。

**依据**：extension/src/launch/terminalRelay.ts:100-105 先执行 mkdtempSync(join(this.logRoot, 'zcode-'))，再判断 !opts.nodePath 并 throw。

**建议**：将 shellCommand 模式的 nodePath 非空校验前移到创建日志目录之前。

## 认为正确的部分

- glmInteractive.ts 的解析优先级（显式设置 > 扩展宿主 PATH 与常见 macOS 目录自动发现 > 原探针）、显式失败不回落、桌面包 ZCode.app/Contents/Resources/glm/zcode.cjs 结合动态 import('@zcode/tui') 与祖先 node_modules/@zcode/tui 的判别逻辑，以及仅探针脚本传递 provider_config 环境变量的设计清晰且贴合计划。
- 两项新配置使用 machine-overridable 作用域并按当前工作区根 URI 读取，且在 GLM 点火分支里于 claimTopic 之前显式检查 vscode.workspace.isTrusted，安全边界与认领时序正确。
- cockpitHtml.ts 将健康行明确标为「后台审核探针」，仅放开 GLM 作为 Driver 可选而保持审核者可用性由探针控制；结合核心 preflight.ts 仅对入选审核者校验只读能力与版本的机制，后台 GLM 审核路径与主攻交互路径完全解耦。
- TerminalRelay.ensureSession 在 direct 与 shellCommand 两种模式下统一按 waitForZcodeTurn 分配独占 ZCODE_LOG_DIR，使独立安装器生成的无后缀启动器也能复用既有 ZcodeTurns 轮次同步机制。
- doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md、extension/README.md 与 doc/05_testing/README.md 的索引条目格式与升序规则均符合仓库文档对账契约（doc-archive-index.ts）。

## 未覆盖范围（本侧盲区）

- 本侧无命令执行能力，未实际运行 npm run check、extension 的单测/Extension Host 集成测试、VSIX 打包或 runE2E.mjs/runGlmEntry.mjs，所有结论均基于静态阅读源码、测试与文档的推理。
- 未在真实 macOS 环境中验证 ZCode 3.18.2 独立安装器生成的 bin/zcode 或解压版 bin/zcode.mjs 的实际启动、bootstrap.app.startup.completed 日志产出时序、keyring 原生绑定及真实模型续话行为。
- 未检查 Windows 平台下的路径分隔符（例如 desktopWithoutTui 使用正斜杠后缀）与可执行权限检查行为（报告与文档已明确 Windows 真机未测）。
- 未检查 diff 之外尚未提交或未包含在本轮 changes.diff 中的 VSIX 二进制构建产物与历史三个 0.3.0 包的哈希值。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-11-20_VSCode驱动GLM交互入口.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `.reviews/驾驶舱GLM主攻交互入口/plan/2026-11-20-驾驶舱GLM主攻交互入口-r2-codex.md`
- `extension/README.md`
- `extension/package.json`
- `extension/scripts/runE2E.mjs`
- `extension/scripts/runGlmEntry.mjs`
- `extension/scripts/runM1.mjs`
- `extension/scripts/runStdoutE2E.mjs`
- `extension/src/env/config.ts`
- `extension/src/env/health.ts`
- `extension/src/extension.ts`
- `extension/src/launch/carriers.ts`
- `extension/src/launch/glmInteractive.ts`
- `extension/src/launch/prechain.ts`
- `extension/src/launch/terminalRelay.ts`
- `extension/src/launch/zcodeTurns.ts`
- `extension/src/services.ts`
- `extension/src/ui/cockpit.ts`
- `extension/src/ui/cockpitHtml.ts`
- `extension/src/ui/healthTree.ts`
- `extension/test/e2e/glmReplies.mjs`
- `extension/test/e2e/workbench.mjs`
- `extension/test/e2e/workspace.mjs`
- `extension/test/integration/terminalRelay.test.ts`
- `extension/test/integration/testHelper.ts`
- `extension/test/unit/carriers.test.ts`
- `extension/test/unit/glmInteractive.test.ts`
- `extension/test/unit/zcodeTurns.test.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/preflight.ts`
- `src/trivium/state.ts`
- `test/helpers/doc-archive-index.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":46,"grep":0,"glob":0,"run_command":0,"project_reads":39}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
