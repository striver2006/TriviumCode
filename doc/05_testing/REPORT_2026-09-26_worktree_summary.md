# 审批前工作树摘要 · 实施报告（EV-132 候选 ② 折中版）

- **日期**：2026-09-26
- **主题**：`审批前工作树摘要`；计划 `.reviews/审批前工作树摘要/plan/`（r1 → 计划双审 run `20260926T100417Z` 16 条全接受 → r2 定稿，提交 `12d54e2`；用户审批「开始实施」）
- **起点**：`12d54e2`；计划行号取自 `4a94e92`（两者之间只有计划留痕）
- **状态**：代码双审 r1（run `20260926T111908Z`）7 条：接受 6、暂缓 1，审批通过；已按应答件修订（§6）；**未提交**
- **evidence**：`doc/05_testing/evidence/worktree-summary-20260926/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §2.1 摘要模块 | 新文件 `src/trivium/worktree-summary.ts`：`summarizeWorkTree`（不抛错，四种原因）、`renderWorkTreeSummary`（出口、Driver、主题三参数）、`fullListCommand`（与摘要同口径的照抄命令）、`unavailableSummary`；常量 `SUMMARY_BUDGET_MS = 20000`、`SUMMARY_JSON_LIMIT = 200`、`SUMMARY_TEXT_LIMIT = 20`；测试注入 `TRIVIUM_TEST_SUMMARY_BUDGET_MS`（`summaryBudgetMs()` 只认正整数） | `test/unit/worktree-summary.test.ts` 15 条 |
| §2.2 git 助手 | `util/git.ts`：内部 `git()` 加可选超时；`workTreeHash(cwd, opts?)` 只在显式给了超时时抛 `GitTimeoutError`，不传时连报错形态都与改前相同；新增 `treeExists`、`diffTreesNameStatus`（失败即抛）、`parseNameStatusZ`（`\0` 成对解析，奇数段即抛）；`diffTrees` 未改 | 单测 8、10、13 |
| §2.3 落盘 | `review.ts` 与 `snapshot.drift` 同一处写 `meta.snapshot.after_tree_hash`；`run.v2.json` `snapshot.properties` 加可选字段；`types.ts` `SnapshotMeta` 加可选字段 | W6（值为 40 位 hex、过 `validateRunMeta`）；EV-133 字节不变用例仍绿 |
| §2.4 三个出口 | `cli.ts`：`workTreeSummaryFor`（隔离块覆盖 `readRunMeta` 与计算）+ `printWorkTreeSummary`（渲染出错也只告警）；`approve` 在复核循环之后、落审批循环之前逐阶段算并先打印，复核时拿到的主题定位与闸门项 Driver 留给摘要用，不在隔离块外再取；`--await-approval` 在停点文案后追加，JSON 加 `worktree_summary`；`--check` 自动立停点只在人读模式追加；approve JSON 仅通过时带 `worktree_summary`（按阶段）；CLI 帮助 approve 段加一行 | W1～W5、W7、W8 |
| §2.5 文案 | 两种出口的首尾句；四种原因逐字；无改动一行；范围行（归档根在前、`.git` 不列） | 单测 1、2、7、12 |
| §7 D6 (b) | `hook-config.ts` `gatePeriod` 与 `L2_AFTER_THE_FACT`（及两处文档块）；`l2-notice.md` :5；`approve.contract.md` 一句；`driver.snippet` :27；`registry.ts` :77 注释；重渲染 16 份产物（12 份 L2 主命令 + 4 份 `dual-approve`）；`init.ts` `KNOWN_PROTOCOL_SHA256` 三档各追加当前版指纹；本仓 AGENTS.md / GEMINI.md 协议块原位改到与当前组合正文逐字相同（scratchpad 脚本比对 EQUAL）；根 `CLAUDE.md` 未动（EV-138） | `hook-config.test.ts` 两处改写 + 反向断言；`entry-render-parity` 新增三条 |
| §5 文档 | 主设计 v1.3.46（8.5 新段、6.7.1 新行、AC-21、R18、变更记录）；PRD v1.4.10；LLD v1.1.4；PROTOCOL §四与命令表两行；QUICKSTART §5.2 两处；MANUAL v1.0.4；RUNBOOK §十第 1 条；BACKLOG EV-132 状态、新登 EV-139 / EV-140 | 反扫「补工作树比对」「候选 ② 待办」「没有机制会发现」：剩余命中均为历史说明、审批之后那一格或测试里的反向断言 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 实施时 **2074 / 2072 / 0 / 2**（起点 2048 → 新增 26 条：单测 15、集成 8（W1～W8）、契约 3；`hook-config.test.ts` 两条是改写，不计）；代码双审修订后 **2080 / 2078 / 0 / 2**（再加单测 6 条） |
| `doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`） | 实施时与修订后均 **14/14** |
| 源码侧变异（`mutation-spec.json`，`scripts/mutation-check.mjs`） | 实施时 **14/14**（`mutation-output-run1.txt`）：M1～M11（M4 拆 a / b）、M13、M14；代码双审修订后加 M15～M20，第 2 轮 **19/20**（`mutation-output-run2.txt`，M20 规格把期望套件指错，见 §3.6），改正后单跑 M20 咬住（`mutation-spec-m20.json` / `mutation-output-m20.txt`）⇒ **20/20** |
| 契约侧变异（`contract-mutations.mjs`） | 实施时 **5/5**（`contract-mutations-output-run1.txt`），代码双审修订后加 K6，**6/6**（`contract-mutations-output.txt`）：K1 = 计划 M12（`l2-notice` 去命令限定）、K2 改回「没有机制会发现」、K3 写成「不拦」、K4 `dual-approve` 删句、K5 `driver.snippet` 改回旧句 |
| 零配额验收（`acceptance.mjs`，mkdtemp 夹具、桩审查员、名义 Driver codex、命令 B） | 实施时与修订后各跑一次，均 **13/13**（`acceptance-readout.json` 为修订后那次）：B1 3-4 形态（闸门期改 README.md、新建 NOTES.md ⇒ approve 退 0、两者列出、先打印再落审批、`$dual-abandon`、审批落盘、run.json 逐字节不变）；B2 无改动；B3 `gc --prune=now` ⇒ 报「基线对象已不在对象库」、照常落审批；B4 `gc --auto` 实测（§3.1）且提交掉的改动仍列出（此时 `git status` 干净）；B5 `--check` 停点已列出裁决期改动 |
| 环境 | git 2.54.0（Apple Git-157），Node v25.2.1 |

## 3. 偏离与如实登记

### 3.1 `git gc --auto` 的实测推翻了计划双审时的推测（CODEX-08）

r2 §6.1 按 CODEX-08 写了「闸门期提交得越多，越可能取不到——这个缺失不是随机的」，并约定按 §3.5 实测定口径。
B4 实测：夹具闸门期连续提交 5 次后，`git gc --auto`（缺省配置）与 `git -c gc.auto=1 gc --auto`（强制真跑）之后，基线对象**都还在**；`gc.pruneExpire` 未设，git 缺省只清理两周前的不可达对象。
所以文档按实测写：平常提交与 `gc --auto` 不会清掉当天的基线；显式 `git gc --prune=now`、基线超过两周、或配置了更短的 `gc.pruneExpire` 才会取不到（主设计 8.5、QUICKSTART §5.2）。
r2 计划原文保留为记录，不改；这一格只测了一台机器、一个 git 版本，`git maintenance` 的后台任务没有测。

### 3.2 `treeExists` 不带 `^{tree}` 剥离（与 r2 §2.1 的写法不同）

r2 §2.1 写 `git cat-file -e <基线>^{tree}`。本机实测：带剥离时，对象缺失与「不是 git 仓库」**都退 128**，分不开，会把非 git 目录报成「基线已不在对象库」。
不带剥离时，缺失退 1、非 git 目录退 128。实现改为不带剥离：退 1 判「不在」，其它非零抛错落原因 3。类型不对（不是 tree）交给随后的 `diff-tree` 报错。单测 9 钉住非 git 目录落原因 3。

### 3.3 计划外补的一道锁：`driver.snippet` 改回旧句原本没人抓

写契约变异规格时核出：`driver.snippet` 改回旧句，旧版正文的指纹仍在 `KNOWN_PROTOCOL_SHA256` 里（表只追加），`init.test` 不会红；`entry-render-parity` 的两族反向扫描也不含这一句。
计划 §3.3 没列这一格。已在 `entry-render-parity` 补一条专设断言，K5 实测只有它变红（fail=1），印证了这个缺口。

### 3.4 测试与变异编号的对应

- 计划 M12（`l2-notice` 去命令限定）的目标不是 `src/*.ts`，走契约脚本，编号 K1。
- 计划 M4「严格助手退回 `diffTrees`」拆成两条：M4a 让 `diffTreesNameStatus` 失败返回 `[]`（单测 10 红），M4b 去掉存在性预检（单测 8 红）。单改其一时另一道仍兜得住，所以分开钉。
- 计划外加了 M13（停点前段改回旧句）、M14（写成「不会被拦」）、K2～K5。
- M8「`readRunMeta` 在隔离块外抛错」用 W7 的预算注入作触发条件（变异里人为抛错），不是真实的 IO 故障；M9 把打印挪到 300 ms 之后，打印出现在「已通过」之后或根本没打出来，两种都让 W1 红。
- 单测的「预算环境变量」一条是计划外补的，钉 `summaryBudgetMs` 只认正整数。

### 3.5 其它

- JSON 模式下 `approve` 与 `--await-approval` 不打印人读摘要，只给字段，与停点文案在 JSON 模式下的行为一致。
- 起点 2048 条到 2074 条：新增 15 + 8 + 3 = 26 条，逐条对上；`hook-config.test.ts` 两条既有用例是改写，不计。

### 3.6 代码双审修订时的三处如实登记

- **M20 规格指错了期望套件**：写成 gate-loop（W7），而 W7 走的是超时那一路——超时原因本身就带覆盖提示（`timeoutReason` 追加 `budgetOverrideNote`），只清空渲染层那一句 W7 照样看得到，于是第 2 轮报「没红」。真正守「可用时也写明覆盖」的是单测「r1 CODEX-02」。期望套件改正后单跑 M20 咬住。这说明两条通道（原因里带、渲染层补）互为冗余：超时分支有两道，可用分支只有渲染层一道，单测守的正是后者。
- **原 M10 的变异点失效**：整体截止加上之后，超时一律由截止先返回，`catch` 里按 `timedOut` 分流的那一支成了次要路径，单独变异它咬不住。M10 改为变异截止那一路的原因（落成原因 3），单测 11 咬住；`catch` 里的超时分支保留（截止与底层超时几乎同时到时的兜底），不再单独变异。
- **形状闸的原因是单独一句，没有挂在「git 调用失败：」前缀下**：应答件写「落原因 3「基线不是合法的对象名」」，实现为 `REASON_BAD_BASELINE`「基线不是合法的对象名（应为 40 或 64 位十六进制），无法比对。」——这一格根本没有调用 git，挂在「git 调用失败」下面是失实。它与原因 3 同属「比不了」一类，渲染、退出码与 JSON 形态相同。
- **第 2 轮第一次开跑被装置拦下**：修订改了缩进与变量名，M3 / M4b / M10 的锚点命中 0 处，闸 7 在写盘前拒跑（`mutation-output-run2.txt` 之前那次的输出未单独保留，读数见本条）。更新锚点后重跑。

## 4. 文档同步

见 §1 最后一行。设计变更记录 v1.3.46 行已写；QUICKSTART / PROTOCOL 文首「依据设计 v1.3.43 / PRD v1.4.8」的引用上一主题就没跟进，本主题也不动，照旧登记在此。

## 5. 代码双审 r1（run `20260926T111908Z`）

三侧 `approve-with-nits`，7 条：重要 1、次要 4、吹毛求疵 2。接受 6、暂缓 1（CODEX-04 → BACKLOG EV-141）、驳回 0。同指一组：CODEX-01 ≡ GLM-01。应答件 `.reviews/审批前工作树摘要/code/2026-09-26-审批前工作树摘要-response-claude.md`。用户审批通过、无附言。
送审前按 `--targets claude,glm,codex,gemini` 重装，本轮审查因此自己落了 `after_tree_hash`；停点与 approve 打印了摘要（「未被 .gitignore 忽略的文件无改动」），这是本功能在本仓的第一次实跑。

## 6. 按应答件的修订

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 ≡ GLM-01 | `OBJECT_NAME_RE`（40 / 64 位十六进制）在任何 git 调用之前；不合即 `REASON_BAD_BASELINE`，不回显进 `baseline_tree`；照抄命令两个 tree 值加引号 | 单测：含 `;` 的合法引用名（前提断言 git 接受、`cat-file -e` 认它）被拦；`-` 开头、`HEAD`、39 位、大写 40 位被拦，合法形状在非 git 目录里落 git 失败（证明闸在 git 之前）；单引号路径照抄命令能跑、条数等于 `total`。变异 M17、M18 |
| CODEX-02 | `summaryBudget()` 返回 `{ ms, overridden }`；覆盖生效时超时原因与人读输出写明「预算被 … 覆盖为 N 毫秒，这只应出现在测试里」，JSON 带 `budget_ms` / `budget_overridden`；`reasonTimeout` 不足 1 秒写毫秒、否则向上取整 | 单测 11 与「r1 CODEX-02」；W7 断言覆盖提示与「超过 1 毫秒」；W3 断言两个新字段。变异 M20 |
| CODEX-03 | `git()` 只在显式传超时时加 `killTree: true, killGraceMs: 500`，缺省路径不变；`summarizeWorkTree` 外加整体截止（`Promise.race`） | 单测「r1 CODEX-03」：慢清理过滤器（`trap '' TERM` 忽略 SIGTERM）夹具，800 ms 预算下 1200 ms 内返回超时、1.5 s 后无孤儿 `sleep`。变异 M15（去 killTree ⇒ 孤儿检查红）、M16（截止推迟 ⇒ 时限红） |
| CODEX-04 | 暂缓：新登 BACKLOG EV-141；QUICKSTART §5.2 与主设计 8.5 写明每轮扫两到三次工作树、大仓可能次次超时、预算不可配置 | — |
| GLM-02 | `gatePeriod` 与 `l2-notice` 的括注补「取不到时如实报原因」，重渲染 12 份；`driver.snippet` 不含列出的承诺，不改 | `hook-config.test.ts` 正向断言；`entry-render-parity` 正则更新。变异 M13 锚点更新、契约 K6 |
| AGY-01 | 渲染时原因末尾不是「。」先补一个 | 单测「r1 AGY-01」（原因 3 与自带句号的原因各一）。变异 M19 |

文档：主设计 8.5 与 v1.3.46 变更记录补「代码双审 r1」；PROTOCOL approve 行补两个 JSON 字段；LLD 行数；BACKLOG EV-132 状态与 EV-141。

## 7. 待办

- 提交并推送；提交后从已提交状态重建，用户终端重装 `--targets claude,glm,codex,gemini`，复核一致、selftest 14/14。
