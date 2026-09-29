---
schema: trivium.disposition.v1
topic: 清扫输出失实文字
stage: plan
role: claude
kind: revised
run_id: 20260929T011315Z
addresses:
  - 2026-09-29-清扫输出失实文字-codex.md
  - 2026-09-29-清扫输出失实文字-gemini.md
  - 2026-09-29-清扫输出失实文字-glm.md
---

# 裁决：清扫输出失实文字 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-29-清扫输出失实文字-claude.md`（r1，起点 `171e38c`）
> ｜ 运行：`20260929T011315Z`（约 13 分 42 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 4）｜ gemini `approve-with-nits`（次要 1、吹毛求疵 1）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 9 条：接受 8、驳回 1、暂缓 0
> ｜ 修订后的计划：`plan/2026-09-29-清扫输出失实文字-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：成立。`status.ts` :345 A 格的 `detail` 是 `${r.side} 侧审查员 CLI 进程组 ${r.pgid} 仍在`，经 `admitScrub` 的 `why` 进 `cli.ts` :1927 的人读行；r1 §4.1 只归一化运行根，组号每次都不同，「整段逐行等于期望」做不到确定性成立。§4.3 的「三位以上数字」归一化会连计数一起抹平，不适合单测——取审查员给的第二种：用例把自己派生的组号插值进期望块（更硬）。
- **CODEX-02**：成立。T2 断言 dry-run 的整段 stdout，同样含「侧层已收工」、第四格与提示行；装置的 `expect` 是套件级、只数 fail 数（`scripts/mutation-check.mjs`），应红清单按用例重算。
- **CODEX-03**：成立。`USAGE.split('\n')` = 158 是含尾空元素的口径；`--help` 的 stdout 另被 `say` 追加换行，内容行 157。r1 的「158」是双口径数字。
- **CODEX-04**：成立。上一主题 `acceptance.mjs` 没有 malformed 格（A1～A9 只有 alive、`started_at` = null、到期整删），B5 是新装置；`detail` 带 status.json 的原始值（`status.ts` :340），新旧两侧写入的坏形状必须逐字节一致。
- **CODEX-05**：成立。§5 改 MANUAL / 主设计 / LLD / PROTOCOL / BACKLOG 与三处版本号；只退代码而文档停在新版本，MANUAL 场景 4「提示已改准」立刻变成与本主题同形的失实文字。
- **AGY-01**：**不成立**。实读 `cli.ts` :1874-1892 的 `emitJson` 对象：`ok`、`dry_run`、`buckets`、`visited`、`alive`、`eligible`、`settled`、`scrubbed`、`run_dir_redacted`、`scrub_failed`、`unknown`、`deferred`、`deferred_cli`、`incomplete`、`unreadable_buckets`——**15 个**，没有 `run_root`（运行根只在人读分支 :1893 打印）。codex（「emitJson 的键实测 15 个」）与 glm（「cli.ts :1876-1892 逐一数过」）独立复核同为 15。
- **AGY-02**：成立。`test/helpers/fixture.ts` :44 `topic: string` 必填，r1 的 `makeFixture({ draft: false })` 过不了 typecheck。
- **GLM-01**：成立。`retention.ts` :318 只对桶名 `buckets.sort()`，桶内 :323 `readdir` 未排序；r1 T1 / T2 把 A、D 两行的相对顺序写死进期望串，顺序不稳会假红。
- **GLM-02**：成立。`sleep 120` 在变异装置高负载下（每条重跑 `build --with-tests` 加套件）余量不足；桩 `hang_cli` 用 600 s，对齐成本为零。

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 组号进人读行，只归一化运行根时整段断言不确定；取「插值已知组号」这一更硬的口径，不对单测做数字归一化（会抹平计数、削弱判据） | r2 §4.1「比对口径」：期望块由用例用自己派生的组号、运行目录绝对路径与运行根插值生成，stdout 不做任何归一化逐字比；T4 的 `detail` 按侧对齐逐字比（A 格含插值组号） |
| CODEX-02 | codex | minor | 接受 | 按各用例现场重算应红清单，并写明装置 `expect` 是套件级、fail 数以装置读数为准 | r2 §4.2 变异表「应红」列重算（M5 / M6 / M7 加 T2，M6 另加 T3）；表前注明套件级口径与失败用例名由 `mutation-names.mjs` 对账 |
| CODEX-03 | codex | minor | 接受 | 行数判据改为可执行、不含尾空歧义的对象定义 | r2 §3 末段与 §4.1 T5：「`--help` 的 stdout 去掉末尾换行后按 `\n` 切 = 157 行」+「scrub 一节到其后第一个空行 = 10 行」；删掉「158」 |
| CODEX-04 | codex | minor | 接受 | B5 是新装置，要写清造法与归一化口径 | r2 §4.3 B5：worker 强杀后由验收脚本（不经任何一份构建的代码）把 glm 侧 `cli` 写成同一个常量 `{"pgid":"not-a-number"}`，新旧两侧逐字节相同；原始值不含三位以上数字、不需归一化；gemini 侧保持仍在，`why` 取形状坏在前（`status.ts` :354-357）；收尾结束 gemini 组。工作量计入 |
| CODEX-05 | codex | minor | 接受 | 回滚要成对退，否则文档留下与本主题同形的失实 | r2 §6.4 改写为成对清单：代码两处字符串 + 两处注释 ↔ MANUAL 场景 4 句与版本行、PROTOCOL `scrub` 行补句、主设计 :1477 句与 v1.3.59 行、LLD :605 行与 v1.1.17、BACKLOG EV-164 / EV-157 两行；并写明「只回退代码时必须同时回退的文档句」 |
| AGY-01 | gemini | minor | 驳回 | `emitJson` 对象恰 15 个键，不含 `run_root`（运行根只在人读分支 :1893 打印）；codex、glm 独立数过同为 15。按 16 个键断言反而会让用例红 | 无修改；r2 §4.1 T4 把 15 个键逐项列出，读者不必再数 |
| AGY-02 | gemini | nit | 接受 | `topic` 必填，照写 | r2 §4.1 夹具：`makeFixture({ topic: '清扫文字用例', draft: false })` |
| GLM-01 | glm | minor | 接受 | 桶内顺序来自未排序的 `readdir`；取「按桶名排序钉顺序」——把 A、D 放进两个不同的项目桶，顺序由代码自己的 `buckets.sort()` 决定，不依赖文件系统，也不需要在断言里无序归组 | r2 §4.1 夹具：A 格与 E 格在桶 `aa-ev164-other`，D 格在桶 `bb-ev164-other`（`scrubAllRunRoot` 对桶名无格式要求，:313-330；前缀定序），期望的「项目桶」计数随之为 2；注明该假设的出处 `retention.ts` :318 |
| GLM-02 | glm | nit | 接受 | 零成本加余量 | r2 §4.1：CLI 组改为 `sh -c 'sleep 600; : "$0"' 〈标记〉`，收尾照旧按组结束、按标记兜底 |

## 2. 本轮之外

没有需要暂缓登记的新问题。
