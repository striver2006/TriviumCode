---
schema: trivium.disposition.v1
topic: doctor探针走副本HOME
stage: plan
role: claude
kind: revised
run_id: 20261003T042353Z
addresses:
  - 2026-10-03-doctor探针走副本HOME-codex.md
  - 2026-10-03-doctor探针走副本HOME-gemini.md
  - 2026-10-03-doctor探针走副本HOME-glm.md
---

# 裁决：doctor探针走副本HOME · 计划双审第 1 轮

> 被审对象：`plan/2026-10-03-doctor探针走副本HOME-claude.md`（r1，起点 `292fa79`）
> ｜ 运行：`20261003T042353Z`（约 7 分 44 秒）
> ｜ 结论：codex `request-changes`（重要 2、次要 4、吹毛求疵 2）｜ gemini `request-changes`（重要 1、次要 1）｜ glm `approve-with-nits`（次要 2）
> ｜ 共 12 条：接受 12（其中 CODEX-02 只采纳其三项建议中的两项）、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-03-doctor探针走副本HOME-r2-claude.md`；命令 A 不设人工闸门

每条都回源码或文档核过，核对结果写在「理由」列。三侧对主方向（两次真实调用照 `authProbe` 同形、共用临时目录、副本源缺失一格在 doctor 侧不可达）均表认可，定案。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实：副本支与退路支写同一个 `model_id_form`，结论里不记来源；r1 的 R3「只会更准」只在个人缺省为 UUID 形态时成立。按建议在计划里显式决策一次，取第二支：不补字段，来源只由 note 承载、事后不据其形态判定。理由是唯一消费方只取前缀补短名、对来源不敏感，补字段要走 schema 五处同步，收益只是给人看的一行 | r2 §2.6（新增，显式决策与理由）、§7 R3 改写、§5 EV-194 结案残余 |
| CODEX-02 | codex | major | 接受 | 接受其主判据与字面两项建议，「改用非首位模型」一项不采纳（理由见本格后半）。属实部分：`describeZcodeProbedPath` 的「模型 X」是请求值不是生效值；本机档位 `GLM-5.3` 恰是副本源首位与 `model.main`（开工时只读核过结构键），区分不了「请求生效」与「回落首位」。接受：主判据挪到回读侧（`model_id_form` 的 modelId 段等于档位模型、前缀是副本源 provider 键），详情那行降为辅助；判据里的模型字面改为开跑前从临时项目配置读出。不接受：改用非首位模型跑——「请求生效 vs 回落首位」是 EV-82 的运行期选模问题，由 doctor 零配额的置首支另判；本题要证的是「探的是副本路径而非个人缺省」，这一格已可判伪（个人缺省是停用 provider 下的 UUID 前缀模型，走个人路径必报 `Model creation failed`，回读到 `bigmodel-coding-plan/…` 只可能出自副本源），r2 把这条判伪性说明写进计划 | r2 §2.1 末句、§6.3「判据」改后 ③、「判伪性说明」一段、开跑前读档位模型一步 |
| CODEX-03 | codex | minor | 接受 | 属实：个人配置会被桌面端改写（EV-87），r1 未区分「改前不复现」与「改后不达标」两种停机形态。开工时核过故障现场仍在，但跑前仍要再核一次 | r2 §6.3「改前不复现的处置」：只读核 `defaultModelSelection` 一个键；不复现则判不可对照、如实记下，改后照跑（判据独立），不追加授权、不动真实 `~/.zcode` |
| CODEX-04 | codex | minor | 接受 | 属实：只导出 `ZCODE_CLI_SUBDIR` 后探针侧仍要自己拼 `log`，是落点布局的第二份实现。改为直接取 `zcodeStorageRedirectEnv(landing).ZCODE_LOG_DIR`——就是递给 CLI 的那个值；rollout 沿用 `readRollout` 现成的 `homeDir` 参数，不新增字面。其余四处既有字面不在本题重构 | r2 §2.3 第 6 步；撤回 r1「导出 `ZCODE_CLI_SUBDIR`」；§4 M5 改述 |
| CODEX-05 | codex | minor | 接受 | 属实：`readTrace` 只取最新一片（`probes/zcode.ts:1044-1046`），`run()` 读全部分片并在注释里写明跨午夜理由（`adapters/zcode.ts:1309-1316`）。`readTrace` 唯一调用方就是 headless 段（全仓 grep），改成「目录必填、读全部分片拼接」不影响别处；`run()` 不动，两处注释互指 | r2 §1.3、§2.3 第 6 步、§3 D9（跨午夜）、§4 M15 |
| CODEX-06 | codex | minor | 接受 | 属实三处：①`doc/05_testing/README.md` 索引（与 AGY-02、GLM-01 同一处）；②RUNBOOK zcode 排障行有按「探活 / doctor 在真实 HOME 下拉起」写的句子，:275「该探活走 `homeDir: null`」自 EV-136 起已不符；③EV-136 行末句正是本题要改的那半句 | r2 §1.6、§5 RUNBOOK 一条、EV-136 一条、报告索引一条 |
| CODEX-07 | codex | nit | 接受 | 属实：用全局临时目录列举判删除会被并发进程干扰。`os.tmpdir()` 每次调用都读 `TMPDIR`，钉到用例私有目录即可确定化 | r2 §3 用例前提（钉 `TMPDIR`）、D1～D6「无残留」判法 |
| CODEX-08 | codex | nit | 接受 | 属实：M7 / M8 会留临时目录。钉 `TMPDIR` 后残留落在用例私有目录、随用例整删；仍在装置跑完后核一次系统临时目录、读数进报告，并写明内容只含合成假凭据 | r2 §4 末「变异残留」段 |
| AGY-01 | gemini | major | 接受 | 属实：`doctor.ts:598` 只在 `response_field === null` 时出 blocker，有既有结论时失败即返回、`response_field` 保留旧值，blocker 不可达——`doctor.ts:563-568` 注释早有记载。r1 §0「由 blocker 判据照旧处理」不实，改为如实陈述「只出 note、不拦不警告，与现状一致」。改拦截判据超出决策一的范围，不在本题做；这是双审核出的缺口，按决策四另登 BACKLOG | r2 §0 第四条改写、§1.2、§7 R7、§5 新登条目 |
| AGY-02 | gemini | minor | 接受 | 属实：同 CODEX-06 ①、GLM-01 | r2 §5 测试报告一条 |
| GLM-01 | glm | minor | 接受 | 属实：同 CODEX-06 ①、AGY-02 | r2 §5 测试报告一条 |
| GLM-02 | glm | minor | 接受 | 属实：r1 判据没写「文件数不变」只核改后；改前跑的是旧代码，本就在真实 HOME 留产物，按两侧判会把正确实现判成不达标并烧完授权 | r2 §6.3 改后 ④：只核改后那次；改前清单如实记下、不进判据 |

## 2. 说明

- **CODEX-02 只采纳两项建议的边界**：任务目标验证 3 写死的四条判据保留原意（改前报 `Model creation failed`；改后通过、详情写档位模型、两项结论刷新、真实 HOME 文件数不变），r2 只做两件事：把「详情写档位模型」降为辅助、在「`model_id_form` 被刷新」上加「且等于档位模型、前缀是副本源 provider 键」；把「文件数不变」限定为改后那次（GLM-02）。都是收紧或澄清，没有放宽。
- **新登条目**：AGY-01 核出的「有既有结论时 headless 失败不拦不警告」是双审核出的缺口，按决策四「不新登条目，除非双审核出新缺口」登记，编号实施时取下一个空号。
- **PROTOCOL 不改**：codex 侧独立复核同（`grep` 零命中），三侧无异议。
