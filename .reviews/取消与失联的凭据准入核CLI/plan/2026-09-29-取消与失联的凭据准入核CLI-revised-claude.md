---
schema: trivium.disposition.v1
topic: 取消与失联的凭据准入核CLI
stage: plan
role: claude
kind: revised
run_id: 20260928T231329Z
addresses:
  - 2026-09-29-取消与失联的凭据准入核CLI-codex.md
  - 2026-09-29-取消与失联的凭据准入核CLI-gemini.md
  - 2026-09-29-取消与失联的凭据准入核CLI-glm.md
---

# 裁决：取消与失联的凭据准入核CLI · 计划双审第 1 轮

> 被审对象：`plan/2026-09-29-取消与失联的凭据准入核CLI-claude.md`（r1，起点 `08396d2`）
> ｜ 运行：`20260928T231329Z`（约 7 分 39 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 2、吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 3、吹毛求疵 1）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-09-29-取消与失联的凭据准入核CLI-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：部分成立，按「逐处判真伪」接受。实读：`cli.ts` :327（`trivium scrub` 帮助）、MANUAL :374、`doc/06_deployment/RUNBOOK_pipeline_ops.md` :224、`retention.ts` :284 都是「不再回到那个仓库时，副本会一直躺到 `run_dir_days` 整删。这条命令补那一格」——这是 `trivium scrub` 的**动机句**，论域是它要补的那一格（worker 已不在、CLI 无阻挡的目录只有会话启动清扫与整删两条出路）；A / C / D 格的目录 `trivium scrub` 同样不抹，不在这句的论域内，本主题之后仍成立。主设计 :1477 的「不自愈，出口是人把该侧 `cli` 改回 null 或等 `run_dir_days` 整删」确是同一假话、r1 漏列，成立。
- **CODEX-02**：成立。`.gitignore` :83 忽略 `skills/dual-critic/scripts/trivium.cjs`，`git archive` 里没有 bundle；上两个主题的 `acceptance.mjs`（如 `heartbeat-threshold-warning-20260929/acceptance.mjs` :11-12、:157-162）都是在展开副本里 `node scripts/build.mjs`。r1 没写这一步。快照工作树 bundle 的替代路径不取：用户指定旧基线为固定提交 `08396d2`，archive + 构建可复现、与前几个主题同法。
- **CODEX-03**：成立。`test/helpers/proc.ts` 的 `groupsWithMark` / `groupMemberCount` 扫全进程表；r1 没写标记唯一性与失败路径的收尾，`reused` 也没给确定造法。
- **CODEX-04**：成立。`retention.ts` :233 `if (!opts.adapters || opts.dryRun) continue;` 在 dry-run 下短路凭据准入，被挡下的过期目录只进 kept、不进 `deferredCli`。r1「预览与真跑同判据」只在「删不删」上成立。
- **gemini**：零意见，认可 D3 改准。
- **GLM-01**：成立。用户送审前的决策原文含「清扫子命令的输出格式不改；新增告警之外的输出逐字不变」；`cli.ts` :1924 是 `trivium scrub` 的一行人读输出。冲突双方都成立（内容上改准是对的，GLM 与 gemini 都倾向改），但冻结面的解冻权在用户，Driver 不能借审查员意见代为解冻；用户又定了「跑的过程中不再停下来问」「超范围的问题登记暂缓、不停下」——所以取守决策 + 登记 + 最终汇报交用户定。
- **GLM-02**：成立。按 r1，A7 第一轮必打印 :1924 那行；D3 若改，新旧必然不同而白名单没列。r2 D3 取逐字保留，A7 的 diff 应为空，白名单写死。
- **GLM-03**：成立。`cancelRun` :1809-1821 只清 `settledCliSides`（:877-882）、`waitRun` :1211-1216 不动 `cli`——现状支持交接，但 r1 的 K1 / K3 收尾步「先结束两组再跑 Hook ⇒ 载体已抹」在「记录被过早清掉」的回归下同样通过（无记录 ⇒ E 格放行），没有一处钉住留存。
- **GLM-04**：成立。`fakeCtx` / `seedRun` 在 `test/integration/run-protocol.test.ts` :35 / :49；`test/unit/` 下没有该文件；现夹具起的是活 worker。

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 清单漏了主设计 :1477 的同一假话；其余三处经逐处核对属 `trivium scrub` 的动机句、论域不含 A / C / D 格，本主题之后仍成立——按审查员建议改为全仓逐处判真伪并写明每处结论 | r2 §3.7 改为逐处判定表（主设计 :1477 改准；`cli.ts` :327 / MANUAL :374 / RUNBOOK :224 / `retention.ts` :284 判仍成立、写明论域；无关的「躺到」注释列明不改）；§5 主设计行并入 :1477 |
| CODEX-02 | codex | minor | 接受 | bundle 不进 Git，旧构建须在展开副本里构建；取 archive 路线（用户指定固定提交，且与前几个主题同法），不取快照工作树 | r2 §4.4「构建」段：git archive `08396d2` + `.reviews/`、软链 `node_modules`、展开副本内 `node scripts/build.mjs`、不叠加文件、记两份 sha256 |
| CODEX-03 | codex | minor | 接受 | 全表扫描的判据下，泄漏的进程组会污染同机后续用例；`reused` 不该靠等 pid 复用 | r2 §4.1「夹具纪律」：用例级唯一标记、`finally` 收尾加按标记兜底、`sleep 120` 自然衰减、`reused` 用「真实组 + 错配启动时刻」的确定形态、`gone` 用已确认组空的组号 |
| CODEX-04 | codex | nit | 接受 | dry-run 下被挡下的目录不进 `deferredCli` 是既有短路的结果，r1 措辞会误导实施者 | r2 §3.3 dry-run 一条改写；U4 在 dry-run 下只断言 `removed` / `kept` |
| GLM-01 | glm | minor | 接受 | 冻结面的解冻权在用户；用户又要求不停下、超范围登记暂缓——取守决策、登记、交用户定 | r2 D3 改为 `cli.ts` :1924 逐字保留，新登 BACKLOG EV-164（失实半句、待用户定是否解冻）；注释 / MANUAL / 主设计改准；§3.7、§6.2、§6.3、§7；最终汇报列入待定 |
| GLM-02 | glm | minor | 接受 | 验收口径须随 D3 写死，不留给实施期解释 | r2 §4.4 A7 行与末段「逐字不变的判法」：A5～A7 diff 必须为空，A7 不设白名单；允许差异只列 A1 / A2 / A3 三类 |
| GLM-03 | glm | minor | 接受 | 「留给会话启动清扫」的载荷是被挡侧记录的留存，须有用例直接钉住 | r2 §1.1 末条、§3.4 / §3.5 各补一条；U5 / U6 断言 A / C / D 格之后被挡侧记录原样留存；K1 / K3 在结束两组之前先跑一次会话启动 Hook、断言载体仍在，再结束两组验放行 |
| GLM-04 | glm | nit | 接受 | 用例局部夹具不能跨目录 import，且现夹具起的是活 worker | r2 §4.1 夹具纪律末条：`fakeCtx` / `seedRun` 按形态复制进 `test/unit/scrub-admission.test.ts`，改成 worker 已死的变体 |

## 2. 无修改的部分

gemini 零意见；三侧都认可的 D1、D2、D5、D6、D7 与 §1 现状、§2 矩阵、§3.1～§3.6、§3.8 的改法不变。
