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

## 下一停点

请用户批准：①新预算池（或改额度）；②批 Z 前置的夹具基线提交与 R0 刷新；③`.codex/hooks.json` 的处置。批准前不发布具名批次、不扩容、不启动任何东西。
