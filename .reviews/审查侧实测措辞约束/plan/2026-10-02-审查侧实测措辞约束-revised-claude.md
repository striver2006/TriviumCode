---
schema: trivium.disposition.v1
topic: 审查侧实测措辞约束
stage: plan
role: claude
kind: revised
run_id: 20261002T012129Z
addresses:
  - 2026-10-02-审查侧实测措辞约束-codex.md
  - 2026-10-02-审查侧实测措辞约束-gemini.md
  - 2026-10-02-审查侧实测措辞约束-glm.md
---

# 裁决：审查侧实测措辞约束 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-02-审查侧实测措辞约束-claude.md`（r1，起点 `a03a056`）
> ｜ 运行：`20261002T012129Z`（约 10 分 6 秒；真实审查员运行计数 1/12）
> ｜ 结论：codex `request-changes`（重要 3、次要 4）｜ gemini `approve-with-nits`（吹毛求疵 2）｜ glm `approve-with-nits`（吹毛求疵 2）
> ｜ 共 11 条：接受 10、驳回 1、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-02-审查侧实测措辞约束-r2-claude.md`；命令 A 不设人工闸门

每条都回源码或文档核过；凡依据里的行号与事实，下表「理由」列写明核对结果。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实：`asset-root.ts:17-22` 的解析顺序是显式覆盖 → `TRIVIUM_ASSET_ROOT` → `~/.claude/skills/dual-critic`；直接 `node <bundle>` 不设它时第 5 节阶段要点、第 6 节 schema 路径都取安装副本，改前改后对照与 A/B 就成了混合系统。r1 只钉了 bundle | r2 §3.1 ④ 与 §3.2：每份构建的运行都显式设 `TRIVIUM_ASSET_ROOT` 为**该构建自己那棵树**的 `skills/dual-critic`，设的值写进报告；④ 加硬断言：同一入参下旧/新任务书切掉第 7 节后逐字相同（归一化只抹主题、`run_id`、时间戳、临时路径、哈希，资产根路径按两棵树各自替换成占位） |
| CODEX-02 | codex | major | 接受（取第 ③ 档） | 属实：`install.ts:203`、`:427` 把仓库那份拷到 `~/.gemini/config/agents/trivium-critic/agent.md`，运行期生效的是安装副本；对账用例只能钉仓库内一致性。不取第 ① 档：单测读开发者真实 HOME 违反本仓「测试一律注入临时 home」的口径（`asset-root.ts:13-14`）；不取第 ② 档：安装副本漂移不只影响本声明，而是整个只读白名单本身（`agy.ts:5-9`），该在一条通用的「安装副本与仓库资产一致」检查里做，单为本字段加一条 doctor note 是局部补丁，显著扩大范围 | r2 §0「不做」那句改写为「仓库那份是对账用的事实源，**不是**运行期生效的那份」；r2 §5 登记边界；BACKLOG 新登 EV-187（安装副本工具面与仓库资产漂移，等触发：出现一次安装副本与仓库 `tools:` 不一致，或某侧任务书说的能力与它实际工具面不符） |
| CODEX-03 | codex | major | 接受 | 属实：`mutation-check.mjs:12-33` 记的三次事故都源于临时改工作树文件，r1 的契约脚本只有一道 `finally`；而该 md 不进构建图（`build.mjs:112-116` 只拷 schema），装置的闸 4 会把它判成无操作。改用可注入的纯函数：零写盘，与「该文件只读不改」自洽 | r2 §3.1 ③：agy 事实源拆成纯函数「从 agent 定义文本取 `tools:` 并分类」，对账用例读仓库文件喂它；同文件加两格负例，喂**内存里改过的文本**（加 `run_command` ⇒ 与声明不符；加一个未分类工具名 ⇒ 抛未分类）。§3.1 ⑤ 删掉「临时改 md 的契约脚本」 |
| CODEX-04 | codex | minor | 驳回 | 「旧构建 `a03a056` 跑 1 轮作基线」是用户在决策六第 2 款明定的，不是我能拿掉的；且 EV-79 的三轮不能当同夹具对照：模型版本（glm 现为 `GLM-5.3`）、焦点与被审对象都不同，基线的用处正是在**同一夹具、同一焦点**下回答「新构建的照做是不是措辞带来的」。顺带采纳意见后半的成本口径（不影响裁决） | r2 §3.2「上限」段写明一轮的成本口径：一轮 = 一次入选三侧的真实运行，单侧墙钟上限取 plan 档 `timeout_s`（`config.ts:288`，900s），`parse_fallback` / `no_json_object` 回退、任一侧失败的那轮同样计数；夹具里的零配额预检不计 |
| CODEX-05 | codex | minor | 接受 | 属实：`review.ts:646-664` 逐侧 `availability()` 不过即抛 69，夹具换了目录，探针结论的搬运是否完整要先验。`preflight --skip-auth-check`（`cli.ts:251`、`:815`）不发模型调用 | r2 §3.2 运行段第一步：在夹具里先跑 `preflight --stage plan --critics codex,gemini,glm --driver claude --skip-auth-check`，三侧判可用才开跑；预检失败的那次不计入 12 轮 |
| CODEX-06 | codex | minor | 接受 | 前提今天成立（已核：`git diff --quiet a03a056 -- package.json package-lock.json` 退 0），但 r1 没写成断言 | r2 §3.1 ④ 前置断言：旧树与工作树的 `package.json`、`package-lock.json` 逐字节相同，不同即中止 |
| CODEX-07 | codex | minor | 接受 | 属实：`COMMAND_TRACE_CAPABILITY` 的 `rejectionRecorded: false`（`base.ts:748-759`）意味着被沙箱拒绝的命令可能不进轨迹，判据 5 不分成因会假阴性 | r2 §3.2 判据 5 补成因分档：`evidence` 写了命令而轨迹找不到时，若该命令属写形态（会被沙箱拒）记「无从证实」不判负；夹具焦点写明复测只用只读命令 |
| AGY-01 | gemini | nit | 接受 | 属实：`doc/05_testing/README.md:16` 规定同日按文件名排、由 `doc-archive-index.test.ts` 对账；`critic…` 字典序在 `mustread…` 之前 | r2 §4：报告索引条目插在 `REPORT_2026-10-02_mustread_deny_intersection.md` 之前 |
| AGY-02 | gemini | nit | 接受 | 属实：BACKLOG 在 `doc/08_project/` 下，r1 两处写成了仓库根的相对名 | r2 §1.5 两处改为 `doc/08_project/BACKLOG.md:193` / `:211` |
| GLM-01 | glm | nit | 接受（同步） | 属实：PROTOCOL `:157-166` 八段表第 7 行枚举五条，改后不完整；与 EV-113 那句单侧尾注不同，本条作用于每一侧，按分量应同步 | r2 §4 文档清单补 PROTOCOL 第 7 行：末尾加「按该侧命令执行能力二选一的证据性质措辞约束」 |
| GLM-02 | glm | nit | 接受 | 同 AGY-02（两侧独立收敛） | 同 AGY-02 |

## 2. 修订摘要

- 资产根钉死：改前改后对照与 A/B 每份构建都指向自己那棵树的资产，第 7 节之外逐字相同做成硬断言（CODEX-01）；
- agy 事实源改纯函数 + 内存负例，不再临时改仓库文件（CODEX-03）；安装副本漂移登记为 EV-187 等触发（CODEX-02）；
- A/B 补零配额预检、成本口径、判据 5 成因分档（CODEX-05 / CODEX-04 后半 / CODEX-07）；对照构建补依赖一致断言（CODEX-06）；
- 文档清单补 PROTOCOL、报告索引位置、BACKLOG 路径写全（GLM-01 / AGY-01 / AGY-02 ≡ GLM-02）。

## 3. 另记

- codex 侧本轮 `run_command` 33，总判断与 CODEX-07 里写「我实际执行的只读命令」并给出命令原文与输出（bash 3.2 默认模式 `true 2>&/dev/null` 得 rc=1）；gemini、glm 两侧 `run_command` 均为 0，结论里没有一处把自己的判断说成实测或复测（glm 写的是「逐锚点核实」「实读」「Glob 全仓仅命中」，都是读与检索）。这是本主题改动之前的一组自然样本，记进实施报告，不作判据；
- 编排器告警「codex 侧 evidence 引用但未列入 consulted：`test/integration/stub-agent-kit.test.ts`」：该侧在 CODEX-03 里自陈「只 grep、未通读」，与告警一致；不影响裁决（CODEX-03 的结论不依赖那个文件）。
