---
schema: trivium.disposition.v1
topic: Windows原子写重试
stage: plan
role: glm
kind: revised
run_id: 20261027T091039Z
addresses:
  - 2026-10-27-Windows原子写重试-codex.md
  - 2026-10-27-Windows原子写重试-gemini.md
  - 2026-10-27-Windows原子写重试-claude.md
---

# 裁决：Windows原子写重试 · 计划双审第 1 轮

> 被审对象：`2026-10-27-Windows原子写重试-glm.md`（r1）
> ｜ 运行：`20261027T091039Z`（7m12s）
> ｜ 结论：codex `pass-after-changes` ｜ gemini `pass-after-changes` ｜ claude `pass`
> ｜ 共 12 条：重要 1（gemini）｜次要 5｜吹毛求疵 3｜降级件 5（codex，缺 `confidence` 字段，不参与阻断）
> ｜ **12 条全部以「接受」为主裁决；CODEX-02 的内容级防护子建议驳回**（分析部分接受，理由列写明）。

计票：1 通过 / 2 修改后通过 / 0 不通过 → **修改后通过**。r2 计划：`2026-10-27-Windows原子写重试-r2-glm.md`。

## 0. 本轮的形状

三侧对 r1 的核心结论一致认同：win32 三码有界重试的范围划定、775 ms 上界论证、三调用点处置（lock 仲裁不重试 / review 同口径 / ledger 并入 writeAtomic）、注入面设计、零配额纪律、回滚面。claude 侧独立复核了全部仓库事实（rename 恰 4 处、writeAtomic 恰 8 个消费模块、not ok 357 原文、hooks 15/15/15/30、主设计 v1.3.181），无一失实。意见集中在四处真缺口（等待侧锁预算数值、延迟写者交错、实测握手与观测口径、POSIX 零变化辖域）与四处顺带项（onExhausted 异常防护、三码参数化、P-xx 补登、run-files-parity 首匹配）。全部按意见修订进 r2。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major（降级件） | 接受 | 重试睡眠发生在持锁区间内、抬高全局锁持有时长——真缺口，r1 只论证了本进程 Hook 预算。已补数值比较：`withGlobalLock` 缺省等待预算 **40 次重试 × 100 ms ≈ 4 s**（`lock.ts:481-482`，`updateState` 即用此缺省 `state.ts:146`），持锁新增 ≤775 ms 占预算 19%、余量 5 倍；Hook 侧 15 s 占 5%——不给等待方引入取锁超时这一新失败模式。重试留在锁内（移出持锁区间会制造「锁已放、rename 未落」窗口，得不偿失） | r2 §1.3 B2、§6.1 R2、§7 D1；数值表随报告留档 |
| CODEX-02 | codex | major（降级件） | 接受 | 分析部分成立：重试确实改变竞态结局分布——「延迟的较旧写在较新写之后静默成功」在 win32 上是新交错（今天以响亮失败收场）。r2 新增 §3.5 逐文件分析：state.json 经 `withGlobalLock` 串行无此面；status.json 是唯一无锁并发写面（`status.ts:132-137` 直写），`heartbeat_at` 回退 ≤ 快照年龄（秒级），对 30 s 心跳与 120 s 失联阈值是噪声；**POSIX 上这一交错自始存在**（rename 覆盖打开中的文件在 POSIX 成功），本修正把 win32 对齐到跨平台既有语义。T6 注释口径改写为钉「最后一次成功 rename 胜」的形式语义并引用 §3.5。**内容级防护子建议驳回**：心跳取 max / 序号拒退是跨平台 status 语义变更，超出本主题授权；回退窗口 ≤775 ms 距最近判定阈（30 s）余量 38 倍以上，过度设计——如未来有真实症状按新主题立项 | r2 §3.5（新增）、§4.1 T6 注释、§6.2 登记行、§7 D7 |
| CODEX-03 | codex | major（降级件） | 接受 | 两场景确实缺同步握手且「次数 ≥2」在缺省参数下不可观测。修法：PS 侧 `File.Open` 成功后向 stdout 打 READY 行，node 读到才发起 `writeAtomic`（场景 B 按柄确认后才计时）；次数断言改为时序边界口径 | r2 §4.3 第 2/3 条 |
| CODEX-04 | codex | minor（降级件） | 接受 | 「POSIX 路径行为零变化」辖域写过宽、与 C 调用点处置自相矛盾。修法：§0 限定为「fsx.ts 的 POSIX 分支与 B 调用点」；C 调用点的 POSIX 可观察差异（残件形状 `.tmp` → `.tmp-<pid>-<ts>`、mkdir→ensureDir）移 R5 单独声明并补 `LEDGER_RE` 判据出处（`doctor-deadline.ts:98`） | r2 §0 不做栏、§6.1 R5 |
| CODEX-05 | codex | minor（降级件） | 接受 | 场景 B 的 0.7～1.5 s 上界偏紧：`onExhausted` 的 `fs.rm maxRetries:3`（Node 缺省 retryDelay ~100 ms/次）可再加 ~0.3 s，叠加抖动在慢机上造假红。放宽为 **0.7～3 s**，会计随文 | r2 §4.3 第 4 条 |
| AGY-01 | gemini | major | 接受 | r1 §3.1 JSDoc 里「onExhausted 自身异常……顶替原错误抛出」与任务书「抛最后一次原始错误」及 §3.2 优先级声明自相矛盾——写岔了。统一为原始错误最高优先：`renameOverwriting` 在调用 `onExhausted` 时原语内自带 try/catch 防护，清理回调异常一律吞掉、绝不顶替原始错误；防护放原语内而非依赖调用方自觉 | r2 §3.1 实现轮廓与 JSDoc、§7 D6 |
| AGY-02 | gemini | minor | 接受 | T1/T2 只构造 EPERM，实现漏判 EACCES/EBUSY 时用例不红——成立。T1/T2 改为对三码各跑一格（T1×3、T2×3），T8 变异口径同步加「删掉任一码必红」 | r2 §4.1 T1×3、T2×3、T8 |
| AGY-03 | gemini | nit | 接受 | 「脚本自记」无落点——与 CODEX-03 / CLAUDE-02 同点，并入同一修法：时序边界推断（成功耗时下界证明发生过睡眠），不用计数钩子 | r2 §4.3 第 3 条 |
| CLAUDE-01 | claude | minor | 接受 | 与 CODEX-02 同族且影响面评估成立（state.json 有锁、status.json 心跳回退 <1 s、30 s 级判据兜得住）。r2 §6.2 新增登记行：win32 重试使延迟写者可能在较新写入后以较旧快照成功覆盖（窗口 ≤775 ms，仅 status.json 类无锁并发写可见；POSIX 自始有此交错）；BACKLOG 收口行与报告同步带上 | r2 §6.2、§6.3、§5（报告内容口径） |
| CLAUDE-02 | claude | minor | 接受 | 与 CODEX-03 / AGY-03 同点，并入同一修法：§4.3 钉死观测口径（耗时下界 + 内容 / 残件断言） | r2 §4.3 第 3 条 |
| CLAUDE-03 | claude | nit | 接受 | PS 5.1 无 BOM `.ps1` 按 ANSI 读的坑只在记忆与发布脚本先例，P-xx 台账确无（P-34 为最后一条）。§5 文档同步表加一行补登（ASCII-only 或带 BOM、显式 `-Encoding UTF8`），编号编码时按台账末尾顺延 | r2 §2.2 E2、§5 |
| CLAUDE-04 | claude | nit | 接受 | `run-files-parity.test.ts:92` 首匹配抓 `const tmp = \`${target}…\`` 字面量，值得点名。§4.1 接线回归补：实现保持该行为 fsx.ts 首处同形态字面量（`renameOverwriting` 只收 from/to、不拼 tmp 名，天然满足），该用例列入回归面 | r2 §1.1 F5、§4.1 接线回归段 |

## 2. 驳回项的理由汇总

仅 CODEX-02 的**内容级防护**子建议被驳回（该行主裁决仍为接受）：心跳取 max / 序号拒退是跨平台的 status 语义变更，超出「win32 改名重试」主题的授权范围；回退窗口 ≤775 ms，距最近判定阈值（心跳间隔 30 s）余量 38 倍以上，属零余量问题的过度设计。该方向如未来有真实症状，按新主题立项。

## 3. 对降级件的说明

codex 侧 5 条全部因缺 `confidence` 字段降级（其会话内所有文件读取被策略阻止，属本机 codex 接入的已知形态）；但意见本身质量高（CODEX-01/02/03 三条 major 均被代码事实证实），按协议逐条实质裁决如上，不因降级而轻纵。
