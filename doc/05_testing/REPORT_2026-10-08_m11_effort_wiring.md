# M11 第 6 步 · 思考等级透传与留痕接线 · 测试报告

> - **日期**：2026-10-08
> - **起点**：`c855dcee`（`main`；主设计 v1.3.132、PRD v1.4.22）
> - **流程**：命令 A，主题 `M11-思考等级透传与留痕接线`。计划三审 run `20261007T234735Z`（三侧 `approve-with-nits`），6 条全接受，r2 定稿；用户起草前定三件（本仓配置不改、过渡闸与两条过渡告警整体拆除不留开关、claude 原生枚举随本步落盘）。代码三审 run `20261008T004931Z`：gemini `approve`（零意见）、codex / glm `approve-with-nits` 各 1 条，2 条全接受（CODEX-01 可用性缺省分支注释点名了不存在的 doctor 调用方，两处注释改准；GLM-01 `config.v2.json` 两处 `description` 未随拆闸改，只改描述字符串、不动契约形状）。
> - **证据目录**：[`evidence/m11-effort-wiring-20261008/`](./evidence/m11-effort-wiring-20261008/)
> - **配额**：运行期零配额（只用桩、夹具、假 codex / 假 claude 与纯函数），只有三审本身花配额

## 1. 结论

档位解析的结果真正送到了各家适配器并写进留痕（设计 v1.3.133）：思考等级按厂商通路下传（agy 的 `--effort`，slug 带档位后缀时不传；codex 的 `-c model_reasoning_effort=`；claude 新增 `--effort`；glm 不传），厂商 profile 的三层解析值同时用于可用性检查、模型目录比对与 codex 的 `-p`（含隔离副本拷哪份分层文件）；run.json 审核者条目恒写 `effort_requested` / `effort_effective` / `effort_effective_source` / `tier` / `tier_source`、顶层写 `profile`，front-matter 同值；生效思考等级只取回读——由必填钩子 `effortReadback(result)` 派生，入参拿不到请求值，codex / claude 恒 `null` + `unverified`；claude 的取值集合由探针零配额解析 `--help` 落盘；第 4、5 步的过渡闸与两条过渡告警拆除。

**本步未达成任何 AC**：AC-23 的真实验收随第 11 步（达成边界注记与实现核对一致）；FR-30 还差按审核者聚合的报告（第 7 步）。

**本仓现役行为逐字不变**（用户已定 ①）：§5 的零配额验收对档位表 default / flash / pro × 阶段 plan / code 共 6 格，新旧构建的交接文件逐侧 `model` / `effort` / `profile_requested` 逐字相同，经各家纯函数组出的 argv 逐字相同。

## 2. 用例

| 组 | 文件 · 用例 | 断言要点 |
| :--- | :--- | :--- |
| A | `test/unit/effort-wiring.test.ts` A1～A4（新） | codex 的 `-p` / `-c` 有值才带；`codexInvocationOf` 只取请求、不读配置段；claude 的 `--effort` 有值才传、紧跟 `--model`，不带该键的调用照旧不传；agy 后缀三格 |
| R | 同上 R1、R2 | 读本仓 `.trivium/config.yaml`，三张档位表 × 三阶段 × 三家逐格比「改前取值公式」与 `resolveTier`：思考等级、厂商 profile、argv 逐字相同（9 格以上，空转护栏）；档位形态下 codex / claude 的档位思考等级真进请求、gemini 档位没写 effort 即不下传 |
| E | 同上 E1～E5 | agy 只认回执（`requested` 来源即使 slug 带后缀也不取）；codex / claude 结果里塞带后缀、来源 envelope 的生效模型也恒 null + unverified；zcode null + null；桩注入两格；四家真实适配器都声明了钩子 |
| C | 同上 C1～C4 | 新字段在场 / null / 缺席三态都过当前 schema；`tier` / `tier_source` / `effort_effective_source` 封闭枚举、顶层 `profile` 不收空串；**旧读者**：`c855dcee` 版 `run.v2.json` 快照（`test/fixtures/run.v2.pre-m11-step6.json`）校验新留痕通过；front-matter 五键恒写且进回显剥离清单 |
| K | 同上 K1～K3 | `parseEffortLevels` 八格（F6 原文、无此行、括号缺失、空串、多对括号取第一对、列表项不合形状、空括号、前缀相同的别的旗标）；四态映射；`probeClaude` 在 `--no-model-calls` 下也落盘且不刷新 `probed_at`（假 claude，失败 ⇒ null） |
| P | 同上 P1 | codex 可用性传了本轮解析值就逐个判、不再看配置段；不传按配置段 |
| S / P | `test/integration/effort-wiring.test.ts` S1、S2、P2～P4（新，经 bundle） | 桩回报「请求 low ≠ 生效 high」：run.json 与 front-matter 分记、旧字段同请求值、档位与档位表名入档、未给思考等级的一侧五格恒写为 null；不注入 ⇒ null + unverified；预检与 `--start` 的可用性检查都按解析出的厂商 profile 判（解析出的那家没凭据 ⇒ 拒，配置段那家有凭据也不放、不选档照旧通过）；交接文件里发起用的 profile / 模型 / 思考等级就是解析值，`--profile-codex` 覆盖时跟着变 |
| X | `test/integration/codex-effort-profile.test.ts` X1～X4（新） | 真跑 codex `run()`（假 codex、钉住的 `CODEX_HOME`）：`-p` 与隔离副本里的 profile 分层文件都是请求里的 deepseek、不是配置段的 qwen，`-c` 带请求值；会话文件回显 `effort=max` 时生效值仍 null + unverified；失败出口 `profile_requested` 同值；claude `run()` 把 `--effort` 递进 argv |
| T | `tier-resolve.test.ts`（改）C3 / C5 / C6 / F2 / F3 → T1～T5 | 原过渡闸与两条过渡告警的每一格反转为「通过、不念第 6 步」；C4、F4 与 C2 等永久判据格保留并加断言「文案不含过渡说法」；R9 / R10 改断言字段来源 |
| 改 | `tier-flags-cli.test.ts` T3 / T4 / T5、`no-artifacts.test.ts` 两格 | T3 / T4 反转为不念留痕空窗；T5 加核 run.json 的 `tier: low` / `tier_source: cli`、顶层 `profile`；零工件两格换成永久判据（glm 给 `--effort-glm`、gemini 格子写枚举外 effort） |

## 3. 变异验证

规格由 `gen-mutation-spec.mjs` 从源码截锚点并核唯一（源码 19 条 + schema 契约 1 条）。

| 编号 | 变异 | 套件 | fail | 红的是谁 |
| :--- | :--- | :--- | :--- | :--- |
| M1 | agy 回读不看来源（回执缺失退到请求值时也取后缀） | 单测 | 1 | E1 |
| M2 | codex 回读改取生效模型的 slug 后缀（拿非回读面冒充） | 单测 | 1 | E2 |
| M3 | claude 回读同上 | 单测 | 1 | E2 |
| M4 | zcode 来源写 unverified（无此概念与没读到合流） | 单测 | 1 | E3 |
| M5 | 写侧 effort_effective 改条件展开（null 与缺席合流） | 端到端 | 2 | S1、S2 |
| M6 | 写侧 effort_requested 改条件展开 | 端到端 | 1 | S1 |
| M7 | 不写 tier / tier_source | 端到端 | 2 | S1、P3 |
| M8 | 不写顶层 profile | 端到端 | 1 | S1 |
| M9 | codex 的 -p 回退取配置段 | run() | 1 | X1 |
| M10 | codex 隔离副本拷配置段那家的 profile 文件 | run() | 1 | X1 |
| M11 | codex 可用性忽略本轮解析值 | 单测 | 1 | P1 |
| M12 | claude run() 不下传 --effort | run() | 1 | X4 |
| M13 | 请求的思考等级回退为只给 antigravity（原 effortFor 口径） | 端到端 | 1 | P3 |
| M14 | parseEffortLevels 解析不出时落 []（错枚举：把「取不到」说成「没有这个旗标」） | 单测 | 1 | K1 |
| M15 | claude reasoningLevelsFor 不读探针 | 解析 | 1 | H3 |
| M16 | front-matter 漏写 effort_effective | 单测 | 1 | C4 |
| M17 | parseEffortLevels 改回取最后一对括号（计划三审 CODEX-02） | 单测 | 1 | K1 |
| M18 | 预检可用性不传本轮解析值 | 端到端 | 1 | P2 |
| M19 | review 准备阶段可用性不传本轮解析值 | 端到端 | 1 | P4 |
| MC1 | 契约：tier 枚举放宽（任意串都收） | 单测 | 1 | C2 |

逐条预跑 **20/20 咬住**（`mutation-names.mjs`，带 60 s 用例超时，失败用例名与首行文案见 `mutation-names-log.txt`、`mutation-names-output.json`；规格 `mutation-spec-all.json`）。正式装置 `scripts/mutation-check.mjs` 跑源码 19 条 **19/19 咬住**（`mutation-output.txt`，规格 `mutation-spec-ts.json`；schema 那条装置不收 `.ts` 以外的目标，只走预跑）。

**写变异规格时按「这条变异由哪个用例咬」逐条对出来的覆盖缺口**（没有实跑出「未咬住」，是对表时发现计划 r2 §3.1 的用例守不到，变异开跑前补上）：codex 与 claude 的 `run()` 里「把解析值递进 argv / 隔离副本」那几处（M9、M10、M12），纯函数单测守不到——补了 `codex-effort-profile.test.ts`（真跑 `run()`，假 codex / 假 claude）；`review` 准备阶段的可用性检查（M19）在端到端里被桩的 `availability` 盖住——补了 P4（codex 不打桩、走真实可用性）。

## 4. 全量检查

- `npm run check` **两次串行：3044 / 3042 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同、退出码均为 0（`check-1.txt`、`check-2.txt`）。第 5 步为 3016，本步净增 28 例，跳过数不变。
- **首次全量红 1 格**（读数留在 `check-0-index-order.txt`）：`doc-archive-index` A3「含日期条目按（日期, 文件名）升序」——本报告的索引条目放在了同日的 `m11_tier_flags` 之后，按文件名应在其前。只调换两行顺序，再串行跑两次即上面的读数。
- 代码三审两条接受项（注释与 `config.v2.json` 描述，不改行为）改完后再串行两次：**3044 / 3042 / 0 / 2**，退出码均为 0（`check-3.txt`、`check-4.txt`）。变异锚点不涉及这几行，规格未重生成。
- 自检 `doctor --selftest` 14/14（仓库构建）。
- 本段文字是全量跑完后填入的，索引条目与文件集未动。

## 5. 零配额验收：现役请求逐字不变

脚本 `acceptance.mjs`（基线 `c855dcee`），读数 `acceptance-output.json`：

- 旧构建 = `git archive c855dcee` 导出的旧源码在导出目录内用现行工具链现构建（不是历史构建，计划三审 CODEX-03）；bundle sha256 旧 `b8f7f581fcc6…`、新 `2df791506109…`，断言不同。
- 夹具复刻本仓 `.trivium/config.yaml`（只改运行根与 verify），三侧全桩，`review --start` 到终态：档位表 default / flash / pro × 阶段 plan / code 共 **6 格，新旧交接文件逐侧 `model` / `effort` / `profile_requested` 逐字相同**——codex `kimi-for-coding`（pro 为 `k3`）/ 无思考等级 / `kimi`，gemini `gemini-3.8-flash-high` / `high`（裸 slug 回落阶段级 effort）/ 无，glm `GLM-5.3`（flash 为 `GLM-5.3-Flash`）/ 无 / 无。
- 同一组请求经两边各自的纯函数组出的 argv **6 格逐字相同**：agy 不带 `--effort`（slug 带后缀）；codex `exec -p kimi -m 〈slug〉 -s read-only …`，无 `-c`。
- 临时目录在系统临时目录下、跑完删除（已核无残留）。

## 6. 偏离与边界

1. **`effort_effective` 不是 `CriticResult` 字段**（偏离主设计 11.1 原表）：改为必填钩子 `effortReadback(result)` 派生。理由：钩子入参只有回读结果，生效值结构上拿不到请求值；`failedResult` 与 runner 兜底两个通用构造点不必知道该侧有无思考等级概念（否则要按 Agent 身份分叉）。主设计 11.1 已改写。
2. **探活仍按 `agents.codex.profile`**（BACKLOG EV-229）：可用性、目录、`-p` 三处按解析值，探活这一处没跟——改了会让 `--stage all` 下一侧可能探多次（真实配额）。
3. **`override_reason` 的「档位 X」措辞**（BACKLOG EV-230）：X 是厂商 profile，不改措辞，只登记。
4. **回滚代价**（计划三审 CODEX-01）：回滚到本步之前的 bundle 时，本步之后的 parse_fallback 原文若照抄了新五键，旧剥离清单剥不掉，该轮按回退编号裁决。
5. **现役行为的唯一预期变化面在档位形态**：gemini 档位没写 effort 时不再回落阶段级 effort；codex / claude 档位里的 effort 真下传。本仓无 tiers，不受影响。
6. **`config.v2.json` 改了两处描述**（代码三审 GLM-01）：范围边界「不改 config.v2」指不改契约形状；这两处只是 `description` 字符串跟着拆闸改为现在时，键、类型与约束都没动。
7. **探针结论形状变**：旧的 claude 探针结论没有 `effort_levels`，预检对 claude 的思考等级跳过校验并点名，重装后跑一次 `doctor --no-model-calls` 即落盘。
