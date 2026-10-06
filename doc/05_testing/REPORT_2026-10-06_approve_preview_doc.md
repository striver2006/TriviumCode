# 批之前再看一眼改动：写明现有路径 · 实施报告（EV-140）

> - **日期**：2026-10-06
> - **主题**：`批前再看改动`（M11 前待办第三批第 6 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`3f312f0`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/approve-preview-doc-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定取 ③——不加入口；用户手册与 `/dual-approve` skill 写明「批之前想再看一眼改动，重跑 `gate --await-approval`」（BACKLOG EV-140 状态列），本题不再论证方案本身。skill 改在 `skills-src/` 并重渲染，**用户重装后生效**

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `approve`（`src/trivium/cli.ts` :1615 `cmdApproval`）先跑与 `--await-approval` 共用的复核，再逐阶段打印工作树改动摘要（:1736 `workTreeSummaryFor`、:1738 `printWorkTreeSummary`），随即落审批——同一条命令里人来不及中止。
2. 等待审批期间重跑 `gate --await-approval` 是允许的迁移（:1363 起 `setGateChecked` 的 `expect.state` 含 `awaiting_approval`）：照样复核、照样打印摘要（:1386 / :1394，`gate-loop` W4 钉住「`--await-approval` 也列出改动」），本轮人已表态时保持不变（:1345 `humanDecidedThisRound`）；副作用只是闸门项按原值重写一次（会话 id 与时间戳刷新），状态不变。
3. 文档：`skills-src/commands/approve.contract.md` 只写了「输出里的工作树改动摘要只告知……」，没有「批之前怎么先看」；用户手册 §4.8「三条辅助命令」只列四条规则，同样没有。

### 修法

1. `skills-src/commands/approve.contract.md` 加一段：用户只是想批之前再看一眼改动时，不跑 `approve`，改跑 `.trivium/bin/trivium gate --stage <阶段> --topic <主题> --await-approval` 并原样转述——它与 `approve` 同一份复核、同样打印摘要、不落审批，闸门保持等待审批；看完、用户明确要求审批时再跑 `approve`（不写 `/dual-approve` 这一调用写法：四个载体的入口写法不同，同一份源要渲染给四家）。随后 `npm run render` 重渲染各载体产物。
2. 用户手册 §4.8 加一条同义的说明（v1.0.38）。
3. 验证：`.md` 目标进不了变异装置，只做逐条预跑（删掉 skill 源里新加的那段，看渲染一致性用例 `entry-render-parity` 是否红）。

### 不改的边界

- 不加 `approve --dry-run`、不改 `status`；`approve` 与 `gate --await-approval` 的行为不变（零代码）。
- skill 其余段落不动。

## 1. 改了什么

1. `skills-src/commands/approve.contract.md`：在「把输出原样转述给用户……」之后加一段「批之前想再看一眼改动」——`approve` 没有确认步骤；用户只想先看时不跑 `approve`，改跑 `gate --stage <阶段> --topic <主题> --await-approval`（命令写全了 `.trivium/bin/` 前缀，与本 skill 的 `allowed-tools` 一致），说明它与 `approve` 同一份复核、同样打印摘要、不落审批、闸门保持等待审批（只按原值刷新一次闸门项的会话与时间）；原样转述，等用户明确要求审批再跑 `approve`。
2. `npm run render`：重写四份 `dual-approve` 入口产物（`skills/dual-approve/SKILL.md` 与 codex / gemini / glm 三个载体），四份新段逐字相同。
3. 用户手册 v1.0.38 §4.8「三条辅助命令」加一条同义说明；主设计 v1.3.119 版本行；BACKLOG EV-140 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 渲染 | 重写 4 份、删除 0 份 | `render.txt` |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑 `entry-render-parity` | 20/20 | `suite-parity.txt` |
| 逐条预跑（`.md` 目标进不了变异装置） | M1 删整段、M2 只删命令行，各红 1 格「源 → 产物零 diff」 | `mutation-names-log.txt`、`mutation-names-output.json`、`mutation-spec.json` |
| 全量第 1 次 `npm run check` | 2889 / 2887 / 0 / 2，退 0（总数不变：本题没有新用例） | `check-1.txt` |
| 全量第 2 次（串行） | 2889 / 2887 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 第 1 次全量期间 1（`trivium-index-`）、第 2 次与自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 内容如实：`--await-approval` 在等待审批期间重跑「同一份复核、同样打印摘要、状态不变、闸门项按原值重写」与 :1345 / :1363 / :1386～:1394 的实现一致；「本轮人已表态则保持不变」这一格（已批后重跑）skill 里没写——那时已经没有「批之前」可言。
- 范围：零代码；没加 `--dry-run`、没改 `status`。skill 其余段落未动。
- 生效：skill 产物要**用户重装后**才进各载体，本仓 `.trivium/bin` 指向的全局安装副本此时仍是旧文。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
