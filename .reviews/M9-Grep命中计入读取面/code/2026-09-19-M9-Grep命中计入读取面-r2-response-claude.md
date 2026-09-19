---
schema: trivium.disposition.v1
topic: M9-Grep命中计入读取面
stage: code
role: claude
kind: response
run_id: 20260919T154710Z
addresses:
  - 2026-09-19-M9-Grep命中计入读取面-r2-codex.md
  - 2026-09-19-M9-Grep命中计入读取面-r2-gemini.md
  - 2026-09-19-M9-Grep命中计入读取面-r2-glm.md
---

# 代码审应答：M9-Grep命中计入读取面（第 2 轮）

## 0. 应答总览

codex `request-changes`（5 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 2）、gemini `approve-with-nits`（2 条）、glm `approve-with-nits`（2 条）。
共 9 条：**接受 9 ｜ 驳回 0 ｜ 暂缓 0**。

三个焦点三侧一致：T12 四格与 `dispose` 分派逐格对应，己方材料那格锁的是「真命中后放行」（codex 与 glm 都推演到 deny 目录条目前缀命中 → `own-run-material` → `dispose` 返回 null）；`toLogicalForm` 对项目外路径原样保留，运行根条目命中没丢；codex「未采集」的措辞**不一致**——三侧独立命中 `types.ts:1507` 仍写「codex 的命令输出不进轨迹」，codex 另找到设计 §10.1.1 consulted 行里「agy / zcode / codex 无此事实」。这两处都是上一轮 CODEX-01 修改计划落点清单之外的残留：我列了五处落点，漏了字段注释与我自己在同一批里改写的那一行。

其余四条：T12 ③ 缺正对照（codex ≡ gemini）、README「原件另存」与盘上事实不符、guard.ts 两处注释错位（codex ≡ glm）。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实：§10.1.1 consulted 行是我本批改写的，括号里仍把 codex 与 agy / zcode 并列为「无此事实」，与同文档 §10.1 新规则段「未采集」自相矛盾。危害在决策面：读到「无此事实」的人会认定不可修，而 EV-76 明写「要做时从 `commands[].output` 起步」 | 设计 §11.4（原文 2378 行附近）consulted 行括号改为「claude 侧已解析；agy / zcode 的流无工具输出；codex 的输出在轨迹里但未采集」；「同一个 null 两种原因」只在 §10.1 定义一次，别处引用 |
| CODEX-02 | codex | minor | 接受 | 属实：`types.ts` 字段注释是三态纪律的第一读者，却把「未采集」写成「不进轨迹」，与下一句自己强调的纪律矛盾 | `types.ts` `search_hit_paths` 注释括号改为：agy / zcode 的流只有工具入参、stub 不产真实输出（无此事实）；codex 的命令输出在 trace.json `commands[].output` 里但未做命中解析（未采集）——两种 null 分列 |
| AGY-02 | gemini | nit | 接受 | 与 CODEX-02 同一处 | 同 CODEX-02 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-02 同一处，且指出它是 CODEX-01 落点清单之外的第四处——落点清单不全，这条教训与 EV-12 的「差集自检」同源 | 同 CODEX-02；本件 §4 记一句：措辞类修正的落点要 grep 差集自检，不靠列清单 |
| CODEX-03 | codex | minor | 接受 | 属实：T12 ③ 是纯阴性断言，区分不了「命中后放行」与「压根没命中」；`toLogicalForm` 的 `rel === null` 分支若改成丢弃，运行根条目在措施 a 里静默变盲而 T12 / T13 全绿——正是本轮引入的失效面 | T12 ③ 前补正对照：同一 deny 条目 `/runs/proj-1/R1`、对端侧 `/runs/proj-1/R1/gemini/out/result.json` → `peerArtifactRead === true`、`typedHits` 类别 `peer-run-output`；再断言己方侧三集合不记。一格内先证「运行根条目能命中」再证「己方命中后放行」 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-03 独立收敛，建议形态一致 | 同 CODEX-03 |
| CODEX-04 | codex | nit | 接受 | 属实：证据件与夹具逐字节相同（同 sha256、同 71065 字节）、都带 `<ROOT>` 占位，仓库里没有未改写的原件，「原件另存」不成立；截取脚本也不在仓库里 | README 措辞改为「同一份截取的归档副本（已做根前缀改写；原始 `stdout.jsonl` 含本机 slash_commands 清单，刻意不入库）」；截取脚本 `extract-grep-pairs.py` 落进 `doc/05_testing/evidence/m9-acceptance-20260919/`，README 引用它与命令行，让「其余一字未动」可复现核对 |
| CODEX-05 | codex | nit | 接受 | 属实：`matchConsulted` 插在 `judgeSide` 的 docstring 之后，前一段成了无主注释，`judgeSide` 失去说明 | `matchConsulted`（含其 docstring）移到 `judgeSide` 那段 docstring 之前，让「单侧判定 / 阈值 80%」重新挂回 `judgeSide` |
| GLM-02 | glm | nit | 接受 | 与 CODEX-05 同一处，另指出措施 a 旧注释首句「只吃 `read_paths`、不吃回填」在并集之后字面已不准 | 同 CODEX-05；旧注释首句改为「措施 a 只吃**真实读取**事实（`read_paths` 与 `search_hit_paths`）、不吃回填」 |

**统计**：接受 9 ｜ 驳回 0 ｜ 暂缓 0。

## 2. 双方共同指出的问题

- **codex 措辞残留**（CODEX-01 / CODEX-02 / AGY-02 / GLM-01）：两处，一并改，改完 grep「不进轨迹」「无此事实」做差集自检。
- **T12 ③ 缺正对照**（CODEX-03 / AGY-01）：补对端侧同条目命中。
- **guard.ts 注释错位**（CODEX-05 / GLM-02）：docstring 归位 + 旧句改准。

## 3. 不予采纳的意见及其依据

无。

## 4. 本轮未覆盖

- 三侧均未实跑全量（codex 单跑 grep-hits 11/11，其余用例因沙箱只读 EPERM）；本批改完再跑全量。
- 大小写不敏感文件系统下 `init.cwd` 与 `projectRoot` 大小写不一致的假阴性（codex 盲区，低置信）：本批不动，与 EV-78 同批评估时一并看。
- 上一轮 CODEX-01 的落点清单漏了两处——措辞类修正以后先 grep 旧措辞取差集，再列落点。
