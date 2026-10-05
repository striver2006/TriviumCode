# 探针注释失实与回归格合成入口 · 实施报告（EV-23、EV-94 ①；EV-04 待拍板）

> - **日期**：2026-10-06
> - **主题**：`探针注释失实与回归格合成入口`（M11 前待办批次第 4 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`c81a504`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/probe-doc-and-entry-20261006/`
> - **配额**：零配额

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. **EV-04**（`readRunMeta` 把「文件不存在」与「存在但读不出」回落成同一个 `null`）：`meta.ts` :657 起，读文件或 `JSON.parse` 失败、schema 不识、校验不过一律 `return null`。用户可见的出口有 `gate.ts` :1542（审批停点，文案「文件缺失、内容损坏，或不合 run.v1/v2 契约」）、`cli.ts` :1108（`--run-id` 读不出，同样列三档成因）、`report.ts` :237（「读取失败」）等；这些出口属 EV-148 定下的「七处语义同源」——都以 `meta.ts` 的共用出口段 `UNREADABLE_RUN_META_EXIT_BODY` 收尾，由 `test/helpers/unreadable-exit.ts` 与 `APPROVAL_CHECK_META_UNREADABLE` 判别文字一族用例约束。**区分两者必然改这些报错文案**（以及共用出口段要不要按成因分叉）。
2. **EV-23**：`types.ts` `CodexProbe.model_catalog_path` 的文档块写「**消费方**：人读诊断与 `doctor` 报告」。实核：全仓读它的只有类型定义、`probes/codex.ts` :1086 的赋值与 `config.ts` :138 的默认值，**没有代码读者**；`doctor` 的人读报告（`renderDoctorReport`）不渲染它；它只随整段探针结论落进 `.trivium/config.local.yaml` 的 `probe:` 段，并出现在 `doctor --json` 的 `probe` 里（`cli.ts` `cmdDoctor`）。
3. **EV-94 ①**：`test/unit/preflight.test.ts`「回归：--no-model-calls 保留上一次探到的 zcode 结论」以 `probeZcode(null, …)` 起步；`probeZcodeEntry` 把 `null` 补成 `ENTRY_CANDIDATES`（`/Applications/ZCode.app/…` 与家目录下同名路径，`probes/zcode.ts` :67）。装了 ZCode.app 的机器上，这条单元用例会真实跑七次旗标候选与版本探针（零配额，P-30 前提有守卫）；CI 上入口不在则在 :1332 早退，**模型覆盖臂的「未判定 ⇒ 保留」根本走不到**——两台机器测的不是同一件事。另，它没注入 `cliConfigPath`，`cliConfigured` 取决于本机有没有 `~/.zcode/cli/config.json`，臂走不走同样随机器变。

### 修法

1. **EV-04：不做，登记候选等拍板**（属「改输出」）。BACKLOG 写明候选与建议。
2. **EV-23**：只改那段文档块的「消费方」为如实描述（无代码读者；只进 `config.local.yaml` 的 `probe:` 段与 `doctor --json`，`doctor` 人读报告不渲染）。字段、取值、落盘都不动——上文两个修法方向（改成逐 profile 的 map、移出 `models` 附近）都改 `doctor --json` / 落盘结构，属改契约，不在本题。
3. **EV-94 ①**：那条回归格改传**合成入口**（`scratchDir` 里的 `zcode.cjs`：`version` 子命令打版本号，其余调用一律往 stderr 写 `Unknown option '<首个旗标>'` 退 1——旗标臂七个候选全判拒绝、零配额）与**合成 `cliConfigPath`**（存在的空 JSON 文件，让门控确定地进臂、由桩接住）。新增断言 `probe.entrypoint` 等于合成入口、桩确实被调到——证明没落到真实候选、臂确实走到了。

### 不改的边界

- 产品代码零改动（EV-23 只改注释）；不给 `probeZcode` 加 `entryCandidates` 注入口（用例传合成入口即不会落到候选表，加口子是多一个只为测试存在的参数）。
- 那条用例里 `probeZcodeModels`、`probeTraceSource` 仍按真实家目录只读取数（不写、不拉起），它们只影响 `models` 与 notes，用例不断言这两项；本题只隔开会**拉起进程**的入口与旗标臂。

## 1. 改了什么

1. `src/trivium/types.ts`：`CodexProbe.model_catalog_path` 文档块的「消费方」改为如实描述（见 §0 现状 2），注明是 EV-23 订正。纯注释。
2. `test/unit/preflight.test.ts`「回归：--no-model-calls 保留上一次探到的 zcode 结论」：在 `scratchDir` 里写合成入口 `zcode.cjs` 与空的 `cli-config.json`，`probeZcode` 改传合成入口与 `cliConfigPath`；两个探针桩计数被调次数；新增三条断言（入口是合成入口、版本 `0.16.9` 取自它、两个臂都走到），原有三条断言不动。
3. 文档：主设计 v1.3.98；BACKLOG EV-23、EV-94 结案，EV-04 写候选与建议、保持待定；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| `preflight` 单跑（先 `build.mjs --with-tests`） | 57/57（改的是既有格，数不变）；那一格 441 ms | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`） | M1（用例退回 null 入口）红 1、耗时 58 s——即改前那格在本机真实跑旗标候选；M2（`probeZcode` 不认调用方入口）红 1 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 2/2 咬住 | `mutation-output.txt`、`mutation-spec.json` |
| 全量第 1 次 `npm run check` | 2845 / 2843 / 0 / 2，退 0（与起点同数：改的是既有格） | `check-1.txt` |
| 全量第 2 次（串行） | 2845 / 2843 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 0、全量 2 期间 2（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：EV-23 的新文档块只陈述核实过的三处去向；EV-04 的候选里「七处语义同源」「共用出口段」都取自现有代码与 EV-148 的用例助手，没有新造约束。起草本报告 §0 时曾写「这些文案被既有用例逐字钉住」，核对 `unreadable-exit.ts` 后订正为「受共用出口段与判别文字约束」。
- 断言范围：只在那一格**加**断言；没有放宽原断言。
- 护栏：合成入口建在 `scratchDir` 下；全程不拉起真实 ZCode（改后那格 441 ms，旗标臂七次都打在合成入口上）。
