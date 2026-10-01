---
schema: trivium.disposition.v1
topic: 漂移比不了不放行
stage: code
role: claude
kind: response
run_id: 20261001T080545Z
addresses:
  - 2026-10-01-漂移比不了不放行-codex.md
  - 2026-10-01-漂移比不了不放行-gemini.md
  - 2026-10-01-漂移比不了不放行-glm.md
---

# 应答：漂移比不了不放行 · 代码双审第 1 轮

> 被审对象：相对 `40ca534` 的未提交改动（39 个文件，补丁约 786 KB，大头是全量与 Node 读数文本）
> ｜ 运行：`20261001T080545Z`（约 8 分 53 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 2）｜ gemini `approve-with-nits`（吹毛求疵 1）｜ glm `approve-with-nits`（吹毛求疵 3）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01 ≡ GLM-03**：成立。`classifyCompareFailure` 只在比对本身超时时不再查对象；比对快速失败（如退 128）之后两次 `treeExists` 各走缺省 120 s、没有共享截止，病态仓库里收尾最坏要多等约 240 s（改前这一格立即返回）。worker 心跳在收尾期间照跳（`run-protocol.ts` 的 setInterval），不会被 `--wait` 误判失联，只是变慢。计划 r2 §7 只写了「最坏多等两次超时」，设计与 LLD 都没写上界。
- **CODEX-02 ≡ GLM-02**：成立。`detail` 里的「120 s」是 `util/git.ts` `git()` 内联缺省值的复制，只靠注释耦合；子命令名又靠对 `GitTimeoutError.message` 去掉结尾「超时」二字的正则得到——两边任一改动，run.json 里的数字或措辞就失实，而 U5 锁的是字面串、照样绿。
- **CODEX-03**：成立。「`detail` 单行」只是写侧约定（`firstLineOf`），schema 只约束字符串，四个渲染点直接内插；手工修过的 run.json 带多行 `detail` 会让告警与旗标版式错位。
- **CODEX-04**：成立。K1～K3 改的是 `dist/test/` 拷贝，K4 改的是进 Git 的源 schema——C1 直接读仓库路径，要咬 C1 只能动它。恢复在 `finally` 里逐字节回写并核哈希，但 SIGKILL / 断电时不执行；哨兵会挡住重跑、被改的 schema 留在工作树里，与「活工作树不动」的既有口径（`doc-archive-index` 那一轮）不同，需要显式写明。
- **AGY-01**：成立。`${which}值…` 拼出「送审快照的 tree值」，与计划 r2 §2.1 表的「tree 值」不一致；U9 断言跟着写成了无空格。
- **GLM-01**：成立。LLD「退出码判定优先级」一行本补丁编辑过，但保留的 `review.ts:894-908` 早已过期（实际在 `executeRun` 收尾段，现约 :1697～:1709）。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | 次要 | 接受 | 分原因的两次核对没有共享截止，最坏上界未写 | `freeze.ts` `classifyCompareFailure`：两次 `treeExists` 共用一份 120 s 预算（逐次传剩余毫秒，与审批时摘要同法；显式传值即按进程组收尾）；超时文案从同一预算排版。设计 9.2「比不了不放行」要点与 LLD 3.3 补最坏时长：比对 120 s + 核对至多 120 s |
| CODEX-02 | codex | 吹毛求疵 | 接受 | 时长与子命令名都应有单一来源，不靠复制与正则 | `util/git.ts` 导出 `GIT_DEFAULT_TIMEOUT_MS`（`git()` 缺省值改用它）；`GitTimeoutError` 加只读结构字段 `what`（子命令名）；`timeout` 的 `detail` 由 `what` 与超时毫秒数排版（核对段用的是共享预算的值）；U5 改为由常量与 `what` 推出期望值 |
| CODEX-03 | codex | 吹毛求疵 | 接受 | 读侧也要守单行排版契约，成本一行 | `types.ts` `describeDriftUnknown` 对 `detail` 取首行（与写侧同口径）；`drift-unknown.test.ts` G3 加一格多行 `detail` 只出首行 |
| CODEX-04 | codex | 次要 | 接受 | 动活工作树源文件是有意的偏离，必须写明 | 选「写明偏离」而不是把 C1 参数化：C1 的意义就是钉「仓库里那份源 schema 与枚举相等」，改读副本就测不到它。`contract-mutations.mjs` 头注与实施报告 §3.3 写明：K4 改活工作树源 schema，恢复靠 `finally` 回写与哈希核对，崩溃残留由哨兵挡住重跑、`git status` 可见，恢复方式为在终端 `git restore` 该文件 |
| AGY-01 | gemini | 吹毛求疵 | 接受 | 与计划文案不一致、排版不自然 | `freeze.ts` 形状闸 `detail` 改为「〈which〉 值不是合法的 git 对象名（不回显该值）」（补空格）；U9 断言同步 |
| GLM-01 | glm | 吹毛求疵 | 接受 | 本补丁编辑过的行上留着过期行号 | LLD 该行把 `review.ts:894-908` 改为「`review.ts` `executeRun` 收尾段」，不写行号 |
| GLM-02 | glm | 吹毛求疵 | 接受 | 与 CODEX-02 同一缺口（≡） | 同 CODEX-02 |
| GLM-03 | glm | 吹毛求疵 | 接受 | 与 CODEX-01 同一缺口（≡） | 同 CODEX-01 |

修订后重跑：受影响单测与集成、源码变异（锚点有变的条目重新生成规格）、全量两次、doctor；读数补进实施报告 §6。
