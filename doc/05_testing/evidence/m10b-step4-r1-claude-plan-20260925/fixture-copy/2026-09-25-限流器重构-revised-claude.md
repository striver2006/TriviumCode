---
schema: trivium.disposition.v1
topic: 限流器重构
stage: plan
role: claude
kind: revised
run_id: 20260925T153032Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - CODEX-08
  - CODEX-09
  - CODEX-10
  - CODEX-11
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
---

# 限流器重构 · 计划审查裁决（r1 → r2）

两侧独立核出同一组主问题：§3.2 的空队列删除是死分支（CODEX-01 ≡ AGY-01）、sweep 外包与「调用方零改动」矛盾（CODEX-02 ≡ AGY-02）、
时钟回拨的钳位没有损害上界（CODEX-03 ≡ AGY-04）、类名语义脱节（CODEX-11 ≡ AGY-05）。r2 的回收方案改为 AGY-03 提出的
「Map 插入序即活跃序」：每次 `allow` 把 key 删后重插到队尾，于是 Map 队头永远是最久未活跃的 key，
`allow` 顺带检查队头常数个 key 即可均摊回收，`sweep` 遇到第一个未过期 key 即停。这一处改动同时承接 CODEX-01 / 02 / 06 与 AGY-01 / 02 / 03。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | blocker | 接受 | 复核成立：§3.1 放行时刚压入 now、拒绝时队列长度为 limit，limit ≥ 1 时 allow 结束队列必非空，该分支不可达；r1 把它写成两条回收路径之一，掩盖了回收全押在 sweep 上 | r2 §3.2 删去空队列删除；改为 allow 末尾检查 Map 队头至多 k（默认 2）个 key，队尾过期即整 key 删除；§4 补「只调 allow、不调 sweep 时闲置 key 被回收」用例 |
| CODEX-02 | codex | blocker | 接受 | 新增须周期调用的方法就是新义务，与「零改动」自相矛盾；时钟域不同源会静默超发或泄漏 | r2 §2 改为「allow 签名不变；回收在 allow 内均摊完成，调用方零改动」；§3.2 sweep 降为可选的批量回收，`now` 缺省 `Date.now()`，写明须与 allow 同一时钟域，从不调用时由均摊回收兜底 |
| CODEX-03 | codex | major | 接受 | 永久回拨下钳位到未来队尾会造成与回拨幅度等长的全量拒绝，且 sweep 回收不了该 key；r1 未把这写成刻意的 fail-closed | r2 §3.3 分两档：回拨幅度 ≤ windowMs 按队尾钳位；> windowMs 判为时钟故障，清空该 key 历史后按 now 重新计数（有界 fail-open），并写明最坏拒绝时长 ≤ windowMs |
| CODEX-04 | codex | major | 接受 | 前跳让淘汰线一次越过整条队列，数毫秒内可放行 2×limit；§2 的无条件上界不成立 | r2 §2 第 1 条改为带前提的承诺（now 单调不减且与真实时间偏差远小于 windowMs）；§3.3 写明前跳不做特殊处理及其后果；§4 补前跳用例 |
| CODEX-05 | codex | major | 接受 | 均摊 O(1) 取决于队列结构，Array.shift 在大 limit 下线性退化，实测数据与 §5 设想区间重合 | r2 §3.1 定为定长环形缓冲（容量 limit，头下标 + 长度），复杂度表述改为对该结构成立；§5 大 limit 阈值引用本条实测数据 |
| CODEX-06 | codex | major | 接受 | 内存上界应是「回收延迟内出现过的 key 数 × limit」，r1 写成「活跃 key 数」不准确 | r2 §2 第 2 条改写；§3.2 写明均摊回收下闲置 key 的驻留上界（最后命中 + windowMs 之后，下一次任意 allow 或 sweep 时回收），并给出预期基数（10⁵ 量级）下的内存估算 |
| CODEX-07 | codex | major | 暂缓 | 成立，但容量阀门触顶时拒绝新 key（fail-closed，合法用户被挤出）还是淘汰最旧 key（fail-open，限流失效）是产品取舍，需要负责人拍板，不宜由 Driver 在计划里代定 | r2 §5 补「key 基数由外部流量 / 攻击者决定，本轮不防 key 基数型内存放大」的已知限制，并列为下一轮决策项 |
| CODEX-08 | codex | minor | 接受 | 淘汰判据 ≤ now − windowMs 等价于半开区间，与 §4「下一个窗口开头」的两读措辞冲突 | r2 §3.1 声明窗口为 (now − windowMs, now]，与现有 >= 语义一致；§2 上界按半开区间表述；§4 边界用例写具体时间戳 |
| CODEX-09 | codex | minor | 接受 | 「删除……的项」可读成只删队尾元素，与 §4 的整 key 断言不一致 | r2 §3.2 改为「队尾过期即删除整个 key」，并补一句为何只看队尾（队列升序，队尾即最新） |
| CODEX-10 | codex | major | 接受 | 夹具仓库无 package.json / tsconfig / runner，§4 无从执行；断言私有 hits 与实现强耦合 | r2 新增 §4.0「测试前提」：本轮初始化 package.json，用 `node --test` 配合类型剥离直跑 TS；新增只读 `size` getter 作为可观测接口并列入接口变更清单；为 CODEX-02 / 04 与 §5 两条风险各补一条用例 |
| CODEX-11 | codex | major | 接受 | 当前零 import 点，是改名唯一免费的窗口；回滚成本极低但计划没写 | r2 新增 §3.4「迁移与回滚」：类改名为 SlidingWindowLimiter，保留 FixedWindowLimiter 作为 @deprecated 别名一个版本；README 同步；写明状态纯内存、回滚即重新部署 |
| AGY-01 | gemini | blocker | 接受 | 与 CODEX-01 同一问题，推理一致 | 同 CODEX-01（r2 §3.2 均摊回收） |
| AGY-02 | gemini | blocker | 接受 | 与 CODEX-02 同一问题；所给「allow 路径均摊分批淘汰」正是 r2 采用的方向 | 同 CODEX-02（r2 §2、§3.2） |
| AGY-03 | gemini | major | 接受 | 全表遍历在预期基数下可接受（codex 实测 10 万 key 3.6ms），但借 Map 插入序维护活跃序后 sweep 可在首个未过期 key 处停止，成本降为 O(过期 key 数)，且让 allow 内均摊回收成为可能，收益明确 | r2 §3.1 allow 放行与拒绝时都把 key 删后重插；§3.2 sweep 按插入序遍历、遇未过期即停；§5 删去「全表遍历本轮不做分批」一条 |
| AGY-04 | gemini | major | 接受 | 与 CODEX-03 同一问题；单调时钟建议已评估：allow 的 now 是调用方传入的 epoch 毫秒，换时钟域属接口级变更、与 §2 兼容目标冲突，r2 不采用但写明结论 | 同 CODEX-03（r2 §3.3），另在 §3.3 末尾记录单调时钟的评估结论 |
| AGY-05 | gemini | minor | 接受 | 与 CODEX-11 同一问题；保留旧名别名兼顾两侧建议 | 同 CODEX-11（r2 §3.4） |
