# VSCode插件Phase0-1 · 实施计划（r2 · 定稿）

- 主题：VSCode插件Phase0-1
- 执笔：glm（Driver，ZCode 桌面端会话）
- 日期：2026-11-06
- 基线：分支 `feat/vscode-extension`，HEAD `7bae8100`；CLI 1.3.5
- 依据：v2 计划（§4~§8）+ 计划审第 1/5 轮三侧意见（claude/gemini/codex，23 条全部接受，裁决见 `…-revised-glm.md`）
- 工作树既有未提交改动登记（本批不碰不回退，S6 diff 归因以此为准）：`.trivium/config.yaml`（default_critics、timeout）、`doc/08_project/README.md`、未跟踪的 v2 计划文档

## 相对上一轮的改动（第 1/5 轮审查，23 条全接受）

1. **CLAUDE-01 / CODEX-01 / AGY-01（入口调用建模，双阻断+major）**：调用形态从「单字符前缀」升级为**完整调用模板**（终端 CLI 形态）：claude `/dual-run`、codex `$dual-run`、gemini `/dual-run`、glm `/skill dual-run`；注入组装去掉 `--` 分隔符与 shell 引号（聊天输入不是 shell），改为 `<调用模板> <正文单行化> <旗标>`；防漂移测试从「产物正文猜前缀」改为**对账注册表源码与载体 yaml**。
2. **AGY-02（终端拉起，阻断）**：按载体声明拉起模式——可执行二进制直启；脚本类（zcode `.cjs`）经默认 shell + `"<node>" "<entrypoint>"` 激活，node 路径取探针 runner、兜底解析 wrapper 内嵌路径。
3. **CLAUDE-02（前置链次序）**：resolve → preflight → 主题确认（UI 回显）→ claim（仅 A/B、确认后）；C/D 不预认领；登记终端会话重跑同链路的幂等性评估。
4. **CLAUDE-03 / CODEX-06（注入失败误判）**：撤销「30s 无变化=失败」推断；改「尚未观察到审查启动」提示 + 核对终端引导 + 人工重发。
5. **CLAUDE-04 / AGY-04（run 发现误捞）**：活跃白名单 {running, review_done_awaiting_disposition, awaiting_approval} + run_id 非空；历史终态与活跃看板分离。
6. **CODEX-02（闸门先写、状态后建窗口）**：激活期初始扫描 + run 定位重试退避（5s×12）；回落 idle 的 run 读终态以「已结束」提示。
7. **CLAUDE-05 / CODEX-03（心跳失联无事件场景）**：每 run 30s 周期重估定时器（仅非终态），独立于 watcher 事件；终态即停。
8. **CLAUDE-06（侧完成正文数据面）**：文件面新增 `.reviews/<topic>/<stage>/` 目录 watcher 与 runDir/<critic>/out/ 存在性检查；验收改「侧完成即列正文入口」。
9. **CLAUDE-07（终端复用键）**：身份键 `agent|topic|entry`（topic 含推导值），显示名不充当身份；忙碌/归属不明即新开或询问。
10. **CLAUDE-08（事实表对账）**：防漂移测试机器对账 `src/trivium/agents/registry.ts` 与 `skills-src/carriers/*.yaml`（cliKey、skill 根、完整调用模板）。
11. **CLAUDE-09（版本对齐可执行化）**：按文件类型声明 schema 支持集，逐文件判未知主版本降级；CLI 数值版本仅诊断。
12. **CLAUDE-10（引导链接修正）**：部署手册路径改 `doc/06_deployment/部署手册.md`，静态存在性检查。
13. **AGY-03（D6 撤销）**：**不改 `.trivium/config.yaml`**；extension check 定为 S5 交付步骤（执行留档）+ S6 送审前复跑；是否接入 verify.test 留给用户。
14. **AGY-05（Disposable 契约）**：monitor 全模块 Disposable 化，驾驶舱关闭/切换主题/终态复核后统一清理。
15. **CODEX-04（平台边界）**：本批明示 **macOS**；Windows 适配登记后续批次。
16. **CODEX-05（保真验证两层化）**：通道保真（fake TUI 字节级，自动化）与入口解析保真（真机单载体全链）分别成测。
17. **CODEX-08（桩配置形态）**：`TRIVIUM_STUB_CRITIC` 用按审核者的 JSON 对象（对齐 fixture 形态），启动前自检、事后断言桩指纹。
18. **CODEX-07（矩阵预算）**：零配额承诺限定假 TUI + 桩 e2e；真机矩阵登记调用次数与重试上限，超限记「本批未验证」。

——以下为合入后的完整计划。

## 〇、要解决的问题与范围

**任务目标**：按 v2 计划实施 VS Code 插件第一批开发——Phase 0（脚手架与探活）+ Phase 1（启动器与运行监控，M1 终端协同 / M3 纯监控最小闭环），交付 FR-1/FR-2/FR-3/FR-4/FR-5。

**交付清单**（同 r1）：FR-1 环境健康面板、FR-2 装配表单、FR-3 前置链、FR-4 运行监控、FR-5 M1 终端协同（核心）。

**范围边界**：
- 不在本批：FR-6 行内批注/Diagnostics、FR-7 历史回放、FR-8 裁决台、FR-9 审批按钮、FR-10 保存拦截与状态灯、FR-11 预设、FR-13 市场发布（仅保证 `vsce package` 可打包）；E1/E2/E3；M2。闸门区只读展示「P3 交付」提示。
- **平台边界（CODEX-04）**：本批开发、测试与验收全部在 **macOS（darwin/arm64）**；Windows 原生（`.cmd` wrapper 经命令解释器执行、Git Bash shell 夹具假设）登记为后续批次待办。插件代码内对 CLI 子进程一律 `spawn(路径, 参数, {shell:false})` + 绝对路径（为后续适配减负，不作承诺）。
- 硬约束不变：集成面仅 CLI（`--json` + 退出码）与文件面（只读 watcher）；零复制编排器业务逻辑；路径只用 wrapper + 探针 entrypoint 绝对路径（裁决 C1，禁登录 Shell 提取）；不直写 `.trivium/*.yaml`；UI 与注释全中文；不改用户全局配置；本批不改核心仓 `src/`、`skills-src/`；status.json 幂等渲染（N3）。

## 一、事实基线（r1 基线 + 本轮新增核实）

r1 的九条事实保留（probe 段结构与 cliKey 映射、渲染产物落点、state.json/run 目录形态、CLI 契约与退出码、wrapper 形态、工具链、.gitignore 现状）。新增：

10. **ZCode 命令行调用形态**：桌面端 `/名字`（注册表 `entryInvocation` 登记的形态），**命令行 CLI 为 `/skill <名字> <参数>`**（README「四条正式入口」、`skills-src/carriers/glm.yaml` 注释、registry.ts:386-389 三处一致）。插件拉起的是终端 CLI，必须用命令行形态。其余三家终端形态：claude `/dual-run`、codex `$dual-run`、gemini(agy) `/dual-run`。
11. **zcode entrypoint 是 `.cjs` 脚本**（`/Applications/ZCode.app/.../zcode.cjs`）：不可作为 `createTerminal.shellPath` 直接 exec（ENOEXEC）；探针 `version_probe.runner` 字段可能给出解释器；wrapper 脚本内嵌 node 绝对路径（`/opt/homebrew/opt/node/bin/node`）可解析复用——两者都是「wrapper+探针」单一来源，不碰登录 Shell。
12. **入口 skill 参数契约是 `<正文> [旗标]`**：正文在前、旗标在后，`--` 不是合法前缀（`topic-args.ts` 的 splitArguments 会把裸 `--` 当位置参数，正文将永久带 `-- ` 前缀）。注入文本是聊天输入，不需要 shell 引号转义。
13. **闸门先写、status.json 后建**（CODEX-02）：`review.ts` 先 `setGateChecked` 置 running，`run-protocol.ts` 到 prepareRun 之后才写初始 status.json——存在发现窗口；失败运行收尾把闸门回 idle。
14. **侧完成即归档**：每侧审查完成即写 `.reviews/<topic>/<stage>/<日期>-<主题>-[rN]-<角色>.md` 与 `_meta/review-<角色>-<runId>.json`（本轮实测：claude 侧失败时 gemini/codex 的件已落盘）；`status.json.artifacts` 仅整 run 终态填写。
15. **桩配置形态**（CODEX-08）：`TRIVIUM_STUB_CRITIC` 须为可解析成对象的 JSON（按审核者配置，形态见 `test/helpers/fixture.ts:195`）；`"1"` 被解析为数字即视为未注入、回落真实适配器。

## 二、总体架构

```
extension/（独立 npm 包，不进主仓构建链与闸门）
├── package.json / package-lock.json / tsconfig.json / esbuild.mjs / .vscodeignore / README.md（中文）
├── src/
│   ├── extension.ts            激活入口；命令/视图/配置注册；生命周期（activate/deactivate 释放全部 Disposable）
│   ├── cli/
│   │   ├── triviumCli.ts       wrapper 定位与执行（spawn shell:false、超时、UTF-8、退出码捕获）
│   │   ├── exitCodes.ts        退出码 → 中文语义映射（纯展示层）
│   │   └── commands.ts         doctor / preflight / topicResolve / topicClaim / reviewStatus / reviewCancel / version 类型化封装
│   ├── env/
│   │   ├── config.ts           .trivium/config.yaml + config.local.yaml 只读解析（yaml 库，支持锚点别名）
│   │   ├── health.ts           Agent 可用性模型（probe 驱动）；未 init 判定
│   │   └── versionCheck.ts     D10′：按文件类型的 schema 支持集判定，未知主版本降级只读
│   ├── launch/
│   │   ├── carriers.ts         载体描述表（D1′）：agent → {cliKey, skillRootCandidates, invocation(终端 CLI 模板), launch 模式}
│   │   ├── entryCommand.ts     D1′：调用模板 + 旗标组装 + injectText 单行化（无 -- 无引号）
│   │   ├── prechain.ts         D4′前置链：resolve → preflight → 主题确认 → claim(仅 A/B)
│   │   └── terminalRelay.ts    D2′/D3′：拉起（direct|shell+node）、身份键复用、延迟注入、人工重发、关闭降级
│   ├── monitor/
│   │   ├── stateWatch.ts       D4′：state.json watcher（激活期初始扫描 + 白名单 + 回落 idle 终态提示）
│   │   ├── runDiscovery.ts     run_root 浅扫描定位 <runId> 目录（重试退避 5s×12）
│   │   ├── statusWatch.ts      D5′：status.json watcher + 30s 心跳重估定时器（幂等，终态复核 --status）
│   │   ├── reviewWatch.ts      CLAUDE-06：.reviews/<topic>/<stage>/ 目录 watcher（侧完成即列正文入口）
│   │   └── logTail.ts          worker.log 尾随（节流 + 尾部窗口）
│   ├── ui/
│   │   ├── cockpit.ts          驾驶舱 Webview（装配条/输出窗口/输入框、postMessage、M1/M3 模式、Disposable 归口）
│   │   ├── cockpitHtml.ts      Webview HTML/JS（原生无框架、CSP、全中文）
│   │   └── healthTree.ts       FR-1 树视图 + viewsWelcome 未 init 引导
│   └── util/
│       ├── injectText.ts       AGY-01：正文单行化（换行→空格）+ `--` 开头警示（替代 r1 的 shellQuote）
│       └── yamlLoad.ts         yaml 安全加载薄封装
├── test/
│   ├── unit/（node --test）    exitCodes、injectText、entryCommand（含注册表/载体 yaml 对账）、health、statusRender（幂等/未知态）、runDiscovery、carrierTable 对账
│   ├── integration/（@vscode/test-electron + mocha）
│   │   health.test / prechain.test(stubTrivium) / monitor.test(miniRepo：历史残留、闸门先行窗口、心跳零事件) /
│   │   terminalRelay.test(fakeTui：字节级通道保真) / reviewWatch.test / disposable.test
│   ├── e2e/fullflow.stub.test.ts（慢测，可选跑）——真实 trivium.cjs + JSON 桩配置
│   ├── fixtures/               stubTrivium.sh、fakeTui.cjs、miniRepo 模板、stub 配置 JSON
│   └── scripts/runIntegration.mjs、runE2E.mjs
└── .vscode/launch.json          F5 调试
```

**修改的既有文件（全部）**：仅 `.gitignore`（追加 `extension/.vscode-test/`；`node_modules/`、`dist/` 既有规则已覆盖）。**不改 `.trivium/config.yaml`**（AGY-03 裁决）。不碰 `src/**`、`skills-src/**`、`skills/**`、`test/**`、主仓构建配置、`doc/**`。

## 三、关键设计决策（r2 修订版）

### D1′ 入口调用模板：完整模板 + 机器对账，不猜前缀

- `carriers.ts` 每载体声明：`{ agentId, cliKey, skillRootCandidates, invocation }`，`invocation` 是**终端 CLI 完整调用模板**（`dual-run` 等命令名代入）：claude `/dual-run`、codex `$dual-run`、gemini `/dual-run`、glm `/skill dual-run`。插件只拉起终端 CLI，无桌面端形态分支；模板取 `{name}` 占位由入口映射 A→dual-run / B→dual-review-plan / C→dual-review-code / D→dual-review-bug 代入。
- 注入文本组装：`<invocation> <正文单行化> <旗标串>`。**无 `--` 分隔符、无 shell 引号**（AGY-01：聊天输入不是 shell）；正文经 `injectText` 单行化（换行→空格，UI 提示长正文建议精简或走 `--context`），正文以 `--` 开头时 UI 警示「可能被当旗标吞掉」。
- **防漂移对账测试（CLAUDE-01/08、CODEX-01）**：`carrierTable.test.ts` 读取仓内 `src/trivium/agents/registry.ts`（entryInvocation、cliName、entrySkillRoot 的 homeRel/skillsRel）与 `skills-src/carriers/*.yaml` 注释（zcode CLI `/skill 名字`），断言 carriers.ts 的 cliKey、skill 根候选与完整调用模板逐项一致——注册表演进时测试红。渲染产物（安装位优先、仓内兜底）仅用于**旗标语法展示**（argument-hint / 参数写法行），不再承担调用形态推断。
- 产物缺失兜底链：安装位 → 仓内 `skills/` → 提示「未找到入口产物，命令条为猜测值」。

### D2′ 终端拉起：按载体声明模式，脚本类经解释器

- `launch.mode = direct`（claude/codex/agy：entrypoint 为可执行）：`createTerminal({ name, shellPath: entrypoint, cwd })`。
- `launch.mode = shellCommand`（zcode `.cjs`）：默认 shell 终端就绪后注入启动命令 `"<node>" "<entrypoint>"`；`<node>` 优先取探针 `version_probe.runner` 给出的解释器路径，兜底**解析 wrapper 脚本内嵌的 node 绝对路径**（正则取 `exec "..."` 引号内路径）。两处来源都属「wrapper+探针」面，不读登录 Shell（C1）。
- 终端身份（CLAUDE-07）：内部键 `agent|topic|entry`（topic 取 resolve 结果，含推导值；未 resolve 时占位 `?` 并在点火前补齐）；复用须键相同且终端存活；键不同、归属不明或正忙（已有未完成注入会话）→ 新开终端或请用户选择。显示名 `Trivium · <agent> · <topic>` 仅展示。

### D3′ 就绪与注入：延迟 + 人工兜底，不做自动失败推断

- 不用 proposed API（`onDidWriteTerminalData` 市场不可用）。就绪 = `trivium.launch.readyDelayMs`（缺省 3000，可按载体覆盖）延迟后注入；长正文（>512B）分段 `sendText`（段间 80ms）；回车语义三模式 `execute | split | manual`（配置 `trivium.launch.sendMode`，缺省 execute）。
- **auto 判定撤销**（CLAUDE-03/CODEX-06）：注入后不做「无变化=失败」推断。UI 常驻两条：「重新注入」（人工重发）与「尚未观察到审查启动——请核对终端」的信息提示（不称失败、不自动重发）；命令条（一键复制完整注入文本）始终可用，流程永不阻塞。
- 续话中继：输入框 → 命中身份键的终端 `sendText`；终端已关 → 提示「请在终端直接输入」并降级 M3。
- 终端关闭（onDidCloseTerminal）→ 驾驶舱切 M3 纯监控，watcher 不中断。

### D4′ run 发现：白名单 + 初始扫描 + 重试退避

- 激活时与每次 state.json 变更时：读 `gates`，**活跃白名单** `state ∈ {running, review_done_awaiting_disposition, awaiting_approval}` 且 `run_id` 非空 → 进活跃看板（CLAUDE-04/AGY-04）。其余（idle/approved/rejected/abandoned、null run_id）归历史折叠列表，watcher 事件不把它们推进活跃看板。
- `runDiscovery`：读 `runtime.run_root`（展开 `~`），`<run_root>/*/<run_id>/status.json` 浅扫描；**闸门已 running 而 status.json 未现**时按 5s×12 轮退避重试（CODEX-02 的创建窗口），仍失败则提示「运行目录尚未就绪」并保持 watcher 盯目录创建。
- gates 条目从活跃回落 idle 且 run_id 非空：读该 run 的 status.json 终态，以「已结束（<phase>）」提示，不进活跃看板。
- M3 自动发现：任何来源的 run（别处 CLI、Driver 会话）经同一路径进看板。

### D5′ 心跳失联：周期重估 + 终态复核 + Disposable

- 每个 run：status.json watcher（幂等渲染，N3：坏快照/未知态原样丢弃或展示，不报错）+ **30s 周期定时器**重估 `heartbeat_at` 年龄（仅 phase 非终态时）；超 `heartbeat_stale_s`（config，缺省 120）→ 失联提示（含 `--wait` 失联收尾语义与 worker.log 绝对路径），不自行判死（CLAUDE-05/CODEX-03）。
- watcher 报终态 → 追加一次 `review --status <run_id> --json` 复核，不一致以 CLI 为准并标注「文件快照可能滞后」；复核完成即停定时器。
- **Disposable 契约（AGY-05）**：monitor 全模块实现 `vscode.Disposable`；驾驶舱关闭、切换监控主题、终态复核完成三处统一 dispose（watcher、定时器、缓存）；集成测试断言「关闭面板后无残留定时器」。

### D6′ verify 命令面（AGY-03 裁决：撤销接线）

- **不改 `.trivium/config.yaml`**；主仓 verify 与 `npm run check` 原样。
- 机械保证：S5 第 10 步执行 `npm install --prefix extension && npm run check --prefix extension` 并把输出留档（写进交付说明）；S6 送审前复跑一次确认仍绿。是否把 extension check 接入 `.trivium/config.yaml` verify.test，作为交付后用户决策项单列（涉及无头环境代价与 v2「不并入主仓闸门」边界）。

### D7′ 测试底座

- 单测（node --test）：exitCodes 映射、injectText（单行化、`--` 开头警示、中文/引号/`$`/反引号保真）、entryCommand（模板代入、旗标组装、对账）、carrierTable 对账（registry + carriers yaml）、health（probe 夹具）、statusRender（旧快照/坏 JSON/未知态/心跳计算）、runDiscovery（含重试与回落 idle）。
- 集成（@vscode/test-electron 真实 extension host，mocha）：
  - `stubTrivium.sh`：可编程假 CLI（canned JSON + 指定退出码）——prechain 错误面、cancel、版本降级；
  - `miniRepo` 夹具：假 wrapper/config/probe/state.json/run 目录——健康面板、run 发现（含**历史残留条目**、**闸门先行 status 后建**时序、**回落 idle 终态提示**）、status/心跳（**新鲜快照后零写入**用例）、reviewWatch（侧完成件落盘即列入口）、logTail；
  - `fakeTui.cjs`：stdin 回显假 TUI——**通道保真（CODEX-05）**：注入文本与 TUI 收到字节逐字相等；终端创建/复用（身份键）/关闭降级/Disposable 无残留；
  - e2e 慢测（可选）：真实 `skills/dual-critic/scripts/trivium.cjs` + 夹具仓库 + **JSON 桩配置**（CODEX-08：按审核者对象，覆盖入选集合；启动前解析自检，失败即中止；事后逐侧断言 `cli_version: 'stub/0.0.0'`），插件旁观 run 推进至终态。
- vscode-tests 下载的 VS Code 缓存于 `extension/.vscode-test/`（gitignore）；除真机矩阵外零配额。

### D8′ 注入矩阵（macOS 真机，预算登记）

| 维度 | claude | codex | gemini(agy) | glm(zcode) |
| :--- | :--- | :--- | :--- | :--- |
| 直启（direct/shellCommand）进交互 TUI | 待测 | 待测 | 待测 | 待测 |
| 就绪延迟中位数（≥3 次采样） | 待测 | 待测 | 待测 | 待测 |
| sendText 模式（execute/split/manual） | 待测 | 待测 | 待测 | 待测 |
| 短正文注入成功（dual-status 探针） | 待测 | 待测 | 待测 | 待测 |
| 长正文（~2KB 中文+引号+$）通道保真 | 待测 | 待测 | 待测 | 待测 |
| 续话中继第二段 | 待测 | 待测 | 待测 | 待测 |
| 关闭→降级 M3 监控不断 | 待测 | 待测 | 待测 | 待测 |
| 同主题复用不开新终端 | 待测 | 待测 | 待测 | 待测 |

- 探针命令用 `<调用模板 dual-status>`：只读本地查询，但**如实标注少量配额**（会话经 Driver 模型转述，CODEX-07），非零成本。
- **入口解析保真（CODEX-05）**：真机单载体一次全链（建议 glm 或 codex），从表单注入 dual-run 到会话 S0.5 解析，比对解析出的 task_goal 与表单原文（终端可见 + `task.json` goal 字段）。通道保真已由 fakeTui 自动化，不以它冒充。
- **预算与上限（CODEX-07）**：每载体会话启动 ≤3 次、注入重试 ≤2 次；超限记「该载体本批未验证」并如实交付，不继续烧。矩阵结论逐格记录进交付说明。

### D9′ 中文化与安全（同 r1，无变化）

全中文 UI 与注释；不改用户全局配置；Webview 严格 CSP（仅 vscode-webview 协议 + nonce 内联脚本）；probe/工件展示不渲染指纹与凭据类字段。

### D10′ 版本对齐与未 init 引导（可执行化）

- **schema 支持集（CLAUDE-09）**：按消费文件类型声明 `{ '.trivium/config.yaml': 'trivium.config.v2', '.trivium/state.json': 'trivium.state.v1', '<runDir>/status.json': 'trivium.status.v1' }`；逐文件读取时判 `schema` 字段——未知**主版本**（前缀 `trivium.<name>.v` 后的数字超出支持）→ 驾驶舱黄条「数据版本可能不兼容，已降级只读监控」，禁用点火；CLI `--version` 数值仅作诊断展示，不作判定输入。补新旧组合夹具（v1/v2 config、v2 status 等）。
- **未 init 引导（CLAUDE-10）**：链接 `doc/06_deployment/部署手册.md` 与 `doc/07_manuals/使用手册.md`（静态存在性检查进单测），点火按钮禁用。
- N5 最小：第一 workspace folder 为根；主题已有活跃 run 时装配条置灰提示。

## 四、S5 实施步骤（每步可验证）

1. 脚手架：包骨架 + esbuild + F5 空激活；`.gitignore` 增补；`npm install`。
2. cli/ + env/：triviumCli、exitCodes、commands、config 解析（锚点）、health、versionCheck（schema 支持集）；单测。
3. FR-1：healthTree + viewsWelcome（修正链接）；集成（miniRepo）。
4. launch 纯逻辑：carriers（完整模板）+ entryCommand + injectText + prechain（新次序）+ 对账单测；stubTrivium 集成。
5. FR-5：terminalRelay（direct/shellCommand、身份键、延迟注入、三模式、人工重发、关闭降级）+ 命令条；fakeTui 集成（通道保真字节级）。
6. monitor/：stateWatch（白名单+初始扫描+重试）、runDiscovery、statusWatch（周期重估）、reviewWatch、logTail、cancel；Disposable 契约；miniRepo 集成（历史残留/闸门先行/零写入/回落 idle）。
7. FR-2 + cockpit：装配表单（探针驱动、排除同身份、A/B/C/D、max-rounds、高级折叠、context 选择）+ 输出窗口（阶段条/侧卡/侧完成正文入口/Driver 区/日志）+ 输入框（点火注入/续话中继）+ M1/M3 切换。
8. e2e 慢测：JSON 桩配置 + 真实 trivium.cjs 全链（可选跑，先本地验证）。
9. 真机注入矩阵（D8′ 表）逐格执行并记录；超限格记「未验证」。
10. **extension check 留档（D6′）**：`npm install --prefix extension && npm run check --prefix extension` 跑绿并保存输出进交付说明；`vsce package` 冒烟出 `.vsix`；主仓 `npm run check` 回归确认不破坏。

## 五、测试与验收

**verify 命令面（S10 实际执行）**：`.trivium/config.yaml` 原样——build `npm run typecheck`、`npm run build`；test `npm test`。**extension check 不接入**（AGY-03），其绿由 S5 第 10 步执行留档 + S6 送审前复跑保证。

**验收标准（对齐 v2 §6.0/§6.1，macOS）**：

Phase 0：
- [ ] TriviumCode 仓库打开 VS Code（F5 宿主），健康面板正确显示四家可用性/版本/入口（probe 驱动）；
- [ ] 未 init 仓库显示引导（链接真实存在）而非报错；
- [ ] `npm run check --prefix extension` 绿（留档）；主仓 `npm run check` 绿。

Phase 1（全程无手敲命令）：
- [ ] 装配表单：Driver/审查者探针驱动置灰、自动排除同身份、入口/轮次/高级折叠/context 选择生效；
- [ ] 点火自动走前置链（resolve→preflight→主题确认→claim[A/B]），退出码 64/65/69/70 语义化展示（64 含吞旗标提示、69 含探针过期指引、70 显示持锁 run）；
- [ ] 前置链过后自动开命名终端（zcode 走 shell+node 模式）、注入 `<调用模板> <正文> <旗标>`；注入不理想时「重新注入」与命令条可用；
- [ ] 看板：阶段条/侧状态卡推进至终态；**侧完成即列该侧审查正文入口（.reviews 归档件）可打开**；artifacts 链接终态补充；
- [ ] 输入框续话中继；终端关闭正确降级 M3 且监控不断；
- [ ] M3：在别处（终端 CLI）起一个 run，驾驶舱自动发现并监控；
- [ ] 中止按钮 → `--cancel` → run 转 cancelled；
- [ ] 心跳失联：新鲜快照后零写入场景，超阈值出现提示 + worker.log 路径（不误判终态）；
- [ ] 历史残留 gates 条目不进活跃看板。

**已知局限（如实交付）**：就绪探测为延迟+人工兜底（无事件驱动）；Windows 未适配（登记后续）；注入矩阵真机结论以 S5 执行记录为准，超预算载体记「本批未验证」；审查正文只做打开文件，不做结构化展示（FR-6 属 P2）。

## 六、风险登记（r2）

| 风险 | 等级 | 应对 |
| :--- | :---: | :--- |
| 四家 TUI 直启/注入兼容性参差（zcode 脚本类最不确定） | 高 | D2′ 双模式 + D3′ 三模式 + 命令条兜底；矩阵逐格实测、超限如实记「未验证」 |
| 长正文经 TTY 吞/截断 | 中 | 分段注入 + fakeTUI 字节级通道保真 + 真机单载体全链解析保真 |
| run 发现窗口（闸门先行）与失败运行回落 idle | 中 | D4′ 初始扫描 + 5s×12 退避 + 回落终态提示；时序夹具 |
| state.json 并发读到半截 JSON | 中 | 解析失败丢弃该快照（幂等），下轮事件重读 |
| 载体事实表（模板/根路径）随注册表演进漂移 | 低 | carrierTable 对账测试先红先知 |
| `.vscode-test` 首次下载失败 | 中 | S5 手动跑通缓存；e2e 慢测可独立跳过 |
| 用户误以为插件代跑全流程 | 低 | UI 文案「阶段循环由终端 Driver 会话驱动，插件旁观」 |
| 主仓 check 被误伤 | 低 | 不动主仓任何构建文件；第 10 步回归验证 |

## 七、交付物清单

新增：`extension/` 全目录（§二树，约 38 个文件）+ 本主题 `.reviews/` 工件。
修改：`.gitignore`（+1 段）。
产物（不入库）：`extension/dist/`、`extension/.vscode-test/`、`trivium-cockpit-0.1.0.vsix`、交付说明（矩阵结论 + check 留档 + 已知局限）。
