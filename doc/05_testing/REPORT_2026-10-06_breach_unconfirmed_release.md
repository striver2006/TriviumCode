# 只读失守未确证改动放行 · 实施报告（EV-223）

> - **日期**：2026-10-06
> - **主题**：`只读失守未确证改动放行`（命令 A `/dual-run`，Driver claude）
> - **起点**：`80ff60b2`（`main`，工作树干净）
> - **来源**：原始需求 20261005 第 1 条（「只要没有真正进行了修改，就放行」）；判据由用户 2026-10-06 定为最宽档「只有确证改动才拦」
> - **计划**：`.reviews/只读失守未确证改动放行/plan/` r2（计划双审第 1 轮 run `20261006T153526Z`，8 条全接受）
> - **证据目录**：`doc/05_testing/evidence/breach-unconfirmed-release-20261006/`
> - **配额**：验证全程零配额（桩审查员）；真实审查运行只有本主题的计划双审与代码双审

## 1. 问题

只读失守的判据是「审查员轨迹里出现写事件」（`guard.ts` `judgeSide` 的 `write_events` 非空），与工作树是否真被改无关。`gate.ts` `checkAdjudication` 对 `readonlyBreach.hit` 无条件判 failure `readonly_breach`，`gate --check` / `--await-approval` / `approve` 三个出口都退 2；待裁决时 `review --start` 又拒绝重跑，唯一出口是作废这一轮。EV-79 r2（EV-98）就这样丢掉 22 条已齐备的裁决——那一轮跑后复算无变化，人工核为误报。

## 2. 改了什么

- **判据单点**（`gate.ts`）：新增 `classifyReadonlyBreach(drift)`，失守成立后按 run 元数据 `snapshot.drift` 分三档——`changed` 为 true 且无 `unknown_reason` ⇒ `confirmed`；带 `unknown_reason` ⇒ `unconfirmed_unknown`；其余 ⇒ `unconfirmed_unchanged`。`checkAdjudication` 与 `hooks.ts` 的 `roundBreach` 共用这一个函数。名字避开 `probes/claude.ts` 同名不同义的 `judgeReadonlyBreach`（计划双审 GLM-03）。
- **闸门**：确证格照旧 failure `readonly_breach`，文案改为「且跑后复算确证审查期间工作树有改动……复算检出：〈摘要〉」+ 新处置句 + 「要重跑须先作废这一轮」；未确证两格降为 warning `readonly_breach_unconfirmed`，结论照常进审批，分「复算无变化」「比不了」两种说法，列调用记录（`breachRecordsText`），逐条点明 `BREACH_BLIND_SPOTS`（被 .gitignore 忽略的文件、归档根与 `.trivium/`、改了又改回、写到项目外、MCP 执行型调用的任意写），不说复算证明没写。`--await-approval` 停点已有告警渲染通道，审批人在表态那一步看得到。
- **接线收紧**：`readonlyBreach` 入参改为判别联合，`hit: true` 必带 `drift`，漏传编译期即红（实施时单测里 `{ hit: true, files }` 字面量当场报错，印证了这一点）。
- **两处 Hook**：失守组只收确证格；未确证的失守轮按普通轮出原文案（逐字不变，补裁决件即可解开）。`BREACH_UNFIXABLE`、`driftText`（改调共用的 `confirmedDriftText`，删掉两档死分支）、`breachLines` 末行与互指注释同改。
- **后果描述**：`renderGuardWarnings` 补「闸门拦不拦取决于跑后复算」一句；任务书第 7 节 MCP 执行工具那句改为「一被调用即判只读失守、记入本轮留痕；……跑后复算一旦检出工作树改动，整轮在闸门被挡下、须作废重跑」，删去本来就不对的「本轮该侧结论作废」（失守从不作废某侧；作废侧只从禁读泄漏派生），仍明令不得调用。`report.ts` / `summarizeRun` 只出「只读失守」字样、无拦截措辞，未改。
- **注释**：`gate.ts` 原「drift 只能单向用」一段改写为「原口径被用户 2026-10-06 决策推翻」，保留 `judgeDrift` 机理与盲区清单，补 scratch 白名单一项（计划双审 CODEX-02）。
- **桩**：新增 `write_breach_applied`——与 `write_breach` 同一条写事件，同时真的在项目里追加一行（缺省 `src/injected.ts`）。`write_breach` 不变，它现在恰是放行格。
- **不改**：guard 的失守判定、run.v2 契约（不触发 EV-75 ②）、`review` 退出码与 `meta.status`、待裁决拒绝重跑、`on_drift` / `on_drift_related`。

## 3. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 三格验收（经打包 CLI，桩审查员） | **3/3 符合期望**：A 只产写事件不落盘 ⇒ `gate --check` 退 0、告警放行、闸门 `review_done_awaiting_disposition → idle`、两处 Hook 退 0；B 真改项目文件 ⇒ 退 2、`readonly_breach`、drift `{changed: true, files: [src/injected.ts]}`、闸门停在待裁决、两处 Hook 退 2 并说失守；C 比不了 + 写事件（`on_drift_related: warn`）⇒ 退 0、告警为「比不了」说法（`unknown_reason.cause: object_gone`）、闸门迁到 `idle` | `acceptance.mjs`、`acceptance-output.txt`、`acceptance-readout.json` |
| 变异预跑（逐条带超时） | **9/9 咬住**：判据 changed 分支 M1a（单测 3 红）/ M1b（集成 A 格红），unknown_reason 分支 M2a（单测 2 红）/ M2b（集成 C 格红），M3 Hook 不调判据（U17 两格红），M4 未确证也推 failure，M5 两种说法串位，M6 桩不落盘（fault-injection 红），M7 drift 接线被改写 | `gen-mutation-spec.mjs`、`mutation-spec.json`、`mutation-names.mjs`、`mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置（`scripts/mutation-check.mjs`） | 基线 4 套件全绿，**9/9 咬住** | `mutation-output.txt` |
| 全量检查（串行） | 见 §3.1 | `check-1.txt`、`check-2.txt` |
| doctor 自检 | 见 §3.1 | `doctor-selftest.txt` |

### 3.1 全量与自检

- `npm run check` **两次串行：2937 / 2935 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同（`check-1.txt`、`check-2.txt`）。每次发起前确认无残留测试进程、输出直接落文件、取真实退出码（均为 0）。
- 上一主题（EV-222，`diff-pathspec-env-20261006/check-*.txt`）为 2931；本题净增 6 例：`gate.test` 2（真值表、三档文案）、`hooks.test` 2（U17 两格）、`gate-loop` 2（A、C 格），其余为改写既有用例，跳过数不变。
- `doctor --selftest`（工作树新构建）：**14/14**（`doctor-selftest.txt`）。
- 以上读数在代码双审之前；本行之后的文字是全量跑完后填入的，索引条目与文件集未动。
- 代码双审后按 GLM-01 只改了文档（设计、BACKLOG、本报告），按「改完文档要重跑」再串行跑一次：**2937 / 2935 / 0 / 2**，退出码 0（`check-3.txt`）。
- S10 `trivium verify`：**通过**（typecheck、build、test 三条命令，run `20261006T171047Z`，留痕 `.reviews/只读失守未确证改动放行/verify/`）。

### 3.2 代码双审

run `20261006T165356Z`（约 10 分 16 秒）：codex / gemini `approve`（零意见）、glm `approve-with-nits` 1 条——GLM-01（复盘面不区分确证与未确证）接受，只落文档：设计 10.3 补一句、BACKLOG 登记 EV-224 待用户定，代码不动。应答件 `.reviews/只读失守未确证改动放行/code/…-response-claude.md`。

### 3.3 断言翻转清单（旧 → 新，计划 r2 §6.2）

| 用例 | 旧断言 | 新断言 |
| :--- | :--- | :--- |
| `gate.test` readonly_breach 带出 ① | 失守（缺省 drift，`changed: false`）⇒ failure；正向锁 `/snapshot\.drift/`；否定式锁「没有改动则是误报」 | 失守 + drift `{changed: true, files: [breach.txt]}` ⇒ failure，message 含「复算检出：1 个文件改动」「git status / git diff」「要重跑须先作废这一轮」；新增 ①′ 失守 + 复算无变化 ⇒ ok + 告警，`snapshot.drift.changed 为 false` 正向锁迁到这里（AGY-02 ≡ GLM-01），否定式锁与「已跟踪文件被改」锁移到告警上，另加五项盲区正向锁 |
| `gate.test` U15 | message 与 `364ef0f` 逐字相同 | 锁确证格新文案逐字（截断与空记录两格） |
| `gate-loop` 两条失守用例 | `write_breach` 齐裁决仍失败；未写裁决件 Hook 说失守 | 换 `write_breach_applied`（B / B′ 格），B 格补 drift 与「检出 1 个文件改动」断言；新增 A、C 两格 |
| `fault-injection` 审查中写项目文件 | `write_breach` ⇒ `readonly_breach` failure | 换 `write_breach_applied`，补 drift 断言与「确证」措辞断言 |
| `mcp-detect` I2 | MCP 执行型 ⇒ `readonly_breach` failure | 桩不落盘 ⇒ `failures: []`、告警 `readonly_breach_unconfirmed` 含 `MCP:` 调用记录与 MCP 盲区 |
| `hooks.test` U1～U16、U4b / U8b / U10b | `seedBreach` 缺省 drift `changed: false` | `seedBreach` 缺省确证 drift；U2「快照漂移：未检出」→「检出 1 个文件改动」、「drift 为 false 只排除了」→「处置：用 git status / git diff 核对」、「都须先作废这一轮」→「要重跑须先作废这一轮」（AGY-01 ≡ GLM-02）；U13 切割锚点「处置：先核对」→「处置：用 git status」（AGY-01）；U12「比对未完成」格换成「确证但清单为空」格；新增 U17 未确证两格（原文案逐字） |
| `brief-mcp-exec.test` | 锁旧句 | 锁新句 |

## 4. 已知边界

- **盲区放行**（用户决策二接受）：被 `.gitignore` 忽略的文件、归档根与 `.trivium/`、改了又改回、写到项目外、MCP 执行型调用的任意写，复算看不见，失守轮会被放行；scratch 白名单内的写入同样看不见（不在用户清单里，告警不点名）。放行告警逐条点名前五项，判断交给审批人。
- **确证不等于审查员所写**：审查期间别处的手改（无关漂移）与写事件同时出现时照拦，不做归因；处置句明说。
- **可达性**：缺省配置下进得了待裁决的失守轮只有「复算无变化」（放行）与「无关漂移」（拦）两种；被审对象漂移恒判运行失败，相关漂移与比不了按 `on_drift_related`（缺省 fail）判运行失败。C 格因此要在夹具里设 `on_drift_related: warn`。
- **`approve` 不出告警**：与其它 warning 现状一致；告警在 `gate --check` 与 `--await-approval` 停点可见。
- **`review.ts` 重跑拒绝文案**「补齐裁决件并通过 gate --check 后再来」：对未确证轮现在走得通，对确证轮仍走不通（EV-98 登记的同族未改项之一），未动。
- **待议（不在本题）**：`report` / `summarizeRun` 是否区分「失守（确证）」与「失守（未确证）」。代码双审 GLM-01 提出同一点，接受其后备建议：设计 10.3 记一句「复盘面不区分两档」，BACKLOG 登记 EV-224 待用户定。（2026-10-07 补记：用户定做，已落地，见 [`REPORT_2026-10-07_breach_flag_split.md`](./REPORT_2026-10-07_breach_flag_split.md)。）
