---
schema: trivium.disposition.v1
topic: M10a-第3步
stage: plan
role: claude
kind: revised
run_id: 20260923T072251Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - AGY-01
  - AGY-02
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
---

# 裁决：M10a 第 3 步实施计划 · 计划双审第 1 轮

> 被审对象：`2026-09-23-M10a-第3步-claude.md`
> ｜ 运行 `20260923T072251Z`
> ｜ 三侧均为结构化产出（`parse_fallback: false`）
> ｜ 结论：codex `request-changes`，gemini、glm `approve-with-nits`
> ｜ 共 13 条：重要 2 ｜ 次要 8 ｜ 吹毛求疵 3 ｜ 无阻断
> ｜ **全部接受，无驳回、无暂缓**

## 0. 本轮的形状

三侧对四个焦点的正面结论基本一致：
- §3.3 的绑定值得做，窗口真实，注释没有说过头；
- runMeta 读不出即拒绝，对 `--await-approval` 不误伤；
- 「只核本轮」是取舍，不是缩窄；
- 「跳过复核」那条变异的定义自洽。

问题集中在三处，每一处我都回到源码核对过：

1. **契约面漏同步（CODEX-01 ≡ GLM-05）**。
   - `cli.ts:216-218` 的 USAGE 逐字写着「只校验已登记，尚未启用为 Driver 的也放行」，
     这正是本步要删的行为；
   - PROTOCOL 第 16 行写着「取值须为已登记 Agent」，第 349 行的 approve 行没有复核语义；
   - `preflight.ts:86-88` 的注释写着「M9 只校验已登记」。
   §2.4 与 §6.4 都漏了它们。做完之后 `--help` 仍在教一个已经不存在的行为，
   而 AGENTS.md 的改动同步清单把「退出码语义变化」列为必同步项。
2. **approve 那一格的出口走不通（CODEX-02 ≡ GLM-03，外加 AGY-02 的文案依赖）**。核对结果：
   - `review --start` 抢占闸门时，期望态是 `['idle','running','approved','rejected','abandoned']`，
     **不含 `awaiting_approval`**（`review.ts:966`）；
   - `--check` 与 `--await-approval` 都带 `expect.runId`，本机闸门项的 run_id 为 null 或指向别的运行时，
     一律被 skip（`state.ts:223`）；
   - approve 本身**没有 `--run-id`**。
   所以原样搬来的「用 --run-id 指定，或先跑一次双审」两条出口，在 approve 这一格**都不成立**。
   唯一走得通的是 `/dual-abandon`，之后才能重跑。
   这与 `cli.ts:1014-1030` 记载过的「给出的出口在本状态下都不成立」是同一个形状。
3. **一条变异按字面定义不可鉴别（CODEX-04）**。核对属实：`readRunMeta` 读文件失败一律返回 null
   （`meta.ts:497-502`）。于是 `if (runId)` 包住第 1 步之后，第 2 步照样抛错，
   只断言「抛错」的单测照样绿。
   §4.1 注意到了「CLI 路径上两道防线互相掩盖」，却没注意**函数内部**第 2 条也会掩盖第 1 条——
   同一个错误在同一份计划里出现了两层。

其余各条：
- **边界枚举**：漏了交接文件通道（CODEX-05），一处位置描述不准（AGY-01）；
- **用例构造**：A3 没钉死改哪个文件（GLM-01），抽出函数后原处是否保留调用没写（GLM-02）；
- **登记完整性**：两项行为决策只写在正文、没进 §5（GLM-04）；
- **方法**：本仓已有变异装置，计划却仍安排手工循环（CODEX-06）；
- **口径**：报错清单借用了审核者的口径（CODEX-03）。

**闸门期不改业务代码。** 以下落点在 `/dual-approve` 之后写进 r2 稿，r2 稿再送一轮计划双审。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核对属实：USAGE 的 `--driver` 段（`cli.ts:216-218`）逐字描述了本步要删除的放行行为；PROTOCOL 第 16 行的取值论域、`preflight.ts:86-88` 的注释也停在 M9 口径。本步改的是一类输入的退出码语义（警告放行变为退 64），AGENTS.md 同步清单把它列为必做。不同步的话，`--help` 与新报错列出的清单会互相矛盾，正是 `critics.ts:159-165` 记载过的「第一个错误把用户引向第二个错误」 | r2 稿 §2.4 改写清单补三处：USAGE 的 `--driver` 段改为「已登记且已启用为 Driver，否则退 64」；PROTOCOL 第 16 行同口径；`preflight.ts:86-88` 注释改为「历史留痕与注入测试才会出现 false」。§6.4 文档清单加 PROTOCOL 一行。另在实施前全仓 grep「只校验「已登记」」「尚未启用为 Driver」两个字面，把命中清单写进 r2 稿，不靠记忆列举。`skills/dual-critic/schema/run.v2.json:81` 描述的是历史语义，按 codex 的判断保留，在 r2 稿里注明理由 |
| CODEX-02 | codex | major | 接受 | 核对属实，三个事实见 §0 第 2 条：`--start` 抢占不含 `awaiting_approval`，`--check` / `--await-approval` 带 `expect.runId` 会被 skip，approve 没有 `--run-id`。原样搬来的两条出口在 approve 这一格都走不通，唯一走得通的是 abandon 之后重跑。按 r7 §4.3 的要求，「推断不出即拒绝」这个**判定**必须原样带过来；但**文案**不能原样搬，因为两个调用点的恢复路径不同 | r2 稿 §3.1 第 1、2 条：判定只写一份，**文案按调用点分开**。由调用方传入 `recovery` 文本，函数只负责拼接，判定本身不带分支。approve 那一格写明：「本机闸门项没有指向一份可读的运行留痕；归档是正本、本机闸门是副本，两者已经分叉。approve 没有 `--run-id`；`--check` / `--await-approval` 不会改写别的运行的闸门项；出口是 `/dual-abandon --topic <t> --stage <s> --reason <说明分叉>`，然后重跑该阶段双审」。同时如实写明：这会留下一条 run_id 为空的放弃记录，reason 里要写明缘由。A4 / A4′ 两格补断言：输出含 abandon 出口，且**按出口走一遍能走通**（abandon 之后 `review --start` 成功抢占）。§5 新增一行，登记「两处文案不同源」这一偏差 |
| CODEX-03 | codex | minor | 接受 | 属实：`legalList` 走的是 `selectableCritics`，即 criticEnabled ∩ 有配置段 − 当轮 Driver，是**审核者**口径。今天四家恰好同集，所以看不出差别；将来第五家只当 Driver、或没有配置段时，报错就会漏掉一个其实会被接受的取值 | r2 稿 §2.2：清单改为按 `(descriptors ?? AGENTS).filter(a => a.driverEnabled)` 派生，删掉「与 `legalList` 同一个口径」这半句。§4.2 的桩用例补一条反向断言：注入表里「driverEnabled 为真、criticEnabled 为假」的一家**必须**出现在清单里 |
| CODEX-04 | codex | minor | 接受 | 核对属实：`readRunMeta` 读文件失败一律返回 null（`meta.ts:497-502`），所以只包住第 1 步时，第 2 步仍会抛错，只断言「抛错」的单测照样绿。这条正是 r7 §4.3 列出的验收项，不能靠不可鉴别的变异来「锁住」 | r2 稿 §4.1 的单测改为断言**第 1 步那条错误的身份**：退出码，加上只有第 1 步才会带的文案（含 runIdSource 与「不会跳过校验」字样），并且断言**不含**第 2 步的文案。§6.2 的变异定义取两种形态、各跑一次：① 只包住第 1 步；② 整个校验体被 `if (runId)` 包住、null 时直接返回 ok。两种形态都必须由该单测变红 |
| CODEX-05 | codex | minor | 接受 | 属实：`review --worker` 经 `rebuildContext` → `handoffDriver`（`run-protocol.ts:160-168`）从交接文件取 driver，不经过 `resolveDriver`。它不开新运行（复用 `--start` 已分配的 run_id），但它的取值决定原稿定位和 `meta.driver` 的落盘值。§2.4 是边界枚举，漏一面就又成了「写成保证的例外」 | r2 稿 §1 表末行与 §2.4 的清单加入「worker 交接文件（本机运行目录下的交接文件，由 `--start` 在 `resolveDriver` 之后写出）」，标注它靠的是「本机文件由入口写出」，不是自身判定；与「手工改写的 claim 声明」并列 |
| CODEX-06 | codex | nit | 接受 | 属实：`scripts/mutation-check.mjs` 的五道闸（全路径备份、构建失败非零、基线全绿、产物确实变了、恢复逐字节比对）正是为第 2 步报告里自述的「跑了旧 dist/test」这类失效而建的。计划仍安排手工循环，等于放着机制不用、回头靠记性 | r2 稿 §6.2：五条变异（CODEX-04 拆出的两种形态算两条）写成一份规格，交给 `node scripts/mutation-check.mjs <spec>` 跑，`--with-tests` 覆盖集成套件。「核对用例名」降级为兜底。规格文件放在草稿目录，结果写进测试报告 |
| AGY-01 | gemini | nit | 接受 | 核对属实：`review.ts:541` 位于 `prepareRun`（`:514` 起），在 `cmdReview` 派生工作进程之前、主进程内同步执行，不在 worker 内 | r2 稿 §1 表末行与 §2.4 改为「`prepareRun`（主进程启动准备期）直接查表」；worker 侧的真实通道由 CODEX-05 那一行补上 |
| AGY-02 | gemini | nit | 接受 | 属实：原文案（`cli.ts:1141`）引用的 `rerunIndex` 是 `cmdGate` 预先算好的，抽成函数后 runId 为 null 时还没有 meta 可读；第 2 步也没写退出码 | 与 CODEX-02 同一落点：第 1 步的文案只用 stage、runIdSource 与调用方传入的 recovery，不引用 rerunIndex。r2 稿 §3.1 第 1、2 步都明写 `TriviumError(EXIT.MISSING_ARTIFACT, …)`，与 A4 / A4′ 的期望逐字对应 |
| GLM-01 | glm | minor | 接受 | 属实：本轮 `artifacts[]` 同时登记了渲染出的 .md 审查文档和结构化结论 JSON，而 `loadRoundReviews` 只读后者。去改那份 JSON，会先因解析失败被 `missingSides` 判红，「跳过 sha256 抽核」那条变异因此不可鉴别，正是 §7 提醒 4 担心的形态 | r2 稿 §4.1：A3 / A3′ 写明改动对象是**阶段目录下渲染出的 .md 审查文档**，这类工件只受哈希保护；并加注记：「改结构化结论 JSON 会先撞上解析那道防线，鉴别不了本变异」。§6.2 的变异表在 A3 旁注明构造对象 |
| GLM-02 | glm | minor | 接受 | 属实：没写清是「移出」还是「抽取并保留」。若按移出实现，rejected / abandoned 路径的前置校验就只剩 CAS 的 skip 文案，`approval.test.ts:60-74` 断言 `--cancel R2` 的用例会先红 | r2 稿 §3.2 写明：`assertGateDecidable` 抽成共用函数，**`recordApproval` 内保留原调用**，三种决定的前置校验与今天逐字相同；`cmdApproval` 的前置调用只用于 approved 路径，目的是在复核之前报出准确文案 |
| GLM-03 | glm | minor | 接受 | 属实：`cmdGate` 对「留痕读不出」已有分档文案（`cli.ts:988-995` 与 `:1013-1043`），出口是重跑，并警示「不要删改 run-*.json，动了锚会让提交被拦」。approve 侧如果只写「取不到就拒绝」，排障的人可能去手改 run.json | 与 CODEX-02 同一落点：第 2 步的文案点名 run_id 与阶段，带上「不要删改运行元数据，那是提交锚」的警示。出口按调用点区分：`--await-approval` 的出口是重跑该阶段（与 cmdGate 同源）；approve 的出口是 abandon 之后重跑（原因见 CODEX-02） |
| GLM-04 | glm | minor | 接受 | 属实：按本稿自设的标准（凡超出 r7 字面的都列进 §5），「runMeta 读不出即拒绝」和「先全部复核、再逐一落审批」这两项都是行为决策，却只写在正文和提醒里 | r2 稿 §5 补两行，另加 CODEX-02 引出的「两处文案不同源」一行，偏差表由 4 行增至 7 行 |
| GLM-05 | glm | minor | 接受 | 属实：PROTOCOL 第 349 行 approve 那一行已逐条登记了既有报错行为；本步新增的「复核不通过退 2、推断不出或留痕读不出退 65」属于同一文档面上用户可见的变化 | 与 CODEX-01 同一落点：§6.4 补 PROTOCOL approve 行的同步，写一句话，说明新增的复核、两个退出码，以及 `rejected` / `abandoned` 不复核。USAGE 的 approve 段按同一口径补一句 |

## 另外补上的一处（不是审查意见，是审查员在盲区里顺带指出的）

codex 的「未覆盖范围」第 3 条指出：`driver-flag.test.ts:127-130` 除了 `:126` 的 `driver_enabled` 之外，
还在断言 notes 里含「尚未启用为 Driver」。这一断言会随 §2.3 删掉的标注分支一起变红，
而 r1 稿 §4.3 只写了 `:126`。r2 稿 §4.3 把 `:126-130` 整段列入改写范围，不另立编号。

## 下一步

用户 `/dual-approve` 之后：
- 按上表把落点写进 `2026-09-23-M10a-第3步-r2-claude.md`；
- 再送一轮计划双审；
- 本轮按 plan 档记进 `doc/08_project/M10a-轮次台账.md`。
