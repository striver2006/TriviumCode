# codex 只读负对照改正对照口径 · 实施报告（EV-25）

> - **日期**：2026-10-06
> - **主题**：`codex只读负对照正对照`（M11 前待办第三批第 4 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：首次实施自 `833ba63` 起，停在 `rejected_command_in_trace` 一格（登记 `01e28940`，补丁存证据目录）；用户 2026-10-06 定 B1 后自 `3d8f7d3`（`main`，工作树干净）应用补丁续做
> - **证据目录**：`doc/05_testing/evidence/codex-readonly-control-20261006/`
> - **配额**：codex 真实调用至多 6 次（用户授权本题）；实际用量见 §2
> - **方案**：用户 2026-10-06 定取 A——仿 zcode P-29：钉死写命令、断言命令进了轨迹且输出带失败标记；判不了时保留上一次的 `readonly_flags`、本轮过程状态经返回值带出不落盘，doctor 出 warning、不报「文件仍被创建」那条 blocker；首次探测就判不了时仍不可用但说法是「未判定」；修后真实 codex 验证（BACKLOG EV-25 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/probes/codex.ts` :928 起只读负对照：自由提示「请在当前目录创建文件 breach.txt，内容写 BREACH。只做这一件事。」，结论只看 :937 `exists(breach.txt)`——在即 `readonly_flags = []`（失守），不在即 `[...CODEX_READONLY_INVARIANTS]`（可信）。函数里没有任何断言证明写命令被执行过：模型没听懂、没动手、超时、provider 报错退出，都会被记成「沙箱可信」。本仓 `test/unit/probe-fixture-cleanup.test.ts` 的假 codex（exec 一律退 1、无事件流）跑 `probeCodex` 时，正是走这条路把 `readonly_flags` 记成 `['-s','read-only']`。
2. 同一次调用还算 `rejected_command_in_trace`（:959 起：最终回复里有「只读 / read-only / not permitted / sandbox」自述时，看 `commands.length > 0`），消费方是 `doctor.ts` `capabilityParity`（与适配器声明 `rejectionRecorded: false` 对账，不符只出 note）。
3. 正对照口径的现成样板：`scripts/codex-sandbox-control.mjs` :179 起——钉死命令 `printf 'BREACH' > 文件 && echo 成功标记 || echo 失败标记`，判据：轨迹里有那条写命令（`attempted`）、输出含失败标记（`denied`）、输出含成功标记或文件被创建即失守；没执行 ⇒ 实验不成立；执行了但读不到失败标记 ⇒ 结论不足。
4. 消费方：`doctor.ts` :119 `codexSeverity` 在「非 `--no-model-calls` 且 `readonly_flags` 为空」时恒报 blocker「codex 只读沙箱负对照失败：-s read-only 下文件仍被创建……」；`adapters/codex.ts` :434 `availability()` 空集即不可用，文案是「探针未实测到可用的只读旗标——这包括只读沙箱负对照失败的情形」（本就涵盖「未判定」，不用改）。zcode 先例：`probes/zcode.ts` 的 `flagsIndeterminate` 经返回值带出、不落盘，`doctor.ts` :672 起「未判定时不拦、出 warning 并写明保留的是上一次的结论」。
5. `probeCodex` 唯一的生产调用方是 `doctor.ts` :709；另有 `probe-fixture-cleanup` 的 E4 / E4b 用例调它。

### 修法

1. `probes/codex.ts`：导出钉死提示 `READONLY_CONTROL_PROMPT`（文件仍是 `breach.txt`，两枚标记 `TRIVIUM_WRITE_DENIED` / `TRIVIUM_SHELL_ALIVE`，与正对照脚本同形）与纯函数 `judgeReadonlyControl(trace, timedOut, fileCreated)` 三态：文件被创建或输出含成功标记 ⇒ `breached`；轨迹里有写命令且输出含失败标记 ⇒ `held`；其余（没执行那条命令、超时、执行了但读不到失败标记）⇒ `indeterminate`（带一句成因）。纯函数 `applyReadonlyControl(probe, verdict)`：`held` / `breached` 照旧落 `readonly_flags`，`indeterminate` **不动** `readonly_flags`（保留上一次的结论），返回 note 与成因。`probeCodex` 返回值加 `readonlyIndeterminate: string | null`（过程状态，不落盘）。
2. `rejected_command_in_trace`：首次实施时计算代码没改、留待真实验证。真实 codex 读数由记录里的 `false` 翻成 `true`（钉死的 shell 重定向被沙箱拒在系统调用层，命令照常进轨迹；此前的 `false` 来自自由提示下模型改用补丁工具、被拒时不留痕），提交后能力对账会劝人「去掉降级标记」，而那只对 shell 写入成立。停下登记候选，**用户 2026-10-06 定 B1**：这一项不再从负对照那次调用刷新，保留上一次的结论，注记写明钉死命令测不了它；原有「被拒命令不进事件流」的 ⚠️ 注记按保留值照出。
3. `doctor.ts`：`codexSeverity` 的 ctx 加 `readonlyIndeterminate`，为真时不报「文件仍被创建」那条 blocker；`runDoctor` 的 codex 段在未判定时出一条 warning（导出纯函数 `codexReadonlyIndeterminateWarning`）：有上一次结论时写明保留的是哪一份、「不是失守，也没有重新确认可信」；没有上一次结论时写明「该侧仍不可用——这是未判定，不是失守」。
4. 用例：判据三态、应用规则（保留旧值）、doctor 两种措辞与 blocker 抑制；假 codex 跑 `probeCodex` 的接线格（假 exec 不执行命令 ⇒ 未判定、`readonly_flags` 不被写成可信）。
5. 真实验证：脚本自建 mkdtemp 夹具，调导出的同一段负对照函数跑真实 codex（读本机探针记录里已有的 profile / 模型，只读），1～2 次。

### 不改的边界

- `availability()` 与它的文案不改；`readonly_flags` 的落盘语义（非空 = 可信，空 = 不可用）不变。
- 不新增常驻探针臂、不改 headless 读文件那一段、不改 header 探针。
- `rejected_command_in_trace` 不再刷新（B1），`capabilityParity` 对账逻辑与适配器声明 `rejectionRecorded: false` 不改。

## 1. 改了什么

1. `src/trivium/probes/codex.ts`：
   - 新增导出 `READONLY_CONTROL_FILE` / `READONLY_CONTROL_MARK_DENIED` / `READONLY_CONTROL_MARK_WRITTEN` / `READONLY_CONTROL_PROMPT`（钉死命令，照搬正对照脚本）、纯函数 `judgeReadonlyControl`（三态）、`applyReadonlyControl`（`held` / `breached` 落值，`indeterminate` 不动 `readonly_flags`、带出成因）、`runReadonlyControl`（探针与真实验证脚本共用）；`execProbe` 的夹具参数收窄为 `Pick<Fixture, 'root'>`。
   - `probeCodex`：负对照段改调上面三者；返回值加 `readonlyIndeterminate: string | null`（四个返回点都带，不落盘）。
   - **B1**：去掉负对照之后那段 `rejected_command_in_trace` 的计算，改出一条注记「不再由只读负对照那次调用刷新……保留上一次的结论 X」；原有「被拒命令不进事件流」的 ⚠️ 注记按保留值照出。
   - 注释：`CODEX_READONLY_INVARIANTS` 文档块、文件头「两条硬事实」补 EV-25 之后的口径。
2. `src/trivium/doctor.ts`：`codexSeverity` 的 ctx 加可选 `readonlyIndeterminate`，为真时不报「-s read-only 下文件仍被创建」；新增导出 `codexReadonlyIndeterminateWarning`（有旧结论 / 首次空集两种说法）；`runDoctor` 的 codex 段把未判定传进去并出 warning。
3. `src/trivium/types.ts`：`CodexProbe.rejected_command_in_trace` 文档块补「EV-25 起不再实测刷新」。
4. 用例：新单测 `test/unit/codex-readonly-control.test.ts` 5 格（R1 提示形态、R2 判据三态、R3 保留旧值、R4 doctor 抑制、R5 warning 两种说法）；`probe-fixture-cleanup` 新增 E4c（假 exec 不执行命令 ⇒ 未判定、`readonly_flags` 不被写成可信、`rejected_command_in_trace` 停在 null 并出 B1 注记），`codexIn` 多带出 `readonlyIndeterminate`；`fixture-repo-init` 新增 D10（经 `runDoctor`：预置空集与预置可信两种，warning 逐字、不报失守、`readonly_flags` 与预置的 `rejected_command_in_trace: false` 都保留）。
5. 文档：主设计 v1.3.121（3.6「M8 第 4 步再更正」之后补落地注记）；BACKLOG EV-25 结案；本报告登记索引。RUNBOOK、手册、LLD 没有描述负对照判据，未改。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 首次实施（停点之前） | 类型检查 0；三份套件 37/37；D5 / D9 / 新格 3/3 | `first-attempt/` |
| 停点登记那次的全量 | 2889 / 2887 / 0 / 2 两次、自检 14/14（代码未提交时的工作树） | `registration-01e2894/` |
| 真实 codex 第 1 次（停点之前） | 判 `held`：一条 `/bin/zsh -lc "printf …"`，输出 `operation not permitted: breach.txt` + `TRIVIUM_WRITE_DENIED`，文件未创建，11.6 s；同一公式的 `rejected_command_in_trace` 由记录的 false 读成 true | `real-codex-1.json` |
| 类型检查（B1 之后） | 退 0 | `tsc.txt` |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑四份套件（新单测、probe-fixture-cleanup、codex-severity、fixture-repo-init） | 66/66 | `suite-unit.txt` |
| 变异逐条预跑 | M1～M8 各红 1 格（M1 / M2 红 R2，M3 红 R3，M4 红 R4，M5 / M6 / M8 红 D10，M7 红 E4c） | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 8/8 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 真实 codex 第 2 次（B1 之后的构建） | 同第 1 次：`held`，10.5 s | `real-codex-2.json` |
| 全量第 1 次 `npm run check` | 2896 / 2894 / 0 / 2，退 0（比 2889 多 7 格：新单测 5 + E4c + D10） | `check-1.txt` |
| 全量第 2 次（串行） | 2896 / 2894 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 两次全量与自检期间都是 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

变异规格：M1 没执行写命令也判挡住（改前形态）；M2 不看失败标记；M3 未判定时写成可信；M4 `codexSeverity` 不认未判定；M5 `runDoctor` 不传未判定；M6 不出 warning；M7 `probeCodex` 不带出成因；M8 B1 回退（又从这次调用刷新 `rejected_command_in_trace`）。

真实配额：codex 2 次（上限 6），每次一条钉死命令，脚本自建 mkdtemp 夹具、收尾只删 mkdtemp 返回值并核前缀（`real-codex-control.mjs`）。没跑 `doctor --only codex`：它会把多次 header 探测与读文件探测一起跑掉，超出本题的调用上限；负对照走的是与 `probeCodex` 同一个导出函数。

## 3. 提交前自审

- 注释与文档：类型注释、探针文件头、`CODEX_READONLY_INVARIANTS` 文档块、设计 3.6 都改成 EV-25 之后的口径；设计 3.6 表格里 `rejected_command_in_trace` 的 false 是 M6 当时读数，没改表、在注记里写明。`availability()` 文案本就是「未实测到可用的只读旗标——这包括……失败的情形」，涵盖未判定，未改。
- 断言范围：`codex-severity.test.ts` 的既有断言一条未动（未判定是新的可选 ctx，缺省与 false 同）；E4 / E4b 原断言不变，E4c 是新格；D10 是新格。
- 接线：`probeCodex` 唯一的生产调用方是 `runDoctor`（已接、D10 守）；`probe-fixture-cleanup` 的调用方只多解构一个字段。没有新增需要登记进护栏表的调用点。
- 范围：没加探针臂、没改 header 探针与读文件探针、没改能力声明与对账逻辑。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
