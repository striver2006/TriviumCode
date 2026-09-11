---
schema: trivium.disposition.v1
topic: M4-M5实现
stage: code
role: claude
kind: response
run_id: 20260911T025329Z
addresses:
  - 2026-09-11-M4-M5实现-r3-gemini.md
  - 2026-09-11-M4-M5实现-r3-glm.md
---

# 代码审应答：M4-M5实现（第 3 轮）

## 0. 应答总览

glm 侧 10 条：**接受 9 条、驳回 0 条、暂缓 1 条**。
gemini 侧本轮 `parse_fallback`（agy 吐了两个首尾相接的 JSON 对象），按 §6.6 规则 8
不参与阻断判定，但其 6 条意见我**照样逐条裁决**，见第 3 节。

最要紧的是闸门状态机的两条，两侧**独立收敛到同一处**：

- **闸门迁移是无条件覆盖**（GLM-r2-01）：`setGate` 不比较 `prev.state` / `prev.run_id`，
  于是「对旧轮 `--check` 放行」「`--cancel` 旧 run」「旧轮未裁决就重跑」三种正常操作序列
  都会把**正在跑的新一轮**护栏清掉。
- **worker 异常路径不回收闸门**（GLM-r2-02 ≡ AGY-01）：`finally` 里想到了锁、漏了闸门，
  业务写锁要挂到 24h TTL。这正是我自己在 `executeRun` 注释里写下的
  「比不拦更糟，因为人会去改配置绕开 Hook」的形态。

两侧在背靠背状态下收敛到同一处，这本身就是双审有效的证据。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-r2-01 | glm | major | 接受 | 逐行核实成立。`setGate` 确为 `s.gates[key]=entry` 无条件赋值；`cancelRun` 回收闸门时只判 `s?.stage`，而回收锁时却有 `existing.run_id===runId` 守卫——锁想到了、闸门漏了，同一个函数里两套标准 | `state.ts`：`setGate` 增加 `expect` 条件（`prev.state` / `prev.run_id`），在 `updateState` 的持锁回调内做比较交换；`cli.ts` 的 `--check` 放行仅当 `prev.run_id === 本次校验的 runId`；`cancelRun` 仅回收 `prev.run_id === 被取消 run` 的闸门；`prepareRun` 置 `running` 前若 prev 是别的 run 的 `review_done_awaiting_disposition` 则拒绝启动。补「r1 待裁决 + r2 running」集成用例 |
| GLM-r2-02 | glm | major | 接受 | 与 AGY-01 独立命中同一处。实读 `workerMain` 的 catch 只 `patchStatus`、`finally` 只处理锁；`startRun` 在 `prepareRun` 之后的 catch 同理；`waitRun` 的 `worker_lost` 分支也不回收 | 在 `workerMain` 的 finally、`startRun` 的后置 catch、`waitRun` 的 `worker_lost` 三处补闸门回收，配合 GLM-r2-01 的条件迁移（仅当闸门仍记着本 run_id）。补「worker 中途崩溃后闸门必须回 idle」集成用例 |
| GLM-r2-03 | glm | major | 接受 | 与 AGY-04 独立命中同一处，且比我自己的实现想得更远：清单来自被核对对象自身，删 `run.json`、删整个主题目录、把目录改名为 `_`/`.` 前缀都能整枝绕过。`task.json.runs[]` 是现成的外部锚而我没用 | `hooks.ts`：核对改以 `task.json.runs[]` 为锚，反查每个登记过的 run 的 `run-<id>.json` 是否存在且可解析；损坏的 `run.json` 按「记录在案却不可读」拦截而非跳过。补三条用例：删 run.json、删整目录、目录改名 |
| GLM-r2-04 | glm | major | 接受 | 实读确认 `util/git.ts:127` 就是 `tracked.code === 0 ? tracked.stdout : ''`。`--base` 是用户参数，拼错时已跟踪变更**全部消失**而未跟踪文件让 body 非空，空判定不触发——两侧「认真审完」的是一段残缺变更。本次我只给 `diffAgainst` 加了 excludes，没动这行 | `util/git.ts`：`tracked.code !== 0` 时抛错（回显 base 原值与 stderr 摘要），让错误 `--base` 在冻结前失败且零工件；untracked 段同理。补用例：坏 base → 退非 0 且 `.reviews/` 零变化 |
| GLM-r2-05 | glm | minor | 接受 | 成立。`meta.artifacts` 只收 `writeArtifact` 的两份审查文档，`changes.diff` 与两份 brief 走 `writeMeta` 从不登记；且 `changes.diff` 是固定文件名，重跑会把上一轮的被审对象整体覆盖。hook 文案承诺的范围与实现不符 | `review.ts`：把 `changes.diff` 与两份 brief 一并写入 `run.json.artifacts`；`code` 阶段核对时额外比对现存 `changes.diff` 与 `snapshot.subject_sha256`。补用例：删 changes.diff 应被拦 |
| GLM-r2-06 | glm | minor | 接受 | 成立且方向性正确：错在**漏审**而非多审。`core.quotePath=false` 只解决可打印非 ASCII，文件名含双引号/控制字符时 git 仍加引号，该行不匹配→文件从清单消失→`classifyDiff` 可能误判 doc_only。同仓库 `statusPorcelain` 已有去引号实现而 `filesInDiff` 没复用 | `code-stage.ts`：`filesInDiff` 补去引号（复用 `statusPorcelain` 的写法）；补「引号路径业务文件 + 全文档 → 不得判 doc_only」分类用例 |
| GLM-r2-07 | glm | minor | 接受 | 成立。`--only build` 而 build 未配时，落盘记录会写「两组**均为空**」——审计记录里出现与事实不符的陈述，这比少写一句更糟。`--timeout abc` 静默回退默认值也确实零提示 | `verify.ts`：`unconfigured` 仅当两组皆空；`--only` 选中组为空时另立 `selected_empty` 并据实渲染；`cli.ts` 的 `--timeout` 解析失败退 64 并回显原值 |
| GLM-r2-08 | glm | minor | 接受 | 成立。`verify` 记录是 AC-10 的对账凭证，却完全不在留痕核对的保护范围内——可以被删被改而不拦，与 hook 文案的普适承诺不一致 | 把 `'verify'` 纳入 `listRecordedRuns` 的阶段清单，并让 `runVerify` 登记其两份工件。补用例：删 verify 记录应被拦 |
| GLM-r2-09 | glm | minor | 接受 | 成立，且正中该模块自述的纪律。`loadLatestVerify` 把「记录损坏」渲染成「尚无 verify 记录」，恰好是 P5 要防的误读 | `report.ts`：`loadDisposition` 的 readFile 包 try/catch 转 notes；`loadLatestVerify` 解析失败时写 notes「最近一份 verify 记录损坏（文件名）」而非返回 null |
| GLM-r2-10 | glm | minor | 暂缓 | 问题成立（`resolveTopic` 无条件 `ensureDir`，`report --topic 拼错名` 会凭空建目录并给出空报告）。暂缓不是因为不重要，而是因为它和 GLM-r2-05 都要动 `review.ts` 的落盘顺序与 `topic.ts` 的建目录时机，两处一起改才不会互相打架。**条件**：与 GLM-r2-05 同一批改，若该批未能在本里程碑内完成则单独提交 | `cli.ts` 的 `cmdReport`/`cmdVerify` 改用 `resolveTopicReadOnly`，缺主题时报 65 并给候选；或给 `resolveTopic` 加 `create` 开关。与 GLM-r2-05 合并实施 |
| AGY-01 | gemini | blocker | 接受 | 与 GLM-r2-02 同一处：worker 异常退出不回收闸门，业务写锁挂到 24h TTL | 见 GLM-r2-02 的修改计划；`releaseRunningGate` 三处统一回收 |
| AGY-02 | gemini | blocker | 接受 | 独有发现且成立：`gate --await-approval` 只 setGate、零前置校验，直接调用它再 approve 即可完全跳过逐条裁决与工件核验。人工审批是加在「机器已确认裁决齐备」之上的一道，不是替代品 | `cli.ts` 的 `--await-approval` 前置跑一次 `checkAdjudication`，不通过退 2 并打印缺口 |
| AGY-03 | gemini | major | 驳回 | **实测不成立**：`git diff --no-index /dev/null new.ts` 输出 `diff --git a/new.ts b/new.ts`，git 已归一化，`/dev/null` 只出现在 `---` 行而 `filesInDiff` 只解析 `^diff --git` 行；本次真实 changes.diff 的 48 项清单里也确实没有 dev/null。`code-stage.ts` 早有同结论的注释与单测 | 不改 |
| AGY-04 | gemini | major | 接受 | 与 GLM-r2-03 同一处。glm 的版本更完整（多给了「删整目录」「目录改名」两条绕过路径与 task.json 外部锚的建议），按 glm 的方案实施 | 见 GLM-r2-03 的修改计划 |
| AGY-05 | gemini | minor | 接受 | 独有发现且成立：`hookPreCommit` 复用了 `approval_lock_scope` 的会话过滤，非当前会话的提交不被拦。但**裁决完整性是仓库的属性、不是会话的属性**——写锁按会话是 RV-05 的刻意设计，提交拦截不该沿用 | `hooks.ts` 去掉 pending 的会话过滤，仅 `block_commit` 开关控制 |
| AGY-06 | gemini | nit | 接受 | 成立：`buildFixture` 在 try 之外，夹具初始化失败会泄漏临时目录且无结构化诊断 | `selftest.ts` 把 buildFixture 移进 try，失败时清理并返回结构化诊断 |

## 2. 双方共同指出的问题

两侧背靠背，仍独立收敛到同两处，**优先修**：

| 共识项 | glm | gemini |
| :--- | :--- | :--- |
| worker 异常退出不回收闸门，写锁挂到 24h TTL | GLM-r2-02 (major) | AGY-01 (blocker) |
| 留痕完整性核对的清单来自被核对对象自身，可整枝绕过 | GLM-r2-03 (major) | AGY-04 (major) |

gemini 判 AGY-01 为 blocker、glm 判 GLM-r2-02 为 major。**按较高者处理**：
它会让开发者在一次崩溃之后 24 小时内无法改任何业务文件，而人的第一反应是去关掉 Hook——
护栏一旦开始误伤，第一个被关掉的就是它自己。

## 3. 关于 gemini 侧的解析降级

本轮 gemini 侧被判 `parse_fallback`，当时 `gate --check` 的 `fallback_ids` 为空，
其 6 条意见不在机读校验范围内——所以初稿把它们放在这一节单独裁决，避免触发
`unknown_findings`。

**修掉解析缺陷之后情况变了**：`gate` 会用**当前**解析器重试历史 `parse_fallback`
原文（§6.6 规则 8 的既定行为——解析器修好之后，旧的运行不该继续背着一个已经不存在
的缺陷），于是 AGY-01～06 全部解析成功并进入机读校验。它们已并入第 1 节的主表。

这条连锁反应本身是个好信号：**留痕是可复核的**，工具变好之后旧记录会跟着变准，
而不是被冻结在当初那次失败里。

## 4. 本轮未覆盖

- **gemini 侧的 `parse_fallback` 本身是一条缺陷线索，不在上面任何一条里**：
  agy 1.2.0 输出了**两个内容完全相同、首尾相接的 JSON 对象**（解析在位置 6785 处撞上第二个的起始
  `{`），并带 `toolAction` / `toolSummary` 噪声字段。`extractJsonCandidate` 目前只取一个候选。
  这会让一侧的完整结论在**每次**都被降级成 `parse_fallback`、失去阻断资格——按新发现处理，
  另立一条修复（多对象时逐个尝试、取首个通过 schema 校验者），不塞进本轮裁决表。
- 两侧都没看 `doc/` 下新增的三份文档（QUICKSTART / PROTOCOL / GUIDE）的**内容正确性**，
  只看了代码。文档与实现的一致性本轮无人核对。
- 本轮补丁 277 KB / 48 文件，是一次里程碑的全部变更，**不是**一个正常的审查单元。
  两侧都只能做抽样深读（glm 读 15 文件、gemini 读 44 文件），覆盖面必然有限。

---

## 5. 实施记录（S9，2026-09-11）

14 条接受项全部实施完毕，分四批提交。每批都补了对应用例——**用例本身逮到过
两处实施缺口**（`gate --check` 的放行路径漏改、`worker_lost` 分支拿不到
topic/stage），这两处若只靠类型检查和既有用例都发现不了。

| 编号 | 落点 | 提交 |
| :--- | :--- | :--- |
| GLM-r2-01 | `state.ts` 新增 `setGateChecked`（`expect` 比较-交换，比较与写入同锁内）；`review.ts` / `cli.ts` / `run-protocol.ts` 三处调用点分别按 ①②③ 收紧；③ 改为**拒绝启动**并给出补裁决与 `abandon` 两条出路 | `90898f1` |
| GLM-r2-02 ≡ AGY-01 | 新增 `releaseRunningGate`，worker finally / startRun 后置 catch / `--wait` 的 `worker_lost` 三处统一回收 | `90898f1` |
| AGY-02 | `--await-approval` 前置跑一次 `checkAdjudication`，不过退 2 | `90898f1` |
| AGY-05 | `hookPreCommit` 去掉会话过滤——裁决是仓库的属性 | `90898f1` |
| GLM-r2-03 ≡ AGY-04 | 两个外部锚：`task.json.runs[]` 反查 run.json 存在且可读（损坏按违例拦）；`git diff --name-status HEAD` 捕获已提交归档文件的删改（治「删整个目录」） | `9b61de1` |
| GLM-r2-05 | `changes.diff` 与两份 brief 进 `run.json.artifacts`；executeRun 收尾改为**追加**而非替换 | `9b61de1` |
| GLM-r2-08 | verify 写 run.json 并 `registerRun`；`listRecordedRuns` 纳入 `'verify'`；`TaskMeta.runs[].stage` 放宽为 `StageOrVerify` | `9b61de1` |
| AGY-06 | `buildFixture` 移进 try，失败时清理并返回结构化诊断 | `9b61de1` |
| GLM-r2-04 | `diffAgainst` 对 tracked / untracked 的非零退出一律抛错并回显原值 | `7c37d73` |
| GLM-r2-06 | 抽出 `unquoteGitPath`，`filesInDiff` 与未跟踪枚举复用；形态取自实测 | `7c37d73` |
| GLM-r2-07 | `unconfigured` 仅两组皆空；新增 `selected_empty`；`--timeout` 坏值退 64 | `1329765` |
| GLM-r2-09 | `loadDisposition` 读失败进 notes；新增 `verifyUnreadable` 区分「损坏」与「从未验证」 | `1329765` |
| GLM-r2-10 | report / verify 改用 `resolveTopicReadOnly`；report 对不存在的主题退 65 并列候选 | `1329765` |

**GLM-r2-10 原裁决是「暂缓」**，条件是「与 GLM-r2-05 同一批改」。GLM-r2-05 已在
第二批落地，条件达成，故在第四批一并完成——暂缓不是搁置，是附条件的延后。

测试 472 → 503（+31），`npm run check` 全绿。
