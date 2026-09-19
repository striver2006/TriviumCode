---
schema: trivium.disposition.v1
topic: M9-验收实跑
stage: code
role: claude
kind: response
run_id: 20260919T133957Z
addresses:
  - 2026-09-19-M9-验收实跑-r2-codex.md
  - 2026-09-19-M9-验收实跑-r2-gemini.md
  - 2026-09-19-M9-验收实跑-r2-glm.md
---

# 代码审应答：M9-验收实跑（第 2 轮）

## 0. 应答总览

gemini `approve-with-nits`（2 条）、glm `approve-with-nits`（3 条）、codex **解析降级**（输出整体被包进 ```json 围栏，
落成 1 个待裁决单元 CODEX-F01，内含 6 条意见与「同意」段）。本件对 5 条结构化意见与 CODEX-F01 内 6 条逐条裁决：
**接受 11 ｜ 驳回 0 ｜ 暂缓 0**（按闸门编号：接受 6 ｜ 驳回 0 ｜ 暂缓 0）。

三个焦点的答案三侧一致：**接线本体接实了**——同源是真 import 不是拷贝，两个 `--check` 调用点都传了，A31 主断言对当前文件不 vacuous。
三侧挑出的全是「锁没锁全」：

1. **A31 缺正向锚点**（CODEX-F01-③ ≡ AGY-01）：`readSchemaJson` 退化成 `{}` 时 A31、A28 同时绿。
2. **同内容第二份清单咬不住**（CODEX-F01-④ ≡ AGY-02 ≡ GLM-01）：把 import 换成同内容的本地 Set，A6c/A6d/A29/A30 全绿。
3. **接线段无端到端锁**（GLM-02）：删掉 cli.ts 的透传，全仓照绿。
4. **「旧留痕无字段」那格不可达**（CODEX-F01-②）：`guard.readonly_breach` 在 run.v1/v2 两版契约里都必填，`readRunMeta` 不合法即 null——我核了，属实。gate.test ② 与 ③ 重格，注释失实。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | minor | 接受 | 降级单元内 6 条意见逐条裁决见 §1.1，**全部接受**。降级本身不是本批引入：codex 输出把 JSON 包进围栏，`extractJsonCandidate` 没剥——与 EV-10 / EV-56 同族，不在本批范围，登记进 EV-76 旁的观察 | §1.1 六条各自的落点 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-F01-③ 独立收敛：A31 只断 `offending === []`，`readSchemaJson` 退化成 `{}` 或读错文件时空集恒真；自证样例与 `sent` 解耦 | A31 补正向断言：`used` 含 `properties` / `required` / `type`，`JSON.parse(sent).properties.findings` 在场；自证改为在 `sent` 的深拷贝里注入 `$defs` 再扫，断言命中 |
| AGY-02 | gemini | nit | 接受 | 与 CODEX-F01-④ / GLM-01 同一缺口的适配器侧：A29/A30 硬编码 `'StructuredOutput'`，适配器内部退化成 `u.name !== 'StructuredOutput'` 时四条用例全绿 | A29 改为遍历 `CLAUDE_OUTPUT_TOOLS` 构造交付事件；新增 A6e 源码字面腿（见 GLM-01） |
| GLM-01 | glm | minor | 接受 | 核实：A6c 输入由适配器常量构造，探针清单**宽于**适配器时 A6c 照绿、A6d 只咬到 Write。单源今天靠「探针只 import、不自建」这条纪律；本仓对这类纪律的既定对策是 grep 级对账。它还指出第三份推导（负对照臂的 `offLimit`，`READONLY_TOOLS.split(',')`，不套豁免）——语义不同（那臂要的正是白名单外调用），不构成缺陷，但要写给接手 EV-75① 的人 | 新增 A6e：读 `probes/claude.ts` 与 `adapters/claude.ts` 源码，断言不含字面 `'StructuredOutput'`（事实只能来自 `claude-trace.ts` 的 import）；EV-75① 补一句「三处推导的分工：judgeToolSurface 的 extra / 适配器写事件 / 负对照臂 offLimit，前两处同源、第三处刻意不豁免；清单加宽方向由 A6e 咬住」 |
| GLM-02 | glm | minor | 接受 | 核实：`readonly_breach` 的测试落点只有 gate.test 两个纯函数环节与 fault-injection 的 run 级断言，cli.ts 的解构→透传段被变异时全仓照绿——正是 fault-injection 自己总结过的「纯函数测对了、接线处错了」。`readonlyBreach` 是 EV-69 家族的新成员。用例 ② 注释「旧留痕（无字段）」失实：`newRunMeta` 恒写 `false`，测的是「字段在场且为 false」 | fault-injection 的 write_breach 用例续两步：落一份最小合法裁决件、经真实 CLI 跑 `gate --check --json`，断言 `ok:false` 且 failure code 含 `readonly_breach`（同时锁「在 missing_disposition 早退之后仍可达」）；gate.test ② 注释改准；EV-69 触发条件扩为「`GateCheckInput` 任一可选参数出现新调用点」 |
| GLM-03 | glm | nit | 接受 | 自证只证 `properties` 嵌套一种形态，`keywordsUsed` 若被改得不下降数组位（`items` / `allOf` / `anyOf`），自证照绿、主断言随之 vacuous；`$ref` 兄弟键语义分叉不在论域，今天文件无 `$ref`，可见症状是 parse 侧更严（吵而不静默），记边界即可 | A31 自证补数组形态（`{ allOf: [{ $anchor: 'x' }] }` 须抓到 `$anchor`）；`DRAFT_2020_ONLY_KEYWORDS` 旁注明 `$ref` 兄弟键边界 |

**统计（闸门编号）**：接受 6 ｜ 驳回 0 ｜ 暂缓 0。

### 1.1 CODEX-F01 内 6 条的逐条裁决

| 子项 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| ① 失败文案与判据不对齐：判据是「轨迹里有白名单外工具调用」，文案说「写了工作树、请清理」；`breached_files` 是调用记录不是路径；整跑布尔说不出哪一侧 | minor | 接受 | 属实。本轮留痕 `readonly_breach: true` 而 `snapshot.drift.changed: false`，五条记录全是 `StructuredOutput(...)`，没有可清理的写入；文案把 JSON 片段打进闸门输出 | `gate.ts` 失败文案改为「轨迹记录到白名单外的工具调用（写事件记录，非文件路径）」，处置分两句：先核对 run 元数据 `snapshot.drift` 与工作区是否确有改动；确有则清理后重跑，没有则按判据误报处理（登记 EV-75）；不再暗示可按侧清理。「EV-75① 两臂合并排在接线之前」不取：假阳性的根在适配器判据、本批已修，探针合并是独立改进——与第 1 轮 GLM-02 的裁决一致 |
| ② 「旧留痕无字段」那格不可达；历史轮次会被追溯硬拦；用例 ② 与 ③ 重格 | minor | 接受 | 核实：run.v1 / run.v2 的 `guard.required` 均含 `readonly_breach`，`readRunMeta` 校验不过即 `null`。追溯面如实写：本仓无 `readonly_breach: true` 的历史 run.json（已 grep），夹具留痕有一份（正是误判那跑）——它在仓外，且 CODEX-F01-⑥ 已要求把这层写进报告 | `gate.ts` 两处注释改为「该字段两版契约必填，历史轮次按当年刻下的布尔判；留痕整份读不出时 `missingSides` 先行兜底」；gate.test ② 改名为「字段在场且为 false → 不拦」，并把「读不出的留痕」交给既有 `missingSides` 用例，不再声称覆盖「无字段」 |
| ③ A31 无正向锚点，`readSchemaJson` 退化成 `{}` 时 A31 / A28 全绿；A26 绕过 `readSchemaJson` | minor | 接受 | 同 AGY-01 | 同 AGY-01；A28 补一句正向断言 `JSON.parse(s).required` 在场 |
| ④ 同内容第二份清单咬不住；第三处判据 `offLimit` 不套豁免 | nit | 接受 | 同 GLM-01 / AGY-02 | 同 GLM-01 / AGY-02 |
| ⑤ A31 是单向黑名单，description 与注释的承诺是双向的 | nit | 接受 | 属实：守卫口径比宣称窄。取它的第一条出路——把承诺收窄到机制能守的范围，不扩成白名单（白名单会把 `title` / `description` 这类无害键也拉进登记面） | `review.v1.json` description 与 `adapters/claude.ts` 注释改为「不用 2020-12 独有关键字（A31 守）；draft-07 独有或跨方言语义变化的键（`dependencies`、tuple 形 `items`、布尔 `exclusiveMinimum`、`$ref` 兄弟键）不在守卫论域，改契约时人工核」 |
| ⑥ 报告 §5.5 与证据 §4 在接线后成了失实断言：同一留痕现在会被 `readonly_breach` 拦下，EV-66 三格不再可复现 | nit | 接受 | 属实，且按本仓纪律这是「先改再提交」那类 | 报告 §5.5 改写；`hook-and-gate-outputs.md` 开头与 §4 加时限声明「取自接线前的构建（bundle 198fc87…）；接进失败面后同一留痕会因 `readonly_breach` 判 `ok:false`，EV-66 三格的复现要在清掉该旗标或用干净留痕上做」 |

## 2. 双方共同指出的问题

- **A31 的空集通过**（CODEX-F01-③ / AGY-01 / GLM-03 的数组位）：一处补齐——正向锚点 + 在真实产物上注入 + 数组形态自证。
- **同源只靠纪律**（CODEX-F01-④ / AGY-02 / GLM-01）：A6e 源码字面腿 + A29 遍历常量。
- **接线无端到端锁**（GLM-02；CODEX-F01-② 的重格问题同源）：fault-injection 续到 `gate --check`。

## 3. 不予采纳的意见及其依据

无整条驳回。局部不取的一处：CODEX-F01-① 建议「EV-75① 两臂合并排在接线之前」——理由见 §1.1 ①。

## 4. 本轮未覆盖

- codex 侧解析降级的成因（围栏包裹 JSON）不在本批修，登记观察；三侧均未实跑 `npm test`，鉴别力仍是静态推演，本批新增用例后再跑全量。
- `scripts/claude-admission-control.mjs` 仍未改（EV-74 范围）；EV-75② 逐侧留痕、EV-76 出路不在本批。
