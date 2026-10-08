---
schema: trivium.disposition.v1
topic: M11-复盘报告双维度聚合
stage: plan
role: claude
kind: revised
run_id: 20261008T053559Z
addresses:
  - 2026-10-08-M11-复盘报告双维度聚合-codex.md
  - 2026-10-08-M11-复盘报告双维度聚合-gemini.md
  - 2026-10-08-M11-复盘报告双维度聚合-glm.md
---

# 裁决：M11-复盘报告双维度聚合 · 计划三审第 1 轮

> - **运行**：`20261008T053559Z`；codex `approve-with-nits`（次要 4、吹毛求疵 1）、gemini `request-changes`（重要 1、次要 3、吹毛求疵 1）、glm `approve-with-nits`（次要 6）。
> - **结果**：16 条全部接受；合入后的计划见 `2026-10-08-M11-复盘报告双维度聚合-r2-claude.md`。
> - **逐条核实**：每条都回源码或文档核过再裁决。AGY-01 的 `isReviewArtifact` 核实存在（`archive.ts:149`），但既有用例 `report.test.ts:370`「缺 run.json 的轮次照样出现在报告里」用的是**没有 front-matter** 的审查文档（第 375 行），纯用内容谓词会让它消失——所以落点是「内容谓词优先、后缀规则兜底」的组合，不是整换；GLM-04 的 PROTOCOL 第 428 行核实存在。
> - **原稿里的待拍板 D-1～D-6 本轮不变**，仍待用户拍板；r2 的规格按推荐项写，拍板结果不同时随之改写。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实 `test/fixtures/run.v2.pre-m11-step6.json` 顶层是 `$schema` / `$id` / `properties` 的 JSON Schema 快照，不是 run 记录实例；原稿 §1.4 把它说成「缺席夹具」失实 | r2 §1.4 改正该句；r2 §4.1 写明「缺席」夹具由 `seedRound` 式助手手造（逐侧条目不写思考等级五键，gemini 只写旧名 `effort`），该 schema 快照不用 |
| CODEX-02 | codex | minor | 接受 | ⚠️ 需要同时看两值，与「生效列纯函数入参不含请求值」确实矛盾；按建议拆开：纯函数只出单值，⚠️ 在行级拼装处比较 | r2 §2.4 纪律句改写、§3.4 写明分工（`renderEffortEffective` 只收生效值两格；`effortMismatch(side)` 单独一个函数在行级用） |
| CODEX-03 | codex | minor | 接受 | 行集与「读不到 Driver」组的未进时间线格确实没钉死；核实 `collectUnlistedRuns` 只收可读 run.json，未进时间线的运行必有已知 driver | r2 §2.2 行集 = 时间线轮次出现过的（Driver, 阶段）∪ 未进时间线运行出现过的（Driver, 阶段），轮次为 0 写 0；「读不到 Driver」组的未进时间线格写「—」并注明不适用的原因；A2 补断言 glm 在 code 阶段成行、轮次 0、未进时间线 1 |
| CODEX-04 | codex | minor | 接受 | 「本轮」二义；轮次与运行在数据模型里本来分两档，入选轮次只数时间线轮次更一致 | r2 §2.3 表 A「入选轮次」限时间线轮次；未进时间线运行的入选与失败只在表 B 专列 |
| CODEX-05 | codex | nit | 接受 | 行序不钉会让 P4 的同归档同报告出现顺序漂移 | r2 §2.3 补「审核者按注册表顺序，『来源不明』排最后」 |
| AGY-01 | gemini | major | 接受 | 核实 `isReviewArtifact`（`archive.ts:149`）按 front-matter `schema: trivium.review.v1` 判，原稿与裁决件不带它，比后缀集合可靠；但它对 front-matter 缺失 / 损坏的审查件判假（EV-63），而既有用例 `report.test.ts:370` 正是无 front-matter 的孤立审查文档、断言「有工件就得出现」——整换会把它打红并违背该原则。故组合使用：无可读 run.json 的轮次号，内容谓词为真即算审查文档；为假时再用后缀兜底（后缀不属于「本阶段记过的 driver ∪ 缺省 Driver」才算） | r2 §3.2 枚举规则改写；r2 §7 R1 按新规则重写残余（只剩「front-matter 损坏且后缀落在排除集」与「从未出现过的 Driver 的无 front-matter 原稿」两格）；r2 §4.1 新增 A1b：无 run.json 的轮次里 claude 是唯一产出方、审查文档带 front-matter ⇒ 该轮仍在时间线 |
| AGY-02 | gemini | minor | 接受 | 「产出结论轮次」确无定义，与 GLM-03 同一缺口 | r2 §2.3 定义：该侧本轮有可读的合格结论（`sides[].findings` 非 null，即 review json 读得到）；意见数为 0 的也算；整份回退、失败、超时不算，空审查（结构合法、零意见）算 |
| AGY-03 | gemini | minor | 接受 | 正文说「—」而列口径表没同步，读者按表实现会补 0 | r2 §2.2 列口径表每一格补「读不到 Driver 组」的写法（意见数、已裁决 / 未裁决、接受 / 驳回 / 暂缓、采纳率、未进时间线一律「—」） |
| AGY-04 | gemini | minor | 接受 | 与 CODEX-01 同一事实，核实同上 | 同 CODEX-01 |
| AGY-05 | gemini | nit | 接受 | 表 B 思考等级合一列确实会和第四节的分列混淆；未进时间线运行的失败判据也没写 | r2 §2.3 表 B 拆「思考等级请求」「思考等级生效」两列分别计次；「未进时间线运行中失败」只数该侧 `critics[c].status` 为 `failed` / `timeout`，不看顶层状态 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-02 同一矛盾；按建议改写纪律句并写明分工 | 同 CODEX-02；r2 §2.4 纪律句改为「生效列的取值只来自 `effort_effective` 与 `effort_effective_source`，不以请求值顶替；⚠️ 是两列对比标记，在行级拼装，不是生效列的取值来源」 |
| GLM-02 | glm | minor | 接受 | 两列输入互相独立，行式表的「—」既当显示值又当「此形态不约束」占位，确会误读 | r2 §2.4 拆成「请求列映射」「生效列映射」两张单列表，表前写明两列各自独立判定 |
| GLM-03 | glm | minor | 接受 | 与 AGY-02 同一缺口；A4 确实没断言 codex 在 code r1 的这一格 | 同 AGY-02；r2 §4.1 A4 补断言：codex 入选 1 轮、产出结论 0 轮、整份回退 1 次 |
| GLM-04 | glm | minor | 接受 | 核实 `doc/03_api/PROTOCOL_dual_critic_relay.md:428` 登记过 `--json` 多出 `unlistedRuns` 的先例，本步同类变化漏列 | r2 §5 文档清单补 PROTOCOL 第 428 行：按 r2 §2.5 的字段形状更新 `--json` 描述 |
| GLM-05 | glm | minor | 接受 | 原稿 R1 ② 低估了：缺省 Driver 无条件在排除集，claude 作唯一产出方的无 run.json 轮次必消失；且「从未存在」的 run.json 不进 notes，消失无声。AGY-01 的内容谓词优先把这条主路径堵上了（front-matter 完好即保留）；剩下的「front-matter 损坏且后缀在排除集」不加 notes——那一格里绝大多数文件是合法原稿，逐个记进 notes 是噪音，如实写进残余即可 | r2 §7 R1 按 GLM-05 的两点如实重写（含「从未存在的 run.json 不进 notes」）；不加 notes 的理由写进 R1 |
| GLM-06 | glm | minor | 接受 | JSON 面一句话带过、与 Markdown 表详略失衡；纪律 6b 要求规格同粒度 | r2 §2.5 给出 `aggregates` 字段级形状（`byDriver` 行结构、`unknownDriver`、`byCritic` 两组字段、逐值计次的形状），并入 13.2 |
