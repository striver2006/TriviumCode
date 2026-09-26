---
schema: trivium.disposition.v1
topic: 缓存过期策略
stage: plan
role: gemini
kind: revised
run_id: 20260925T233826Z
addresses:
  - CLAUDE-01
  - CLAUDE-02
  - CLAUDE-03
  - CLAUDE-04
  - CLAUDE-05
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
---

# 缓存过期策略 · 计划审查裁决（r1 → r2）

> 执笔说明：本轮 gemini 为名义 Driver（M10b 第 4 步 3-3 夹具轮），本裁决件实际由 Claude 会话代写。

两侧独立核出同一个主问题：§2「过期条目在有限时间内释放、不依赖再访问」与 §3.2 / §3.3 的机制对不上。释放只由对该键的 `get`
或下一次 `set` 的头部连续段清理触发，只读或低频写入时过期条目可以无限期驻留，§5 自己也承认了（CLAUDE-01 ≡ CODEX-01）。
r2 不引入定时器，把 §2 改成可验收的口径：释放不晚于该键的下一次 `get`、或下一次 `set` / `get` 的头部检查；条目总数由 `capacity` 封顶。
同时让淘汰优先挑头部附近已过期的条目（CODEX-02）。两侧同指的还有：文档落点悬空（CLAUDE-04 ≡ CODEX-06）、
`size` 放宽与「零改动」的口径（CLAUDE-02，与 CODEX-05 的签名口径合并处理）。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | blocker | 接受 | 复核成立：头部段清理遇到第一个未过期条目即停，被挡在后面、又不再被访问的冷条目在容量未满时永不释放，正是 §1 第 2 个问题的原型；§2 与 §5 两个口径并存 | r2 §2 第 2 条改为「过期条目的释放不晚于该键的下一次 `get`，或下一次 `set` / `get` 的头部检查扫到它；条目总数上界由 `capacity` 保证，不承诺时间上界」；§3.3 头部检查扩到 `get` 命中路径，每次至多查 k（默认 4）条；§5 第 1 条改写为与 §2 一致的已知限制 |
| CLAUDE-02 | claude | major | 接受 | 调用语法不变但 `size` 的行为契约变了，「零改动」只在语法层成立；采纳「限定措辞」一支，不采纳并存的精确 `liveSize`：精确计数要么全表扫描、要么第二套按过期序的索引，与本轮不引入第二套顺序的取舍冲突 | r2 §2 第 3 条改为「既有调用形式不变，仅追加可选参数；`size` 由精确值放宽为上界，列入接口变更清单」；§3.4 注明不提供精确有效条目数及原因 |
| CLAUDE-03 | claude | minor | 接受 | 「不处理」本身保留（codex 侧同样认可），但缺判断依据；回拨的后果是晚过期，正好在回拨窗口内重现 §1 的陈旧数据问题，必须写明 | r2 §5 时钟回拨条补依据：进程内内存缓存、无持久化，墙钟回拨通常为 NTP 的秒级校正；后果是受影响条目晚过期约等于回拨幅度，陈旧窗口同量级；日后改用单调时钟是局部改动，不构成返工 |
| CLAUDE-04 | claude | minor | 接受 | 类头 JSDoc 与 README 都写着「没有过期」，实施后必然失实，计划漏列 | r2 新增 §3.5「文档落点」：类 JSDoc 承载过期、`size` 上界、释放保证与时钟回拨的说明；README 改掉「不带过期」一句；两项列进范围 |
| CLAUDE-05 | claude | minor | 接受 | `size` 上界是 r1 写进文档的契约，没有用例固化，改松或改紧都不会被发现 | r2 §4 补一条：写入若干条目、推进时间使部分过期但不触发清理，断言 `size` 大于有效条目数且不超过 `capacity` |
| CODEX-01 | codex | blocker | 接受 | 与 CLAUDE-01 同一问题；采纳建议 (a)，把目标改成可验收的释放保证，不引入定时器 | 同 CLAUDE-01（r2 §2、§3.3、§5）；§4 补「只 `get` 不 `set` 时，头部过期条目在 k 次命中内被释放」用例 |
| CODEX-02 | codex | major | 接受 | 复核成立：超容淘汰固定删头部一条，头部未过期而其后有过期条目时删掉的是活条目，有效容量随 TTL 分布浮动 | r2 §3.3 超容淘汰改为先在头部至多 k 条内删已过期者，都未过期才删头部；§3.4 写明 `capacity` 约束的是条目总数（含过期）、有效容量 ≤ `capacity` 且可能更低；§4 补对应用例 |
| CODEX-03 | codex | major | 接受 | 夹具仓库只跟踪 README.md 与 src/cache.ts，没有 package.json / tsconfig / runner，§4 无从执行 | r2 新增 §4.0「测试前提」：本轮初始化 package.json，用 `node --test` 配合类型剥离直跑 TS，测试文件放 `test/cache.test.ts` |
| CODEX-04 | codex | minor | 接受 | 边界全部未定；`ttlMs = 0` 会写入永远读不到、却占容量名额的条目，与 CODEX-02 叠加 | r2 §3.1 补边界表：`undefined` 用默认；`Infinity` 表示不过期；0、负数、`NaN` 抛 `RangeError`；非数字（含 `null`）抛 `TypeError`；`defaultTtlMs` 按同一规则在构造时校验，与 `capacity` 先例一致；§4 补边界用例 |
| CODEX-05 | codex | minor | 接受 | 定下 §4.0 后，`node:test` 的 `mock.timers` 可以接管 `Date.now`，时钟不必进公开签名；r1 §2「构造不改签名」与 §3.1 新增构造参数的口径也确实不一 | r2 §3.1 撤回时钟注入，缺省且唯一的时钟源为 `Date.now`；构造签名写明为 `(capacity, defaultTtlMs?)`；§2 措辞同 CLAUDE-02 的落点 |
| CODEX-06 | codex | nit | 接受 | 与 CLAUDE-04 同一问题 | 同 CLAUDE-04（r2 §3.5） |
