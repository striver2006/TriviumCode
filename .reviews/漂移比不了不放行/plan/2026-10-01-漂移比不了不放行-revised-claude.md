---
schema: trivium.disposition.v1
topic: 漂移比不了不放行
stage: plan
role: claude
kind: revised
run_id: 20261001T070329Z
addresses:
  - 2026-10-01-漂移比不了不放行-codex.md
  - 2026-10-01-漂移比不了不放行-gemini.md
  - 2026-10-01-漂移比不了不放行-glm.md
---

# 裁决：漂移比不了不放行 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-01-漂移比不了不放行-claude.md`（r1，起点 `40ca534`）
> ｜ 运行：`20261001T070329Z`（约 19 分 14 秒）
> ｜ 结论：codex `request-changes`（重要 2、次要 5、吹毛求疵 1）｜ gemini `approve-with-nits`（次要 2、吹毛求疵 1）｜ glm `approve-with-nits`（吹毛求疵 3）
> ｜ 共 14 条：接受 14、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-01-漂移比不了不放行-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：成立。r1 §6 只比了「建 ref」与「`.keep` 包」，漏了「冻结时把送审 tree 的路径与 blob 清单落成编排器自己的文件，跑后与跑后 tree 的清单在内存里比」这一档；§2.4 只写「重跑花一轮配额」，没给单价；EV-180 的触发条件「出现失败轮才做」确实等于每次都先付一轮。核过这一档的代价：每轮冻结多一次全树 `ls-tree -r`，清单放归档 `_meta/` 会随 `.reviews/` 进版本库（大仓每轮数 MB），放运行目录则随清扫消失；更要紧的是「两份清单在内存里比」是**第二份比对实现**，与用户决策「复用现成严格助手，不另写第二份」正面冲突。所以仍不在本主题做，但要把它与被否理由写进 §6。
- **CODEX-02 ≡ GLM-01**：成立。r1 的自证读数 `cat-file -e 〈tree_hash〉` 是脚本在清理之后当场跑的，证明不了「清理发生在复算之前」；而「清理与改文件都落在复算之后」时旧构建同样写 `changed: false`、退 0，B 格会假通过。CODEX-02 建议的签名 `after_tree_hash ≠ tree_hash` 在本仓**不够**：编排器自己往归档写的送审包、`run.json` 本身就让两棵 tree 不同（`freeze.ts` :496～:498 的注释），所以它恒真。改用更强的签名：**跑后 tree 里被改文件的 blob 等于改后内容的 `hash-object`**（证明改文件早于复算），且**旧构建 `changed: false`**——若复算时送审 tree 还在，旧构建会把这个非自有文件列成 `unrelated`、`changed: true`，所以 `changed: false` 反证清理也早于复算；新构建则以 `unknown_reason.cause = object_gone` 自证。r1「小 `sleepS`」与「`--allow-single` 让单侧超时不致整轮中止」两处措辞也确实不对：`hang_cli` 的 `sleepS` 就是窗口长度（`stub.ts` :356～:391，自然结束后按 `timeout` 返回），`--allow-single` 的作用是让那一侧失败后降级续跑（`config.ts` :274 缺省 `allow_partial_flag: true`）。
- **CODEX-03**：成立，且比意见写的更要紧。worker 路径的 `primarySnap` 从运行目录的 `request.json` 读回（`run-protocol.ts` :196～:260），与审批前摘要的基线同属「从留痕读回的值」。不加形状闸时，一个以 `-` 开头的值会被 `git diff-tree` 当成选项（例如 `--output=〈路径〉` 会让 git 往那里写文件）。姊妹实现的形状闸 `OBJECT_NAME_RE` 在 `worktree-summary.ts` :71、:156。
- **CODEX-04**：成立。`stub.ts` :1～:22 写明桩在生产路径只告警、不拒绝；`git prune --expire=now` 不可逆。夹具根取自 `os.tmpdir()`（`test/helpers/fixture.ts` :77），自缚条件可行。
- **CODEX-05**：成立。`freeze-drift.test.ts` 共 10 个用例，走 `judgeDrift` 的 9 条；r1 漏点名「归档写入不算漂移」「`.trivium` 写入不算漂移」「中文路径可读」三条，后两类正落在 3.a 的输出解析上。
- **CODEX-06**：成立。设计 :1757（EV-132 注记写「`judgeDrift` 均未改」）、:2774（异常处置表漂移行只列三档）都描述本主题要改的判定；AGENTS.md :182 的 JSON Schema 同步清单五个落点，r1 只写了 PROTOCOL。逐个核过：`parse` / `gate` / `meta` 校验由 `schemas.ts` 直接编译 `run.v2.json`，改 schema 即接线，不改代码；`skills/dual-critic/SKILL.md` :19 只到目录级，不改；AGENTS.md 的契约面描述（:68 起）不列 drift 子字段，不改；`registry-parity` 的盯防点是身份字段（`registry-parity.test.ts` :753～:776）与「schema 全目录不得枚举 Agent id」，新枚举不含 Agent id，不改。
- **CODEX-07**：成立。比对**本身**超时这一格，旧行为放行、新行为缺省判失败，r1 风险表没写这个方向反转；r1 §1.2 只实测了对象清理一因。
- **CODEX-08**：成立。r1 §5 没有墙钟预算与砍除次序；09-30 撞过装置挂死。
- **AGY-01**：成立。BACKLOG :287「一次性快照，记当时的判断，不随后续主题回改；条目状态以各行状态列为准」。
- **AGY-02 ≡ GLM-02**：成立。`freeze.ts` :14～:15 已从 `types.ts` 取类型；若 `types.ts` 再反向从 `freeze.ts` 取 `DriftUnknownCause` 就是双向依赖，各写一份字面量并集又是两个事实源。
- **AGY-03**：成立。r1 的标签与 `detail` 都含「已不在对象库」，拼起来套叠。
- **GLM-03**：成立。`renderGuardWarnings` :814～:833 是语句型 `switch`，漏写分支不报错；r1 §2.3「编译期守住」只对 `driftAction` 成立。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | 重要 | 接受 | 暂缓论证漏了「冻结时落清单」一档，代价段没给单价，触发条件要先付一轮 | r2 §6 加第三档（冻结时落路径与 blob 清单）及被否理由：第二份比对实现与用户决策冲突、每轮多一次全树遍历、清单落归档会随版本库膨胀；EV-180 触发条件改为「出现一次即评估」；§2.4 代价段补单价（一轮 = 入选各侧各一次真实审查，plan 阶段本轮实测约 19 分钟、三侧配额各一次） |
| CODEX-02 | codex | 重要 | 接受 | 旧构建格的通过判据有假阳性通道；窗口与 `--allow-single` 措辞不对；单审降级形状未说明 | r2 §5.4 改判据：旧构建 `changed: false` 且跑后 tree 中被改文件的 blob 等于改后内容的 `hash-object`（两者合起来证明改文件与清理都早于复算）；新构建 `unknown_reason.cause = object_gone`；外部 `cat-file` 只作旁证。窗口 `sleepS` 取 60 s，触发点为归档骨架 run.json 已含 `snapshot.tree_hash`（合 GLM-01），有界重试至多 2 次；`--allow-single` 改写为「让超时侧失败后降级续跑」；写明清理格是单审降级轮、双审形状由集成 I1 承担，读数记 `review_mode` / `degraded_reason` |
| CODEX-03 | codex | 次要 | 接受 | `before.treeHash` 来自留痕读回，与姊妹实现同口径应加形状闸；且以 `-` 开头的值会被 git 当选项 | r2 §2.2：任何 git 调用之前对两棵 tree 都过 `OBJECT_NAME_RE`，不合 ⇒ `unknown` / `git_error`，`detail` 不回显该值；`OBJECT_NAME_RE` 挪到 `util/git.ts`，`worktree-summary.ts` 改为从那里取并原样再导出；§5.1 加 U9（值为 `--output=〈夹具内路径〉` ⇒ `git_error`、该文件未被创建）；§5.3 加 M13 |
| CODEX-04 | codex | 次要 | 接受 | 第一个执行不可逆 git 操作的桩形态，应自缚到临时夹具 | r2 §5.2 与 §3：`prune_objects` 只在 `realpath(project_root)` 落在 `realpath(os.tmpdir())` 之下时执行，否则不动手、该侧按 `failed` 返回并写明原因；§5.1 加 S1；§5.3 加 M14 |
| CODEX-05 | codex | 次要 | 接受 | 既有用例清点少三条，其中两条落在 3.a 输出解析上 | r2 §5.1 U8 逐条点名九条；§2.2「顺带变化」点明中文路径与自有前缀两格要随 `-z` 重钉 |
| CODEX-06 | codex | 次要 | 接受 | 设计另两处描述同一判定；schema 同步清单另三处没写结论 | r2 §4 加设计 :1757 注记更正（「`judgeDrift` 均未改」改为现状）与 :2774 异常表漂移行加「比不了」一档；表下逐条写 schema 同步清单五个落点的核过结论（PROTOCOL 改，其余四处不改及理由） |
| CODEX-07 | codex | 次要 | 接受 | 比对本身超时由放行变为一轮失败，风险表未写；超时一因没有实测 | r2 §7 加一行：方向反转如实写，接受理由（同一次复算里的 `workTreeHash` 走同一 120 s 缺省、工作量远大于两棵 tree 的 `diff-tree`，它不超时而 `diff-tree` 超时的情形仓库已不健康）；§5.4 V0 加本仓 `diff-tree -r`（两棵相距较远的 tree）与 `workTreeHash` 的耗时读数 |
| CODEX-08 | codex | 吹毛求疵 | 接受 | 验证没有墙钟预算与砍除次序 | r2 §5.6 加成本与次序：目标套件先行、变异按单套件、预跑每条带 `--test-timeout`、预跑挂死或超时的变异条目砍掉并在报告「已知缺口」里登记；全量两次放在最后 |
| AGY-01 | gemini | 次要 | 接受 | 排序快照明文不随后续主题回改 | r2 §4 BACKLOG 一行删去「快照里 EV-139 标已结案」，只改主表 EV-139 行 |
| AGY-02 | gemini | 次要 | 接受 | 原因枚举应由 `types.ts` 唯一持有，避免反向依赖 | r2 §2.1 / §2.5：`types.ts` 定义 `DRIFT_UNKNOWN_CAUSES`（`as const`）与 `DriftUnknownCause`，`SnapshotMeta.drift.unknown_reason` 引用它；`freeze.ts` 从 `types.ts` 取；§5.1 加 C1（schema 的 `cause` 枚举与该数组逐项相等，照 `run-meta-strict.test.ts` 守 `termination.reason` 的写法） |
| AGY-03 | gemini | 吹毛求疵 | 接受 | 标签与 `detail` 套叠 | r2 §2.1 / §2.4：标签缩短为类别（「对象已不在」「git 超时」「git 出错」），`detail` 只写具体事实；四个消费方统一经 `freeze.ts` 的 `describeDriftUnknown(u)` 排版；G3 断言输出里不出现同一短语两次 |
| GLM-01 | glm | 吹毛求疵 | 接受 | 与 CODEX-02 同一缺口（≡）：窗口触发点与宽度 | 同 CODEX-02：触发点改为骨架 run.json 已含 `snapshot.tree_hash`、`sleepS` 60 s、有界重试 |
| GLM-02 | glm | 吹毛求疵 | 接受 | 与 AGY-02 同一缺口（≡）：原因并集的唯一属主 | 同 AGY-02：`types.ts` 持有、`freeze.ts` 引用、C1 守 schema 与之逐项相等 |
| GLM-03 | glm | 吹毛求疵 | 接受 | 人读告警的 `switch` 漏写分支不报错，正是本主题要修的形态在告警层的同形 | r2 §2.4：`renderGuardWarnings` 的 `switch` 加 `default` 分支做 `never` 赋值（穷尽性断言）；§2.3 的「编译期守住」改写为两处都守 |

gemini 3 条、glm 3 条、codex 8 条，共 14 条全部接受。

## 2. 修订摘要（r1 → r2）

1. §2.1 / §2.5：原因枚举归 `types.ts`（AGY-02 ≡ GLM-02）；标签缩短、统一排版函数（AGY-03）；
2. §2.2：两棵 tree 先过形状闸，`OBJECT_NAME_RE` 挪到 `util/git.ts`（CODEX-03）；「顺带变化」点明中文路径与自有前缀（CODEX-05）；
3. §2.3 / §2.4：告警 `switch` 加穷尽性断言（GLM-03）；代价段补单价（CODEX-01）；
4. §3 / §5.2：桩形态自缚到临时夹具（CODEX-04）；
5. §4：设计 :1757 与 :2774 同批改、schema 同步清单逐条结论（CODEX-06）；BACKLOG 不碰排序快照（AGY-01）；
6. §5.1：U8 点名九条、新增 U9、S1、C1；§5.3 新增 M13、M14；
7. §5.4：判据改为「旧 `changed: false` ∧ 跑后 tree 含改后 blob」、窗口 60 s、触发点、有界重试、单审降级说明（CODEX-02 ≡ GLM-01）；V0 加耗时读数（CODEX-07）；
8. §5.6 新增成本与次序（CODEX-08）；
9. §6 加第三档与被否理由、触发条件改「出现一次即评估」（CODEX-01）；
10. §7 加超时方向反转一行（CODEX-07）。

其余（§0、§1、§2.6、§2.7）不变。
