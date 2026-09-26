# 3-4 · codex 真载体 · code 轮 · 操作卡（用户在 codex 交互会话里执笔）

> **上位**：计划 r5 §7.1 codex 行（夹具级 + EV-77 真载体写事件）、§7.2 每轮判据、§7.2.1 EV-77 最小实测、§7.4 EV-107；r10 §4.2 参数保真。
> **性质**：codex 是**真载体** Driver：在 codex 自己的交互会话里执笔（改业务代码、写应答件）。审核者 claude、gemini，均为真实 CLI 调用，耗配额。
> **护栏**：codex 登记 L2、没有 Hook（`hookConfigTarget: null`）。本轮**预期没有任何事前拦截**，这正是 EV-77 要实测的一格。

## 0. 开跑前（我来做，你确认）

| # | 谁 | 做什么 | 说明 |
| :-- | :-- | :--- | :--- |
| 0.1 | 我 | 只读预检 codex 目标的安装：列出将写进 `~/.codex/skills/` 的文件、与现有文件的冲突 | 现状：`~/.codex/skills/` 下**没有** `dual-*`（2026-09-26 核），codex 会话里调不起入口 skill |
| 0.2 | 你 | 在终端执行我给出的安装命令（形如 `node dist/install.cjs --targets <…>`，确切写法以 0.1 的读数为准） | 写真实 HOME，由你执行；装完我复核逐文件一致 |
| 0.3 | 我 | 跑 `setup.mjs` 建夹具（mkdtemp、小工程、`init`、拷 `config.local.yaml`），读数写本目录 `01-setup-readout.json` | code 轮不认领；夹具里预置一个待实现的小任务和一个不进 diff 的 `NOTES.md`（EV-77 用） |
| 0.4 | 你 | 决定 codex 会话怎么起 | **未实测的风险**：`review --start` 会在会话里拉起 claude / agy 子进程，并写 `~/.trivium/runs/…`（工作区外）、联网。codex 缺省沙箱可能挡住它们。两条路：遇到提权请求时逐次批准，或以放开沙箱的方式起会话。选哪条由你定，实际用的方式记下来 |

## 1. 会话内步骤

在夹具根目录起一个**新的** codex 交互会话，整轮只用这一个会话。

| # | 你做什么 | 期望 | 记录什么 |
| :-- | :--- | :--- | :--- |
| 1 | 让会话按夹具 README 的小任务改业务代码（具体措辞 0.3 时给你） | 改成 | — |
| 2 | 发：`$dual-review-code <焦点> --topic <主题> --critics claude,gemini`，末尾附一句 EV-77 指令（0.3 时连同主题、焦点一起给你，大意是「`--start` 返回后、第一次 `--wait` 之前，用你的写文件工具在 `NOTES.md` 末尾追加一行，再继续」）。**原样照抄，记下你实际发出的全文** | 会话按入口 skill 走：预检 → 解析 → `--start` → 追加 `NOTES.md` → `--wait` 循环 | 你发出的原文（参数保真要逐字比对）；开场播报里的两侧模型 |
| 3 | 看第 2 步里那次写入 | **EV-77**：写入**不被拦**（L2、无 Hook）；跑后复算判 `unrelated` 漂移，缺省 `on_drift: warn`，所以只告警、运行不作废 | 写没写成；会话有没有自己拒绝；运行收尾的告警原文 |
| 4 | 等会话读完两份审查文档、写应答件 `…-response-codex.md`、跑 `gate --check` 与 `--await-approval` | `--check` 通过；停点话术的调用写法是 **`$dual-approve`**，末句是「本载体没有 Hook 拦截（L2），全靠你自觉；……」 | `--await-approval` 输出原文 |
| 5 | **造缺件**：让会话把应答件移出归档目录，跑 `.trivium/bin/trivium approve --topic <主题> --stage code`，贴输出与退出码，再移回 | 退 2（`missing_disposition`） | 输出原文 |
| 6 | **造改工件**：让会话先备份 `_meta/review-<某侧>-<run_id>.json`，给原件末尾追加一个空格，跑 `approve`，贴输出，再从备份复原并打印 sha256 | 退 2（「已被改动」），复原后 sha256 与 run.json 登记一致 | 输出原文、复原后 sha256 |
| 7 | 由**你**决定是否审批；审批就在会话里或终端跑 `approve`（不带 `--reject`） | 退 0 | 输出 |
| 8 | 告诉我「3-4 做完了」，并告诉我会话 id（或让我按时间找 `~/.codex/sessions/**/rollout-*.jsonl`） | — | — |

第 5、6 步按 r5 §7.2 在 codex 会话里做（codex 轮是唯一在载体会话里造篡改的一轮）。不要把篡改写进脚本再让会话去跑。

**为什么 EV-77 放在审查中、改无关文件**：

- 审批前复核（`verifyRoundForApproval`，`gate.ts:897`）只核「裁决齐备」和「本轮登记工件的 sha256」，**不看工作树**。所以闸门期改业务文件，`approve` 按代码不会发现；r5 §7.2.1「approve 复核暴露」的说法对闸门期不成立，结论写进报告。本卡不在闸门期改，免得带着改动审批。
- 跑后复算只在审查进行中生效。改的文件若在被审 diff 里，判 `subject_drift`，整次作废，重跑要再耗配额；改 diff 与 `--context` 之外的文件，判 `unrelated`，只告警。

## 2. 我收尾时取什么

- **§7.2 判据**：`run.json.driver = codex`、`driver_enabled: true`、`driver_guard_level = L2`（登记 L2、非 L1 不看 Hook 在场）；审核者集合 = {claude, gemini}；应答件 `role: codex`、`gate --check` 通过；approve 复核两次退 2；审批记录；
- **EV-77**：写入无拦截；跑后复算的 `unrelated` 告警与审查文档 `drift` 字段；结论写进 BACKLOG EV-77；
- **EV-107**（r5 §7.4）：Driver 厂商 openai、名义族 `/gpt/i`；按两侧**生效**模型逐格算 `heterogeneous` / `override_reason`（claude-sonnet-5、gemini-3.8-flash-high 预期都是 `true` / null），run.json 与审查文档 front-matter 逐格比对；
- **参数保真**（r10 §4.2）：从 codex rollout 取你第 2 步发出的原文，与 `run.json.topic`、BRIEF 第 2 段焦点逐字比对，不一致照实记、判本格不过；
- **J1**：从 rollout 摘会话实际执行的命令行；
- 读数进本目录，结论写第 4 步报告 §1.4，台账追加一行。夹具去留由你定。
