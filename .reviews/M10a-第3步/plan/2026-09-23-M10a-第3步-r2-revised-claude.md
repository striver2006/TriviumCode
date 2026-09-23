---
schema: trivium.disposition.v1
topic: M10a-第3步
stage: plan
role: claude
kind: revised
run_id: 20260923T075029Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - AGY-01
  - GLM-01
  - GLM-02
  - GLM-03
---

# 裁决：M10a 第 3 步实施计划 · 计划双审第 2 轮

> 被审对象：`2026-09-23-M10a-第3步-r2-claude.md`
> ｜ 运行：`20260923T075029Z`
> ｜ 三侧均为结构化产出
> ｜ 结论：三侧均为 `approve-with-nits`
> ｜ 共 8 条：次要 5 ｜ 吹毛求疵 3 ｜ 零阻断、零重要
> ｜ **全部接受**。其中 CODEX-04 的后半条经核对不成立，理由写在表内

## 0. 本轮的形状

四个焦点的正面结论，三侧给出的一致：

- recovery 只影响文案，不进入判定；
- abandon 这个出口在 A4、A4′ 两格都走得通，§1 表末行列出的三条事实三侧都逐条复核过；
- 「run_id 为空」的说明与实际情况相符；
- M3a、M3b 两条变异都能让用例变红。

问题集中在两处：

1. **我在上一轮照单收下了一个过度声明（CODEX-01）**。
   r1 CODEX-05 说 worker 交接文件里的 driver「决定原稿定位与 `meta.driver` 的落盘值」，我接受了，
   没有再核对一遍。实际上 `executeRun`（`review.ts:997`）从定义起直到文件结束，**一处 `driver` 字样都没有**：
   交接文件里的 driver 只被放进 `RunContext.opts.driver`，worker 侧没有任何代码读它。
   codex 这轮主动收回了自己上一轮的说法。
   性质上，这与第 2 步 r2、r3 犯过的错同属一族：一句**没核对过的断言**差一点逐字写进六个源文件的注释。
   区别是这次在计划阶段就被拦下了。
2. **两句「固定文字」既不同源、也不唯一（CODEX-02 ≡ AGY-01 ≡ GLM-01）**。
   - 第 1 步的原文带 Markdown 星号（`cli.ts:1143` 的写法是 `**不会**跳过校验`），
     §4.1 断言的子串「不会跳过校验」在基线上就匹配不到。结果是变异装置的「基线全绿」闸门直接中止，
     本轮要锁住的 M3a 那一格反而验不成。
   - 第 2 步所用的「运行留痕读不出」，其实是 4 处既有文案（`cli.ts:533` / `:837`、`topic-args.ts:498`、`hooks.ts:617`）的子串。
     glm 说它「无一处连续出现」，这一点核对后不成立；codex 的判断是对的。
   - 修法：两句都换成**全仓零命中**的新文字，定义成导出常量，函数与单测引用同一份。落笔前已 grep 确认零命中。

另外两处：

- 检索方法与清单不闭合（CODEX-03、GLM-03）：
  - 「放行 + 标注」这个字面零命中；
  - 两份 schema 的 `driver` 描述不在清单里；
  - 「为 M10 预留 / 仍待 M10」这一族措辞落在检索字面之外。
- 清单口径只改了一半（GLM-02）：「未登记」那个分支仍然列出全部已登记项，
  相邻用例的标题也还钉着旧口径。

**闸门期间不改业务代码。** 落点在 `/dual-approve` 之后写进 r3 稿。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核对属实：`review.ts:997` 从 `executeRun` 起到文件末尾都没有 `driver` 字样；worker 侧的原稿定位用交接文件的 `subject_path`，轮次用 `rerun_index`，meta 用 `readRunMeta` 读回的既有 run.json，收尾时原样写回。交接文件里的 driver 没有消费方。我上一轮接受 r1 CODEX-05 时没有核对这半句，差点把一条可以被推翻的断言写进六个源文件的注释，这正是本步要防的事 | r3 稿 §1 表末行第 ② 项改为事实表述：「交接文件的 driver 字段只进入 `RunContext.opts.driver`，worker 侧没有消费方；它不构成未启用 Agent 进入运行的通道。能改变 worker 行为的是同一文件里的 `subject_path`、`rerun_index`、`sides` 等字段，这属于『本机文件可信』的一般假设，不是 Driver 判据问题，本步不处理」。§2.4 (a) 统一口径中去掉「worker 交接文件」这一项。r2 裁决件里 CODEX-05 那一行是已审留痕，不回改；r3 稿在 §0 登记这次收回 |
| CODEX-02 | codex | minor | 接受 | 核对属实：(i) `cli.ts:1143` 原文带 `**`，照搬后 §4.1 的无星号断言在基线就是红的；(ii) 「运行留痕读不出」是 `cli.ts:533` / `:837`、`topic-args.ts:498`、`hooks.ts:617` 四处的子串，「只在这一步出现」这句话不成立 | r3 稿 §3.1 给两句判别文字**换新字面并定义为导出常量**：第 1 步 `APPROVAL_CHECK_NO_RUN_ID` =「推断不出 run_id 时不跳过复核」；第 2 步 `APPROVAL_CHECK_META_UNREADABLE` =「本轮运行元数据读不出，复核无从进行」。两句都是纯文本、不带 Markdown，落笔前 grep 全仓零命中。函数与 §4.1 单测、A4 / A4′ 集成断言都引用这两个常量。原注释（「`if (runId)` 那种写法等于留了个后门」）仍从 `cli.ts:1134-1138` 原样带过来；变的只是用户可见文案里的判别短语。「唯一」改为准确表述：「在本函数的抛错分支之间唯一；作为全仓字面，靠落笔时 grep 零命中保证，不是机制保证」 |
| CODEX-03 | codex | minor | 接受 | 属实：「放行 + 标注」零命中；`review.ts:537`、`registry.ts:20` 是通读时加进来的，不是字面命中。「命中 18 个文件，逐一归类」这句话把一份靠人工拼出来的清单说成了派生结果。两份 schema 的 `driver` 描述也确实没有归类 | r3 稿 §2.4 改写检索方法：**按「面的类别」归类**，字面 grep 只作辅助。类别分为四类：用户可见面（USAGE、PROTOCOL）、机读契约描述（schema）、现状断言型注释、历史叙事型注释。删去「18 个文件」的派生说法。两份 schema 的归类：`run.v2.json:77` 与 `disposition.v1.json:16` 描述的是 **schema 校验器对落盘值的判定**，即「取值是否为已登记 Agent」。本步之后它照旧只校验「已登记」，因为历史 run.json 里有 `driver_enabled: false` 的合法记录，校验器不能收紧；入口处的 driverEnabled 判定属于 CLI，不属于 schema。因此归入 (d) 不改，并写明它与 `:81`（历史语义）不是一个理由。不另写扫描脚本：这是一次性的口径同步，不是反复触发的判据；r7 §3.2.2 那个脚本守的是会被反复改写的安全文案，两者论域不同 |
| CODEX-04 | codex | nit | 接受 | (i) 属实：approve 只给了一段出口文案，没说填进 recovery 的哪个字段。(ii) 经核对**不成立**：`--await-approval` 在 `--run-id` 给出且可读时 `pinnedId` 为真，`runIdPinned` 就是 true，而且计划 §3.1 第 3 步要把它透传给 `checkAdjudication`，用于 `missing_disposition` 的文案分档（`gate.ts:132-142`，glm 本轮也确认「approve 传 true 恰好压掉不适用的建议」）。codex 的推理把「runId 非空」和「是否钉住」混为一谈了。但 r2 稿确实**没写**第 3 步要透传它，这是规格缺口，属实 | r3 稿 §3.2 写明 approve 的 `recovery.missingRunId` 与 `recovery.unreadableRunMeta` **用同一段文案**（abandon 后重跑）；§3.1 第 3 步写明 `runIdPinned` 原样透传给 `checkAdjudication`，并说明它服务于哪一句文案 |
| AGY-01 | gemini | nit | 接受 | 与 CODEX-02 (i) 是同一处问题 | 同 CODEX-02：判别文字改为纯文本常量 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-02 (i) 是同一处问题。glm 补充指出了后果：变异装置的「基线全绿」闸门会让整份变异规格中止，M3a 验不成 | 同 CODEX-02；另在 r3 稿 §6.2 注明「变异规格开跑前，先单独跑一遍 gate.test，确认基线是绿的」 |
| GLM-02 | glm | minor | 接受 | 属实：`critics.ts:182-187` 的「未登记」分支仍列出 `ALL_AGENT_IDS`；`driver-flag.test.ts:134-150` 的用例名逐字写着「列出全部已登记（不是已启用为 Driver 的那几家）」，`:146` 的注释写着「它们是合法取值」；`critics.test.ts:342` 的用例名同样如此。本步之后「已登记」不再等于「合法的 `--driver` 取值」，这几处与 §2.2 新立的原则正好相反 | r3 稿 §2.2：两个分支的报错清单**统一**按 `driverEnabled` 派生，都叫「可用作 Driver 的 Agent」，不再叫「已登记」。今天四家两种口径是同一个集合，既有断言的数值不变。§4.3 把 `driver-flag.test.ts:132-150` 与 `critics.test.ts:342-358` 纳入改写范围：用例名与注释改成新口径，并各加一格注入表用例（未启用的那一家不出现在「未登记」分支的清单里）。§2.4 (b) 的 USAGE 文案同步改用「可用作 Driver」这个说法 |
| GLM-03 | glm | nit | 接受 | 属实：「为 M10 预留 / 仍待 M10」这一族不在检索字面之内，方法与清单对不上 | 与 CODEX-03 同落点，按类别归类：`registry.ts:29`（「Driver 任意化仍待 M10」）是**现状断言**，改为「driverEnabled 于 M10a 第 3 步启用；任一 Agent 作为 Driver 的真载体验收待 M10b」；`gate.ts:145`（「为 M10 的 Driver 任意化预留」）同属现状断言，改为「M10a 第 3 步起四家均可为 Driver」；`naming.ts:103`、`freeze.ts:408`、`registry.ts:345` 是**历史叙事或设计理由**，陈述的是当年为什么这么写，本步之后仍然成立，不改，理由写进 §2.4 (d) |

## 下一步

用户执行 `/dual-approve` 之后：

- 把以上落点写进 `2026-09-23-M10a-第3步-r3-claude.md`；
- 本轮按 plan 档记入台账第 26 行。

**是否再送一轮计划双审，请用户决定。** 本轮三侧都是 `approve-with-nits`，零阻断、零重要，
8 条都是文案、规格或清单层面的修正，不改变设计。
