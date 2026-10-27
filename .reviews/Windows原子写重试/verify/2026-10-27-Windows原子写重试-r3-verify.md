# 编译测试记录 · Windows原子写重试

- **运行**：`20261027T103125Z`
- **结论**：❌ 失败
- **起止**：2026-10-27T10:31:25.809Z → 2026-10-27T10:40:05.285Z
- **项目根**：`C:/Work/TriviumCode`

## 一、执行的命令

| # | 组 | 命令 | 退出码 | 耗时 | 命令 sha256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | build | `npm run typecheck` | 0 | 9.9s | `982c1455e5e7` |
| 2 | build | `npm run build` | 0 | 5.2s | `16c0e4305ac2` |
| 3 | test | `npm test` | 1 | 504.3s | `328e123c6385` |

> `命令 sha256` 取命令原文，用于与配置对账（AC-10）。

## 二、输出摘要

### `npm test`（test，退出码 1）

**stdout（尾部）**

```text
…（已省略前 18928 行）
  type: 'test'
  ...
# Subtest: G2 名单外 ⇒ 证据不可信：不失守、不动禁读与证据判定，告警点名
ok 3078 - G2 名单外 ⇒ 证据不可信：不失守、不动禁读与证据判定，告警点名
  ---
  duration_ms: 1.5343
  type: 'test'
  ...
# Subtest: G3 两档同时成立、互不覆盖
ok 3079 - G3 两档同时成立、互不覆盖
  ---
  duration_ms: 2.1005
  type: 'test'
  ...
# Subtest: G4 都没有 ⇒ verification 上没有 untrusted 这个键（结构上缺席）
ok 3080 - G4 都没有 ⇒ verification 上没有 untrusted 这个键（结构上缺席）
  ---
  duration_ms: 1.6805
  type: 'test'
  ...
# Subtest: G5 MCP: 条目不参与归因扣除：括号里恰好是漂移文件的路径也不扣（GLM-01 的可杀构造）
ok 3081 - G5 MCP: 条目不参与归因扣除：括号里恰好是漂移文件的路径也不扣（GLM-01 的可杀构造）
  ---
  duration_ms: 3231.378
  type: 'test'
  ...
# Subtest: G6 证据不可信参与归因：漂移落进「无法归因」、不记开发者手改（AGY-01）
ok 3082 - G6 证据不可信参与归因：漂移落进「无法归因」、不记开发者手改（AGY-01）
  ---
  duration_ms: 2132.6812
  type: 'test'
  ...
# Subtest: G7 无不可信侧、能力都可用 ⇒ 归因与改前相同（开发者手改）
ok 3083 - G7 无不可信侧、能力都可用 ⇒ 归因与改前相同（开发者手改）
  ---
  duration_ms: 2045.7394
  type: 'test'
  ...
# Subtest: G8 MCP 执行型调用参与归因：写事件里没有路径，漂移不得记成开发者手改（计划 r2 §7 偏离 2）
ok 3084 - G8 MCP 执行型调用参与归因：写事件里没有路径，漂移不得记成开发者手改（计划 r2 §7 偏离 2）
  ---
  duration_ms: 1868.7659
  type: 'test'
  ...
# Subtest: G9 只有能力恒态这一种成因时，「无法归因」文案与改前逐字相同
ok 3085 - G9 只有能力恒态这一种成因时，「无法归因」文案与改前逐字相同
  ---
  duration_ms: 2263.5299
  type: 'test'
  ...
# skip（win32）: zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）
# Subtest: dist\\test\\test\\unit\\zcode-model-selection.test.js
ok 237 - dist\\test\\test\\unit\\zcode-model-selection.test.js
  ---
  duration_ms: 1022.4334
  type: 'test'
  ...
# skip（win32）: zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）
# Subtest: dist\\test\\test\\unit\\zcode-provider-env.test.js
ok 238 - dist\\test\\test\\unit\\zcode-provider-env.test.js
  ---
  duration_ms: 948.7697
  type: 'test'
  ...
# skip（win32）: zcode HOME 隔离夹具按 POSIX env HOME 写死，win32 需 USERPROFILE 一并适配（登记残余清单）
# Subtest: dist\\test\\test\\unit\\zcode-runtime-selection.test.js
ok 239 - dist\\test\\test\\unit\\zcode-runtime-selection.test.js
  ---
  duration_ms: 824.0746
  type: 'test'
  ...
# Subtest: 抠 envelope：容忍前置告警行（不能用 JSON.parse(trim) ）
ok 3089 - 抠 envelope：容忍前置告警行（不能用 JSON.parse(trim) ）
  ---
  duration_ms: 3.3154
  type: 'test'
  ...
# Subtest: 抠 envelope：字符串里的花括号不破坏配平
ok 3090 - 抠 envelope：字符串里的花括号不破坏配平
  ---
  duration_ms: 1.6417
  type: 'test'
  ...
# Subtest: 抠 envelope：转义引号不破坏配平
ok 3091 - 抠 envelope：转义引号不破坏配平
  ---
  duration_ms: 0.2998
  type: 'test'
  ...
# Subtest: 抠 envelope：无 JSON 时返回 null 而非抛异常
ok 3092 - 抠 envelope：无 JSON 时返回 null 而非抛异常
  ---
  duration_ms: 0.4758
  type: 'test'
  ...
# Subtest: 解析 envelope：正文在 .response，且记录全部字段名
ok 3093 - 解析 envelope：正文在 .response，且记录全部字段名
  ---
  duration_ms: 0.6521
  type: 'test'
  ...
# Subtest: 回读生效模型：envelope 没有 model 字段，只能从日志 context.model 取（AC-13）
ok 3094 - 回读生效模型：envelope 没有 model 字段，只能从日志 context.model 取（AC-13）
  ---
  duration_ms: 1.2666
  type: 'test'
  ...
# Subtest: 按 sessionId 过滤：共享 HOME 下多会话交织不得混入
ok 3095 - 按 sessionId 过滤：共享 HOME 下多会话交织不得混入
  ---
  duration_ms: 0.7019
  type: 'test'
  ...
# Subtest: 只统计 completed 的工具调用，failed 不算证据
ok 3096 - 只统计 completed 的工具调用，failed 不算证据
  ---
  duration_ms: 0.9607
  type: 'test'
  ...
# Subtest: 写工具与 Bash 计入 writeEvents（只读失守信号）
ok 3097 - 写工具与 Bash 计入 writeEvents（只读失守信号）
  ---
  duration_ms: 1.4704
  type: 'test'
  ...
# Subtest: 解析 turn.failed 的结构化根因
ok 3098 - 解析 turn.failed 的结构化根因
  ---
  duration_ms: 1.3897
  type: 'test'
  ...
# Subtest: sessionId 传 null 时全收（独立 HOME 下日志天然隔离）
ok 3099 - sessionId 传 null 时全收（独立 HOME 下日志天然隔离）
  ---
  duration_ms: 0.4516
  type: 'test'
  ...
# Subtest: rollout：工具参数里的路径可提取（标准日志没有这个信息）
ok 3100 - rollout：工具参数里的路径可提取（标准日志没有这个信息）
  ---
  duration_ms: 1.0259
  type: 'test'
  ...
# Subtest: rollout：回读生效模型的全限定形态与来源档位
ok 3101 - rollout：回读生效模型的全限定形态与来源档位
  ---
  duration_ms: 0.6139
  type: 'test'
  ...
# Subtest: rollout：写工具与 Bash 计入 writeEvents
ok 3102 - rollout：写工具与 Bash 计入 writeEvents
  ---
  duration_ms: 1.0364
  type: 'test'
  ...
# Subtest: rollout：坏行与无 toolCalls 的行被跳过而非抛异常
ok 3103 - rollout：坏行与无 toolCalls 的行被跳过而非抛异常
  ---
  duration_ms: 5.3154
  type: 'test'
  ...
# Subtest: 模型名补全：短名按探针回读的 providerId 补前缀
ok 3104 - 模型名补全：短名按探针回读的 providerId 补前缀
  ---
  duration_ms: 31.2016
  type: 'test'
  ...
# Subtest: 模型名补全：已是全限定形态时原样返回
ok 3105 - 模型名补全：已是全限定形态时原样返回
  ---
  duration_ms: 0.393
  type: 'test'
  ...
# Subtest: 模型名补全：探针没给出前缀时原样传，不瞎猜
ok 3106 - 模型名补全：探针没给出前缀时原样传，不瞎猜
  ---
  duration_ms: 0.3127
  type: 'test'
  ...
# Subtest: 模型名补全：providerId 含斜杠时只切最后一段
ok 3107 - 模型名补全：providerId 含斜杠时只切最后一段
  ---
  duration_ms: 0.599
  type: 'test'
  ...
# Subtest: 模型名补全：null 模型返回 null
ok 3108 - 模型名补全：null 模型返回 null
  ---
  duration_ms: 0.4539
  type: 'test'
  ...
1..3108
# tests 3129
# suites 0
# pass 3082
# fail 4
# cancelled 0
# skipped 43
# todo 0
# duration_ms 498722.8812
```

**stderr（尾部）**

```text
npm notice run triviumcode@1.3.2 pretest
npm notice run node scripts/build.mjs --with-tests

  skills\dual-critic\scripts\trivium.cjs  1.8mb

Done in 87ms

  dist\install.cjs  294.0kb

Done in 20ms

  dist\test\test\integration\gate-loop.test.js  635.7kb
  dist\test\test\unit\hooks.test.js             304.3kb
  dist\test\src\trivium\run-protocol.js         302.2kb
  dist\test\src\trivium\review.js               300.5kb
  dist\test\src\trivium\cli.js                  294.2kb
  ...and 332 more output files...

Done in 237ms
npm notice run triviumcode@1.3.2 test
npm notice run node scripts/run-tests.mjs "dist/test/**/*.test.js"
```

### `npm run typecheck`（build，退出码 0）

**stderr（尾部）**

```text
npm notice run triviumcode@1.3.2 typecheck
npm notice run tsc --noEmit
```

### `npm run build`（build，退出码 0）

**stdout（尾部）**

```text
构建标识：6e5f313（作用面内有未提交改动），inputs 337a6a8fac20
```

**stderr（尾部）**

```text
npm notice run triviumcode@1.3.2 build
npm notice run node scripts/build.mjs

  skills\dual-critic\scripts\trivium.cjs  1.8mb

Done in 84ms

  dist\install.cjs  294.0kb

Done in 20ms
```

---

> ❌ 有命令非零退出，全流程状态为 `failed`。已产生的计划 / 审查 / 应答工件全部保留，
> 不因本次失败而删改（设计 §14.2）。修复后重跑会另起一份记录，本文件不被覆盖。
