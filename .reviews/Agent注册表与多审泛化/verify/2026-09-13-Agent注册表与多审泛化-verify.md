# 编译测试记录 · Agent注册表与多审泛化

- **运行**：`20260913T123426Z`
- **结论**：✅ 通过
- **起止**：2026-09-13T12:34:26.016Z → 2026-09-13T12:35:59.742Z
- **项目根**：`/Users/chenzhenbo/Work/TriviumCode`

## 一、执行的命令

| # | 组 | 命令 | 退出码 | 耗时 | 命令 sha256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | build | `npm run typecheck` | 0 | 0.8s | `982c1455e5e7` |
| 2 | build | `npm run build` | 0 | 0.2s | `16c0e4305ac2` |
| 3 | test | `npm test` | 0 | 92.8s | `328e123c6385` |

> `命令 sha256` 取命令原文，用于与配置对账（AC-10）。

## 二、输出摘要

### `npm run typecheck`（build，退出码 0）

**stdout（尾部）**

```text

> triviumcode@0.1.0 typecheck
> tsc --noEmit
```

### `npm run build`（build，退出码 0）

**stdout（尾部）**

```text

> triviumcode@0.1.0 build
> node scripts/build.mjs
```

**stderr（尾部）**

```text

  skills/dual-critic/scripts/trivium.cjs  939.7kb

⚡ Done in 22ms

  dist/install.cjs  7.9kb

⚡ Done in 0ms
```

### `npm test`（test，退出码 0）

**stdout（尾部）**

```text
…（已省略前 601 行）
✔ 空主题：如实说「没有轮次」，不渲染成一份看起来干净的报告 (3.842791ms)
✔ 一轮双审：时间线、意见数、严重度分布、生效模型齐备 (30.411833ms)
✔ 归一化后的重合度进表，且未归一化值一并给出 (5.23825ms)
✔ 单侧超时：显示状态而非 0，并进降级清单 (4.667625ms)
✔ 审查完成但无裁决件 → 明确点出，采纳率不按 0 算 (4.73225ms)
✔ 裁决件被解析：采纳率与被驳回项带理由 (5.523875ms)
✔ token 逐侧列出，字符串字段被丢弃而不是累加成垃圾 (9.424875ms)
✔ 漂移与路径 deny 降级进告警清单 (4.641041ms)
✔ 多轮按轮次升序，采纳率跨轮累计 (8.806708ms)
✔ 缺 run.json 的轮次照样出现在报告里，并说明元数据缺失 (0.776709ms)
✔ task.json 的降级与争议项被带进报告 (4.25775ms)
✔ verify 记录损坏 → 如实说损坏，不伪装成「从未验证」 (4.747542ms)
✔ 裁决件读不到不让整份复盘崩溃 (4.416375ms)
✔ 超过 run_dir_days 的终态运行目录被删，新的保留 (6.9375ms)
✔ 仍在跑的运行（worker 活着）无论多老都不动 (5.189958ms)
✔ 没有 status.json 的残留目录按 mtime 处理；run_dir_days 为 0 时不清理 (0.695625ms)
✔ 只清本项目的桶，别的项目的运行目录不碰 (0.56125ms)
· [gemini] 第 1 次尝试，模型 M，上限 900s
⚠️  [gemini] 瞬时故障，重试一次：schema 校验失败
· [gemini] 第 2 次尝试，模型 M，上限 900s
· [glm] 第 1 次尝试，模型 M，上限 900s
⚠️  [glm] 瞬时故障，重试一次：schema 校验失败
· [glm] 第 2 次尝试，模型 M，上限 900s
· [gemini] 第 1 次尝试，模型 M，上限 900s
· [glm] 第 1 次尝试，模型 M，上限 900s
· [gemini] 第 1 次尝试，模型 M，上限 900s
⚠️  [gemini] 瞬时故障，重试一次：schema 校验失败
· [gemini] 第 2 次尝试，模型 M，上限 900s
· [glm] 第 1 次尝试，模型 M，上限 900s
· [glm] 失败原因判定为业务性，不重试：鉴权失败
· [gemini] 第 1 次尝试，模型 M，上限 900s
✔ 瞬时故障可重试：空输出 / schema / 证据不足 / 429 (0.63425ms)
✔ 业务性失败不重试：鉴权、模型非法、配置缺失 (0.066792ms)
✔ 超时不重试（重试大概率再超时，交给失败策略） (0.039667ms)
✔ 成功结果不触发重试判定 (0.0445ms)
✔ 瞬时故障重试一次即成功，且重试的 BRIEF 被追加了失败原因 (0.433125ms)
✔ 重试次数受上限约束，不会无限重试 (0.085833ms)
✔ 两侧真并行，一侧抛异常不连带丢掉另一侧（AC-06） (0.165458ms)
✔ 两侧都成功 → dual，不降级 (0.555083ms)
✔ 严格模式下单侧失败即中止，但幸存侧结果与原因都保留 (0.064709ms)
✔ 降级模式下单侧失败继续，但必须标 single 与原因（不得伪装双审） (0.074084ms)
✔ 两侧都失败：无论什么策略都中止 (0.059708ms)
✔ parse_fallback 侧算「跑成功了」，不触发降级中止 (0.045167ms)
✔ 单侧进展在开始、重试与收口三处各回调一次，attempt 递增 (0.120041ms)
✔ 终态失败也回写，并带上失败原因 (0.076334ms)
✔ 进展回调抛异常不得连累审查本身 (0.056083ms)
✔ 干净文本不误报 (1.4855ms)
✔ 识别 ZCode <id>.<secret> 形态凭据 (0.307042ms)
✔ 识别 JWT (0.091792ms)
✔ 预览已脱敏，不回显原文 (0.050583ms)
✔ 多种前缀 token 均可识别 (0.067583ms)
✔ 行号定位正确 (0.040792ms)
✔ assertNoSecrets 命中时抛出且不含原文 (0.181292ms)
✔ assertNoSecrets 干净内容不抛 (0.055625ms)
✔ 设置与读取闸门 (7.458041ms)
✔ 会话 id 一旦记下不因后续状态变化而丢（写锁作用域判定要用它） (5.694667ms)
✔ 不同主题与阶段互不干扰 (7.959042ms)
✔ listOpenGates 只列未关闭的闸门 (11.220375ms)
✔ state.json 不存在 → 空状态（还没跑过，正常） (0.271958ms)
✔ state.json 存在但坏了 → 抛 StateCorruptError（退出码 2），不得静默当成空 (0.881458ms)
✔ 并发 setGate 不丢更新（经短临界区串行化，GLM-08） (753.131667ms)
✔ 本会话的 awaiting_approval 闸门 → 加锁 (0.211375ms)
✔ 运行中的闸门也加锁（就地模式下审查员正在读真实工作树） (0.056667ms)
✔ 其它会话的闸门 → 只提醒不加锁（RV-05：不锁死开发者的其它编辑） (0.073875ms)
✔ scope=global 时不论会话都加锁 (0.042917ms)
✔ 超过 TTL 的闸门 → 不加锁 (0.041167ms)
✔ 已审批/已拒绝/已放弃的闸门 → 不加锁（三种结论均解除写锁） (0.039292ms)
✔ review_done_awaiting_disposition 不加写锁（那是 hook-stop 的职责） (0.023ms)
✔ 闸门未记录会话 id 时按本会话处理，照样加锁 (0.020333ms)
✔ hook 自己也拿不到会话 id（两边都是 null）时同样加锁 (0.019375ms)
✔ 无闸门 → 不加锁 (0.016208ms)
✔ 闸门时间戳损坏 → 不加锁（宁可放过也不误伤） (0.023166ms)
✔ expect.state 不匹配时不写入，并说明原因 (6.049917ms)
✔ expect.runId 不匹配时不写入——新一轮的护栏不该被旧 run 清掉 (4.752583ms)
✔ expect 匹配时正常写入 (4.874375ms)
✔ 闸门不存在时默认放行——首次置 running 的槽位本来就是空的 (6.805042ms)
✔ 比较与写入在同一把锁内：并发的条件迁移只会成功一个 (112.886542ms)
✔ 新建状态：两侧 pending，非终态 (1.344208ms)
✔ 写入是原子替换，且每次刷新心跳 (9.09325ms)
✔ patchStatus 读改写 (1.403ms)
✔ 同进程并发 patchStatus 串行化：心跳不会把终态回滚成 running (2.490167ms)
✔ 情形 A1：status.json 不存在但进程活着 → inconclusive，继续等 (4.163833ms)
✔ 情形 A2：status.json 不存在且进程已死 → worker_lost (0.285417ms)
✔ 情形 A3：连 pid 都不知道 → worker_lost，不无限等 (0.185084ms)
✔ 情形 A4：文件存在但内容撕裂 + 进程活着 → inconclusive（本次轮询无效） (3.329833ms)
✔ 情形 B：终态直接返回，不再查进程 (0.543833ms)
✔ 情形 C1：非终态 + 心跳新鲜 + 进程活 → running (3.344667ms)
✔ 情形 C2：非终态 + 进程没了 → worker_lost（即使心跳还新鲜） (0.523792ms)
✔ 情形 C3：进程活着但心跳过期 → worker_lost（卡死在某处） (3.394458ms)
✔ 情形 C4：PID 被复用（启动时刻不符）→ worker_lost (1.941625ms)
✔ 进度摘要包含两侧状态、已用时与心跳新鲜度 (0.2085ms)
✔ 传入 budget 时补出期待值：预算、百分比、第几次等待 (0.094916ms)
✔ waits_done 从 1 起算，并在窗口边界进位 (0.046417ms)
✔ 超出单阶段预算时不显示百分比，改说重试收尾 (0.049542ms)
✔ brief 是单行摘要，含阶段、时间段与两侧状态 (0.098333ms)
✔ 时钟回拨：elapsed 为负时钳到 0，不渲染负百分比或「第 0 次」 (0.062166ms)
✔ 时长渲染：不足一分钟按秒，超过则分秒 (0.020583ms)
✔ max_waits 覆盖「单侧超时 × (1+重试)」并留 2 次余量 (0.025833ms)
✔ 窗口收窄到 180s 后 max_waits 自适应（本项目 timeout_s 覆盖值） (0.018208ms)
✔ max_waits 对异常入参不炸（除零保护） (0.018209ms)
✔ 显式 --goal 优先于 task.json 与 plan 原稿 (3.491333ms)
✔ 无 --goal 时回退 task.json 的 goal (2.181625ms)
✔ task.json 无 goal 时回退 plan 原稿的首个标题，跳过 front matter (1.258667ms)
✔ plan 原稿无标题时取首段正文，且不把围栏代码块当标题 (0.96275ms)
✔ 三级来源全空时返回 null，不兜底成主题名 (0.452333ms)
✔ plan 阶段不回退 plan 原稿（被审对象就是它，同义反复） (0.53675ms)
✔ 超长目标被截断到 200 字符加省略号 (0.289833ms)
⚠️  回收主题「.task-登录重构」的遗留锁（原因 unparsable，原持有者 pid ?）
✔ 并发 updateTask 不丢更新（走 .task-<主题> 短临界区） (950.142041ms)
✔ 推导目标不写回 task.json，resolveTaskGoal 全程只读 (1.255708ms)
✔ 切出具名参数，其余为提示语 (0.717542ms)
✔ 支持 --k=v 形式 (0.053375ms)
✔ 引号内的空格被保留 (0.047833ms)
✔ 提示语正文里出现 -- 不会被误当参数（关键用例） (0.07825ms)
✔ 参数名后紧跟另一个已知参数时，值为空而不吞掉下一个 (0.036833ms)
✔ 中文提示语与中文主题都正常 (0.0365ms)
✔ 主题推导：去标点、连字符化、截断 (0.131625ms)
✔ plan 阶段：定位到原稿 (70.913125ms)
✔ plan 阶段：找不到原稿退 65 并列出目录现状 (68.768666ms)
✔ all 阶段（命令 A）：subject_path 为 null，不因原稿不存在而报错 (74.352791ms)
✔ code 阶段：subject_path 为 null，输出 base 与 diff_available (95.86475ms)
✔ code 阶段：无变更时退 65 (99.657334ms)
✔ 关键用例：resolve 新主题后 .reviews/ 下无任何新增 (77.2225ms)
✔ 非法主题名退 64 并给出修正建议 (108.049709ms)
✔ 主题缺省时推导并标记 topic_inferred，便于 skill 回显确认 (117.096209ms)
✔ --focus 与 prompt_hint 的对应统一（AGY-04） (107.592125ms)
✔ 命令 A：正文是任务目标，--focus 是可选补充 (97.364ms)
✔ B/C/D：正文就是审查焦点，用户不必区分目标与焦点 (136.875125ms)
✔ B/C/D：显式 --goal 是已知旗标且贪婪取值，不会被吞进焦点 (156.870583ms)
✔ B/C/D：兼容显式写法 <任务目标> --focus <焦点>——给了 --focus，正文落到目标 (97.600458ms)
✔ B/C/D：主题缺省时从焦点推导，note 说明来源 (81.490916ms)
✔ 焦点里出现白名单旗标字样不再被静默吞掉 (92.473041ms)
✔ 主题被推成单字时给出「疑似被旗标截断」的提示 (65.286458ms)
✔ 正常长度的推导主题不触发该提示 (62.994208ms)
✔ 不加引号时焦点仍会在旗标字样处截断——这是预期行为，靠引号解决 (59.175917ms)
✔ --focus 贪婪取到下一个已知旗标为止，带空格无需引号 (59.842291ms)
✔ B/C/D 什么都没写（无正文、无 --focus）才退 64（FR-20） (58.915666ms)
✔ 命令 A 不要求 --focus：它的焦点本就是可选补充 (59.77025ms)
✔ AGY-04：三个旗标被识别，不再被当成正文吞进审查焦点 (0.113917ms)
✔ AGY-04：--allow-single 是布尔旗标，绝不能吃掉后面的正文 (0.046292ms)
✔ AGY-04：resolveTopicArgs 把三者输出，不静默丢弃 (77.618958ms)
✔ AGY-04：--only 取值当场校验，拼错不必等到 review --start (58.630666ms)
✔ 主题名规范化：空格转连字符；非法名退 64 并带建议 (1.903625ms)
✔ resolveTopicReadOnly 不创建任何目录；resolveTopic 才建阶段目录 (0.92025ms)
✔ listTopics：跳过 . 与 _ 前缀目录与普通文件；归档根不存在返回空 (1.877208ms)
✔ locateSubject：显式路径不存在退 65；存在则原样返回绝对路径 (0.537625ms)
✔ locateSubject：取轮次最大的原稿，忽略裁决件、别的主题与审查文档 (1.90925ms)
✔ locateSubject：同轮多份按文件名倒序取最新日期 (5.767292ms)
✔ locateSubject：没有原稿退 65 并列出目录现状，目录不存在也不抛别的错 (1.033792ms)
✔ topicExists 只看主题目录 (0.483208ms)
✔ 命令顺序为 build 先于 test (1.1445ms)
✔ --only 只取一组 (0.071958ms)
✔ 未配置时命令集为空——绝不回退到猜测的默认命令 (0.050209ms)
✔ assertVerifyConfigured 在两组皆空时抛 64 (0.195542ms)
✔ 全部通过 → success，退 0，两份记录落盘 (17.144875ms)
✔ 任一命令非零 → failed，退 1，绝不宣称成功 (17.319208ms)
✔ build 失败即不跑 test——免得根因被连带失败埋掉 (8.325291ms)
✔ 两组皆空 → 落盘一份「未配置」记录并退 64，而不是静默算通过 (7.092333ms)
✔ 命令原文与其 sha256 一并记录，可与配置对账（AC-10） (8.573458ms)
✔ 走 shell 执行，管道与 && 语义保留 (9.786458ms)
✔ 在项目根执行，而不是在编排器的工作目录 (9.240333ms)
✔ 超时被记录为 timed_out 而非普通失败 (1007.239834ms)
✔ 重跑不覆盖既有记录（P6 只追加） (12.5965ms)
✔ 尾部截断保留末尾并标注省略行数 (0.147834ms)
✔ 渲染把失败项排在输出摘要最前 (0.057917ms)
✔ 表格里的管道符被转义，不破坏 Markdown 表格 (0.030833ms)
✔ 摘要点名失败的命令 (0.066917ms)
✔ --only build 而 build 未配：不得写成「两组均为空」 (3.696167ms)
✔ 两组皆空时仍判 unconfigured (3.673333ms)
✔ verify 的 run.json 用独立 schema 标识，不冒充 trivium.run.v1（AGY-03） (17.61025ms)
✔ 只有 --mode plan 时不可用，并说明原因 (0.66075ms)
✔ 有 --disallowed-tools 即可用 (0.067333ms)
✔ 抠 envelope：容忍前置告警行（不能用 JSON.parse(trim) ） (0.7095ms)
✔ 抠 envelope：字符串里的花括号不破坏配平 (0.505916ms)
✔ 抠 envelope：转义引号不破坏配平 (0.046375ms)
✔ 抠 envelope：无 JSON 时返回 null 而非抛异常 (0.042458ms)
✔ 解析 envelope：正文在 .response，且记录全部字段名 (0.072459ms)
✔ 回读生效模型：envelope 没有 model 字段，只能从日志 context.model 取（AC-13） (0.133167ms)
✔ 按 sessionId 过滤：共享 HOME 下多会话交织不得混入 (0.060375ms)
✔ 只统计 completed 的工具调用，failed 不算证据 (0.052333ms)
✔ 写工具与 Bash 计入 writeEvents（只读失守信号） (0.071041ms)
✔ 解析 turn.failed 的结构化根因 (0.074041ms)
✔ sessionId 传 null 时全收（独立 HOME 下日志天然隔离） (0.050166ms)
✔ rollout：工具参数里的路径可提取（标准日志没有这个信息） (0.171625ms)
✔ rollout：回读生效模型的全限定形态与来源档位 (0.088625ms)
✔ rollout：写工具与 Bash 计入 writeEvents (0.4545ms)
✔ rollout：坏行与无 toolCalls 的行被跳过而非抛异常 (0.099333ms)
✔ 模型名补全：短名按探针回读的 providerId 补前缀 (4.517083ms)
✔ 模型名补全：已是全限定形态时原样返回 (0.052541ms)
✔ 模型名补全：探针没给出前缀时原样传，不瞎猜 (0.03525ms)
✔ 模型名补全：providerId 含斜杠时只切最后一段 (0.042792ms)
✔ 模型名补全：null 模型返回 null (0.038042ms)
ℹ tests 755
ℹ suites 0
ℹ pass 755
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 92543.272583
```

**stderr（尾部）**

```text

  skills/dual-critic/scripts/trivium.cjs  939.7kb

⚡ Done in 17ms

  dist/install.cjs  7.9kb

⚡ Done in 0ms

  dist/test/test/integration/gate-loop.test.js     134.5kb
  dist/test/src/trivium/cli.js                     120.1kb
  dist/test/src/trivium/hooks.js                   108.6kb
  dist/test/test/unit/hooks.test.js                108.6kb
  dist/test/src/trivium/review.js                  108.3kb
  dist/test/src/trivium/run-protocol.js             74.3kb
  dist/test/src/trivium/report.js                   57.8kb
  dist/test/src/trivium/preflight.js                55.2kb
  dist/test/test/unit/gate.test.js                  54.0kb
  dist/test/test/integration/code-stage.test.js     52.9kb
  dist/test/src/trivium/gate.js                     51.8kb
  dist/test/test/unit/init.test.js                  49.0kb
  dist/test/test/unit/topic-args.test.js            46.5kb
  dist/test/test/unit/archive.test.js               46.2kb
  dist/test/src/trivium/probes/zcode.js             44.9kb
  dist/test/test/unit/report.test.js                43.2kb
  dist/test/test/unit/probe-verify.test.js          41.4kb
  dist/test/src/trivium/selftest.js                 40.9kb
  dist/test/src/trivium/archive.js                  40.6kb
  dist/test/src/trivium/probes/verify-commands.js   39.7kb
  ...and 82 more output files...

⚡ Done in 21ms
```

