---
schema: trivium.disposition.v1
topic: 留痕字段与误报小修
stage: code
role: claude
kind: response
run_id: 20260926T151155Z
addresses:
  - 2026-09-26-留痕字段与误报小修-codex.md
  - 2026-09-26-留痕字段与误报小修-gemini.md
  - 2026-09-26-留痕字段与误报小修-glm.md
---

# 应答：留痕字段与误报小修 · 代码双审第 1 轮

> 被审对象：`_meta/changes-20260926T151155Z.diff`（相对 `661be7b` 的 33 个文件）
> ｜ 运行：`20260926T151155Z`（11m23s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve`（零意见）
> ｜ 共 5 条：次要 2 ｜ 吹毛求疵 3 ｜ 零阻断
> ｜ **5 条全部接受**。同指一组：CODEX-04 ≡ AGY-01（E1 用修改时间钉先后，依赖时间戳粒度）。

## 0. 本轮的形状

四个焦点三侧都核过：
- **① 位置与失败出口**：三侧都认为「排在 `patchStatus` 之前 ⇒ 进程中断后再跑 `--cancel` 可补齐」成立，E6 证明归档侧失败不连坐锁与闸门回收。codex 另指出一格我没写准的：**单步写失败**（不是进程中断）之后，`patchStatus` 照常落终态，此后没有重试入口（CODEX-01）。
- **② task 登记同步**：三侧认为独立判据与精确匹配完整；codex 核出 `.task-<topic>` 锁若被猝死的 worker 持有，`judgeStale` 的 pid_gone 判据会回收，不会卡死。文档只写了三档跳过里的两档（CODEX-03）。
- **③ 正则**：codex 证明新匹配集是旧集的子集并复跑 `ev127-measure.mjs` 读数一致；glm 核对前界与主设计 §6.5 逐字符一致。codex 核出 consulted 一侧没做 `./` 归一（CODEX-02）。
- **④ 桩与报告**：三侧都认为 `hang` 只经 `TRIVIUM_STUB_CRITIC` 可达、报告 §3 属实。codex 与 gemini 都提了 E1 的时间戳粒度前提（CODEX-04 ≡ AGY-01）。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：两步异常都转成 skipped 后，`cancelRun` 照常 `patchStatus` 把 status.json 落终态，此后 `--cancel` 在 :804 终态分支早退——「可重入」只对**进程中断**成立，对**单步写失败**不成立；可达形态是 task 锁争用（`withTopicLock` 重试用尽即抛）或临时写错误，结果是 run.json 与 task.json 登记分叉。codex 给了两个方向，取 (b)：改 :804 终态分支会碰「不追溯改写」这条纪律，r2 也把 :804 的语义列为不动；(b) 把口径写准，并让当场的告警把这件事说出来 | ①`run-protocol.ts` `reportFinalizeStep`：异常转成的跳过，告警尾部加一句「这一步不会再有第二次机会：status.json 随后落终态，再跑 --cancel 会早退，请人工核对归档 run.json 与 task.json 登记」；E6 断言补这一句。②主设计 6.7 注记、LLD :452 一段、MANUAL 场景 4、`meta.ts` `finalizeCancelledRunMeta` 文档注释：「可重入」限定为「进程中断」，写明单步写失败当轮无第二次机会、需人工对账。③报告 §3 补一条登记 |
| CODEX-02 | codex | minor | 接受 | 属实：`./` 只在 evidence 抽取侧剥掉，consulted 集合原样比对，两侧同写 `./src/…` 会被误标——正是 EV-127 要消灭的那类误报，也不在 EV-143 登记的三类残余里。已用只读脚本核过本仓 383 份历史审查件：consulted 里带前导 `./` 的条目为 0，归一后读数仍为 64 / 96，C4 期望不变 | `parse.ts` `checkReviewIntegrity`：consulted 集合构造时对每条去掉前导 `./`（与抽取侧同一个小函数）；`parse.test.ts` 补 U8（evidence 与 consulted 都写 `./src/a.ts` ⇒ 不报）；变异规格加一条（去掉 consulted 侧归一 ⇒ U8 红）；报告 §2 读数与 §3 补登 |
| CODEX-03 | codex | nit | 接受 | 属实：实现里第二步有三档跳过——run.json 不是 cancelled、登记里找不到这轮、登记已不是 running；文档只写了前两档 | 主设计 6.7 注记与 LLD :452 一段把第二步的跳过写成三档；PROTOCOL `review` 行同步半句 |
| CODEX-04 | codex | nit | 接受 | 属实：E1 用纳秒 mtime 严格小于钉先后，依赖文件系统时间戳粒度。失效方向是假红（同刻度时判红），不会假绿；APFS 下可靠。改成「小于等于」会在粗粒度卷上让 M12 假绿，得不偿失，所以只写明前提 | `run-protocol.test.ts` E1 注释补「依赖纳秒级时间戳（APFS / ext4 等）；粗粒度文件系统上可能假红，不会假绿」；报告 §3.3 补同一句 |
| AGY-01 | gemini | nit | 接受 | 同 CODEX-04；gemini 建议的三种做法里，放宽到相等会削弱 M12 的鉴别力，插延迟会给生产路径加测试专用的东西，取「注释写明前提」 | 同 CODEX-04 |

## 2. 不改的部分

- `cancelRun` 的顺序、两步的前提与独立判据、自身不抛的失败出口，三侧都认同，不变。
- :804 终态早退的语义不动（CODEX-01 取 (b)，理由见上）。
- 正则本身与不核范围不变；CODEX-02 只在 consulted 一侧补同样的归一。
- 无驳回、无暂缓。

## 3. 下一步

审批通过后按本件落点修改，重跑全量检查、变异（含新增一条）与零配额验收，再请用户决定提交。
