# claude 探针两臂同源 · 实施报告（EV-46、EV-47）

> - **日期**：2026-10-06
> - **主题**：`claude探针两臂同源`（M11 前待办第二批第 7 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`688337f`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/claude-probe-arm-parity-20261006/`
> - **配额**：C 组，可花 claude 配额，上限每家 6 次真实调用（用户本批授权）

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. **EV-46**（`src/trivium/probes/claude.ts`）：EV-44 记忆探测的受限臂走 `execProbe(bin, memFx, askMemory)`（内部 `probeArgs({ prompt })`）；对照臂（:1522 起）是在调用点手拼的 argv——`[...projectMemoryControlArgs(READONLY_INVARIANTS), '-p', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', …, '--model', …, askMemory]`，**机制旗标是手抄了一遍 `probeArgs` 的配方、顺序还不同**（`probeArgs` 是 `-p` 在前、只读旗标在中）。`projectMemoryControlArgs` 只返回只读旗标那一段。准入脚本 `scripts/claude-admission-control.mjs` :591 还有第三份：`readonlyArgs.filter((f) => f !== '--restricted')` 字面过滤。「两臂逐字相同、只差一条旗标」这个单变量前提没有用例守着（现存用例只断言过滤函数本身）。
2. **EV-47 ①**：`probeClaudePathDeny` 的逐文件第三臂（:880 起）自建规则 `<Tool>(./<file>)`（只有精确一条）；生产 `adapters/claude.ts` `buildDenySettings`（:340）对每条路径同时下精确与子树两条（`<Tool>(<p>)` 与 `<Tool>(<p>/**)`），相对路径前缀取自 `denyRuleShapeOf(rule_syntax)`。于是 `file_shape_verified`（适配器 `peer_deny_applied` 读的就是它）长期只验生产注入集的真子集。本文件已从 `adapters/claude.js` 导入 `readSchemaJson`，反向导入适配层是既定方向。
3. **EV-47 ②**：`denied_tool_in_trace` 的配对判据（:1304 起，按 `tool_use_id` 把白名单外调用与错误结果配对，三分：无可配对 id ⇒ null、配上 ⇒ true、配不上 ⇒ false）内联在 `probeClaude` 里、没有导出；准入脚本 :511 是另一份内联判据，且问的不是同一个问题（「发起过白名单外调用」）。
4. 触发条件：EV-46 写「下一次改 `probeArgs` 签名时」、EV-47 写「本轮 CODEX-02 的路径形状校验落地之后」——用户把两条明确排进本批 C 组，按排序快照「值得修」第 16 序执行；本题不命中其它等触发条目。

### 修法

1. `probeArgs` 加可选入参 `readonlyFlags`（缺省 `READONLY_INVARIANTS`）；新增导出 `projectMemoryArmArgs(prompt)` 返回 `{ restricted, control }` 两条完整 argv（都经 `probeArgs` 构造，对照臂传 `projectMemoryControlArgs(READONLY_INVARIANTS)`）；两臂调用点都改用它的输出、经同一个执行封装跑。补用例：对照臂 argv ≡ 受限臂 argv 去掉 `--restricted`（逐元素、同序）。
2. 第三臂的 `--settings` 改由新增导出 `fileShapeDenySettings(peerRelPath, readRule)` 给出：`buildDenySettings([peerRelPath], READONLY_TOOLS, denyRuleShapeOf(readRule)).json`——与生产注入逐字同源（精确 + 子树两条）。
3. 配对判据抽成导出纯函数 `judgeDeniedToolInTrace({ toolUses, erroredToolUseIds, allowedTools })`，探针改调它；准入脚本两处（对照臂过滤、`denied_tool_in_trace`）改调探针导出的函数，删掉内联副本与「如实记」的例外注释。
4. 真实 CLI 验证（花 claude 配额，≤ 6 次）：经探针导出的同一组构造函数，跑记忆两臂与第三臂各一次，核对结论与改前一致。

### 不改的边界

- 各判据（`judgeProjectMemoryBlocked`、`judgeFileShape`、配对三分）的语义与落盘字段不动；doctor 输出不动。
- 主臂（目录 glob）与 Grep 臂的规则形态不动；`READONLY_TOOLS`、预算与超时常量不动。
- 准入脚本只改判据来源，不改它的夹具、双臂结构与输出字段。

## 1. 改了什么

1. `src/trivium/probes/claude.ts`：`probeArgs` 加 `readonlyFlags`；新增导出 `projectMemoryArmArgs`、`fileShapeDenySettings`、`judgeDeniedToolInTrace`；`execProbe` 的执行与解析拆成内部 `execArgv`（收现成 argv），记忆探测两臂都经它跑；第三臂改用 `fileShapeDenySettings`（拼不出规则时不调用、本格 null）；只读负对照的配对判据改调 `judgeDeniedToolInTrace`；从 `adapters/claude.js` 多导入 `buildDenySettings`、`denyRuleShapeOf`（探针反向导入适配层是既定方向，`adapters/` 不导入 `probes/` 的契约不受影响）。
2. `scripts/claude-admission-control.mjs`：对照臂改调 `mod.probe.projectMemoryControlArgs`，`denied_tool_in_trace` 改调 `mod.probe.judgeDeniedToolInTrace`；文件头「一处例外」说明改为「例外已取消」。`node --check` 通过；本题未跑该脚本（它要跑全套准入、花配额远超本题上限）。
3. 用例：`test/unit/claude-events.test.ts` 新增 3 格（两臂单变量、第三臂规则与生产同源、配对三分），改 1 格（源序护栏的锚点随结构改：旋钮只在 `projectMemoryArmArgs` 里拨一处、探测臂取它的输出经 `execArgv` 跑）；新文件 `test/integration/claude-probe-arm-parity.test.ts` 2 格（假 claude 端到端，录下 `probeClaude` 每次调用的 argv）。
4. 文档：主设计 v1.3.110（3.7 表 `path_deny` 一格补一句、版本行）；BACKLOG EV-46、EV-47 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 三份套件单跑（先 `build.mjs --with-tests`） | 55/55（起点 50，新增 5 格） | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`） | 6/6 红：M1（`probeArgs` 忽略覆盖）红单变量格，亦红端到端；M2（对照臂拿错 argv）、M3（退回调用点手拼，改前形态）红端到端；M4（第三臂退回 exact-only，改前形态）红同源格，亦红端到端；M5（调用点不用同源函数）红端到端；M6（配对不排除 null id）红三分格 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 6/6 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 真实 claude（2.1.288，3 次调用，上限 6） | 两臂 argv 单变量；受限臂跑完、零工具调用、未见哨兵；对照臂跑完、零工具调用、见到哨兵 ⇒ `project_memory_blocked: true`；第三臂 6 条规则（3 工具 × 精确 / 子树），模型发起 Read、记入 1 条 permission_denials、哨兵未泄漏 ⇒ `file_shape_verified: true`。与本机 2026-10-05 探针落盘（同版本）结论一致 | `real-cli-arms.mjs`、`real-cli-arms.out.json`、`real-cli-version.txt` |
| 全量第 1 次 `npm run check` | 2882 / 2880 / 0 / 2，退 0（起点 2877 + 5） | `check-1.txt` |
| 全量第 2 次（串行） | 2882 / 2880 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 1（`trivium-index-`）、全量 2 与自检期间 0；真实 CLI 脚本自建的两个 `trivium-realcli-*` 已由脚本自己删掉（核过残留 0）；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：被删掉的内联判据的说明（「三分」、「初版的 some(...) 在 id 全为 null 时返回 false」）挪进了 `judgeDeniedToolInTrace` 的文档块与调用点的一句指引，没有丢；准入脚本注释写明「此前准入报告该格的读数按旧判据得出，与新版不可直接比较」，没有把历史读数说成同口径。
- 断言范围：唯一改动的既有断言是源序护栏——锚点从「调用点出现 `projectMemoryControlArgs(READONLY_INVARIANTS)`」改为「这串只出现一处（在 `projectMemoryArmArgs` 里）+ 调用点取 `projectMemoryArmArgs` 的输出、两臂都经 `execArgv`」，守的仍是「旋钮拨了、只拨一处」，没有放宽（M2 / M3 两种退化都会红端到端格）。
- 行为面：第三臂规则从 3 条变 6 条，这是本题要的同源；真实 CLI 结论不变。新增一种「拼不出规则即不调用、本格落 null」的分支（注释写明了处置）；今天夹具路径是固定的 ASCII 路径、主臂规则恒合形，这一支走不到，无用例。
- 护栏：没有新增登记调用点；新用例临时目录走 `scratchDir`；真实 CLI 只调 claude 3 次，均在本批授权上限内；真实 CLI 自己写的会话日志之外没有写家目录。
- 触发条件：EV-46 / EV-47 自带的触发条件由用户把它们排进本批而解除；本题没碰 `probes/claude.ts` 的工具面或结构化臂边界，未命中 EV-75 ①；**EV-78 的触发写的是「claude 正式当审查员，或下次改 `probes/claude.ts`」，本题确实改了 `probes/claude.ts`，按字面算命中**（它要加一条 Grep 输出格式探针臂，与本题无交集），未顺手做，汇总时请用户定。
