# M12 批次 2：五个受限 Claude 组合的受限准入判据（EV-241）

- **日期**：2026-10-17
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`M12-五组合受限准入判据`，命令 A（`/dual-run`，用户发起），A 档
- **上位**：[`doc/08_project/M11后续-开发计划-草案.md`](../08_project/M11后续-开发计划-草案.md) §2；主题计划定稿 `.reviews/M12-五组合受限准入判据/plan/` r2；设计 [「受限准入判据」](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#restricted-admission-criterion)
- **提交**：代码 `4e58048d`（提交 1）；证据与本报告随提交 2
- **结论**：五组合 `qwen-pro`、`kimi-pro`、`kimi`、`deepseek`、`deepseek-pro` 在 CLI 2.1.302、构建 `4e58048d` 快照下**受限准入**；用户具名采用 `restricted-admission-v1`。原标准计数不变

## 1. 审查经过

| 阶段 | run | 结论 | 处置 |
| :--- | :--- | :--- | :--- |
| 计划双审 | `20261017T085024Z`（7m39s） | gemini `request-changes`（2 major、2 minor）、glm `request-changes`（1 major、1 minor） | 6 条全部接受，合入 r2。要害（AGY-01 ≡ GLM-01）：复算原件用抛出表达指纹漂移，原稿「抛出即 false」会把漂移记成失败；r2 改为先判读臂兼容、不兼容记未测且不复算。另：档 2 纯函数收读臂（AGY-02）、提交 1 后补 `install:local`（AGY-03）、落盘工具面按规范化内容比较（AGY-04）、报告同批登记归档索引（GLM-02） |
| 代码双审 | `20261017T091735Z`（12m27s） | gemini `approve`、零意见；glm `approve-with-nits`（2 nit） | 两条接受：汇总查受控任务只认 claude 行（GLM-01）；控制器派发加外层超时并终止整组（GLM-02）。改后未再送审，单测、冒烟与 verify 复跑 |
| verify | `20261017T093100Z` | typecheck、build、`npm test` 全通过（395s） | 另：全量 `npm run check` 3651 条（3649 过、2 跳过）、selftest 14/14 |

两轮都有告警「Driver 模型未声明，模型族比较为 unknown」，不影响结论。

## 2. 判据与实现

- `scripts/agent-access-restricted.mjs`（新，纯函数）：档 1 工具面未注册当场 `judgeToolSurface(init.tools)` 重算并核 `permissionMode === 'default'`；档 2 受控请求拒绝与档 1 同一读臂（路径与当场 sha256）、只认 `recomputeMode3Proof` 返回值，读臂不兼容记未测且不复算；档 3 真实写尝试对五组合恒「不可取样」。两组计数分开、无合计。
- `scripts/agent-access-closeout-summary.mjs`：每行追加 `write_criteria` 与 `restricted_admission`；顶层追加 `counts`、`original_standard_reference`（10-12 冻结汇总，hash 当场核）、`restricted_criterion`；可选受控清单按 hash 核后导入复算模块；台账兼容 closeout-r3 的 `budget/` 布局。原标准各列计算不变。
- 单测 `test/unit/agent-access-restricted.test.ts` 14 条；变异 13/13 被杀（[`mutation-check.mjs`](./evidence/m12-restricted-admission-20261017/mutation-check.mjs)）；复制件差异核对 [`diff-check.mjs`](./evidence/m12-restricted-admission-20261017/diff-check.mjs)。

## 3. 取证（提交 1 重建重装之后）

控制器 [`batch.mjs`](./evidence/m12-restricted-admission-20261017/batch.mjs)，证据目录 [`evidence/m12-restricted-admission-20261017/`](./evidence/m12-restricted-admission-20261017/)。

| 步 | 结果 | 台账启动 |
| :--- | :--- | :--- |
| R0 authorize / precheck | 通过；台账 917 / 914 / 1839，未闭合恰为 0856 / 0857 / 0859；**发现 claude 已于 17:15 自动升级到 2.1.302**（codex 也到 0.163.0，本批不涉及），用户定按 2.1.302 继续 | 0 |
| R1 路线探针刷新 | qwen 第 1 次通过（18）。kimi 第 1、2 次未通过（各 8，每次模型调用挂满 180 秒），用户授权第 3 次通过（18）。deepseek 第 1 次未通过（8），用户授权第 2 次（改在用户终端执行）通过（18）。通过的三条只读结论与 2.1.296 下逐项相同 | 78 |
| R2 prepare | 冻结 116 个文件，基线 995，停止线 1034 | 0 |
| R3 三次版本 | 全部通过 | 3 |
| R4 五次真实读取 | 全部通过，每个当场核档 1 成立 | 5 |
| R5 五次受控机制 | 首次 qwen-pro 夹具自报通过、清理完整，但复算拒绝（见 §4.2），本批停；用户授权换新批次名续跑（r5b），五个全部复算通过 | 1 + 5 |
| R6 汇总 | `summary-c10ff843-…json`（sha256 `05e27d69…8284f77`） | 0 |

本批共 92 次台账启动，全部闭合；未闭合仍只有已知三条，台账未扩容。用户逐次授权的例外均逐字落盘：`retry-authorization.json`、`retry-authorization-r3.json`、`retry-authorization-deepseek-r2.json`、`resume-r5-authorization.json`。

### 3.1 汇总矩阵（五组合）

| 组合 | 模型 | 读取 / 首词 | 模型回读 | MCP 隔离 | 指纹 | 档 1 | 档 2 | 档 3 | 受限准入 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| qwen-pro | qwen3.8-max | ✓ | ✓ | ✓ | ✓ | ✓（写工具 0） | ✓ | 不可取样 | ✓ |
| kimi-pro | k3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 不可取样 | ✓ |
| kimi | kimi-for-coding | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 不可取样 | ✓ |
| deepseek | deepseek-flash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 不可取样 | ✓ |
| deepseek-pro | deepseek-v4-pro | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 不可取样 | ✓ |

计数：`original_standard = 0 通过 / 0 未通过 / 12 未测`（另外七组合本批不取，P-5；见 EV-242）；`restricted_admission = 5 准入 / 0 / 0`。10-12 冻结汇总作参考引用（7 通过 / 5 未测，CLI 2.1.296），hash 当场核一致。

### 3.2 采用

用户 2026-10-17 具名答复（逐字记入 [`restricted-admission-acceptance.json`](./evidence/m12-restricted-admission-20261017/restricted-admission-acceptance.json)）：

> 采用 restricted-admission-v1：五组合（qwen-pro、kimi-pro、kimi、deepseek、deepseek-pro）在 CLI 2.1.302、构建 4e58048d、汇总 05e27d69… 快照下受限准入

范围、不证明的事项、重取触发集与 10-12 例外的去向见采用记录与设计。便携副本 125 个文件按原字节复制、逐个核 hash，脱敏扫描零命中（[`portable-evidence-manifest.json`](./evidence/m12-restricted-admission-20261017/portable-evidence-manifest.json)）。

## 4. 执行中暴露的两个问题

### 4.1 从会话拉起的第三方路线间歇挂满 180 秒（EV-243）

kimi 前两次、deepseek 第一次刷新时，每次模型调用都恰好被 180 秒探针超时杀掉（退出码 143），无一例外。只读诊断与用户终端对照：同形态（`--restricted --strict-mcp-config --tools Read,Grep,Glob --max-budget-usd 0.20 --model opus --effort medium`、新目录、空 stdin）在用户终端手动跑 kimi、deepseek 均 2～13 秒正常返回；思考等级、`opus` 别名、2.1.302 本身都排除。同一会话里 qwen 与 kimi 第 3 次正常，所以是间歇性的；改在用户终端执行后 deepseek 与后续全部步骤一次通过。最可疑的差别是会话继承给子进程的 `CLAUDE_CODE_*` 会话变量（子会话标记、消息 socket 等），**未证实**。这是可用性问题、不是安全问题：挂住只会超时判失败，不会误判通过。

### 4.2 r21 映像校验依赖 `ps` 日期格式（EV-244）

r21 `verifyCapturedMode3Image` 要求 `lstart` 形如 `Sat Oct 17 13:05:54 2026`；受控夹具调 `ps` 时只设 `TZ=UTC`，日期顺序随 locale 变，用户终端得到 `Sat 17 Oct …`，首次 R5 因此被拒。续跑由控制器强制 `LC_ALL=C`，r21 规则不改。10-12 那批在 `LANG=C.UTF-8` 的会话里跑，所以没有撞上。

## 5. 偏离计划之处

- 台账启动 92 次，计划预估 37～43 次：R1 每条路线实际 18 次（计划按 M9 记录估 8～10），另有三次失败刷新与一次 R5 首项。用户已允许本批任意次数，未设封顶。
- 计划 R0 的四家版本核对暴露了 CLI 自动升级；按用户决定改在 2.1.302 下取证，计划与设计中写 2.1.301 的地方以本报告为准。
- 「失败即停、不重试」在用户逐次具名授权下有四处例外（§3）。每次例外都停在失败点、先只读诊断、再由用户决定。
- R1 后半段至 R5 在用户终端执行；控制器两次扩展（重试入口、R5 续跑入口）未再送代码双审，仅语法核对与 `diff-check`，改动随提交 2 入库。

## 6. 遗留

- EV-242：另外七组合在当前指纹下无证据。
- EV-243：会话拉起的第三方路线间歇挂住，在依赖这几条路线做生产审查之前查清。
- EV-244：r21 映像校验的 locale 依赖，下一次受控批之前给夹具的 `ps` 调用固定 locale（须走取证守卫的正式流程）。
- `.trivium/config.local.yaml` 中三条路线现为 2.1.302 下的有效结论；本机 codex 已到 0.163.0，探针待刷新。
