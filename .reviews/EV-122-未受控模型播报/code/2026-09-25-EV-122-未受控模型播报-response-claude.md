---
schema: trivium.disposition.v1
topic: EV-122-未受控模型播报
stage: code
role: claude
kind: response
run_id: 20260924T222959Z
addresses:
  - CODEX-01
  - GLM-F01
  - GLM-F02
  - GLM-F03
  - GLM-F04
---

# 应答：EV-122（未受控模型播报）· 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260924T222959Z.diff`（相对 `HEAD` `d5c177c` 的 22 个文件，138.9 KB）
> ｜ 运行：`20260924T222959Z`（6m29s）
> ｜ 结论：codex `approve-with-nits`（1 nit）｜ gemini `approve`（0 条）｜ glm **解析回退**（原文 `request-changes`，但只含 2 minor + 1 info，无阻断级；该侧按编排器口径不参与阻断判定）
> ｜ 实质意见共 4 条（codex 1 条，glm 原文 3 条），**全部接受**；修改在审批后实施

## 0. 本轮的形状

**三侧一致判定成立的**（五个焦点）：
- **焦点一 接线与互斥**：第二参取 `req.model`（`zcode.ts:1243`）；`model_override_applied` 只在 `overrideAttempted` 时展开、`decideModelUnenforced` 在 `attempted` 时恒返回 `undefined`；四个失败早退与超时早退都在计算点之前返回，`failedResult` 不带该字段。codex 与 glm 各自读遍了调用点。
- **焦点二 契约面**：`no_model` 只在 `ZcodeHomePrep`，字段只有两值；适配器恒产出恰好四项，`writeRunMeta` 的严格校验在真实路径上撞不到；桩注入坏值会被 run.v2 拒，与 `carriers_landed` 同口径（codex 在内存里复现了三条拒）。新字段可选，历史留痕仍能校验。
- **焦点三 文案**：主句无越界因果，按 `cause` 分句，用例有「默认模型」负断言。`reason` 不含凭据（`qualifyAgainstCliConfig` 只拼 provider 键名与成员名，不碰 `options`），但内容面有一处要拍板（下文 glm 分项 ②）。
- **焦点四 文档**：设计四处、6.7.1、变更记录、README、RUNBOOK、BACKLOG 四格、预检指向句逐处在位；只差 schema description 一项（glm 分项 ①）。
- **焦点五 证据**：N1～N9 的 find 串在当前树上各唯一命中，E1 读数与 E2 归档逐字相符；只有变异输出首行的措辞有歧义（glm 分项 ③）。

**glm 解析回退**：编排器按段落把原文切成四个单元（`review-glm-20260924T222959Z.fallback-items.md`）：F01 是开场白，F02 与 F04 是两段小结，glm 真正的三条意见（它自编号 GLM-01～03）整块在 F03 的 JSON 里。
回退成因推测是 GLM-03 的 `severity: "info"` 不在 schema 枚举内，未定位，不在本题处理。下表按 F 编号逐条裁决，F03 内三条的分项裁决见 §1.1。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | nit | 接受 | 属实，codex 用构建产物复现出「…这一轮不构成真正的双审。undefined」。适配器自己产不出两值之外的 `cause`，但 `TRIVIUM_STUB_CRITIC` 注入串只 `JSON.parse` 不校验，会原样透传到守卫；同文件 `reorderHint` 对同形的不可达档留了防御分支，本函数没有。glm 在 F03 的 agreed 里指出现在的穷尽 switch 让新增 `cause` 值时类型层会红——这个性质要保住，不能为了防御分支把它丢掉 | `guard.ts` `unenforcedHint` 加 `default` 分支：先 `const unreachable: never = cause` 保住编译期穷尽（新增枚举值仍会红），运行期返回空串（只陈述事实、不给排查指向）；`zcode-model-selection.test.ts` 加一格：两值之外的 `cause` ⇒ 播报里不出现 `undefined` 字面、主句照常；变异 N10（去掉 `default` 分支）补进规格重跑 |
| GLM-F01 | glm | 未分级（解析回退） | 驳回 | 这一单元是过程陈述（「全部核实完成，工具调用 12 次…」），不含任何意见，无可修改之处 | 无修改 |
| GLM-F02 | glm | 未分级（解析回退） | 接受 | 这一单元是 F03 三条意见的摘要（两条 minor、一条 info），本身不另提新意见；所指三条均接受 | 同 GLM-F03 的落点（§1.1 三个分项） |
| GLM-F03 | glm | minor（内含 2 minor + 1 info） | 接受 | 结构化结论整块，含三条意见，逐条复核均属实，逐条裁决见 §1.1：① schema description 漏「请求为空」；② `reason` 把副本源目录清单与 HOME 绝对路径首次带进 Git 归档，需显式拍板；③ 变异输出首行「工作树干净」措辞歧义 | ① `run.v2.json` 的 `model_unenforced.description` 补「请求为空」；② 接受现状并写明：设计 6.7.1 该行、`run.v2.json` 的 `reason.description`、`types.ts` 字段注释各补一句内容面说明；③ 新增 `doc/05_testing/evidence/ev122-mutation-20260925/00-readout.md` 写明口径，BACKLOG EV-122 格记装置字样残余 |
| GLM-F04 | glm | 未分级（解析回退） | 接受 | 「给人读的补充说明」，重述 F03 三条的性质与建议方向（① 一行可修、② 要求显式拍板而非改代码、③ 只影响证据可读性），与我的裁决一致 | 同 GLM-F03 的落点 |

### 1.1 GLM-F03 内三条的分项裁决

- **① glm 自编号 GLM-01（minor）· 接受**。属实：`run.v2.json` 的缺席成因列了四项，`types.ts` 与设计 6.7.1 都是五项，差「请求为空」。
  落点：该 description 的缺席枚举补「请求为空」，与另两处同序同口径。
- **② glm 自编号 GLM-02（minor）· 接受，取「接受现状并写明」，不截断**。属实，已复核 `zcode.ts:706`、`:712`：限定失败的 `reason` 拼有副本源的 provider 键清单或模型成员清单，缺失支带真实 HOME 绝对路径；此前只进运行目录的 trace.json（随保留期整删），本字段让它们首次进 Git 归档，计划双审没裁这一面，确实是顺带结果而非决定。不截断的理由：
  - 截断只能按文案切，正是计划轮 CODEX-02 刚否掉的做法；要结构化截断就得改 `qualifyAgainstCliConfig` 的理由形状，连带 trace.json；
  - 内容是键名与模型名、不含凭据；run.json 本就有 `model_effective`（含个人 provider 的 UUID）与 `deny_paths`（HOME 绝对路径）；
  - 清单对排查 `qualify_failed` 正是有用的那部分。

  glm 附带指出缺失支原文的「将沿用 ZCode CLI 的全局默认」经 `reason` 带进了播报：对该支准确，且 `reason` 在播报里是括号引用的理由原文，不是守卫自己的断言，不改。
  落点：设计 6.7.1 `model_unenforced` 行、`run.v2.json` 的 `reason.description`、`types.ts` 字段注释各补一句「可能含副本源的 provider / 模型目录清单与真实 HOME 绝对路径，随归档持久化；不含凭据」。这一取舍在交付说明里单列给用户，他若要截断再另议。
- **③ glm 自编号 GLM-03（info）· 接受**。属实：装置首行「工作树干净」指无残留哨兵加基线全绿，不是 git 状态；本次变异跑在 `d5c177c` 之上的未提交 EV-122 改动上。机制本身不强于事实。不改装置输出：那是跨主题共用的字样，改它要动 `scripts/` 与其契约用例，超出本题。
  落点：新增 `00-readout.md`（九条一览，写明「干净」口径与基线是当时工作树而非 `HEAD`）；BACKLOG EV-122 格记一条残余「装置首行字样宜改为『无残留哨兵』，留给下一个触碰 `scripts/mutation-check.mjs` 的主题」。

## 2. 修改方案（审批后实施）

| # | 文件 | 改动 | 来源 |
| :-- | :--- | :--- | :--- |
| 1 | `src/trivium/guard.ts` | `unenforcedHint` 加 `default`：`never` 穷尽检查 + 返回空串 | CODEX-01 |
| 2 | `test/unit/zcode-model-selection.test.ts` | 新增一格：两值之外的 `cause` ⇒ 无 `undefined` 字面 | CODEX-01 |
| 3 | `skills/dual-critic/schema/run.v2.json` | `model_unenforced.description` 补「请求为空」；`reason.description` 补内容面一句 | GLM-F03 ①② |
| 4 | `src/trivium/types.ts` | `model_unenforced` 注释的 `reason` 一行补内容面 | GLM-F03 ② |
| 5 | 设计文档 6.7.1 `model_unenforced` 行 | 补内容面一句 | GLM-F03 ② |
| 6 | `doc/05_testing/evidence/ev122-mutation-20260925/` | 规格加 N10；重跑；新增 `00-readout.md` | CODEX-01、GLM-F03 ③ |
| 7 | `doc/08_project/BACKLOG.md` EV-122 格 | 代码双审结果；装置字样歧义记为残余 | GLM-F03 ③ |

改完跑 `typecheck` → `build` → `test` → `install:local` → `doctor --selftest`。
改动面是一个防御分支、三处说明文字与一份证据说明，**建议不送第 2 轮代码双审**，由用户定。

## 3. 其它登记

- 编排器收尾结构提示：codex 在 evidence 里引用了 `dist/test/src/trivium/guard.js`（它用构建产物复现 CODEX-01）而未列进 consulted。那是本次改动的构建产物，与源码同版（codex 核过时间戳），不影响结论，只记录。
- 「构建时工作树有未提交改动：安装副本不对应任何一个提交」：属实且符合预期（EV-122 改动尚未提交，`install:local` 为验证而装），提交后重装即对应提交。
- codex 侧只读核验与路径核验的两条既有能力边界，与计划轮同形，只记录。
