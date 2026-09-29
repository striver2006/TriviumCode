# REPORT：清扫输出失实文字（EV-164）实施报告

> - **日期**：2026-09-29
> - **主题**：`清扫输出失实文字`（命令 A，`/dual-run`）
> - **起点**：`171e38c`；计划 `.reviews/清扫输出失实文字/plan/2026-09-29-清扫输出失实文字-r2-claude.md`（计划双审第 1 轮 run `20260929T011315Z`，三侧 `approve-with-nits`，9 条接受 8、驳回 1）
> - **证据目录**：`doc/05_testing/evidence/scrub-output-text-20260929/`
> - **范围**：只改 `trivium scrub` 的两处人读文字（用户解冻、只改文字）；判据、分档、`--json`、退出码、行数与位置都不变；不花配额

## 1. 逐条落地（按 r2 章节）

| r2 | 落地 |
| :--- | :--- |
| §2.1 提示行（D1） | `cli.ts` 第四格之后那一行由「…需把该侧 cli 改回 null 或等 run_dir_days 整删」改为「…需把该侧 cli 改回 null（到期整删也会保留它）」；触发条件 `r.deferredCli.length > 0`、位置、缩进不变 |
| §2.2 帮助动机句（D2） | `USAGE` 里 `trivium scrub` 一节的动机句加限定「（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）」，仍是一行；显示宽度 151，等于 USAGE 现有最宽行 |
| §2.3 会话启动第四格（D3） | 逐句核过，不失实，**不改**；验收 B8 钉住新旧逐字相同 |
| §2.4 注释（D4） | USAGE 之上两行、第四格之上两行各并为一行已解决的说明；「第四格：…逐条带成因」一行不动 |
| §2.5 不动的面 | `--json`、`admitScrub` 的 `detail`、`--cancel` / `--wait` 文案、退出码均未动（`git diff` 只有 `cli.ts` 4 增 6 删） |
| §4.1 单测 | 新文件 `test/integration/scrub-output-text.test.ts` T1～T6，经真实 bundle；期望块插值用例自己派生的组号、运行目录与运行根，stdout 不做归一化、整段逐字比（CODEX-01）；A、D 分放 `aa-` / `bb-` 两个桶按桶名定序（GLM-01）；CLI 组挂 600 s（GLM-02）；夹具带 `topic`（AGY-02） |
| §4.2 源码变异 | 规格 11 条由 `gen-mutation-spec.mjs` 从源码截锚点、逐条核唯一；装置读数 11 / 11 |
| §4.3 零配额验收 | `acceptance.mjs` B0～B11，旧构建 `171e38c`；B5 由脚本自己写入坏形状常量（CODEX-04） |
| §5 文档 | 见 §4 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check`（第 1 次，文档同步之后） | **2259 / 2257 / 0 / 2**（`check-1.txt`；基线 `171e38c` 为 2253 / 2251 / 0 / 2，新增 T1～T6 共 6 条） |
| 新单测单跑 | `scrub-output-text` 6 / 6，第一次即全绿 |
| 源码变异（`mutation-spec.json`，11 条） | **11 / 11** 咬住（`mutation-output.txt`）；fail 数 M1 2、M2 1、M3 2、M4 1、M5 2、M6 3、M7 2、M8 1、M9 1、M10 1、M11 1——与 r2 §4.2 的应红清单逐条一致 |
| 失败用例名与文案（11 条全跑） | 全部红在目标用例的目标断言上（M1 / M3 / M5 / M7 → T1、T2；M2 / M9 → T5 的 scrub 一节逐字；M10 → T5「USAGE 行数不变」；M4 → T3；M6 → T1、T2、T3；M8 → T2；M11 → T4），没有前置失败。M1 经真实 bundle 把 T1 / T2 跑红，即「变异进了 bundle」（r2 §4.2 要求的核对） |
| 零配额验收（旧构建 `171e38c`） | **12 / 12**，第一次即全过（`acceptance-output.txt`、`acceptance-readout.json`）；新 bundle sha256 `1d3729f9da50…`、旧 `d9e298a0e6be…`；桩相对基线无 diff。B1 四条帮助路由各自差恰为动机句一对、行数 157 / 157；B2 / B3 / B4 / B5 差恰为提示行一对；B6（`--json`，15 个键）、B7（CLI 结束后）、B8（会话启动第四格）、B9（空运行根）差为空；B10 12 格退出码新旧逐格相同 |
| `doctor --selftest` | **14 / 14**（验收 B11） |
| 入口资产引用 | `grep` `skills/`、`skills-src/`：只有被 `.gitignore` :83 忽略的 bundle 产物里有这两句 |
| 残留进程 | 无（单测、变异、验收、全量之后各核一次） |

## 3. 偏离与如实登记

- 计划之外没有偏离；验收与单测都是第一次即通过，没有需要保留的失败读数。
- 单测 T2 / T4 各起一份独立现场（T1 真跑会抹掉 E 格载体），与 r2 §4.1 表中「另起一份」一致。
- 会话启动提示第四格按 r2 §2.3 核后不改；它此前没有单测逐字钉住，本主题也没有为它加单测，由验收 B8 的新旧对照守住。

## 4. 文档同步

| 文档 | 处置 |
| :--- | :--- |
| MANUAL | v1.0.17；场景 4 那句由「提示里仍写着『或等 run_dir_days 整删』…逐字未改」改为 v1.0.17 起提示与帮助已改准（EV-164）；:374 不动 |
| PROTOCOL | `scrub` 行补一句：人读输出第四格之后的提示只给「把该侧 cli 改回 null」一个出口，帮助动机句带同样限定（设计 v1.3.59，EV-164；`--json` 不变） |
| BACKLOG | EV-164 → done；EV-157「去向」里 EV-164 标已修 |
| 主设计 | v1.3.59；:1477 那段改为「v1.3.59 起改为…（EV-164）」；变更记录新增 v1.3.59 行 |
| LLD | v1.1.17；已知缺口表该行划掉并注已解决；变更说明 |
| RUNBOOK | 核：:224-225、:245 已准确，**不改** |
| PRD | 核：PRD 不提 `trivium scrub` 的文字，**不改** |

## 5. 证据文件

| 文件 | 内容 |
| :--- | :--- |
| `gen-mutation-spec.mjs` / `mutation-spec.json` | 变异规格生成脚本与规格（11 条） |
| `mutation-output.txt` | 变异装置读数 |
| `mutation-names.mjs` / `mutation-names-output.json` | 逐条失败用例名与首行文案（照搬上一主题脚本） |
| `acceptance.mjs` / `acceptance-output.txt` / `acceptance-readout.json` | 零配额验收脚本、输出与读数 |
| `check-1.txt` / `check-2.txt` | 全量检查输出（代码双审前 / 修订后） |
| `mutation-spec.r1.json` / `mutation-output.r1.txt` / `mutation-names-output.r1.json` / `acceptance-output.r1.txt` / `acceptance-readout.r1.json` | 代码双审之前（r1）的规格与读数，原样保留 |

## 6. 代码双审 r1（run `20260929T014154Z`）与修订

三侧：gemini `approve`（零意见）；codex `approve-with-nits`（次要 1、吹毛求疵 3）；glm `approve-with-nits`（吹毛求疵 2）。6 条：接受 5、暂缓 1。
应答件 `.reviews/清扫输出失实文字/code/2026-09-29-清扫输出失实文字-response-claude.md`，`gate --check` 通过。命令 A 不设人工闸门，应答后直接按接受项修订。

| 意见 | 修订 | 验证 |
| :--- | :--- | :--- |
| CODEX-01 帮助主句「不再回到那个仓库时，副本会一直躺到 run_dir_days 整删」本身失实 | **核实成立**：到期整删只由会话启动 Hook 跑、只进本项目的桶，不回去就不会有整删。用户只授权了限定语，改写主句要动 4 处文档与 EV-33 原文，还要先选定走向——取审查员方案②：**代码不动**，BACKLOG 新登 **EV-166**（待用户定），EV-164 的 done 说明写明「只加了 CLI 那一格的限定、主句另有成因」；主设计 v1.3.59 行与 LLD 同步写明 | 文档 |
| CODEX-02 ≡ GLM-01 `scene()` 早退路径漏杀 600 s 的组 | 清理句柄在派生那一刻登记（`held`），其余搭建包进 `try`，抛出时先按组号与标记结束再重抛；运行目录搭建抽成 `runDir()` 供 T7 复用 | 单跑 7 / 7、残留进程 0 |
| CODEX-03 T5 钉 USAGE 全局行数 157（与本主题无关的魔数） | 去掉该断言；「动机句仍是一行」由 scrub 一节 10 行的整段逐字守住，新旧全局行数的对照留在验收 B1 | 变异 M10（拆成两行）改由 T5 的 scrub 一节逐字断言咬住（r1 时红在「USAGE 行数不变」那条） |
| CODEX-04 核后不改的会话启动第四格没有进 CI 的用例 | 新增 **T7**：本项目桶里放一个 D 格运行目录，经 bundle 跑 `gate hook-session-start`，整行逐字断言第四格；只放一格以避开「首个」的顺序问题。变异规格新增 **M12**（`hooks.ts` 那句改一个字），规格目标加 `hooks.ts` | M12 红在 T7 |
| GLM-02 `doc/02_design/README.md` 版本指针停在 v1.3.43 / v1.1.3 | **暂缓**：补丁之外、v1.3.44 起的既有问题；BACKLOG 新登 **EV-167**，本主题不改该文件 | — |

修订后读数（修订前留 `.r1`）：

| 项 | 读数 |
| :--- | :--- |
| 新单测单跑 | `scrub-output-text` **7 / 7**（T1～T7） |
| 源码变异（`mutation-spec.json`，12 条：原 11 条 + M12） | **12 / 12**（`mutation-output.txt`）；原 11 条的 fail 数与 r1 逐条相同；M12 fail=1 |
| 失败用例名与文案（12 条全跑） | 全部红在目标断言上，没有前置失败；M10 红在 T5 的 scrub 一节逐字断言，M12 红在 T7「第四格那一行应逐字不变」 |
| 零配额验收 | **12 / 12**（`acceptance-output.txt`）；各格读数与 r1 相同。新 bundle sha256 变为 `17b5fbf07c4f…`（r1 为 `1d3729f9da50…`）；修订后 `src/` 没有再改，差异从哪来没有逐字节核，如实记下。旧仍为 `d9e298a0e6be…` |
| `doctor --selftest` | **14 / 14**（验收 B11） |
| `npm run check`（第 2 次，修订之后） | **2260 / 2258 / 0 / 2**（`check-2.txt`；比第 1 次多 T7 一条） |
| 残留进程 | 无 |

## 7. verify（出口）

`trivium verify`（run `20260929T020201Z`）**通过**：`npm run typecheck`、`npm run build`、`npm test` 三条都退 0，`npm test` **2260 / 2258 / 0 / 2**，用时约 271 s。
留痕 `.reviews/清扫输出失实文字/verify/2026-09-29-清扫输出失实文字-verify.md`。之后核对：无残留进程。

未做（按用户要求停在 verify）：提交、推送、审批、重装。本仓安装副本仍是 `171e38c` 的构建（代码双审运行时编排器已提示「安装副本不是当前工作树构建的」），重装由用户在终端执行。
