# VSCode插件Phase0-1 · 实施计划（原稿）

- 主题：VSCode插件Phase0-1
- 执笔：glm（Driver，ZCode 桌面端会话）
- 日期：2026-11-06
- 基线：分支 `feat/vscode-extension`，HEAD `7bae8100`；CLI 1.3.5（`.trivium/bin/trivium` → `~/.claude/skills/dual-critic/scripts/trivium.cjs`）
- 依据：`doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`（v2.1，下称「v2 计划」）§4~§8；本计划是 §6.0（Phase 0）+ §6.1（Phase 1）的**实施级细化**，与其冲突处以 v2 计划为准
- 工作树既有未提交改动（本批**不碰、不回退**，仅如实登记）：`.trivium/config.yaml`（default_critics 改 [claude,gemini,codex]、三阶段 timeout 3600）、`doc/08_project/README.md`、未跟踪的 v2 计划文档本身。S6 代码审的 diff 将包含它们，归因以此处登记为准

## 〇、要解决的问题与范围

**任务目标**：按 v2 计划实施 TriviumCode VS Code 插件第一批开发——Phase 0（脚手架与探活）+ Phase 1（启动器与运行监控，M1 终端协同 / M3 纯监控最小闭环），交付 FR-1/FR-2/FR-3/FR-4/FR-5。

**本批交付**：

| 编号 | 内容 | v2 计划出处 |
| :--- | :--- | :--- |
| FR-1 | 环境健康面板（探针段 + doctor/preflight 按需，置灰不可用 Agent；未 init 引导） | §6.0、FR-1 |
| FR-2 | 装配表单（Driver 单选 / 审查者多选探针驱动、入口 A/B/C/D、max-rounds、模型/档位高级折叠、context paths 选择） | §6.1、FR-2 |
| FR-3 | 前置链 topic resolve → topic claim → preflight（经 wrapper），退出码 64/65/69/70 语义化展示 | §6.1、FR-3 |
| FR-4 | 运行监控：state.json 主题锁发现 run → status.json watcher（阶段条/侧状态卡/心跳失联）+ worker.log 尾随 + --cancel | §6.1、FR-4 |
| FR-5 | M1 终端协同：命名终端拉起交互会话、就绪探测 + sendText 注入、失败回退可复制命令条、续话中继、终端关闭降级 M3；入口命令载体差异从 skills 渲染产物读取 | §6.1、FR-5（本批核心） |

**明确不在本批**（v2 计划 P2~P4 与核心增强）：FR-6 行内批注/Diagnostics、FR-7 运行历史回放、FR-8 裁决台、FR-9 审批按钮、FR-10 保存拦截与状态灯、FR-11 预设体系、FR-13 vsce 正式发布流程（本批仅保证 `vsce package` 可打包，不做市场发布）；E1/E2/E3 核心仓改动；M2 内嵌托管（不排期）。驾驶舱 Webview 里与 FR-8/9 相关的闸门区**只做只读展示**（state 变化时提示「该能力 P3 交付」），不做按钮。

## 一、事实基线（本计划调研新增实测，补 v2 计划 §2）

以下均在当前机器实测核实（2026-11-06）：

1. **probe 段结构**（`.trivium/config.local.yaml`，doctor 回填）：`probe.cli.<cliKey>` 键为 **CLI 名**（claude/codex/**agy**/**zcode**），与 Agent id（claude/codex/**gemini**/**glm**）不同名；`entrypoint`/`version`/`probed_at` 可直接取用；`probe.auth.<agentId>.ok` 是认证态；段内大量 YAML 锚点别名（`&a1`/`*a1`），解析库必须支持 alias 展开。probe 段**不含** skill 根信息、不含凭据（凭据副本在 run 目录，由 scrub 管）。
2. **渲染产物的调用形态可推导**：`skills/dual-critic/entry/codex/*/SKILL.md` 正文含 `$dual-review-plan`、`$dual-approve` 等 `$dual-` 字样；claude 顶层产品与 glm/gemini entry 产品正文用 `/dual-*`。→ 调用前缀（`$` vs `/`）可从产物正文正则 `([$\/])dual-[a-z-]+` 取众数推导；**旗标语法**从同一产品读取（claude：front-matter `argument-hint`；其余：正文「参数：」行的参数写法）。这就是「不硬编码第二份」的落实方式（见 D1）。
3. **渲染产物落点**：本仓 `skills/dual-<命令>/SKILL.md`（claude，layout: top）与 `skills/dual-critic/entry/<agent>/<命令>/SKILL.md`（安装时拍平）；用户机安装位（注册表 `entrySkillRoot` 事实）：`~/.claude/skills/`、`$CODEX_HOME`（缺省 `~/.codex`）/skills、`~/.gemini/config/skills/`、`~/.zcode/skills/`。插件按所选 Driver 读**安装位**产品，仓内 `skills/` 产品作兜底（本仓自身作为工作区时直接命中）。
4. **state.json**（`.trivium/state.json`，schema `trivium.state.v1`）：单文件、全主题共享；`gates["<topic>/<stage>"] = {topic, stage, state, run_id, rerun_index, since, session_id}`，state ∈ idle/running/review_done_awaiting_disposition/awaiting_approval/approved/rejected/abandoned（历史样例含大量 idle/approved 残留——插件发现逻辑不得假设条目会被清理）。
5. **run 目录**：`<run_root>/<repoId>/<runId>/`，`run_root` 读 `.trivium/config.yaml` 的 `runtime.run_root`（本机 `~/.trivium/runs`）；含 `status.json`（schema `trivium.status.v1`：`phase` ∈ starting/running/parsing/archiving/success/failed/cancelled、`sides.<critic>` = {state, model, attempt, elapsed_s, cli}、`heartbeat_at`、`artifacts[]`、`exit_code`、`message`）、`worker.log`、`request.json`、`worker.pid`。
6. **CLI 契约**：13 个子命令全部支持 `--json`；退出码 0/1/2/64/65/69/70/73（仍在运行）/75/76（doctor 部分完成）。`review --start/--wait/--status/--cancel` 四件套返回 `run_id`/`bash_timeout_ms`/`review_loop` 等。`topic resolve -- '--<正文>' …` 之后按 argv 逐 token 解析（正文单引号包整段、内部单引号写 `'\''`）。
7. **wrapper**：`.trivium/bin/trivium` 为 sh 脚本，内嵌 node 绝对路径 exec 安装副本——GUI 进程安全调用入口（设计 §10.5），插件一律经它调 CLI，绝不自行解析 PATH。
8. **工具链**：node v25.2.1 / npm 11.7.0 / macOS darwin 27 arm64；本机探针四家 CLI 全部可用（claude 2.1.318、codex 0.166.0、agy 1.5.1、zcode 0.17.1）。
9. **`.gitignore` 现状**：`node_modules/` 与 `dist/` 为非锚定规则（任意层级生效）；`.vscode/*` 锚定在仓根（`extension/.vscode/` 不受影响）；需为 `extension/.vscode-test/` 增补。

## 二、总体架构

```
extension/（独立 npm 包，不进主仓构建链）
├── package.json / package-lock.json / tsconfig.json / esbuild.mjs / .vscodeignore / README.md（中文）
├── src/
│   ├── extension.ts            激活入口；命令/视图/配置注册；生命周期
│   ├── cli/
│   │   ├── triviumCli.ts       wrapper 定位与执行（spawn、超时、UTF-8、退出码捕获）
│   │   ├── exitCodes.ts        退出码 → 中文语义映射（纯展示层，非判定逻辑）
│   │   └── commands.ts         doctor / preflight / topicResolve / topicClaim / reviewStatus / reviewCancel / version 的类型化封装
│   ├── env/
│   │   ├── config.ts           .trivium/config.yaml + config.local.yaml 只读解析（yaml 库，支持锚点）
│   │   ├── health.ts           Agent 可用性模型（probe 段驱动）；未 init 判定
│   │   └── versionCheck.ts     N4：--version 与 schema 串对齐，失配降级只读
│   ├── launch/
│   │   ├── carriers.ts         载体描述表（agent→cliKey、skill 根候选、默认注入参数）——纯数据
│   │   ├── entryCommand.ts     入口命令组装：产物读取→前缀推导→旗标组装→正文转义（D1）
│   │   ├── prechain.ts         FR-3：resolve→claim→preflight 及错误面模型
│   │   └── terminalRelay.ts    FR-5：命名终端、复用、就绪延迟、sendText 三模式、重发、关闭降级
│   ├── monitor/
│   │   ├── stateWatch.ts       .trivium/state.json watcher → 主题锁/run 发现（M3 自动发现）
│   │   ├── runDiscovery.ts     run_root 扫描定位 <runId> 运行目录（不复制 repoId 推导）
│   │   ├── statusWatch.ts      status.json watcher → 渲染模型（幂等，N3）+ 终态 --status 复核
│   │   └── logTail.ts          worker.log 尾随（节流 + 尾部窗口）
│   ├── ui/
│   │   ├── cockpit.ts          驾驶舱 Webview 面板（装配条/输出窗口/输入框、postMessage 协议、模式 M1/M3）
│   │   ├── cockpitHtml.ts      Webview HTML/JS（原生无框架、CSP、全中文）
│   │   └── healthTree.ts       FR-1 树视图（Activity Bar「Trivium」容器）+ viewsWelcome 未 init 引导
│   └── util/
│       ├── shellQuote.ts       转抄规约转义（单引号包裹、'\'' 转义）——与入口 skill 同款规则
│       └── yamlLoad.ts         yaml 安全加载薄封装
├── test/
│   ├── unit/                   node --test 纯逻辑测试（不 import vscode）
│   ├── integration/            @vscode/test-electron 真实 extension host（mocha）
│   ├── fixtures/               stubTrivium.sh（假 CLI）、fakeTui.cjs（假交互 TUI）、miniRepo 夹具
│   └── scripts/runIntegration.mjs
└── .vscode/launch.json          F5 调试（Extension Development Host）
```

**两条集成面**（硬约束）：CLI 面 = 仅 `wrapper --json` + 退出码；文件面 = 仅只读 watcher（state.json / status.json / worker.log / skills 渲染产物 / config*.yaml）。**零复制编排器业务逻辑**：不 import 核心仓任何代码；不含 repoId 推导、票数判定、闸门状态机判定、命名防覆盖等核心逻辑；插件持有的仅是**契约事实**（退出码表、schema 版本串、skill 根路径、agent↔cliKey 对应）与**展示逻辑**。不直写 `.trivium/*.yaml`（配置只读；表单改动全部翻译成 CLI 旗标）。

**修改的既有文件（全部）**：
1. `.gitignore`：追加 `extension/.vscode-test/`（node_modules/dist 已有规则覆盖）；
2. `.trivium/config.yaml`：verify.test 增补 extension 检查（D6，见下；该文件已有用户未提交改动，增补以最小 diff 合入，不动用户已改的行）。

**不改动**：`src/**`、`skills-src/**`、`skills/**`、`test/**`、主仓 `package.json`/`tsconfig.json`/esbuild 配置、`doc/**`。

## 三、关键设计决策（逐条可审）

### D1 入口命令单源：从渲染产物推导，不硬编码第二份

- `carriers.ts` 只存**发现路径**：`{ agentId → { cliKey, skillRootCandidates: string[] } }`（如 glm → `['~/.zcode/skills', '<仓>/skills/dual-critic/entry/glm']`）。cliKey 与 skill 根是安装事实（注册表 `entrySkillRoot` 的镜像），非业务逻辑——插件无法 import 注册表，这是允许的最小事实集，计划如实声明。
- `entryCommand.ts` 推导链：① 按 Driver 在 skillRootCandidates 找 `<命令名>/SKILL.md`（命令名由入口映射 A→dual-run、B→dual-review-plan、C→dual-review-code、D→dual-review-bug——这四个映射是入口语义本身，非载体差异）；② 正文正则 `([$\/])dual-[a-z-]+` 取众数得前缀；③ 旗标语法从产品的 `argument-hint`（front-matter）或「参数：」行读取并展示于表单（高级区显示「可用旗标」提示，随 `npm run render` 演进）；④ 组装 `<prefix><命令> [旗标] -- '<正文>'`，正文按转抄规约转义（`util/shellQuote.ts`）。
- 兜底链：安装位缺失 → 仓内 `skills/` 渲染产物 → 两者皆无（用户未装 TriviumCode 但仓库已 init 的边缘场景）→ 驾驶舱提示「未找到入口产物」+ 命令条按 `/` 前缀给出（明确标注「猜测值」）。
- **防漂移单测**：`entryCommand.test.ts` 以仓内四家真实渲染产物为夹具断言推导结果（codex→`$`，claude/glm/gemini→`/`）；产物结构若变（render 演进），测试红——第二事实源不会静默滋生。

### D2 终端拉起：直启 entrypoint 为主，shell+命令兜底

- 主路径：`vscode.window.createTerminal({ name, shellPath: probe.cli[cliKey].entrypoint, cwd: workspaceRoot })`——探针实测的绝对路径（裁决 C1），不碰登录 Shell。
- 兜底路径（矩阵发现直启不可用的载体时，经配置 `trivium.launch.launchMode: auto|direct|shell` 切换）：默认 shell 终端 + `sendText(entrypoint)` 启动。
- 终端命名 `Trivium · <agent>`；用户显式给主题时 `Trivium · <agent> · <主题>`。复用规则：同名且未关闭 → 聚焦复用，不重复开（同主题复用，v2 §4.1）。

### D3 就绪探测：稳定 API + 可配置延迟，不用 proposed API

- `onDidWriteTerminalData` 仍是 proposed API（市场发布不可用），**不用**。就绪策略 = `trivium.launch.readyDelayMs`（缺省 3000ms，矩阵结论可按载体覆盖）延迟后注入 + 驾驶舱常驻「重新注入」按钮 + 失败回退可复制命令条（一键复制，v2 FR-5）。如实标注局限：这是尽力注入，不是保证注入——命令条兜底保证流程永不阻塞。
- sendText 三模式 `trivium.launch.sendMode: auto|execute|split|manual`：`execute`（`sendText(cmd, true)`）、`split`（`sendText(cmd, false)` 后补 `\r`）、`manual`（只粘贴不回车，用户手按）。`auto` 先 execute，30s 内 `state.json`/run 目录无任何变化则提示改用 split/manual（用户可一键重发）。长正文（>1KB）按 512 字节分段 `sendText`，段间 80ms（矩阵验证 TTY 吞吐）。

### D4 run 发现：state.json 主题锁 → run_root 扫描

- `stateWatch` 监听 `.trivium/state.json`（工作区）；变更时取 `gates` 中 state ≠ idle 的条目（含 running / review_done_awaiting_disposition / awaiting_approval），提取 `{topic, stage, run_id}`。
- `runDiscovery`：读 `runtime.run_root`（展开 `~`），对每个 run_id 在 `<run_root>/*/<run_id>/status.json` 做一层浅扫描定位——**不复制**核心的 repoId 推导（repoId 命名是核心内部约定，插件按 run_id 全桶查找，代价是一次 readdir）。
- M3 自动发现：无论 run 由谁发起（别处 CLI、Driver 会话），只要 state.json 出现主题锁即进看板（v2 §6.1 验收）。

### D5 N3 幂等渲染 + 终态复核

- `statusWatch` 对每次 status.json 事件：解析失败/字段缺失 → 丢弃该快照并保留上次渲染（不报错）；`heartbeat_at` 旧于 `heartbeat_stale_s`（config 读取，缺省 120s）→ 失联提示（含 `--wait` 失联收尾语义原文与 worker.log 绝对路径），不自行判死。
- watcher 报告终态（success/failed/cancelled）后，追加一次 `review --status <run_id> --json` 复核；两者不一致以 CLI 为准并标注「文件快照可能滞后」。
- 侧状态卡对未知 `sides.<c>.state` 字符串原样展示（未知态不报错）。

### D6 verify 命令面：extension check 接入 `.trivium/config.yaml` verify.test

- extension 包定义 `check` = `typecheck && compile && test:unit && test:integration`（真实 extension host）。
- `.trivium/config.yaml` 的 `verify.test` 追加：`npm install --prefix extension` 与 `npm run check --prefix extension` 两条（install 在 node_modules 就绪时秒回）。主仓既有命令不动，`npm run check`（typecheck+build+test）链路零改动。
- 理由：S10 出口须**机械证明**「extension check 绿 + 主仓 check 不破」；不接线则只剩人工口头保证。代价：verify 变慢（首次含 VS Code 测试运行时下载，缓存于 `extension/.vscode-test/`）。此为可否决决策，评审若认为不该动 config.yaml 请给出替代机械证明方案。
- 风险声明：extension `.vscode-test` 首次下载需网络；S10 前会先在 S5 手动跑通缓存。

### D7 测试底座

- 单测（node --test，无 vscode 依赖）：exitCodes 映射、shellQuote 转义（含正文带 `--xxx`、单引号、`$`、反引号、中文）、entryCommand 推导（四家真实产物夹具）、health 模型（probe 夹具）、statusRender 幂等（旧快照/坏 JSON/未知态）、runDiscovery（临时目录夹具）。
- 集成（@vscode/test-electron，真实 extension host，mocha）：
  - `stubTrivium.sh` 夹具：可编程假 CLI（按子命令回放 canned JSON + 指定退出码）——验证 prechain 错误面、cancel、版本对齐降级；
  - `miniRepo` 夹具：临时工作区 + 假 wrapper + 假 config/probe/state.json + 假 run 目录（status.json/worker.log）——验证健康面板、run 发现、watcher 推进、日志尾随；
  - `fakeTui.cjs` 夹具：stdin 回显的假交互 TUI——验证终端创建/复用/注入/续话/关闭降级（不依赖真四家 CLI，可自动化）；
  - **桩全流程 e2e（慢测，单独脚本可跳过）**：用本仓真实 `skills/dual-critic/scripts/trivium.cjs` 在夹具仓库 + `TRIVIUM_STUB_CRITIC=1` 起真 `review --start`，插件侧 watch 到 run 推进至终态并复核桩指纹 `cli_version: 'stub/0.0.0'`——零配额验证「插件旁观真编排器」全链（v2 §7 集成层）。
- vscode-tests 下载的 VS Code 缓存在 `extension/.vscode-test/`（gitignore）；集成测试不烧任何厂商配额。

### D8 注入矩阵（四家 × 实测方案）

自动化部分（CI 可跑）：fakeTui.cjs 驱动 × 维度 {直启/兜底、execute/split/长文分段、复用、关闭降级}。
真机部分（F5 手工矩阵，S5 期间在本机执行并记录结论进交付说明）：

| 维度 | claude | codex | gemini(agy) | glm(zcode) |
| :--- | :--- | :--- | :--- | :--- |
| 直启 entrypoint 进交互 TUI | 待测 | 待测 | 待测 | 待测 |
| 就绪延迟中位数（5 次） | 待测 | 待测 | 待测 | 待测 |
| sendText 模式（execute/split/manual） | 待测 | 待测 | 待测 | 待测 |
| 短正文注入成功 | 待测 | 待测 | 待测 | 待测 |
| 长正文（~2KB 中文+引号+$）完整性 | 待测 | 待测 | 待测 | 待测 |
| 续话中继第二段 | 待测 | 待测 | 待测 | 待测 |
| 关闭→降级 M3 监控不断 | 待测 | 待测 | 待测 | 待测 |
| 同主题复用不开新终端 | 待测 | 待测 | 待测 | 待测 |

- 真机注入探针用 `<prefix>dual-status`（只读、零配额、本地查询），不用 dual-run——把「注入通道验证」与「流水线真跑」解耦；dual-run 全链留给验收场景（可配 stub）。
- 长正文完整性验证：注入后比对 Driver 会话 S0.5 解析产物（终端可见）与表单原文；e2e 场景比对 `task.json` 的 goal 字段。

### D9 中文化与安全

- Webview、树视图、命令面板、所有通知全中文（N6）；代码注释全中文（对齐主仓惯例）。
- 不改用户全局配置（N2）：插件只读 `~/.claude|~/.codex|~/.gemini|~/.zcode` 下的产物文件；不写。工作区只写 VS Code 自己的 workspaceState/globalState。
- Webview CSP 严格（仅允许 vscode-webview 协议与 nonce 内联脚本）；不加载任何外网资源。
- probe/审查工件展示**不渲染指纹与凭据类字段**（auth.fingerprint、证件号等一律不进 UI）。

### D10 边界与降级

- N4 版本对齐：启动时 `--version`（如 1.3.5）与首个发现的 schema 串（`trivium.status.v1`/`trivium.config.v2`）核对；读不懂 → 驾驶舱顶部黄条「CLI 版本可能不兼容，已降级只读监控」，禁用点火按钮（监控/watcher 照常）。
- N5 最小实现：取第一个 workspace folder 为根；`state.json` 显示该主题已有 running 锁时，装配条对该主题置灰并提示（防同主题并发装配）。
- 未 init（无 `.trivium/`）：健康视图走 viewsWelcome 引导（链接部署手册 `doc/07_manuals/部署手册.md` 与「在终端对 TriviumCode 仓执行 init」说明）；驾驶舱点火按钮禁用。
- 插件不代发 `review --start`（M1 原则：阶段循环归 Driver 会话）；`--cancel` 与 `--status` 是例外（运维动作，v2 FR-4 明确）。

## 四、实施步骤（S5 编码顺序，每步可独立验证）

1. **脚手架**：extension/ 包骨架（package.json/tsconfig/esbuild/.vscodeignore/README/.vscode/launch.json）+ `npm install` + 空激活能被 F5 加载；`.gitignore` 增补。
2. **cli/ + env/**：triviumCli、exitCodes、commands、config 解析、health 模型、versionCheck；单测（exitCodes/shellQuote/health）。
3. **FR-1**：healthTree + viewsWelcome + 命令注册；集成测试（miniRepo 夹具）。
4. **launch/ 纯逻辑**：carriers、entryCommand（含防漂移单测）、prechain 状态机；单测 + stubTrivium 集成测试。
5. **FR-5**：terminalRelay（创建/复用/延迟注入/三模式/重发/关闭降级）+ 命令条兜底；fakeTui 集成测试。
6. **monitor/**：stateWatch、runDiscovery、statusWatch（幂等）、logTail、cancel 动作；miniRepo 集成测试。
7. **FR-2 + ui/cockpit**：装配表单 + 输出窗口 + 输入框 + postMessage 协议 + M1/M3 模式切换；把 3~6 全部接进面板。
8. **D6 接线**：`.trivium/config.yaml` verify.test 增补；主仓 `npm run check` 回归确认绿。
9. **桩 e2e**：TRIVIUM_STUB_CRITIC 慢测跑通；真机注入矩阵（D8 表）逐格执行并记录。
10. **收尾**：extension `npm run check` 全绿；`vsce package` 冒烟出 `.vsix`；交付说明（矩阵结论 + 已知局限）。

## 五、测试与验收对照

**verify 命令面（S10 实际执行）**：`.trivium/config.yaml` verify.build 不变（`npm run typecheck`、`npm run build`）；verify.test = 主仓 `npm test` + `npm install --prefix extension` + `npm run check --prefix extension`。四条全绿 = 出口通过；主仓 check 链零改动即「不破坏」的机械证明。

**验收标准（对齐 v2 §6.0/§6.1，逐条可勾选）**：

Phase 0：
- [ ] 装有 TriviumCode 的仓库打开 VS Code（F5 开发宿主即可），Activity Bar「Trivium」健康面板正确显示四家 Agent 可用性/版本/入口（来自 probe 段）；
- [ ] 未 init 仓库显示引导而非报错；
- [ ] `npm run check --prefix extension` 绿；主仓 `npm run check` 绿。

Phase 1（全程无手敲命令）：
- [ ] 装配表单选 Driver/审查者（探针驱动置灰、自动排除 Driver 同身份项）、入口、轮次、高级折叠生效；
- [ ] 点火后自动走前置链（resolve→claim→preflight 经 wrapper），错误面按退出码语义展示（64 含「正文吞旗标」提示、69 含探针过期指引、70 显示持锁 run）；
- [ ] 前置链通过后自动开命名终端、注入入口命令+提示语；注入失败时命令条一键复制可用；
- [ ] 看板（输出窗口）观察到阶段条、逐侧状态卡推进至终态，侧完成后可点开审查正文（artifacts 链接在编辑器打开）；
- [ ] 底部输入框续话中继到协同终端；
- [ ] 对已在别处运行的主题（M3）：手动在终端起一个 run（或用 stub 起），驾驶舱自动发现并监控；
- [ ] 中途关闭协同终端：驾驶舱降级 M3（提示），watcher 不中断；
- [ ] 「中止」按钮触发 `--cancel`，确认后 run 转 cancelled；
- [ ] 心跳失联场景（夹具伪造 stale heartbeat_at）显示失联提示 + worker.log 路径，不误判终态。

**已知局限（如实交付，不隐瞒）**：就绪探测是延迟+人工兜底而非事件驱动（D3）；注入矩阵真机结论以 S5 执行记录为准，个别载体可能只能落到 manual 模式；审查正文本批只做「打开文件」不做结构化展示（FR-6 属 P2）。

## 六、风险登记

| 风险 | 等级 | 应对 |
| :--- | :---: | :--- |
| 四家 TUI 直启/注入兼容性参差 | 高 | D2 兜底 shell 模式 + D3 三模式 + 命令条永不阻塞；矩阵先行探明，逐格记录 |
| 长正文经 TTY 注入被吞/截断 | 中 | 分段注入 + task.json goal 比对验证 + 命令条兜底 |
| `.vscode-test` 首次下载失败拖垮 verify | 中 | S5 先手动跑通缓存；D6 两条命令独立成条，失败可定位 |
| state.json 全局并发写导致读到半截 JSON | 中 | 解析失败即丢弃该次快照（N3 幂等），下一事件重读 |
| 产品结构随 render 演进 | 低 | 防漂移单测先红先知（D1），推导链有兜底 |
| 用户误以为插件会代跑全流程 | 低 | UI 文案明确「阶段循环由终端里的 Driver 会话驱动，插件旁观」 |
| 主仓 check 被误伤 | 低 | 不动主仓构建文件；第 8 步回归验证 |

## 七、交付物清单

新增：`extension/` 全目录（约 35 个文件，见 §二树）；`.reviews/` 本主题流水线工件。
修改：`.gitignore`（+1 行）、`.trivium/config.yaml`（verify.test +2 条）。
产物：`extension/dist/extension.js`（构建产物，不进 Git）、`trivium-cockpit-0.1.0.vsix`（冒烟打包，不入库）。

——以上为完整计划，请三侧审查。
