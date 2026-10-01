---
schema: trivium.disposition.v1
topic: 留痕读不出的出口
stage: plan
role: claude
kind: revised
run_id: 20261001T092816Z
addresses:
  - 2026-10-01-留痕读不出的出口-codex.md
  - 2026-10-01-留痕读不出的出口-gemini.md
  - 2026-10-01-留痕读不出的出口-glm.md
---

# 裁决：留痕读不出的出口 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-01-留痕读不出的出口-claude.md`（r1，起点 `14c188b`）
> ｜ 运行：`20261001T092816Z`（约 10 分 40 秒）
> ｜ 结论：codex `request-changes`（重要 3、次要 3、吹毛求疵 1）｜ gemini `request-changes`（重要 1、次要 3）｜ glm `request-changes`（重要 1、次要 1、吹毛求疵 1）
> ｜ 共 14 条：接受 14、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-01-留痕读不出的出口-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01 ≡ GLM-01**：成立，而且比两侧说的更彻底。我用当前构建经桩写出成功轮与取消轮两份 run.json，拿 `run.v2.json` 最近 25 个历史版本逐个做 ajv 校验（零构建，脚本在本会话 scratchpad），**最近 18 个版本全部接受**：run.v2 顶层允许未知字段，后加的顶层字段旧版一律忽略；`cancelled` 自 `5b83e4b` 起就在枚举里。真正的读侧落差只在 `additionalProperties: false` 的子树里。逐版打印 `termination` 两个 `oneOf` 分支：第一分支 `by` 枚举在 `bcb454e`／`53eaab8` 只有 `worker_exception`，`e49279a` 加 `prepare_exception`／`sync_exception`，`c54091f` 加 `post_spawn_exception`；`e49279a` 的父提交是 `a89a46f`。`sync_exception` 可用 `gate-loop.test.ts` P5 的现成手法写出（同步路径、阶段目录 0555）。r1 那句兜底「换相邻的一对提交」确实预设错了失败方向。
- **CODEX-02**：成立。第 6、7 处的抛错正文（`gate.ts:1116-1122`）只有阶段、run_id、来源；第 5 处（`cli.ts:1148-1155`）只有阶段与 run_id 列表；归档根可配。零参数常量 + 「git restore 〈路径〉」确实是把循环换成缺参数的断头路。
- **CODEX-03**：成立。`test/unit/gate.test.ts:921` 的 `RECOVERY` 占位夹具与 :946-960 那条用例断言「不要删除或改写」，r1 §5 没列这个文件。
- **CODEX-04**：成立。C 格本身就是「已提交、工作树干净、读不出」；没有 Hook 的载体能把坏内容提交进去。按 `git status` 两态分档会把这一格推到三档之外。
- **CODEX-05**：成立。核过 `MANUAL_user.md:218` 有 §3.6「升级」，按载体写了构建与安装两步，可以作落点。
- **CODEX-06**：成立。`mutation-check.mjs` 每条变异都调带测试的构建；`:357` 不写 `expect` 就跑全部套件。
- **CODEX-07**：成立。七处都把 `unreadable` 用顿号拼出，同一阶段确实可能一份已提交、一份未跟踪。
- **AGY-01**：成立。`approve` 复核失败时闸门保持 `awaiting_approval`（`cli.ts:1655-1662`「本次不放行，闸门保持等待审批」），所以 ①、② 恢复之后可以直接重新 approve；先 abandon 会作废一轮有效的审查结论、多花一轮配额。
- **AGY-02**：成立。`latestRunMeta` 靠 `readdir` 扫，不在磁盘上的文件进不了 `unreadable`，第 1～5 处报出的文件按定义都在；「文件不在」只在第 6、7 处出现（`readRunMeta(runId)` 读不到文件）。
- **AGY-03**：成立。用户列的是七处；且共用文本里「提交时的留痕核对会拦下 git commit」「review --start 会拒绝」两句放进提交拦截自己的报错确实语境自指。退出代码范围、登记 EV-182；RUNBOOK 那一句仍按用户的文档清单改——它是现有「讲留痕读不出怎么办」的唯一一处，且与提交锚现文案不冲突（后者没有声称 abandon 能让清单变可读）。
- **AGY-04**：成立。`verifyRoundForApproval` 的 `missingRunId` 分支（`gate.ts:1100-1107`）此时没有任何文件可判成因，拼三档文案文不对题。
- **GLM-02**：成立。:795-805 与 :847-864 都直接 `await hookPreWrite(...)`，是单测。
- **GLM-03**：成立。Hook 现文案六行，第 4 行就是出口行，应为「保留前三行」。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 构建对选错，已实测换成 `termination.by = sync_exception` 这一真实落差，旧版取 `a89a46f` | r2 §1.4「C 格的构建对」、§5.4 C 格、§5.6 |
| CODEX-02 | codex | major | 接受 | 第 5、6、7 处给不出路径，② 档成了断头路 | r2 §2.1 改为 `UNREADABLE_RUN_META_EXIT_BODY` + `unreadableRunMetaExit(files)`（绝对路径）；§2.2 各处传路径；§5.1 U1 / U3 断言路径 |
| CODEX-03 | codex | major | 接受 | 漏列 `gate.test.ts` 的现存断言 | r2 §2.2 末段说明「别动锚」仍可达；§5.1「改现有单测」第 1 条 |
| CODEX-04 | codex | minor | 接受 | 漏了「已提交、工作树干净、读不出」一态 | r2 §1.4「三档的判别动作」；§2.1 ② 改为「与提交的版本不同」、③ 改为「其余情形」 |
| CODEX-05 | codex | minor | 接受 | ① 档「重装」没有可执行落点 | r2 §2.1 ① 指向 MANUAL §3.6「升级」；§5.1 U1 钉成判据；§5.3 M4 |
| CODEX-06 | codex | minor | 接受 | 验证侧没写前置与预算 | r2 §5.6 新增；§5.3 每条只指定一个期望套件 |
| CODEX-07 | codex | nit | 接受 | 一次报多份时单数陈述会误导 | r2 §2.1 文件列表行写「逐份判断成因，每份可能不同」；§5.1 U1 |
| AGY-01 | gemini | major | 接受 | 恢复后可直接重新 approve，先 abandon 会作废有效的一轮 | r2 §2.2 第 7 处 `unreadableRunMeta` 改为先恢复后 abandon；§1.4 E2 行；§5.2 新增 A4‴（E3）；§5.3 M14；§4 PROTOCOL 一格 |
| AGY-02 | gemini | minor | 接受 | 第 1～5 处报出的文件按定义都在磁盘上 | r2 §1.1 补一句；§2.1 ② 去掉「或删掉」，「文件不在」交给第 7 处前半段 |
| AGY-03 | gemini | minor | 接受 | 超出七处且语境自指 | r2 §0「不做」、§1.3 改为不在范围；§6 登记 EV-182；r1 的 M11 与第 8 处用例删除；RUNBOOK 仍按用户清单改（§4） |
| AGY-04 | gemini | minor | 接受 | `missingRunId` 没有文件可判成因 | r2 §2.2 第 7 处两条分开写；§5.1 U3 断言 `missingRunId` 不含固定段；§5.3 M13 |
| GLM-01 | glm | major | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| GLM-02 | glm | minor | 接受 | `hooks.test.ts` 的两条是单测 | r2 §5.1「改现有单测」第 2 条；§5.2 不再列它 |
| GLM-03 | glm | nit | 接受 | 「保留前四行」与删出口行矛盾 | r2 §2.2 第 4 行改为「保留前三行」 |

## 2. 未改动的部分

- 范围（只改文案与注释、不改判定）、共用文本落点 `meta.ts`、第 6 处只在竞态可达的论证、D 格不进本状态的论证——三侧均认定成立，r2 原样保留。
- 第 8 处的必要性 glm 认为论证成立、gemini 认为超范围、codex 未审；按用户决策「七处」与 gemini 的语境理由退出范围，问题本身登记 EV-182，不丢。
