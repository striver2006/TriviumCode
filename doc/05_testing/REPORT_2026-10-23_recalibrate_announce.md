# 测试报告 · 自动校准播报与照抄（EV-252）

- 日期：2026-10-23
- 主题：`自动校准播报与照抄`（`/dual-run`；来源 EV-251 真实配额验收，[`REPORT_2026-10-22_preflight_recalibrate.md`](./REPORT_2026-10-22_preflight_recalibrate.md) 第九节）
- 代码三审：run `20261023T100212Z`，第 1/3 轮：codex `pass`、gemini `pass`（均零意见）、glm `pass`（1 minor），计票通过；GLM-01 接受（应答件 `.reviews/自动校准播报与照抄/code/2026-10-23-自动校准播报与照抄-response-claude.md`），见第三节末
- 计划：`.reviews/自动校准播报与照抄/plan/2026-10-23-自动校准播报与照抄-r2-claude.md`（计划三审 run `20261023T093717Z`，第 1/3 轮：codex、gemini、glm 均 `pass-after-changes`，计票修改后通过；11 条全接受）
- 主设计：v1.3.174（§8.1 末段「自动校准」③④）；BACKLOG EV-252；PROTOCOL `preflight --json` 自动校准字段；LLD 3.2；用户手册 §3.4
- 证据：[`evidence/recalibrate-announce-20261023/`](./evidence/recalibrate-announce-20261023/)

## 一、改了什么

| 面 | 改动 |
| :--- | :--- |
| `preflight.ts` | 导出常量 `RECAL_ANNOUNCE_AFTER_PASS`；`buildRecalibration` 在 `eligible` 分支多给 `announce_before`（失败项名按 `checks` 次序以「、」连接、doctor 次数、每次时限）与 `announce_after_pass`；键序 `eligible`、`why`、`announce_before`、`invocations`、`announce_after_pass`。不 eligible 时形状不变 |
| `cli.ts` | 只改注释（对象整体透传，键序不重排） |
| 公共片段 `partials/preflight/recalibrate.md` | 可校准分支改为四步：①第一个动作是原样念 `announce_before`，念出之前不得发起 doctor（键缺席时按格式自拟，同样先发后调）；②命令文本恰好是字面 `.trivium/bin/trivium` 后接 `args`、前后不加任何东西，理由对四家都成立，长输出按「直接返回就从返回里取、被截存才另起只读读取」取字段；③逐字相同重跑一次；④通过后写的第一句就是定性句（原文写在片段里），然后才念 `warnings` |
| 入口产物 | `npm run render` 重出 16 份（四条命令 × 四家载体） |

预检判据、`invocations[*].args`、`deadline_s` / `bash_timeout_ms`、doctor 行为与输出、Hook 判据均未改。

## 二、用例

**单测 `test/unit/preflight-recalibrate.test.ts`（新增 4 条 U5）**：`announce_before` 逐字核对（两项失败、900 秒；同一侧两条组合时 N = 2、名称只出现一次）；`announce_after_pass` 等于导出常量、常量逐字为定性句；三种不 eligible 情形两键缺席、形状仍是 `{ eligible, why, invocations }`，通过仍为 `null`；键序。

**对账 `test/contract/skill-recalibrate.test.ts`（由 17 条增到 50 条）**：保留论域 16 份与既有逐份断言；新增「同一口径」1 条（16 份产物截取「预检退 69 时先看能不能自动校准」到「每次预检至多一轮。」的整段，两两相等）；逐份新增两条——先播报后调用（闸门句在 `announce_before` 句之后、在 `invocations` 那一步之前；旧「先发一行文本」主步骤不残留；定性句与源码常量逐字相等，排在「仍失败」分支与外层「通过时若 `warnings` 非空」之前）与照抄规则（字面入口加 `args`、前后不加任何东西、重定向与管道、条件出口句、理由不断言「Hook 必拦」）。代码审 GLM-01 后补两处次序断言：「前后不加任何东西」之后有「`args` 的各项也不改、不增删」；回落句的「同样先发后调」在「键缺席时」之后、调用那一步之前。

**集成 `test/integration/doctor-deadline-cli.test.ts` I5 补断言**：打包 CLI 的预检 stdout 原文里 `"announce_before"` 先于 `"invocations"`。

**对账断言不到的**：模型是否真的先发后调、定性句是否真的放在第一句、是否不再改写命令行——只能靠真实会话验收（第五节）。

## 三、变异验证

脚本 [`mutation-run.mjs`](./evidence/recalibrate-announce-20261023/mutation-run.mjs)，读数 [`mutation-output.json`](./evidence/recalibrate-announce-20261023/mutation-output.json)。源码类：改 → `build.mjs --tests-only`（M2 另跑默认构建出打包 CLI）→ 跑目标用例 → 恢复；片段类：改 → `npm run render` → 跑契约 → 恢复 → 重渲染。九条全部变红（M8、M9 为代码审 GLM-01 补），跑完源码、片段与 16 份产物的 SHA-256 与变异前逐一相同（`restored: true`、`drift: []`）。

| 变异 | 变红的用例 |
| :--- | :--- |
| M1 去掉 `announce_before` | U5 `announce_before`、U5 键序 |
| M2 `announce_before` 挪到 `invocations` 之后 | U5 键序；I5 |
| M3 片段闸门句挪到调用细则之后 | 16 份「先播报、后调用」 |
| M4 只改 codex 载体 dual-run 一份产物（不经渲染） | 「同一口径」 |
| M5 片段删「前后不加任何东西」 | 16 份「照抄调用」 |
| M6 去掉 `announce_after_pass` | U5 `announce_after_pass`、U5 键序 |
| M7 片段定性句改一个字 | 16 份「先播报、后调用」（与源码常量不等） |
| M8 片段删「`args` 的各项也不改、不增删」 | 16 份「照抄调用」 |
| M9 片段删回落句的「同样先发后调」 | 16 份「先播报、后调用」 |

脚本首版有一处缺陷：用例文件以字符串传入时被逐字符展开成参数，七条「变红」其实都是模块找不到；补上摘录输出后发现，修正为数组再重跑，上表为修正后的读数。

代码审 GLM-01（照抄的 args 级子句与回落句的「同样先发后调」无锚点）：补两条断言与 M8、M9，九条重跑全部变红、全部恢复；契约 50 条全过。

## 四、全量与干跑

- `npm run check`（前台、单条）：3924 条，3922 通过、0 失败、2 跳过。
- 代码三审改码之后：`trivium verify` 通过（`.reviews/自动校准播报与照抄/verify/2026-10-23-自动校准播报与照抄-verify.md`）：typecheck、build、`npm test` 全部退 0；3924 条，3922 通过、0 失败、2 跳过。
- 零配额干跑（脚本 [`dry-run.mjs`](./evidence/recalibrate-announce-20261023/dry-run.mjs)，读数 [`dry-run-output.json`](./evidence/recalibrate-announce-20261023/dry-run-output.json)）：scratchpad 新建夹具，用仓库刚构建的打包 CLI `init`，照搬本仓本机层的 `probe.cli` / `probe.host` / `generated_at`（不拷 `auth` / `auth_routes`），把 agy、zcode 的记录版本改成 `0.0.0-ev252-drift`，`preflight --skip-auth-check --json`：退 69、两项失败、`eligible: true`、键序如设计、`invocations` 恰为 agy、zcode 两条，`announce_before` 为「预检退 69，以下失败项可由 doctor 重新校准：Antigravity 版本与探针一致、ZCode 版本与探针一致；将依次在前台跑 2 次 doctor（每次至多 900 秒），会消耗少量配额。」。
- **与计划的偏差**：计划 r2 第二节第 7 步写的是 `npm run install:local` 后干跑；实际没有重装全局副本（重装由用户在提交后自行做，与 EV-251 一致），干跑直接调用仓库内的打包产物，验的是同一份代码。

## 五、残余（BACKLOG EV-252）

- **真实会话验收未做**（需用户同意、花配额）：照 D4 末段，夹具同时造 agy、zcode 两家漂移（本报告第四节的干跑已确认会出两条调用），重装后由用户在夹具里新开会话敲 `/dual-review-plan`。判据三条：预检返回与第一次 doctor 调用之间有 `announce_before` 原文；第二次预检返回后的第一条文本以定性句开头；两次 doctor 的命令文本恰好是字面 `.trivium/bin/trivium` 后接 `args`、无 Hook 拦截。记录第一条输出是否被截存，没截存不宣称覆盖「长输出后第二条照抄」。
- 另三家载体作 Driver 时的遵循情况、长输出是否截存未验。
- 片段里「Bash 工具超时」对 codex / gemini / glm 载体是字面借用，四家同一口径、未改。
- 注：本次 `/dual-run` 自己的 S0.6 恰好撞上真实的 agy 版本漂移（1.4.5 → 1.4.6）并走了一轮自动校准，当时用的是改动前的全局副本与旧片段；Driver 先发了播报、通过后当即念了定性句，但 doctor 调用前后加了 `cd` 前缀与 `echo "EXIT=$?"`，按新片段属于不合规形态。这是 Driver 自述，不作验收证据。
