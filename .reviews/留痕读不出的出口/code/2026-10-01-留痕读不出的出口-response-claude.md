---
schema: trivium.disposition.v1
topic: 留痕读不出的出口
stage: code
role: claude
kind: response
run_id: 20261001T103637Z
addresses:
  - 2026-10-01-留痕读不出的出口-codex.md
  - 2026-10-01-留痕读不出的出口-gemini.md
  - 2026-10-01-留痕读不出的出口-glm.md
---

# 应答：留痕读不出的出口 · 代码双审第 1 轮

> 被审对象：相对 `HEAD`（`14c188b`）的 33 个文件变更
> ｜ 运行：`20261001T103637Z`（约 11 分 16 秒）
> ｜ 结论：codex `approve-with-nits`（次要 3、吹毛求疵 1，另逐条降级 1）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 2）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01**：成立。`checkRunManifests` 只遍历 `task.json.runs[]` 登记项；`review.ts:1025` 先 `writeRunMeta`、`:1027` 才 `registerRun`，两者之间失败即留下未登记的骨架（EV-145 记过这个窗口）。这份骨架若对读取方读不出（① 的形态），删掉它没有任何锚会拦，判定随之从 `corrupt` 降级——共用段末句写成了无条件。设计 8.4 那句带「登记过它」的前提，搬进共用段时丢了。
- **CODEX-02**（逐条降级：多余字段 `evidence_note`，内容照常裁决）：成立。① 与「已提交的版本本身就读不出」那一格 `git status` 都是干净的，按文案给的判据分不开；读取方自己的构建标识 `embeddedBuildStamp()` 现成可得，run.json 的 `snapshot.build` 记着写入方的构建，两边可比。这一步不改判定、不改 `readRunMeta` 形状，不与 EV-181 重叠。
- **CODEX-03**：成立。① 是整批读不出，本仓单阶段最多 12 份 run.json；Hook 的 deny 理由每次写入都重复进上下文。
- **CODEX-04**：成立。`acceptance.mjs` 的 `sh()` 没有超时；读数只在 `finally` 之后一次写出，中途抛错全丢。
- **CODEX-05**：成立。共用段给的 `git restore` 路径没加引号（项目根可能含空格）；`git status` 缺省 `core.quotePath=true` 会把中文主题名转八进制，与列出的原始路径形状不同。
- **GLM-01**：成立。`gate --run-id` 钉住读不出的那一格（`cli.ts:1101-1107`）是同一份文件、同样的三档成因，文案只有「请确认归属」；而 `gate.ts` 的 `missing_disposition` 提示与「没有任何运行元数据」的警告都会主动把人引向 `--run-id`。计划 r2 §0 把这一格划出范围的理由是「出口没有循环、不是本状态」——前半句对，后半句不对：归属无误时它就是本状态，且没有出口。改为纳入，作为计划偏离写进报告。
- **GLM-02**：成立。七处都是「动态引入 → `runMetaPaths` → `unreadableRunMetaExit`」两步配对，把 id 数组直接当路径传入类型系统不拦。
- **GLM-03**：成立。runId 为 null 时两个构造函数仍会拼出「涉及的运行留痕：」加空列表加 ② 档「git restore 上面列出的路径」——今天被 `verifyRoundForApproval` 的第 1 步挡住，但形状是坏的。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 末句的后果只对登记过的运行成立，未登记骨架删掉无人可查 | `meta.ts` 共用段末句改为条件句（登记过 ⇒ 提交锚以「运行清单已丢失」拦下；未登记 ⇒ 删掉无人可查、判定悄悄降级——两种都不要删）；U1 加断言钉住「登记」前提；「未登记骨架被删无痕」这一格新登 EV-183（与 EV-181 / EV-182 不同格），设计 8.4 同步 |
| CODEX-02 | codex | minor | 接受 | ① 与 ③ 的已提交干净形态按现判据分不开，构建标识现成可比 | `unreadableRunMetaExit` 在文件列表之后加一行「判别 ①：本工具的构建是〈git_head 短码〉（〈built_at〉）；能以 JSON 打开的 run.json 看 `snapshot.build.git_head`，比本工具新即属 ①」（取不到构建标识时如实写「本工具的构建标识缺失」）；U1 断言该行；变异补一条 |
| CODEX-03 | codex | minor | 接受 | 整批读不出时清单无界、反复进 Hook 上下文 | 至多列 5 份，超出写「另有 K 份同状态未列出（同在该阶段 `_meta/` 下）」；U1 加 7 份的用例断言只列 5 份并报 K=2；变异补一条 |
| CODEX-04 | codex | minor | 接受 | 验收脚本无超时、读数中途抛错即丢 | `acceptance.mjs` 的 `sh()` 加超时（缺省 300 s，到点按进程组 SIGKILL 并记 `timed_out`）；读数写出挪进 `finally`，并记开始 / 结束时间与抛错信息；按修订后的构建重跑一次 |
| CODEX-05 | codex | nit | 接受 | 路径可能含空格；`git status` 缺省会把中文路径转义 | 共用段 ② 改为 `git restore -- '〈上面列出的路径〉'`，判别动作给现成命令 `git -c core.quotePath=false status --porcelain -- '〈路径〉'`；U1 断言 |
| GLM-01 | glm | minor | 接受 | `--run-id` 钉住读不出、归属无误时同属本状态且没有出口，仓内文案又主动引人用 `--run-id` | `cli.ts` 的 pinned 分支保留「请确认归属」，补「归属无误则按下列成因处置」并拼共用出口；`gate-loop` T-12 的 pinned 子用例加 `assertUnreadableExit`；变异补一条；报告记为计划偏离（r2 §0 曾划出范围） |
| GLM-02 | glm | nit | 接受 | 两步配对重复 7 处，类型不拦误传 | `meta.ts` 加单入口 `unreadableRunMetaExitAt(layout, stage, runIds)`，八个站点都改用它；底层两个导出保留给单测 |
| GLM-03 | glm | nit | 接受 | runId 为 null 时拼出空列表与指向不存在路径的 ② 档 | `awaitApprovalRecovery` / `approveForkRecovery` 在 runId 为 null 时 `unreadableRunMeta` 给一句普通说明、不拼共用段；`unreadableRunMetaExitAt` 对空列表抛程序缺陷错误；U3 断言 null 档不含固定段 |

## 2. 修订后的验证

按修订后的源码：变异规格重新生成（锚点随源码更新，补 M15～M17）并先逐条预跑再正式跑；零配额验收重跑；全量检查两次、doctor 自检、Node 18 / 22 目标套件重跑；读数以 `.r1` 后缀另存，首轮读数原样保留。
