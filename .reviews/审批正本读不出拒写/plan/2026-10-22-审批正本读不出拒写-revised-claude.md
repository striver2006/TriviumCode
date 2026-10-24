---
schema: trivium.disposition.v1
topic: 审批正本读不出拒写
stage: plan
role: claude
kind: revised
run_id: 20261022T041612Z
addresses:
  - 2026-10-22-审批正本读不出拒写-gemini.md
  - 2026-10-22-审批正本读不出拒写-glm.md
---

# 裁决：审批正本读不出拒写 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-22-审批正本读不出拒写-claude.md`（r1，起点 `e34c23d0`）。
> 评审循环第 1/5 轮：gemini `pass-after-changes`（2 major、1 minor、1 nit），glm `pass-after-changes`（4 minor），计票「修改后通过」。
> 八条全部接受，合入后的计划见 `plan/2026-10-22-审批正本读不出拒写-r2-claude.md`。
> 裁决前回源码核过的依据：`meta.ts:308-312` 的 `readTaskStrict` 只在 `JSON.parse` 抛错时判 unreadable，`null` / `[]` / `{}` 都会返回 `ok`，随后 `approval.ts:254` 的 `t.approvals.push`、`meta.ts:1046` 的 `t.runs.findIndex` 抛 TypeError 退 1；`cli.ts:1504` 的 `--await-approval` 读不出时 `ok: true` 退 0；`--check` 的结果输出在 `cli.ts:1583-1598`，早于写入段。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 成立。我在 r1 §八 把 `--await-approval` 归为「本就不写正本的保守不动」，这个归类不对：这条命令的职责是立起等待审批的停点，正本读不出时它判不了本轮是否已表态，停点没立起来，却回 `ok: true` 退 0——调用方会以为停点已立好。它和「本轮确已表态 ⇒ 保持不变 ⇒ 退 0」不是一回事，后者是确实完成了判断。改为 `ok: false`、退 2；「已表态」分支照旧退 0 | r2 §二「退出码」一段、§三 表新增 C0 行、§三.1 第 6 步、§八 删去原第三条；用例 I12（`--await-approval` 读不出退 2、闸门不变）；变异 M10 |
| AGY-02 | gemini | major | 接受 | 成立：`readTaskStrict` 只防 JSON 语法错，合法 JSON 但形状不对（`null`、数组、标量、`{}`、`approvals` 不是数组）会判 `ok`，写入口与读侧调用方随后在属性访问处抛 TypeError，以 1 退出，绕过受控的拒写与 Git 出口；`hook-pre-commit` 锚 ② 也会把这类坏件当作可读 | r2 §二 新增「形状判据」：非对象 / 数组、`schema` 不是 `trivium.task.v1`、`runs` / `approvals` / `degradations` / `disputes` 任一缺失或不是数组 ⇒ `unreadable`，`error` 写明是哪一项。编码时先 grep 测试里手写的 task.json，有不合判据的最小形态就补齐夹具，不放宽判据。U1 补 `null`、`[]`、`123`、`{}`、`approvals: {}` 五种形态；变异 M11 |
| AGY-03 | gemini | minor | 接受 | 成立：出口段里的 `git restore` 若不说明由谁执行，Driver 可能在会话里直接跑，而命令文本同时含写动词与 task.json 字样，会被 Hook 拦；既有的 `unreadableRunMetaExitAt` 写明了「只能由用户在终端做」 | r2 §二 出口段末尾加一句「恢复命令请由用户在终端执行；在会话里执行会被 TriviumCode Hook 拦下」，措辞对齐 `meta.ts` 运行留痕读不出的出口段；U4 断言含这一句 |
| AGY-04 | gemini | nit | 接受 | 成立：命令 D（`/dual-review-bug`）与 B、C 共用 `skills-src/partials/review/body.md`，`gate --check` 的那句改在共用片段里会三者同时生效，r1 只写了 B、C | r2 §四 写明 B / C / D 都由 `partials/review/body.md` 渲染，改一处三者同时生效 |
| GLM-01 | glm | minor | 接受 | 成立：r1 的 G4「同一个退出码」与 §八「`--await-approval` 维持退 0」字面矛盾。我没有按 glm 的建议把 G4 收窄，而是按 AGY-01 把 `--await-approval` 也改成退 2，矛盾因此消除，G4 按字面成立：所有读不出出口统一退 2、共用一段出口文案。理由见 AGY-01：`--await-approval` 读不出时没有完成自己的职责，不属于「纯读保守」 | r2 §一 G4 保持原句并补「含 `--await-approval`」；§二「退出码」一段写明唯一例外是「已表态 ⇒ 保持不变」那一支（它不是读不出）；§八 删去原第三条 |
| GLM-02 | glm | minor | 接受 | 成立：r1 规定 verify 竞态时退 2 盖过 0 / 1，skill 里却只有「非零 ⇒ 全流程 failed」一句，Driver 会把退 2 当编译失败去排查 | r2 §四 补 S10 一句：verify 退 2 = 审批正本读不出，命令可能根本没执行（先判拦下）或已执行但未登记（竞态），原样转述后停下，恢复正本再重跑；不当作编译失败，也不宣称已收口 |
| GLM-03 | glm | minor | 接受 | 成立：`--check` 的 JSON / 人读输出在 `cli.ts:1583-1598`，早于写入段；r1 只写「任何写之前」，判定若插在输出之后，`task_unreadable` 进不了已打印的 JSON | r2 §三.1 第 2 步写明插入点为「`checkAdjudication` 之后、结果输出段之前」，读不出时只输出一次（带 `task_unreadable` 的结果）后直接返回 |
| GLM-04 | glm | minor | 接受 | 成立：多个命令新增退 2 形态，按 AGENTS.md 改动同步清单要核 USAGE 字符串与 `doc/03_api/PROTOCOL_dual_critic_relay.md` 的退出码说明 | r2 §六 补一行：核对 USAGE 与 PROTOCOL 文档，列了退出码语义的条目补「2：审批正本读不出」；并写明 `GateFailureCode` 是 `gate.ts` 的 TypeScript 联合、不涉机读 schema，`skills/dual-critic/schema/` 不动（编码时 grep 确认没有别处枚举失败码） |

## 说明

- AGY-01 与 GLM-01 指向同一处，方向相反：gemini 要求改成退 2，glm 认可退 0 的区分、只要求改措辞。我取 gemini 的方向，理由写在 AGY-01 一行。两条都接受，因为 GLM-01 指出的矛盾是真的，只是消除矛盾的办法不是 glm 建议的那一个。
- 本轮无驳回、无暂缓。
