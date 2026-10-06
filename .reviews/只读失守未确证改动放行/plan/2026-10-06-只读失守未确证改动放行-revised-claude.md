---
schema: trivium.disposition.v1
topic: 只读失守未确证改动放行
stage: plan
role: claude
kind: revised
run_id: 20261006T153526Z
addresses:
  - 2026-10-06-只读失守未确证改动放行-codex.md
  - 2026-10-06-只读失守未确证改动放行-gemini.md
  - 2026-10-06-只读失守未确证改动放行-glm.md
---

# 裁决：只读失守未确证改动放行 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-06-只读失守未确证改动放行-claude.md`（r1，起点 `80ff60b2`）
> ｜ 运行：`20261006T153526Z`（约 23 分 53 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 1）｜ gemini `request-changes`（重要 1、次要 1、吹毛求疵 1）｜ glm `approve-with-nits`（次要 2、吹毛求疵 1）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-06-只读失守未确证改动放行-r2-claude.md`；命令 A 不设人工闸门

每条都回源码核过，核对结果写在「理由」列。三侧对方向（单点判据、判别联合、三格可达性分析、桩形态）一致认可，意见集中在翻转清单的完备性、一处命名冲突与盲区登记。有两组重合：AGY-01 的第二半与 GLM-02 指同一条 U2 断言；AGY-02 与 GLM-01 指同一条 `/snapshot\.drift/` 正向锁。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| AGY-01 | gemini | major | 接受 | 属实：`hooks.test.ts:1587`（U13）断言 `reason.split('处置：先核对')` 计数为 1，r1 §2.4 的新处置句以「处置：用 git status」开头，计数变 0；`hooks.test.ts:1384`（U2）断言含「都须先作废这一轮：闸门停在待裁决时 review --start 拒绝重跑」，r1 §3 删了「都」字。两条都漏在 r1 §6.2 之外。U13 守的是「共用处置段只出一次」，语义不变，只换锚点 | r2 §6.2 hooks.test 行补两条旧新对照：U13 切割锚点改为「处置：用 git status」；U2 改断言「要重跑须先作废这一轮：闸门停在待裁决时 review --start 拒绝重跑」 |
| AGY-02 | gemini | minor | 接受 | 属实：`gate.test.ts:815-819` 的正向锁 `/snapshot\.drift/`，在 r1 §2.4 的确证格文案下不再命中。它守的是 `base.ts` 误杀排障指纹（该形态 drift 恒 false），新规则下那一形态归放行告警格，告警文案含「snapshot.drift.changed 为 false」。与 GLM-01 同一处 | r2 §6.2 gate.test:775 行：正向锁迁到放行告警格（断言告警含「snapshot.drift.changed 为 false」）；确证格断言改锁「git status / git diff」与复算摘要；注释说明指纹迁移 |
| AGY-03 | gemini | nit | 接受 | 属实：设计文档 :2569「一被调用即以 `MCP:` 前缀进写事件、判只读失守、整侧作废，与 `Bash` 同档」，「整侧作废」与 r1 §1.4 核出的事实不符（失守从不作废某侧），与 :2101 同源 | r2 §7 设计文档落点加 :2569 |
| CODEX-01 | codex | minor | 接受 | 属实：`cli.ts` 在 `--check` 通过后按 run.json 的 `entry` 迁移闸门（A 或读不到 entry 回 `idle`，B/C/D 立 `awaiting_approval`）。A 格只断言 Hook 放行，咬不住「放行是真的状态迁移」 | r2 §6.1 A 格补机制说明与断言：闸门状态由 `review_done_awaiting_disposition` 迁到 `idle`（夹具走 `--entry A`）；B 格保留「停在原地」断言对偶 |
| CODEX-02 | codex | nit | 接受 | 属实：`judgeDrift`（`freeze.ts:631-633`）把 scratch 白名单内的路径整体剔除，写进那里的东西同样不在复算面内。决策二的清单是用户拍板的，告警文案不扩；只在风险节如实登记 | r2 §8 R2 补一句：scratch 白名单内的写入同样看不见，不在决策二清单内、告警不点名，属接受的盲区 |
| GLM-01 | glm | minor | 接受 | 与 AGY-02 同一处，属实（见上） | 同 AGY-02 |
| GLM-02 | glm | nit | 接受 | 与 AGY-01 第二半同一处，属实（见上） | 同 AGY-01 |
| GLM-03 | glm | minor | 接受 | 属实：`probes/claude.ts:477` 已导出 `judgeReadonlyBreach(o: { breached; completed })`（返回布尔或 null 的三态），语义与签名都不同；同名会让 grep、注释交叉引用与变异定位撞车。`classifyReadonlyBreach` 在 `src/` 下无同名 | r2 §2.1 函数改名 `classifyReadonlyBreach`，类型改名 `ReadonlyBreachClass`；§3、§6.3 同步；变异 find 锚点用含函数体的唯一片段，不按函数名定位 |

## 2. 不涉及驳回与暂缓

本轮无驳回、无暂缓。

## 3. 对 r1 自身的补充更正（非审查意见）

- r1 §2.4 确证格的处置句写「要重跑须先作废这一轮」，§3 的 `breachLines` 末行又写一遍「要重跑须先作废这一轮：……」，Hook 失守段会出现两次同义句。r2 把这半句从 `READONLY_BREACH_TRIAGE` 里拿掉，只留在 `breachLines` 末行；`gate --check` 的 failure 文案改在 TRIAGE 之后单独补一句「要重跑须先作废这一轮」，两面各说一次。
