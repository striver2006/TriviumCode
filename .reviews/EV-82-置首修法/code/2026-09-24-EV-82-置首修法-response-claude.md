---
schema: trivium.disposition.v1
topic: EV-82-置首修法
stage: code
role: claude
kind: response
run_id: 20260924T100928Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - GLM-01
  - GLM-02
---

# 应答：EV-82 第三段（置首修法 + EV-110）· 代码双审第 1 轮

> 被审对象：相对 `HEAD`（`7aa4d2c5`）的 18 个文件，补丁 130.0 KB
> ｜ 运行：`20260924T100928Z`（8m42s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve`（零意见） ｜ glm `approve-with-nits`
> ｜ 共 7 条：次要 5 ｜ 吹毛求疵 2 ｜ 零阻断、零重要
> ｜ **全部接受**；同指两组：CODEX-01 ≡ GLM-01（`qualify_failed` 在审查运行不可达）、CODEX-05 ≡ GLM-02（preflight 新函数插错位置）

## 0. 本轮的形状

**三侧一致判定成立的六个焦点**：
- 置首只动顺序，审查运行与同形臂置首支走同一条 `prepareZcodeHome` 路径；
- 原样支与置首支的供数分工在代码里守住：`model_override_full_copy` 与 EV-94 ② 只吃原样支，`runtime_selection` 只由 `judgeRuntimeSelection(fc, ro)` 产出；
- `model_override_reorder` 不进 run.json：review.ts 与 meta.guard 都是逐字段构造，负向集成用例读的是盘上的 `run-<id>.json`，R1 变异证明有判别力；
- 决策表按序实现，`null` 一律不覆盖旧值；
- EV-110 各拉起路径与计划 §5 表逐条对得上；
- preflight 经注册表取名，与 registry-parity 相容。

**意见都在边上，没有代码行为缺陷**：
- 一档成因在审查运行里不可达，文档却让人去 trace 里找它；
- 键集由三改四后，旧表述残留六处；
- trace note 替收窄后的字段下了因果判断；
- 无副本的审查运行，日志落点的后果没说全；
- 一处排版。

**登记**：codex 侧的轨迹记到三条命令文本提到禁读清单里的 `.env.example`。编排器判定「命中的是状态 / 凭据文件，不含审查意见，不损害背靠背独立性」。本件照录，不处置。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。`reorderRequestedFirst` 只产出 `applied` / `identity` / `not_movable` 三档；`prepareZcodeHome` 限定失败时 `reorder: null`、走 `route: global`，审查运行的 trace 与守卫字段都拿不到 `qualify_failed`；它唯一的产出点是同形臂置首支的合成。设计文档与 RUNBOOK 却让人去审查留痕里找它，照着查会查空。codex 给了两条修法：取「承认它是探针专属档」一条，与计划 r3 §3.2「限定失败时 `reorder: null`」一致，不改行为 | ① `VariantKind` 文档块写明：`qualify_failed` 不由 `reorderRequestedFirst` 产出，只由同形臂置首支在限定失败时合成；审查运行限定失败时 `reorder` 缺席，事实在 `route: global` 与 `modelSelection.reason`。② 设计文档置首一段改为「trace 里只会出现 `applied` / `identity` / `not_movable` 三档」。③ RUNBOOK 第 266 行删掉 `qualify_failed`，补「限定失败时 `reorder` 段缺席，看 `route` 与 `reason`」。④ `reorderHint` 的该分支加注释：生产上只有桩注入走得到，保留作穷尽 switch 的防御分支 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同指，只落在 RUNBOOK 这一处 | 并入 CODEX-01 的落点 ③ |
| CODEX-02 | codex | minor | 接受 | 属实。设计文档第 251 行同一段先写「三个目录键恒清」、后半句又写「四键恒清」，自相矛盾；设计文档是唯一实现依据，第 2464 行「三键一律清掉」会让后来者以为 `ZCODE_LOG_DIR` 没被清。项目对「改一漏二」有先例（v1.3.33 把文档残留清零列为必做） | 六处改为不依赖计数的说法（「`ZCODE_DIR_ENV_KEYS` 全部目录键」），或写成「四个」：`adapters/zcode.ts` 文件头与小节标题、`probes/zcode.ts` 白名单臂 docblock、设计文档第 250、251、2464 行。第 251 行合成一句，不再先三后四。`test/unit/zcode-provider-env.test.ts` 版本探针那条用例的标题同步改。BACKLOG EV-88 行是历史记录，**不改** |
| CODEX-03 | codex | minor | 接受 | 属实。「本次靠置首达成」断言了一个本轮刚宣布不可判的因果：上游修好时（doctor 判 `honored`），置首仍生效、覆盖仍落实，这句 note 会继续宣称「靠置首」，与 doctor 的结论矛盾。计划 r3 §3.4 写了这句，是计划的措辞问题，实现照做了 | trace `modelSelection.note` 的追加句改为只陈述可观测事实：「请求模型已置首，读回的正是它；是否靠置首不可分，见 doctor 的 `zcode.runtime_selection`」。相关用例的断言随之改。计划 r3 原文不改（已审批定稿），本件为准 |
| CODEX-04 | codex | minor | 接受 | 属实，而且比计划 §5 表写的更进一步：无副本的审查运行（未指定模型 / 副本源缺失）走真实 HOME，模型 I/O 日志含送审包全文，落在 `~/.zcode/cli/log` 并持久留存，不进清扫面。并入之后，用户显式设的 `ZCODE_LOG_DIR` 重定向也被忽略。BACKLOG 写「done」、doctor 提示只说「落在各自 HOME 下」，都读不出这层意思。收口方向（给无副本一支**设** `ZCODE_LOG_DIR` 到运行目录，并让 `modelFromLog` 读同一处）要改审查运行的环境构造与回读路径，超出本段计划，另行登记 | ① doctor 信息级 note 把话说全：「所有拉起路径都已清掉它；无副本的审查运行（未指定模型 / 副本源缺失）走真实 HOME，CLI 日志含送审包全文、落在 `~/.zcode/cli/log` 并持久留存，宿主的重定向不再生效」。② RUNBOOK 补同一句。③ BACKLOG EV-110 行的 done 说明改为「副本路径收口；无副本路径的日志落点见 EV-112」。④ 新增 **EV-112**：候选修法与代价按 codex 建议写，排在 EV-82 结案之后，待用户定 |
| CODEX-05 | codex | nit | 接受 | 属实。新函数插在 `checkArchiveAndGit` 的文档块与函数本体之间，那段「归档根与 git」注释现在贴在别的函数上 | `checkZcodeRuntimeSelection` 整段移到 `checkArchiveAndGit` 之后，每个文档块只贴自己的函数 |
| GLM-02 | glm | nit | 接受 | 与 CODEX-05 同指 | 并入 CODEX-05 的落点 |

## 2. 实现相对计划 r3 的偏差（如实登记）

1. **preflight 警告不写 Agent id 字面量**：r3 §4.2 只写「preflight 在 glm 入选时警告」。实现起初写了 `'glm'` 字面量，被 `registry-parity` 用例拦下，改为按入选侧经注册表取 CLI 名与显示名。行为相同，三侧均核过与对账纪律相容。
2. **trace note 的措辞**（CODEX-03）：按上表改，计划原文不改。
3. **`qualify_failed` 的产出面**（CODEX-01 ≡ GLM-01）：行为按 r3 §3.2 不变，只把文档里「会出现在审查留痕」的说法收窄到探针。
4. **无副本审查运行的日志落点**（CODEX-04）：r3 §5 表把它写成「不比现状更差」。本轮核实后更正：宿主的显式重定向会被忽略。登记 EV-112，不在本段改。

## 3. 修改后的核验

- 用例：trace note 的新措辞（两条审查运行流程用例）；doctor 信息级 note 的新文案（日志目录用例）；版本探针用例标题；
- 变异：第三段规格不受影响（find 串不涉及本轮改动的行）。若有改动触及，照闸 7 的报错逐条更新并重跑；
- typecheck、全量测试、build、`install:local`、`doctor --selftest`。

## 4. 本轮之后

审批后按上表修改，再交用户决定是否送第 2 轮。提交后，在干净工作树上重建、重装，按计划 r3 §7.3 执行：
先跑 doctor 读出 `zcode.runtime_selection`，据此决定是否派发；派发由用户发起。
