# 漂移比不了不放行 · 实施报告（EV-139）

- **日期**：2026-10-01
- **主题**：`漂移比不了不放行`；计划 `.reviews/漂移比不了不放行/plan/`（计划双审 run `20261001T070329Z`：codex `request-changes`、gemini / glm `approve-with-nits`，14 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`40ca534`（`main`，工作树干净；与任务目标写的 `9db67ca` 只差一个只改 BACKLOG 的提交，`src/`、`test/`、`skills/` 逐字相同）；改前构建固定为 `git archive 9db67ca`
- **状态**：实施与验证完成；代码双审 r1（run `20261001T080545Z`）8 条全接受并已按接受项修订（§5）；未提交
- **evidence**：`doc/05_testing/evidence/drift-uncomparable-20261001/`

---

## 1. 问题与改前实证

跑后漂移复算（设计 9.2）第 3.a 步用 `util/git.ts` 的 `diffTrees` 列变更文件，它在 `diff-tree` 非零退出时返回 `[]`；`judgeDrift` 拿到空列表即在 3.b 判 `none`。送审快照的 `tree_hash` 是临时索引 `write-tree` 写出的**不可达对象**——审查期间被立即清理、或 git 出错 / 超时，两棵 tree 明明不同，护栏却说「无漂移」，run.json 记 `changed: false`、退 0。

改前构建（`9db67ca`）零配额验收 B 格实证（§3.1）：审查期间 `git prune --expire=now` 并改 `src/b.ts`，跑后 tree 里 `src/b.ts` 的 blob 确是改后内容（改文件早于复算），而 run.json 记 `changed: false, files: []`、`status: success`、退 0。若复算时送审 tree 还在，旧构建会把这个非自有文件列成 `unrelated`——所以 `changed: false` 同时反证清理也早于复算，即旧构建静默放行。

全仓 `diffTrees` 调用方核过（计划 r2 §1.5）：只有 `judgeDrift` 一处是放行方向；agy / zcode 探针的 `probeScratchPaths` 失败时少认几个临时路径 ⇒ 之后多报漂移，方向保守，不改。

## 2. 逐条落地（按 r2 §2～§4）

| 项 | 落点 |
| :-- | :-- |
| 原因枚举 | `types.ts`：`DRIFT_UNKNOWN_CAUSES`（`object_gone` / `git_error` / `timeout`，唯一来源）、`DriftUnknownCause`、`DriftUnknownReason`、`DRIFT_UNKNOWN_LABEL`、`describeDriftUnknown`；`SnapshotMeta.drift.unknown_reason?` |
| 判定 | `freeze.ts`：`DriftVerdict` 加 `unknown`；`judgeDrift` 3.a′ 两棵 tree 先过 `OBJECT_NAME_RE` 形状闸（不合 ⇒ `git_error`、不回显该值），3.a 改用失败即抛的 `diffTreesNameStatus`（`-z`），抛错交 `classifyCompareFailure` 分原因（超时先行不再查对象；逐棵 `treeExists`，任一不在 ⇒ `object_gone`；其余 ⇒ `git_error`，报错首行截 300 字符）；`driftAction` 对 `unknown` 按 `on_drift_related`；快乐路径仍一次 `diff-tree` |
| 形状闸共用 | `OBJECT_NAME_RE` 从 `worktree-summary.ts` 挪到 `util/git.ts`，前者原样再导出 |
| 文档块 | `diffTrees` 写明「失败返回 `[]`，只能用在失败方向保守的地方」与当前唯一调用方；`diffTreesNameStatus` 文档块改为现状（`judgeDrift` 也用它） |
| 告警 | `guard.ts` `renderGuardWarnings` 新增 `unknown` 一格（原因、策略、出口：核对后重跑、别在审查中立即清理、改 `warn` 会连带放宽真实相关漂移）；`switch` 加 `never` 穷尽性断言（计划双审 GLM-03） |
| 留痕 | `review.ts`：`snapshot.drift.policy` 对 `unknown` 取 `on_drift_related`，另写 `unknown_reason`；审查文档传 `driftUnknown` |
| 人读面 | `render.ts` 旗标换成「审查期间的工作树漂移无法判定」（front-matter 不加键）；`report.ts` 推「漂移无法判定」旗标；`meta.ts` `summarizeRun` 打同名一行——三处都不再落到「0 个文件」或一声不吭 |
| schema | `run.v2.json` `snapshot.drift.properties.unknown_reason`（`cause` 三值、`detail` 字符串、`additionalProperties: false`）；`drift` 子对象本身不加 `additionalProperties`，只取加法 |
| 测试桩 | `adapters/stub.ts` 新形态 `prune_objects`：项目根在系统临时目录之下才执行 `git prune --expire=now` 并改一个文件，否则该侧按失败返回（计划双审 CODEX-04） |
| 文档 | 主设计 v1.3.70（9.2 第 3.a′ 步与两条要点、6.7.1 新行、8.5 摘要注记补时点、12 章异常表漂移行、变更记录）；LLD v1.1.27；MANUAL v1.0.25（漂移表与「比不了」出口段）；PROTOCOL（第四节算法块、可选字段段落）；BACKLOG（EV-139 done、新登 EV-180；排序快照不动）；本索引；PRD 核后不改 |

**相对计划 r2 的一处偏离**：r2 §2.1 把 `DRIFT_UNKNOWN_LABEL` 与 `describeDriftUnknown` 放在 `freeze.ts`。编码时发现 `freeze.ts` 已引用 `render.ts`（`parseFrontMatter`），`render.ts` 再从 `freeze.ts` 取排版函数会成环，于是两者放进 `types.ts`、紧挨原因枚举——单一来源与「四个消费方共用一份排版」的意图不变。

**`--wait` 的落点**：护栏告警写进 status.json 的 `message`，由 `--wait --json` 原样带出；人读的 `--wait` 只打进度，这是全部护栏告警的既有行为，本主题不改。集成用例 I1 / I2 因此按 `--wait --json` 断言。

## 3. 读数

### 3.1 零配额验收（`acceptance.mjs` → `acceptance-readout.json`、`acceptance-output.txt`）

两份 bundle sha256 不同（改前 `ac20127b2a82…`、改后 `5fe73c51ef08…`），改前不含 `unknown_reason`。每格 gemini `ok`、glm `hang_cli`（`sleepS: 60`，窗口长度）+ `--allow-single`，所以都是单审降级轮（`review_mode: partial`）；双审形状由集成 I1 承担。`--start` 返回时骨架 run.json 已含 `tree_hash`，脚本随即清理并改文件（清理发生在启动后 0.27～0.43 s），三格都首次即命中窗口（跑后 tree 含改后 `src/b.ts`），无重试。

| 格 | 构建 | `changed` | `unknown_reason` | `policy` | status / 退出码 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| A（无清理） | 改前 | false | — | warn | success / 0 |
| A（无清理） | 改后 | false | — | warn | success / 0 |
| B（清理，缺省） | 改前 | **false**（静默放行） | — | warn | success / 0 |
| B（清理，缺省） | 改后 | true | `object_gone`：送审快照的 tree 〈12 位〉 在审查期间被清理 | **fail** | **failed / 1** |
| C（清理，`on_drift_related: warn`） | 改后 | true | `object_gone` | warn | success / 0 |

改后 B 格终态 message 含「审查期间工作树有变动，但比不了改了哪些文件」与「策略 fail」；C 格含「请人工核对」。外部 `cat-file -e 〈tree_hash〉` 在清理后退 1（旁证）。15/15 判据通过。

**V0**（git 2.54.0）：不可达 tree 在缺省 `git gc` 与 `git maintenance run --task=loose-objects` 之后仍在（`cat-file -e` 退 0），`git gc --prune=now` 之后不在（退 1），`diff-tree` 退 128、`fatal: bad object`。`diffTrees` 与 `diffTreesNameStatus` 在 `9db67ca~100` 与 `9db67ca` 两棵 tree 间输出同集（2192 个文件；14 ms / 9 ms）；本仓一次 `workTreeHash` 932 ms——比对本身远不到 120 s 超时，超时一格只在仓库已不健康时出现（计划 r2 §7）。

### 3.2 单测与集成

| 套件 | 新增 | 读数 |
| :-- | :-- | :-- |
| `test/unit/freeze-drift.test.ts` | U1、U1′、U2、U3、U4、U5、U6、U7、U9（既有 10 条原样） | 19 / 19 |
| `test/unit/drift-unknown.test.ts`（新） | G1、G2、G3、R1、R2、S1 | 6 / 6 |
| `test/unit/run-meta-strict.test.ts` | C1（schema 枚举 ≡ `DRIFT_UNKNOWN_CAUSES`）、C2（合法 / 表外 / 缺 detail / 多键 / 旧形） | 全绿 |
| `test/unit/report.test.ts` | 「漂移无法判定」旗标一格 | 全绿 |
| `test/integration/fault-injection.test.ts` | I1（缺省 fail、退 1、run.json 四字段、`--wait --json` message、审查文档旗标、桩指纹）、I2（warn、退 0） | 37 / 37 |

Node 18.20.8 / 22.23.3（`npx` 缓存）跑上表七个套件加 `worktree-summary`：141 / 141、141 / 141（`node18.txt` / `node22.txt`）。

### 3.3 变异

源码变异按坑清单两步：先用本目录 `mutation-names.mjs` 逐条带 `--test-timeout` 预跑（**相对 `lock-reclaim-enoent-20260930/` 原版唯一改动：重建用 `--with-tests`**——M7 / M8 的期望套件是走打包产物的集成用例，只重建测试产物会让变异进不了 bundle、预跑假绿），15 条全红、无挂死（`mutation-names-log.txt`、`mutation-names-output.json`）；再跑 `scripts/mutation-check.mjs`（规格由 `gen-mutation-spec.mjs` 从源码截锚点、逐条核唯一）：**15 / 15 咬住**（`mutation-output.txt`）。

| 编号 | 变异 | 期望套件 fail 数 |
| :-- | :-- | :-- |
| M1 | 3.a 换回 `diffTrees` | 5 |
| M2 | 比对失败返回 `none` | 4 |
| M3 / M4 | `unknown` 改跟 `on_drift` / 恒 `warn` | 1 / 1 |
| M5 | 去掉超时分支 | 1 |
| M6 | 不用 `treeExists` 的结果 | 2 |
| M7 / M8 | run.json `policy` 不含 `unknown` / 不写 `unknown_reason`（集成） | 1 / 2 |
| M9 | 告警的 `unknown` 分支直接 `break` | 3 |
| M10 / M11 / M15 | report 旗标 / 审查文档旗标 / `summarizeRun` 一行 | 1 / 1 / 1 |
| M12 | 严格比对去掉 `-z` | 7（含中文路径、自有前缀、scratch 等既有格与 U7） |
| M13 | 去掉形状闸 | 1 |
| M14 | 去掉桩的临时夹具自缚 | 1 |

schema 变异（`contract-mutations.mjs` → `contract-mutations-output.txt`；K4 改的是活工作树里的源 schema，有意偏离「活工作树不动」的既有口径，理由与崩溃恢复见脚本头注，代码双审 CODEX-04）：K1 枚举放宽、K2 去掉 `additionalProperties: false`、K3 `required` 去掉 `detail`（改 `dist/test/` 拷贝，咬 C2），K4 源 schema 枚举少一项（咬 C1）——**4 / 4 咬住**。

## 4. 全量检查与 doctor

| 项 | 读数 |
| :-- | :-- |
| `npm run check` 第一次（修订前，文档全部改完之后） | 2463 / 2461 / 0 / 2（`check-1.txt`） |
| `npm run check` 第二次 | 2463 / 2461 / 0 / 2（`check-2.txt`） |
| `doctor --selftest`（工作树构建） | 14 / 14（`doctor-selftest.txt`） |

两次都没撞到已知偶发红（EV-149 / EV-153）。

## 5. 代码双审 r1 与修订

run `20261001T080545Z`（约 8 分 53 秒）：codex `approve-with-nits`（次要 2、吹毛求疵 2）、gemini `approve-with-nits`（吹毛求疵 1）、glm `approve-with-nits`（吹毛求疵 3），8 条全接受（应答件在 `.reviews/漂移比不了不放行/code/`）。

| 意见 | 修订 |
| :-- | :-- |
| CODEX-01 ≡ GLM-03（比不了路径最坏时长） | `classifyCompareFailure` 的两次 `treeExists` 共用 `DRIFT_PROBE_BUDGET_MS`（120 s），逐次显式传剩余毫秒；设计 9.2 要点与 LLD 3.3 写明最坏「比对 120 s + 核对至多 120 s」；新增 U5′（经可选注入参数看到传给核对的预算）、M16 |
| CODEX-02 ≡ GLM-02（120 s 字面量与 message 正则） | `util/git.ts` 导出 `GIT_DEFAULT_TIMEOUT_MS`（`git()` 缺省值改用它），`GitTimeoutError` 加结构字段 `what`；超时文案由两者排版；U5 改为由常量推出期望值 |
| CODEX-03（读侧单行） | `describeDriftUnknown` 只取 `detail` 首行；G3 加多行一格 |
| CODEX-04（K4 动活工作树源 schema） | 选「写明偏离」：`contract-mutations.mjs` 头注写明理由（C1 钉的就是仓库里那份源 schema）、崩溃残留的发现与恢复方式；§3.3 同 |
| AGY-01（「tree值」缺空格） | 形状闸 `detail` 改为「〈which〉 值不是合法的 git 对象名（不回显该值）」，U9 同步 |
| GLM-01（LLD 过期行号） | 「退出码判定优先级」改指 `review.ts` `executeRun` 收尾段，不写行号 |

**修订后读数**：目标套件（七个，含 `worktree-summary`）142 / 142；源码变异规格按新源码重生（`mutation-spec.r1.json`，16 条：M5 锚点随源码更新、M16 新增），逐条预跑 16 条全红、无挂死（`mutation-names-log.r1.txt`），装置 **16 / 16 咬住**（`mutation-output.r1.txt`）。零配额验收与 schema 变异沿用修订前读数：修订没改 `object_gone` 那一格的判定、文案与留痕形状（只改超时与形状不合两格的 `detail` 措辞、核对的超时预算），也没改 schema。

| 项 | 读数 |
| :-- | :-- |
| Node 18.20.8 / 22.23.3 目标套件 | 142 / 142、142 / 142（`node18.r1.txt` / `node22.r1.txt`） |
| `npm run check` 第一次 / 第二次 | 2464 / 2462 / 0 / 2 两次（`check-1.r1.txt` / `check-2.r1.txt`；比修订前多 U5′ 一条） |
| `doctor --selftest` | 14 / 14（`doctor-selftest.r1.txt`） |

## 6. 暂缓与已知缺口

- **EV-180**（新登）：降低成因——审查期间钉住送审 tree（建 ref / `.keep` 包 / 冻结时落清单三档均未取，理由见 BACKLOG 与计划 r2 §6）；触发条件：出现一次带 `unknown_reason` 的失败轮即评估。
- 超时一格（`timeout`）只有单测（U5，直接喂 `GitTimeoutError`），真实仓库里造不出 120 s 的 `diff-tree`；验收只实测了 `object_gone`。
