---
schema: trivium.disposition.v1
topic: 限流器重构
stage: code
role: claude
kind: response
run_id: 20260925T163113Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
---

# 限流器重构 · 代码审查应答（第 2 轮）

第 1 轮（run `20260925T155608Z`）codex 侧 `qwen3.8-max` 跑满 1200s 超时、未带 `--allow-single`，整次失败、无闸门；本轮换 `--model-codex qwen3.8-flash` 重跑，补丁不变。

最重的一条是 AGY-01：钳位分支改写的 `now` 比真实时间**大**（取队尾），又被传进 `reclaim`，抬高了全局回收基准，会把尚在窗口内的其它 key 整 key 删掉、令其重获满额——真超发，必须修。
CODEX-02 驳回：热 key 每次调用都被删后重插到队尾，按定义坐不上队头；队头永远是最久未被触碰的 key，它的驻留有界，早停只造成有界的回收延迟，不会停摆。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 反例在「now 反映真实时间」前提下不超发：钳位那次请求被拒、未压入，之后 (1901, 2901] 内只放行 2900、2901 两次；超发只在「此前的时间戳本身是走快的时钟写下的」时出现，已属头注释时钟假设被破坏的情形。但用例名「不超发」与头注释对钳位档的表述确实过强，只改措辞与补用例，不改实现 | `src/limiter.ts` 头注释钳位档改为「本次调用不超发；长期上界依赖时钟假设，回拨后又恢复的形态见下」；`test/limiter.test.ts` 用例改名并补「小幅回拨后紧接 +windowMs 步进」一例，钉住当前语义 |
| CODEX-02 | codex | major | 驳回 | 前提不成立：allow 对放行与拒绝都删后重插，热 key 每次调用都移到插入序末尾，不可能「稳坐队头」；队头恒为最久未被触碰的 key。插入序确非严格按时间戳单调（被拒请求以旧队尾重插），但队头 key 不再被触碰，其队尾至多在 windowMs（钳位档另加 ≤ windowMs 的偏差）内过期，早停造成的是有上界的回收延迟，不是无界驻留；外部持续对热 key 注入回拨也只让该 key 自身留在队尾 | 无修改。在头注释补一句「插入序近似活跃序，早停带来的回收延迟 ≤ 2×windowMs」，随 CODEX-01 同一处改动落笔 |
| CODEX-03 | codex | major | 接受 | 属实：3-1 裁决 CODEX-10 接受了「本轮初始化 package.json」，本轮未兑现，属未声明的计划偏离 | 新增 `package.json`：`"type": "module"`、`scripts.test` = `node --test test/limiter.test.ts`、`engines.node` = `>=23.6`（类型剥离默认开启的下限） |
| CODEX-04 | codex | minor | 接受 | 构造校验是新增失败模式、别名指向新语义，这两点对纯 JS 调用方没有任何信号，应写明；不做参数归一化——把 `'5'` 静默转成 5 会掩盖调用方的类型错误，与校验的初衷相反 | README 新增「迁移说明」一节：构造参数校验（非正整数 limit、非正 windowMs 抛 RangeError）、旧名别名已指向滑动窗口语义 |
| CODEX-05 | codex | minor | 接受 | 属实，3-1 裁决 CODEX-11 的落点含「README 同步」 | README 描述改为滑动窗口日志，并入 AGY-04 一并改 |
| CODEX-06 | codex | minor | 接受 | 阈值边界与故障档「清空后放行 1 次」都没被钉住 | `test/limiter.test.ts` 补三例：回拨恰等于 windowMs（钳位、拒发）、恰大于 windowMs（清空、放行 1 次后再拒）、回拨后紧接 +windowMs 步进（与 CODEX-01 共用） |
| CODEX-07 | codex | nit | 暂缓 | 成立但当前三处调用点都有 `size > 0` 守卫，不构成缺陷；Ring 的不变量收拢适合在下一轮把 Ring 抽成独立模块时一起做 | 下一轮 Ring 抽模块时加空队列断言与 push 越界防护 |
| AGY-01 | gemini | major | 接受 | 复核成立：`else now = q.last()` 改写入参，钳位后的值大于真实 now，经 `this.reclaim(now, …)` 抬高 cutoff，队头区间 (真实 now − windowMs, 队尾 − windowMs] 内的 key 被误删并重获满额，是真超发 | `src/limiter.ts` allow 内引入局部 `t` 专用于本 key 的淘汰与压入，`reclaim` 传未改写的原始 `now`；补「一个 key 回拨不影响其它 key 驻留」用例 |
| AGY-02 | gemini | minor | 接受 | 属实：3-1 裁决 CODEX-04 接受了「§4 补前跳用例」，本轮未兑现；sweep 早停分支也无断言 | `test/limiter.test.ts` 补前跳用例（前跳后名额一次恢复，并注明这是已声明的时钟假设后果）与「sweep 遇未过期 key 即停、只回收其前的过期 key」用例 |
| AGY-03 | gemini | minor | 接受 | 与 CODEX-03 同一问题 | 同 CODEX-03（新增 `package.json`） |
| AGY-04 | gemini | nit | 接受 | 与 CODEX-05 同一问题，另要求补回滚说明，3-1 裁决 CODEX-11 已承诺 | README 同步类名、别名过渡期与「状态纯内存、回滚即重新部署」一句 |
