# codex 只读负对照改正对照口径 · 实施报告（EV-25）

> - **日期**：2026-10-06
> - **主题**：`codex只读负对照正对照`（M11 前待办第三批第 4 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`833ba63`（`main`，工作树干净）
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
2. `rejected_command_in_trace` 的计算代码不改（仍取同一次调用）。提示换成钉死命令后它的读数可能变化——真实验证时如实记录；若翻转，报给用户定（不在本题自行改判）。
3. `doctor.ts`：`codexSeverity` 的 ctx 加 `readonlyIndeterminate`，为真时不报「文件仍被创建」那条 blocker；`runDoctor` 的 codex 段在未判定时出一条 warning（导出纯函数 `codexReadonlyIndeterminateWarning`）：有上一次结论时写明保留的是哪一份、「不是失守，也没有重新确认可信」；没有上一次结论时写明「该侧仍不可用——这是未判定，不是失守」。
4. 用例：判据三态、应用规则（保留旧值）、doctor 两种措辞与 blocker 抑制；假 codex 跑 `probeCodex` 的接线格（假 exec 不执行命令 ⇒ 未判定、`readonly_flags` 不被写成可信）。
5. 真实验证：脚本自建 mkdtemp 夹具，调导出的同一段负对照函数跑真实 codex（读本机探针记录里已有的 profile / 模型，只读），1～2 次。

### 不改的边界

- `availability()` 与它的文案不改；`readonly_flags` 的落盘语义（非空 = 可信，空 = 不可用）不变。
- 不新增常驻探针臂、不改 headless 读文件那一段、不改 header 探针。
- `rejected_command_in_trace` 的判据与对账不改（见修法 2）。
