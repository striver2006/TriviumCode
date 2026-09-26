---
schema: trivium.disposition.v1
topic: 审批前工作树摘要
stage: code
role: claude
kind: response
run_id: 20260926T111908Z
addresses:
  - 2026-09-26-审批前工作树摘要-codex.md
  - 2026-09-26-审批前工作树摘要-gemini.md
  - 2026-09-26-审批前工作树摘要-glm.md
---

# 代码审应答：审批前工作树摘要（EV-132 候选 ② 折中版）

> 被审对象：相对 HEAD `12d54e2` 的 50 个文件变更（补丁 217 KB）
> ｜ 运行：`20260926T111908Z`（12m29s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 7 条：重要 1 ｜ 次要 4 ｜ 吹毛求疵 2 ｜ 零阻断
> ｜ **接受 6、暂缓 1（CODEX-04）、驳回 0**。同指一组：CODEX-01 ≡ GLM-01（照抄命令里两个 tree 值裸拼）。

## 0. 本轮的形状

五个焦点三侧都核过，结论一致成立：
- ①只告知：approve 先打印、再落审批，隔离块覆盖 `readRunMeta`；
- ②四种原因都不与「无改动」同形，`cat-file` 分档即使将来分错档，最坏也是原因 3；
- ③`after_tree_hash` 全仓一处写、一处读，`git()` 缺省超时与改前硬编码同值；
- ④五处文案同族，glm 按 init 口径重算了三档指纹，与登记值逐一相等；
- ⑤变异锚点与实现对得上。

问题集中在三处：
1. **照抄命令的注入面**（CODEX-01 ≡ GLM-01）。基线值来自 run.json，而审批前复核不核 run.json 自身。git 引用名允许 `;` `$` `(` `)` 等字符，一个合法的恶意引用名能过 `cat-file -e`，再裸拼进给人复制执行的命令。它还是参数注入面：以 `-` 开头的值会被 git 当成选项。这是本主题唯一一处「编排器替用户准备一条可执行命令」的地方，必须收口。
2. **预算的边界与可见性**（CODEX-02、CODEX-03）。
   - 测试注入变量生效时不留痕，与真实超时同形；
   - 被超时杀掉的 git 没有按进程组收尾；
   - 逐步取剩余预算不是整体上限，文档里「最多约 20 秒」在最坏情形下不成立；
   - 预算小于 1.5 秒时印出「超过 0 秒」。
3. **文案的两处缺口**（GLM-02、AGY-01）。
   - 停点与 `l2-notice` 把「会列出」写成了无条件承诺，取不到时这句会落空。这是 r2 §7 D6 草案本身的缺口，不是实现跑偏。
   - 原因 3 末尾没有句号，与后文黏在一起。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实。`fullListCommand` 只给排除前缀加了引号，两个 tree 值裸拼。`baseline_tree` 来自 `snapshot.after_tree_hash`：schema 只写 string，`checkRecordedArtifacts` 只核 `artifacts[]`，不核 run.json 本身。L2 载体正是这个功能要照顾的场合，恰好也最可能出现越界写入。`treeExists` 与 `diff-tree` 接受任何引用名，于是一个含 shell 元字符的合法引用名能一路通到渲染；以 `-` 开头的值还会被 git 当成选项 | `worktree-summary.ts`：入口先对 `afterTreeHash` 做对象名形状闸（`^[0-9a-f]{40}$` 或 `^[0-9a-f]{64}$`，sha1 / sha256 两种仓库），不合即落原因 3「基线不是合法的对象名」，不做任何 git 调用；`fullListCommand` 两个 tree 值也经 `shQuote`。单测补三条：含 shell 元字符的基线落原因 3 且不调 git；以 `-` 开头的基线同样拦下；路径含单引号时照抄命令仍能跑、条数与 `total` 相同（覆盖 `shQuote` 转义分支）。变异补一条：去掉形状闸 ⇒ 新用例红。schema 不加 pattern（旧留痕兼容，收口放在读侧） |
| GLM-01 | glm | minor | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| CODEX-02 | codex | minor | 接受 | 属实两点。①`summaryBudgetMs()` 只读环境变量、不播报；与 `TRIVIUM_STUB_CRITIC`「生效即醒目告警」的同族惯例不一致，注入后与真实超时逐字相同，无从分辨。②`reasonTimeout` 用 `Math.round(ms/1000)`，W7 注入 1 ms 时印成「超过 0 秒」，字面自相矛盾 | `worktree-summary.ts`：`summaryBudgetMs` 改为同时返回预算来源；被环境变量覆盖时，摘要的 `reason`（超时时）与人读输出都追加一句「预算被 TRIVIUM_TEST_SUMMARY_BUDGET_MS 覆盖为 N ms，这只应出现在测试里」，JSON 带 `budget_ms` 与 `budget_overridden`。`reasonTimeout` 不足 1 秒时写毫秒，否则向上取整到秒。W7 与单测 11 同步断言覆盖提示与「超过 1 毫秒」 |
| CODEX-03 | codex | minor | 接受 | 属实。本改动第一次让临时索引的 `git add -A` 可能在中途被杀，而 `git()` 走 `run()` 的缺省支：只给直接子进程发 SIGTERM，清理过滤器之类的孙进程会被遗弃；与架构纪律 5 与 `exec.ts` 的 killTree 注释不一致。另外逐步取剩余预算，最坏情形每步再加 5 秒宽限，「约 20 秒」不是上界 | `util/git.ts`：内部 `git()` 在显式给了超时时一并传 `killTree: true` 与较短的宽限；不传超时的既有调用（送审冻结、漂移复算）仍走原缺省，行为不变。`worktree-summary.ts`：`summarizeWorkTree` 外加整体截止时间（到点即返回原因 4，底层进程由各自的超时收尾），「约 20 秒」成为真的上界。QUICKSTART、主设计 8.5 的措辞按实现改准。单测 13 保持（不传超时时与改前同值）；补一条「整体截止」用例：人为让某一步阻塞时，按预算返回原因 4 |
| CODEX-04 | codex | minor | 暂缓 | 方向成立：没有开关、预算是常量，大仓上三个出口可能各自超时，而且每轮要扫两到三次工作树。但给它正式配置面要新增 config.v2 的键（schema、迁移、文档、`init` 缺省），超出 r2 D5 定的范围（「总预算 20 s，常量」）；「同轮同基线跳过重复扫描」也会改变 W4 已确认的双打印行为。两件都要单独取舍，不在本轮修订里顺手做 | 新登 BACKLOG EV-141（摘要预算可配置与关闭开关、超时时报实测耗时、同轮重复扫描的取舍），触发条件为出现 `add -A` 常态超过 20 秒的真实项目或用户提出。本轮只补文档：QUICKSTART §5.2 与主设计 8.5 写明每轮会扫两到三次工作树（`--check` 立停点、`--await-approval`、`approve` 各一次），以及大仓上可能次次报超时 |
| GLM-02 | glm | nit | 接受 | 属实：停点共用前段与 `l2-notice` 写「审批时 approve 会列出……」，是无条件承诺；四种取不到的情形下这句落空，升级后仍在等待审批的旧运行第一次审批就会碰上。QUICKSTART 与 RUNBOOK 已经如实写了取不到时的口径，这两处面向 Driver 与审批人的运行时文案反而没写。这是 r2 §7 D6 草案的缺口 | `hook-config.ts` `gatePeriod` 与 `l2-notice.md` :5 的括注补「取不到时如实报原因」，重渲染 12 份 L2 主命令产物；`driver.snippet` 那句只说「只打印工作树改动摘要」，不含列出的承诺，不改（指纹不动）。`hook-config.test.ts` 与 `entry-render-parity` 的正向断言按新括注更新；源码变异 M13 与契约变异 K2 的锚点同步 |
| AGY-01 | gemini | nit | 接受 | 属实：原因 1、2、4 的常量自带句号，原因 3 拼的是异常首行，通常不带句号，渲染成「git 调用失败：xxx这不影响审批」 | `worktree-summary.ts` `renderWorkTreeSummary`：原因末尾不是「。」时先补一个再接后文；单测 9 断言原因 3 的渲染里「。这不影响」相连 |

## 2. 修订之后要重跑的

全量 `npm run check`；源码变异（更新 M13 锚点，补形状闸一条）；契约变异（更新 K2 锚点）；零配额验收 B1～B5；selftest。
报告 `REPORT_2026-09-26_worktree_summary.md` 补代码双审 r1 一节与修订后读数。
主设计 v1.3.46 变更记录行补「代码双审 r1」一段。BACKLOG 新登 EV-141。
