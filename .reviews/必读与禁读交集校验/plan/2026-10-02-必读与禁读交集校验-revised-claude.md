---
schema: trivium.disposition.v1
topic: 必读与禁读交集校验
stage: plan
role: claude
kind: revised
run_id: 20261001T155413Z
addresses:
  - 2026-10-02-必读与禁读交集校验-codex.md
  - 2026-10-02-必读与禁读交集校验-gemini.md
  - 2026-10-02-必读与禁读交集校验-glm.md
---

# 裁决：必读与禁读交集校验 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-01-必读与禁读交集校验-claude.md`（r1，起点 `a9e7cdc`）
> ｜ 运行：`20261001T155413Z`（约 10 分 20 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 1）｜ gemini `request-changes`（重要 1、次要 2、吹毛求疵 1）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 9 条：接受 9、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-02-必读与禁读交集校验-r2-claude.md`；命令 A 不设人工闸门

每条都回源码核过；凡依据里的行号与事实，下表「理由」列写明核对结果。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：r1 只给了两个瞬时出口，而 `_meta/brief-*.md` 落盘的是剔除后的版本，事后看不出少过什么。`run.json` 的 `gate.warnings` 是现成字段（`review.ts:1739-1740`、`:1755-1756` 已有先例），`gate --check` 把它回灌为 `run_warning`（`gate.ts:187-200`），只告警不阻断——正是「可审计但不拦」的语义。取它，零 schema 变更 | r2 §2.5 第 1 条（剔除告警的 `detail` 写进 run.json 骨架的 `gate.warnings`）；§3.2 A1 补断言 run.json 与 `gate --check` 的 `run_warning`；§2.6 设计 §10.1.1 行写明留痕位置 |
| CODEX-02 | codex | minor | 接受 | 属实：旧构建 `--start` 必派生 worker（`run-protocol.ts:385-412`），桩会真的跑完一轮、把闸门推到待裁决。r1 没写收束与隔离 | r2 §3.4：每个场景各用一份独立导出树与独立 `HOME`（运行根随之落在临时目录）；旧构建场景断言完任务书后 `--wait` 到终态，再整树丢弃；不在本仓留任何闸门 |
| CODEX-03 | codex | nit | 接受 | 属实：`cli.ts:215` 的 USAGE 写「并入必读清单」，本主题给 `--context` 加了拒跑行为，按 AGENTS.md 改动同步清单的口径应同步 | r2 §2.6 表新增 USAGE 一行：「…；并入必读清单，与本轮禁读集相交则拒跑（退 64）」 |
| AGY-01 | gemini | major | 接受 | 属实，r1 写错了：`runReviewLocked`（`review.ts:1846-1849`）只是 `prepareRun` + `executeRun`，人读模式的 `warn` 循环在 `executeRun` 内（`:1800-1803`），`cli.ts:704-714` 人读模式不打印 `out.warnings`。按 r1 在返回后才并入，终端看不到 | r2 §2.5 第 3 条：由 `executeRun` 消费 `rc.mustReadPruned`——在汇总 `warnings` 时并入（排在 guard 告警之前），既有 `warn` 循环与 `ReviewOutcome.warnings` 一并带出；`runReviewLocked` 不改。worker 重建的上下文给 `[]`，不会在 `--wait` 终态里重复；§3.3 变异 10 改为「`executeRun` 不并入」 |
| AGY-02 | gemini | minor | 接受 | 属实：A2 那格三侧全剔，「其余侧照常列出」失实；单审核者时同理 | r2 §2.5 单条形状：剔除侧覆盖本轮全部入选侧时写「已从各侧任务书的第 4 段剔除」，否则写「已从这几侧……剔除，X、Y 侧照常列出」（点名未剔除的侧）；§3.1 文案用例补两格 |
| AGY-03 | gemini | minor | 接受 | 属实：`classifyDenyPath`（`freeze.ts:95`）与 `isOrchestratorReadable`（`:173`）都只做 `normalizeAbs`，不展开 `~`；传原始 `~/…` 会被拼到项目根下 | r2 §2.1 第 2 条：两个辅助函数一律传已展开、已归一的 `entryAbs`（`normalizeAbs` 对绝对路径幂等）；报错与告警仍按原始写法点名；§3.1 补「`~/.trivium/runs/…/<本侧>/…` 判己方材料」「`~` 写法的具名放行」两格 |
| AGY-04 | gemini | nit | 接受 | 属实：r1 只给了「建议核实」一个标签样例，`pruned` 结构也没带来源 | r2 §2.2：来源类型扩为五值（`convention` / `keyword` / `context` / `suggested` / `own-history`），`brief.ts` 定义 `Record<MustReadSource, string>` 的人读标签表（编译期穷尽）；§2.3 `pruned` 记录带 `source` |
| GLM-01 | glm | minor | 接受 | 属实：设计 `:1586` 与 PROTOCOL `:402` 都把同步 `warnings` 定性为「运行期告警」，并入准备阶段的剔除告警后失实；这正是 `review.ts:651` 注释记过的「改语义时凡断言该语义的文案都要过一遍」 | r2 §2.6 设计「`--start` 的 warnings」行与 PROTOCOL 行：同步路径那半句改为「运行期告警，以及准备阶段的必读剔除告警」 |
| GLM-02 | glm | nit | 接受 | 属实：`walkSensitive`（`freeze.ts:360-379`）不跳 `.trivium`，宽 glob 能让 `.trivium/config.yaml` 成为独立禁读条目；第 8 段（`brief.ts:318-320`）与机器侧（`guard.ts:290-295`）都会滤掉它，r1 的 `contains` 分支却会照列 | r2 §2.1 第 3 条：`contains` 分支对禁读条目 `d` 也过 `isOrchestratorReadable`，与 `under` 分支、第 8 段、机器侧同口径；§3.1 反例补「宽 glob 命中具名放行文件 + `--context .trivium`」一格 |

## 2. 修订摘要

- 告警出口从两处变三处：`--start` 的 `warnings`、同步路径（经 `executeRun`）、run.json `gate.warnings`；
- 路径判定的辅助函数一律吃归一后的绝对路径；`contains` 方向补具名放行；
- 告警文案按「是否覆盖全部入选侧」分支，来源标签成表；
- 验收脚本每个场景独立导出树与 `HOME`，旧构建跑完再丢；
- 文档同步面补 USAGE、设计与 PROTOCOL 里同步路径那半句。

其余（判定口径、拒跑位置、零工件、两条暂缓）三侧均认可，r2 不动。
