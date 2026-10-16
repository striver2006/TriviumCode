# M11 第 12 步收口准备（2026-10-16，Phase 1，零厂商）

执笔：Claude Code（本仓会话）。依据：用户对收口计划的三项答复与「同意」开始 Phase 1（[user-decision.json](./user-decision.json)）。本批未启动任何厂商 CLI、客户端、审查或审批，预算仍 838/401。

| 文件 | 内容 |
| :--- | :--- |
| [user-decision.json](./user-decision.json) | D1 5.2～5.5 改判组合证据；D2 另开收口预算池；D3 五个受限 Claude 组合判据挪到 M11 后；计划派生的 1.4 / 8.1 处置 |
| [reconcile.mjs](./reconcile.mjs) → [matrix-before.json](./matrix-before.json)、[matrix-sync.json](./matrix-sync.json) | 只改 1.4、5.2～5.5、8.1 六格的状态与观察，证据列追加决定文件；68 行判据、要求、顺序断言不变 |
| [scan-oversized-requests.mjs](./scan-oversized-requests.mjs) → [oversized-requests-scan.json](./oversized-requests-scan.json) | 会话启动提示的「7 个运行目录抹除后仍有文件未扫描」：运行根下 ≥8 MB 的 `request.json` 共 16 份（9.5～149 MB），用生产 `scanSecrets` 全文扫，**命中 0**；只记命中数，不输出内容 |
| [budget-pool-proposal.json](./budget-pool-proposal.json) | 新池提案：硬限 admission 32 / review 16（核心 26/12 + 可选 9.6 一轮 6/4），绝对上限 870/417；**未批准、未扩容** |
| [client-steps-z-draft.md](./client-steps-z-draft.md) | 批 Z 草案：Claude 主攻 plan → ZCode 主攻 code，覆盖 7.x（ZCode）与 10.x |
| [client-steps-x-draft.md](./client-steps-x-draft.md) | 批 X 草案：Codex 主攻 plan、闸门期改业务文件，覆盖 7.x（Codex）与 9.1～9.5；X2 可选覆盖 9.6 |

## 改判后矩阵

68 行：已有本轮证据或已判达成 46、未测 20（剧本 7、9、10）、可选未做 2（9.6、11.7）。

## 准备中核出的事实

1. **agy 版本漂移**：本机 agy 已是 1.3.6（今日 Argon 验收用的版本），夹具探针记录 1.3.5。按 10-15 先例，带 gemini 的预检会退 69，所以两批之前先做一次 R0 定向刷新。
2. **探针过期**：codex、zcode 两侧的 `probed_at` 是 2026-10-10，已超 `probe_ttl_days=7`。部分过期只点名不拦（`preflight.ts` `checkProbeFreshness`），不单列刷新。
3. **夹具有未提交改动**：`AGENTS.md`、`src/stack.js`、`test/stack.test.js` 和两个主题的归档都没提交。code 阶段被审的是 `git diff`，所以批 Z 前置要求用户先把它们提交成新基线。
4. **夹具里有 `.codex/hooks.json`**：来源 unknown，内容是 Claude Hook 的拷贝。建议原样保留并如实记录（见批 X 草案），另登记 BACKLOG EV-237，核 Codex 是否已支持项目级 Hook。
5. **剧本 4 末注的同族终端告警（设计 11.5 ①）**：EV-234 v3 已把 `familyWarnings` 并进运行告警（`review.ts` 中 `warnings.push(...familyWarnings(comparisons))`）。按执笔方判断不另立条目，收口时以实跑 `--wait` 输出核实一次。
6. **送审包膨胀**：16 份超大 `request.json` 全在本仓自己的运行里，最大 149 MB，超过脱敏扫描上限才出现「未脱敏」提示。成因待查（很可能是证据目录进了送审 diff），登记 BACKLOG EV-236。

## 用户第二次答复与前置执行（2026-10-16）

用户答复（[user-decision-02.json](./user-decision-02.json)）：D4 收口池不设额度、该用多少就多少；D5 两批前置由 Claude 自动执行；D6 `.codex/hooks.json` 按建议原样保留；D7 Phase 1 先提交推送（`284f1320`）。`budget-pool-proposal.json` 的 32/16 硬限因 D4 作废，里面的分批估算只作参考。

| 步骤 | 文件 | 结果 |
| :--- | :--- | :--- |
| 外壳调整 | `../cap-preload.cjs`、`../client-tv.mjs` | 本步总额从写死 80 改读 `budget-plan.json` 的 `step_limits.total`（revision≤3 仍是 80，revision 4 为 null，即不设）；doctor 可按批次具名的一次性刷新授权放行。旧授权分支不变，生产代码未改 |
| 收口池 | [apply-closeout-pool.mjs](./apply-closeout-pool.mjs) → [closeout-pool-extension-receipts.json](./closeout-pool-extension-receipts.json)、`../budget-plan-revision-04.json` | 用既有 extend 机制把全局上限 admission 839→1839、review 413→1413，`budget-plan.json` 升 revision 4，旧账（838/401，本步 71/80）封存 |
| 夹具基线 | [fixture-baseline.mjs](./fixture-baseline.mjs) → [fixture-baseline.json](./fixture-baseline.json) | 夹具 `a50caa6` → `70bad55`，70 个文件（三份业务 / 协议文件与两个主题归档）；`.codex/hooks.json` 未提交、未挪 |
| R0 agy 刷新 | [r0-agy-refresh-approval.json](./r0-agy-refresh-approval.json)、[client-batch-r0.json](./client-batch-r0.json) → [r0-assessment.json](./r0-assessment.json) | 经验收外壳执行 `doctor --only agy --json` 一次，admission 838→843（+5）；agy 1.3.6 已记入，`headless_read_ok`、`json_schema_ok` 为 true，`path_deny.supported=false`（同前），批次路线 `gemini-3.8-flash-high` 仍在目录内。doctor 退 69，唯一阻断仍是已知的「wrapper 不是 init 生成形态」 |
| 发布 Z1 | [client-batch-z1.json](./client-batch-z1.json)（r1）→ [client-batch-z1-r2.json](./client-batch-z1-r2.json)（`../client-batch.json` 现为 r2） | 主题 `m11-s12-cross`，Claude 主攻 plan，审核者 gemini、glm。r1 沿用 D 批的 qwen3.8-flash 声明；客户端第一条消息自报 Claude Sonnet 5.5，按约定停下，没有启动任何东西。r2 只把 driver 与入口命令里的两个声明旗标改成 `anthropic` / `claude-sonnet-5-5`，与 `239f6026`「恢复 Claude 官方路线」一致 |

## 实跑与收口（2026-10-16）

按时间顺序：Z1 → 10.1 → Z2（含 7.6 终端负对照）→ 10.2～10.7 报告 → 夹具基线 2（`a27d869`）→ X1 → X2（含 R0b agy 1.4.0 刷新）→ X3 → 11.7。逐格判定见 `z-verdicts.json`、`x-verdicts.json`、`x2-verdict.json`、`s117-verdict.json`；矩阵二次改判见 `reconcile-2.mjs` → `matrix-sync-2.json`；叙述与边界见第 12 步报告末节。台账从 838/401 用到 917/423。夹具里所有闸门都已关闭：`m11-s12-tier/plan` 为 idle，其余为 approved。`m11-s12-stack/plan` 本来就是 idle。
