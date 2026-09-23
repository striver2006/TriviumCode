---
schema: trivium.disposition.v1
topic: M10a-第4步
stage: plan
role: claude
kind: revised
run_id: 20260923T114656Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - GLM-01
  - GLM-02
  - GLM-03
---

# 裁决：M10a 第 4 步实施计划 · 计划双审第 1 轮

> 被审对象：`2026-09-23-M10a-第4步-claude.md`
> ｜ 运行 `20260923T114656Z`
> ｜ 三侧均为结构化产出（`parse_fallback: false`）
> ｜ 结论：gemini `request-changes`，codex、glm `approve-with-nits`
> ｜ 共 13 条：重要 1 ｜ 次要 8 ｜ 吹毛求疵 4 ｜ 无阻断
> ｜ **接受 11，驳回 1（AGY-03），暂缓 1（AGY-04）**

## 0. 本轮的形状

三侧对五个焦点的正面结论基本一致：
- §2.2 的近似如实摆出了张力，误差方向说对了；三侧都没有找到今天就能做、又不越出本步的更好近似；
- U7 / U8 的机制成立，U8 的自测能咬住「只看参数在不在」；
- U9 的价值与边界说得准；
- EV-07 件 2 的两处失实属实，改写没有越出「保留」；
- 不带 import 的裸调用能过打包（codex 用 esbuild 内存构建实测过）。

问题集中在**证据可核**这一层，分四类：

1. **我自己的鉴别说明写错了一格（AGY-01 ≡ CODEX-02 ≡ GLM-01，三侧独立命中）。**
   U5 ② 的论域含「非 claude Driver 下可选的 claude 审核者」，退回旧判据时 `claude-sonnet-5` 被判同源，U5 ② 会红。
   我在 U5 行写「M62a 下照样绿」，在 §6 写「adapter-base 2」，两处都错。
   这正是本稿卷首第 3 条要防的事，只是方向相反：不是新用例被别的防线掩盖，而是我低估了一条用例的咬合面。
2. **变异规格在装置上打不到它声称的位置（CODEX-01）。**
   装置用 `String.replace` 只替换首处、不查唯一性。两个写点改完后文本逐字相同，M62b′ 标称「写点 B」，实际会落在写点 A，装置照样报咬住。
   这是「装置声称的强于事实」，本仓在 M9 第 3 步为它专门造过装置。
3. **U7 的锚点与我自己写的代码对不上（CODEX-03 ≡ GLM-03）**：写点 B 的末参后带尾随逗号，「以 `meta.driver)` 收尾」在正确代码上会假红。
4. **清单漏项（CODEX-05 ≡ AGY-02 ≡ GLM-02、CODEX-06）与一处口径冲突（CODEX-04）。**

**逐条落点前我自己核过源码**（第 3 步 r3 卷首第 4 条）。核的结果：
- 装置第 283、287 行确为 `includes` 加 `replace`；
- `config.ts` 的 codex 段注释原话「`profile` 是 R-6 的落点，也是『家族』的唯一判定依据」；
- `README.md:89` 与 `CASE_manual_acceptance.md:207` 原文如审查所述；
- `registry-parity.test.ts` 两处注释确实指名 `base.ts` 的 `!/claude/i.test(model)`。

**两处事实陈述不接受**：AGY-01 依据里写 claude 侧模型为 `claude-opus-4-6 / claude-sonnet-4-6`，实际是 `claude-sonnet-5` 与 `claude-haiku-4-5-20251001`（结论不受影响）；AGY-03 依据里的 `parseAdjudication` 全仓不存在。

**闸门期不改代码。** 以下落点写进 r2 计划稿，在 `/dual-approve` 之后产出。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实属实：`scripts/mutation-check.mjs` 用 `before.includes(c.find)` 判命中，再用 `before.replace(c.find, c.replace)`，只替换首处，不查唯一性。两个写点改完后 `isHeterogeneous(…)` 行逐字相同，M62b′ 的裸表达式会落到写点 A，装置照样报「咬住」，归因记到写点 B 头上。M62b / M62c 依赖「首处恰好是写点 A」这个没写出来的事实。靠人记得「find 串要唯一」是本仓纪律 12 反对的形态 | ① r2 §6 为每条变异**逐字写出** find 串，并带区分上下文：写点 A 延伸到下一行的 `overrideReason: overrideReasonFor(`，写点 B 延伸到其后的注释行或 `override_reason: overrideReasonFor(`。② **给装置加一道闸（闸 7）**：`find` 在目标文件中必须**恰好命中一处**，零处或多处都在写盘前拒绝并非零退出。配 `mutation-device.test.ts` 一条拒绝路径用例（多处命中 ⇒ 拒绝且工作树未被碰过），与既有两条拒绝路径同形。③ r2 §7 偏差表登记「本步顺带改了变异装置」 |
| CODEX-02 | codex | minor | 接受 | 与 AGY-01、GLM-01 同一处，核实属实：`selectableCritics` 只减当轮 Driver，Driver 为 codex / gemini / glm 时 claude 都可选，两档默认模型 `claude-sonnet-5` / `claude-haiku-4-5-20251001` 在 M62a 下判同源，U5 ② 断言 `=== true` 会红 | ① r2 §6 M62a 改为「U2、U3、U5 ② ｜ adapter-base 3」。② r2 §2.5 U5 行改为「① 在 M62a 下仍绿；② 在 M62a 下会红：论域里有非 claude Driver 下可选的 claude 审核者，② 因此顺带咬住 M62a」。**不收窄 ② 的论域**：那一格正是 EV-62 修的那一格，收窄等于把它挪出用例 |
| CODEX-03 | codex | minor | 接受 | 核实属实：r1 §2.3 写点 B 的示例是多行调用、末参 `meta.driver,` 后换行才闭括号；`argBlockAt` 返回含右括号的原样文本，没有规范化。按字面「以 `meta.driver)` 收尾」实现，正确代码上会假红 | r2 §2.5 U7 把两个锚点分开写：`isHeterogeneous` 的厂商实参用 `/,\s*agentById\(meta\.driver\)!\.vendor\s*,?\s*\)$/`；`overrideReasonFor` 的末参用 `/,\s*meta\.driver\s*,?\s*\)$/`。两者都**允许尾随逗号与空白**，并写明为什么这样写。U8 的合成源码 (a) 两种形态（单行、多行加尾逗号）都给一份，确认正确写法在两种排版下都判空 |
| CODEX-04 | codex | minor | 接受 | 核实属实：`config.ts` 的 codex 段注释写着「`profile` 是 R-6 的落点，也是『家族』的唯一判定依据」，默认 `qwen`。于是本仓对「模型族」有了两种说法，driver=codex 时会有两类具体错判：审核者跑 qwen 被判异构，审核者跑 `gpt-*` 被判同族。codex 另核出：「新增检出」那一行在内置配置下不可达（72 格零命中），只对显式覆盖生效。**两个选项取 (b)**：`agents.codex.profile` 是**审核者调用** `codex -p` 的参数（`adapters/codex.ts` 第 67 行），描述的是审核者这一侧的家族，不是 Driver 会话；用户自己起的 codex Driver 会话不经过它。拿它当 Driver 族，是用另一份审核者配置去猜 Driver，而且只对 codex 一家成立，会引入按 id 分叉（纪律 7） | ① r2 §2.2 与 `VENDOR_MODEL_FAMILY` 文档块改称「厂商**名义**族」，并写明：它不等于 `agents.<id>.profile` 与演进设计 §3.1 意义上的家族（后者描述审核者调用）；两者冲突时，本判据按名义族判，并点名 driver=codex 的两类错判。② r2 §2.2 行为对照表「新增检出」一行标注「内置配置下不可达，仅对显式覆盖生效（72 格实测零命中）」。③ r2 §2.6 EV-107 追加这两类错判，并把「按 Driver 会话的实际 provider 取族」列为根本解的一个方向 |
| CODEX-05 | codex | nit | 接受 | 核实属实：`README.md:89`「默认与主脑异构（非 Claude 系）」、`CASE_manual_acceptance.md:207`「默认 profile 两侧都不是 Claude 系（AC-18）」，与 §5.2 已列各项同形。后者是活的人工验收剧本，M10b 用非缺省 Driver 重跑时会被照着念 | r2 §5.2 追加这两处，并入 EV-106 的移交项；验收剧本那处标「M10b 真载体验收之前须改」 |
| CODEX-06 | codex | nit | 接受 | 核实属实：`registry-parity.test.ts` 两处注释（「代价：正则字面量里的 Agent 名（如 `adapters/base.ts` 的 `!/claude/i.test(model)`）」与「明确不覆盖的形态 2」）指名的代码本步之后不复存在。EV-64 侧专门列了「提到该函数的注释」一行，EV-62 侧没有，同一份计划两种口径 | r2 §2.1 补一行：这两处示例改为不指名具体文件的写法（例如「正则字面量里的 Agent 名，如 `/claude/i` 这类写法」）。**不改指 `VENDOR_MODEL_FAMILY`**：`agents/registry.ts` 在白名单里，本来就不扫，拿它当「扫不到」的例子会误导 |
| AGY-01 | gemini | major | 接受 | 结论属实，与 CODEX-02、GLM-01 同一处。依据里写 claude 侧模型为 `claude-opus-4-6 / claude-sonnet-4-6`，与 `config.ts` 不符（实为 `claude-sonnet-5` 与 `claude-haiku-4-5-20251001`），不影响结论；落点不照抄这句 | 同 CODEX-02 |
| AGY-02 | gemini | minor | 接受 | 与 CODEX-05、GLM-02 同一处，核实属实 | 同 CODEX-05 |
| AGY-03 | gemini | nit | 驳回 | 「gate.ts 不得 import 或调用 `parseFrontMatter`」不是本步要守的不变量。gate.ts 正当地解析 front-matter：`checkAdjudication` 经 `parseDisposition` 读裁决件 front-matter，并比对其中的 `run_id` 与 `role`。今天恰好经 `disposition.ts` 而不直接调 `parseFrontMatter`，那是实现细节。把它钉成禁令，是又一条名字判据：挡不住换个解析函数的同形实现，还会误伤将来正当的直接调用。要守的不变量是「run_id、driver、轮次取自运行元数据」，它已有正向判据：`cli.ts` 必调 `latestRunMeta`，`verifyRoundForApproval` 的 `checkAdjudication` 取 `runMeta.driver`。另外，依据里说闸门区用 `parseAdjudication`，全仓无此函数 | 无修改。r2 §3.4 U9 的边界说明补一句：「为什么不再加『gate.ts 不得解析 front-matter』：gate.ts 本来就要解析裁决件 front-matter，那不是不变量」 |
| AGY-04 | gemini | nit | 暂缓 | 放宽 openai 的族正则（加 `^o\d`）能多检出 o 系列，但在本仓不是主要误差来源：codex 在本仓默认跑 qwen（CODEX-04），名义族本身就与 codex Driver 的实际模型对不上。在拿到 Driver 真实模型数据之前逐个加模式，是在一个已知不准的近似上加精度，每加一条都要补用例与说明。条目已在 EV-107 的已知误差里 | r2 §2.6 EV-107 保留「o 系列不含 gpt」一条，并注明「补模式的触发条件：EV-107 根本解落地前，出现 openai Driver 真实运行、且审核者经显式覆盖用了 o 系列」 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-02、AGY-01 同一处，核实属实 | 同 CODEX-02 |
| GLM-02 | glm | minor | 接受 | `CASE_manual_acceptance.md:207` 部分与 CODEX-05 同。另核实：`doc/02_design/README.md` 第 5、61 行写明 `reference/` 为「设计输入，不作为实现依据」。其中五处「Claude 系」不算漏项，但本步没把这条豁免写下来，第 5 步会再判一次 | 同 CODEX-05；另在 r2 §5.2 补一句豁免边界：「`doc/02_design/reference/` 下的调研答卷与 `doc/05_testing/` 下的历史报告属冻结材料，不回溯」 |
| GLM-03 | glm | nit | 接受 | 与 CODEX-03 同一处，核实属实 | 同 CODEX-03 |

## r2 相对 r1 的改动清单

1. §2.2 / §2.6：「名义族」的说法、与 `agents.codex.profile` 家族说法的边界、driver=codex 的两类错判、「新增检出」仅对显式覆盖生效（CODEX-04）；EV-107 补 o 系列的触发条件（AGY-04）。
2. §2.1：补 registry-parity 两处注释（CODEX-06）。
3. §2.5：U5 ② 的鉴别说明改正（三侧同中）；U7 两个锚点分写并允许尾随逗号，U8 (a) 补多行形态（CODEX-03 ≡ GLM-03）。
4. §3.4：U9 边界补 AGY-03 的驳回理由。
5. §5.2：补两处移交与冻结材料的豁免边界（CODEX-05 ≡ AGY-02 ≡ GLM-02）。
6. §6：M62a 期望改为 3；全部 find 串逐字写出并保证唯一；装置加闸 7 与一条锁例（CODEX-01）。
7. §7：偏差表新增「顺带改了变异装置」一行。

## 给第 2 轮审查员（若用户决定再跑）

请优先核两处：
- **闸 7**（find 恰好命中一处）会不会误伤既有的变异规格写法，锁例的构造是否真的不碰工作树；
- CODEX-04 取 (b) 而不取 (a) 的理由是否成立：`agents.codex.profile` 是否真的只作用于审核者调用。
