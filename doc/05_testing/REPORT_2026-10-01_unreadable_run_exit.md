# 留痕读不出的出口 · 实施报告（EV-148 文案部分）

- **日期**：2026-10-01
- **主题**：`留痕读不出的出口`；计划 `.reviews/留痕读不出的出口/plan/`（计划双审 run `20261001T092816Z`：codex / gemini / glm 三侧 `request-changes`，14 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`14c188b`（`main`，工作树干净）；改前构建固定为 `git archive 14c188b`
- **状态**：实施与验证完成；代码双审 r1（run `20261001T103637Z`）8 条全接受并已按接受项修订（§6）；verify 结果见 §8；未提交
- **evidence**：`doc/05_testing/evidence/unreadable-run-exit-20261001/`

---

## 1. 问题与改前实证

运行留痕（`_meta/run-<id>.json`）读不出时，七处拒绝给的出口都是「重跑一次该阶段双审，新运行会（先）落一份可读的留痕」或同义句：Driver 判定的四个消费点（`review --start`、`topic claim`、`topic resolve`、`hook-pre-write`，共用 `resolveStageDriver` 的 `corrupt` 一档）、`gate` 扫到的运行元数据一份都读不出、`gate --await-approval` 与 `approve` 的复核读不出本轮运行元数据。而重跑的入口 `review --start` 在冻结送审包、落下新骨架**之前**就按同一个 `corrupt` 判定拒绝——出口指回自己。`cmdGate` 的注释（「prepareRun 会先落一份骨架……闸门当场恢复」）与 `hooks.ts` 的「语义同源」注释依赖的是同一条走不通的路。BACKLOG 登记时只数到三处。

改前构建（`14c188b`）零配额验收实证（§3.1）：A、B 两格五处文案全部含循环出口（10 / 10）；E2 格（`approve` 时闸门项指向该阶段最新且读不出的一份）照「abandon 后重跑」走一遍，abandon 退 0、重跑退 2 且再次给出循环出口。

## 2. 成因逐格（计划 r2 §1.4）

| 格 | 成因 | 真正走得通的出口（改后实测） |
| :-- | :-- | :-- |
| A | 已提交的 run.json 在工作树里被改坏 | 用户在终端 `git restore`（夹具里代为执行）→ `topic resolve` 退 0、重跑退 0 |
| B | 尚未提交的 run.json 本身就坏 | **工具内没有**：`git restore` 退 1、重跑退 2、提交锚退 2；删掉后 `topic resolve` 退 0 但提交锚改报「运行清单已丢失」 |
| C | 本工具版本落后于写入方 | 换回不旧于写入方的构建即恢复（`topic resolve` 退 0） |
| D | 运行中途被打断（worker 被按组 SIGKILL） | 不进本状态：骨架 `running` 可读，`--wait` 收尾为 `failed` + `worker_lost/pid_gone` 后仍可读 |
| E1 | approve 时闸门项 run_id 指向不存在的运行 | abandon 退 0 → 重跑退 0 |
| E2 | approve 时闸门项 run_id 指向该阶段最新且读不出的一份 | abandon 退 0，**重跑退 2**——落回 A / B / C |
| E3 | 同 E2 但已提交 | 夹具里 restore 后**直接重新 approve 退 0**（计划双审 AGY-01） |
| F | 最新一份坏、较旧一份可读 | Driver 侧判 `corrupt`；`gate` 按 EV-73 采信较旧一份（只记录，不改） |

**C 格的构建对**（计划双审 CODEX-01 ≡ GLM-01 推翻了 r1 的选法）：run.v2 顶层允许未知字段——用当前构建经桩写出的成功轮与取消轮两份 run.json，拿最近 25 个历史版本的 schema 逐个做 ajv 校验，最近 18 个版本全部接受。真正的读侧落差在 `additionalProperties: false` 的子树里：`termination` 第一分支的 `by` 枚举，`sync_exception` 由 `e49279a` 加入，其父 `a89a46f` 只认 `worker_exception`。新构建用同步路径 + 阶段目录 0555 写出 `termination.by = sync_exception` 并提交（`git status` 干净），`a89a46f` 构建读之 `topic resolve` 退 2、`gate --check` 退 65；换回新构建即退 0。

两条代码层的核对：本工具的所有 run.json 写入都经 `writeRunMeta`（写前按 run.v2 校验）与 `writeAtomic`（同目录临时文件再 rename），所以 B 只可能来自工具之外的改动；rename 之前被打断只留 `run-<id>.json.tmp-…`，`latestRunMeta` 的文件名正则不认它，所以 D 不进本状态。

## 3. 落地（按 r2 §2～§4）

| 落点 | 改动 |
| :-- | :-- |
| `src/trivium/meta.ts` | 新增 `UNREADABLE_RUN_META_EXIT_BODY`（固定段）、`runMetaPaths`、`unreadableRunMetaExit(files)`（逐行列出绝对路径 + 固定段）；文档块写清三档成因、重跑与删除为什么不是出口、D 为什么不在其列 |
| `src/trivium/cli.ts` | 第 1、2、5 处删出口行、拼共用段；第 5 处删「不要删除」行（并入共用段），保留「--run-id 在这一格没有用」；第 6、7 处改调 `gate.ts` 的两个函数；`cmdGate` 注释补「3. 重跑同样不成立」、删失实句；approve 段注释改为两条分开写 |
| `src/trivium/topic-args.ts` | 第 3 处同 |
| `src/trivium/hooks.ts` | 第 4 处保留前三行，删出口行与「不要删除」「先重装」两行（并入共用段）；注释改为指向共用函数 |
| `src/trivium/gate.ts` | 新增 `awaitApprovalRecovery`、`approveForkRecovery`（读不出：先恢复后重新 approve、恢复不了才 abandon、abandon 之后重跑有条件，以共用段收尾；缺 run_id：维持 abandon 后重跑、不拼三档）；`verifyRoundForApproval` 删内联「不要删除」行；`recovery` 的排版约定写进类型注释 |
| `src/trivium/driver-claim.ts` | `resolveStageDriver` 文档块补「出口统一用共用段，重跑不是出口」 |

判定、退出码、返回形状零改动；`ApprovalCheckInput.recovery` 的类型不变。

**文档**：主设计 v1.3.71（7.1 一句、8.4 结局③一句、8.4 新增「留痕读不出：成因与出口」、approve 前置复核一句、变更记录）；LLD v1.1.28（3.5 `hook-pre-write` 第 2 条补读不出那一格）；RUNBOOK §六「提交被拦下」把运行清单那一类从「abandon 后重跑」里拆出来按三档写；PROTOCOL 第 401 行 approve 一格；BACKLOG EV-148 改「done（文案部分）」并写剩余项、新登 EV-181 / EV-182；MANUAL 核过没有讲读不出的段落、不改（§3.6「升级」被共用段引用，本身不改）；PRD 核后不改。

**计划偏离**：r2 §4 写了「排序快照第 295 行同步」，实施时核到该快照的性质说明是「一次性快照，记当时的判断，不随后续主题回改」（上一主题 EV-139 也没改它那一行），所以没改，EV-148 的状态以行内状态列为准。

## 4. 读数

### 4.1 零配额验收（`acceptance.mjs` → `acceptance-readout.json`、`acceptance-output.txt`）

三份构建：改前 `14c188b`（bundle sha256 前缀 `c16ea6f8e980`）、改后工作树（`bcdd25a6a1b3`）、落后版本 `a89a46f`（`df1b1c129213`，只给 C 格当读取方）；改前 bundle 不含共用段、改后含。**75 / 75**：

- 改前：A、B 两格五处退出码全对（2 / 2 / 2 / deny / 65），文案**全部含循环出口**（10 / 10）；E2 照文案 abandon 后重跑退 2 并再次给出循环出口；
- 改后：A、B 两格五处退出码不变，文案全部「含共用段、列出该文件的绝对路径、不含循环出口」（10 / 10）；E2 / E3 的 approve 文案含共用段、列出文件、恢复先于 abandon；E2 abandon 之后重跑被拒时给的是同一段共用出口；
- 两份构建上 A、C、E1、E3 的出口都实际走通，B 的「没有出口」与「删除只把拒绝挪到提交时」都成立，D 不进本状态，F 只记录。

### 4.2 单测与集成

新增 `test/unit/unreadable-run-exit.test.ts`（U1 共用段三档与列文件、U2 `src/` 源码契约零循环出口、U3 第 6、7 处经 `verifyRoundForApproval` 的真实文案，共 9 条）与助手 `test/helpers/unreadable-exit.ts`（`assertUnreadableExit`：含固定段、逐行列出绝对路径、不含循环出口）。改现有用例：`topic-claim`「留痕损坏」三个入口逐个断言并把退出码收紧为 2；`hooks`（单测）全损、较新一份损两条；`gate-loop` T-12 三个子命令、A4′ 加断言，新增 A4″（E2：abandon 走通、重跑仍被拒且给同一段出口）与 A4‴（E3：restore 后直接重新 approve 通过）；`gate.test.ts` 那条「不要删除或改写」断言随内联行挪进 U3（计划双审 CODEX-03）。

本主题相关 6 个套件（上述 5 个 + `driver-claim`）：Node 25 / 18.20.8 / 22.23.3 各 290 / 290（`node18.txt` / `node22.txt`）。

### 4.3 变异

规格由 `gen-mutation-spec.mjs` 从现行源码截锚点（逐条核唯一），每条只指定一个期望套件（计划双审 CODEX-06）。先用带 `--test-timeout=60000` 与哨兵的逐条预跑脚本 `mutation-names.mjs`（`--with-tests` 重建，含 bundle）过一遍：**14 / 14 全红、无超时、无取消**，失败用例名见 `mutation-names-log.txt` / `mutation-names-output.json`：

| # | 变异 | 期望套件 | 红在 |
| :-- | :-- | :-- | :-- |
| M1 | 共用段首句换回循环出口 | `unreadable-run-exit` | U1 两条、U2、U3 两条（fail=5） |
| M2 | 共用段 ② 删「只能在终端做」 | 同上 | U1 三档 |
| M3 | 共用段 ③ 删「工具内没有出口」 | 同上 | U1 三档 |
| M4 | 共用段 ① 删 MANUAL 落点 | 同上 | U1 三档 |
| M5 | 不列文件 | 同上 | U1 列文件、U3 两条（fail=3） |
| M6～M8 | 第 1、2、3 处去掉共用出口 | `topic-claim` | 「留痕损坏：入口与 Hook 同口径硬失败」 |
| M9 | 第 4 处 Hook 去掉共用出口 | `hooks`（单测） | 全损、较新一份损两条（fail=2） |
| M10 | 第 5 处 gate 去掉共用出口 | `gate-loop` | T-12（267 s） |
| M11 | `awaitApprovalRecovery` 不带共用出口 | `unreadable-run-exit` | U3 `--await-approval` |
| M12 | `approveForkRecovery` 读不出不带共用出口 | 同上 | U3 approve 读不出 |
| M13 | `approveForkRecovery` 缺 run_id 也拼共用出口 | 同上 | U3 approve 缺 run_id |
| M14 | approve 出口 abandon 排到恢复之前 | 同上 | U3 approve 读不出（次序） |

正式装置 `scripts/mutation-check.mjs`：基线 4 个套件全绿，**14 / 14 咬住**，各条 fail 数与预跑一致（`mutation-output.txt`）。

## 5. 全量检查与 doctor

| 项 | 读数 |
| :-- | :-- |
| `npm run check` 第一次（文档全部改完之后） | 2474 / 2472 / 0 / 2（`check-1.txt`） |
| `npm run check` 第二次 | 2474 / 2472 / 0 / 2（`check-2.txt`） |
| `doctor --selftest`（工作树构建） | 14 / 14（`doctor-selftest.txt`） |

两次都没有撞上已知偶发红（EV-149 / EV-153）。

## 6. 代码双审与修订

代码双审 r1（run `20261001T103637Z`，约 11 分钟）：gemini `approve`（零意见）、codex `approve-with-nits`（次要 3、吹毛求疵 1，另 1 条因多余字段 `evidence_note` 逐条降级为 CODEX-02，内容照常裁决）、glm `approve-with-nits`（次要 1、吹毛求疵 2）。8 条全接受，应答件 `code/2026-10-01-留痕读不出的出口-response-claude.md`，`gate --check` 通过。

| 编号 | 修订 |
| :-- | :-- |
| CODEX-01 | 共用段删除那一句补「登记过的运行」前提：登记过的删掉 ⇒ 提交锚以「运行清单已丢失」拦下；`writeRunMeta` 与 `registerRun` 之间失败留下的**未登记**骨架删掉则无从追查、判定悄悄降级——两种都不要删。U1 钉住；这一格的缺口新登 EV-183 |
| CODEX-02（降级） | 文件列表之后加一行读取方自己的构建标识（`embeddedBuildStamp()` 的 git_head 短码与 built_at），并指向 run.json 的 `snapshot.build.git_head` 供判别 ①；取不到时如实写「构建标识缺失」 |
| CODEX-03 | 清单至多列 5 份（`UNREADABLE_RUN_META_LIST_LIMIT`），其余报「另有 K 份同状态未列出」 |
| CODEX-04 | `acceptance.mjs` 的子进程带 300 s 超时、到点按进程组 SIGKILL 并记 `timed_out`；读数在 `finally` 里写出，记开始 / 结束时间与抛错 |
| CODEX-05 | ② 档的判别给现成命令 `git -c core.quotePath=false status --porcelain -- '<路径>'`，restore 写成 `git restore -- '<上面列出的路径>'` |
| GLM-01 | **补第八处**：`gate --run-id` 钉住的那一份读不出、归属无误时同属本状态（仓内的 `missing_disposition` 提示与「没有任何运行元数据」警告都会把人引向 `--run-id`），保留「请确认归属」并以共用段收尾；T-12 的钉住子用例加断言 |
| GLM-02 | 单入口 `unreadableRunMetaExitAt(layout, stage, runIds)`，八个站点都改用它；底层两个导出留给单测 |
| GLM-03 | `awaitApprovalRecovery` / `approveForkRecovery` 在 run_id 为 null 时读不出那一条给普通说明、不拼共用段；`unreadableRunMetaExitAt` 对空列表抛程序缺陷错误 |

**计划偏离**（第二处）：r2 §0 把 `--run-id` 钉住读不出那一格划出了范围（理由「出口没有循环、不是本状态」）；GLM-01 指出归属无误时它就是本状态且没有出口，按接受项纳入。

修订后读数：

| 项 | 读数 |
| :-- | :-- |
| 本主题相关 6 个套件（Node 25） | 293 / 293（多 U1 三条） |
| 零配额验收 | 75 / 75（`acceptance-output.r1.txt` / `acceptance-readout.r1.json`；首轮读数原样保留） |
| 变异逐条预跑 / 正式装置 | 19 / 19 全红、无超时 / **19 / 19 咬住**（`mutation-names-log.r1.txt`、`mutation-output.r1.txt`；`mutation-spec.r1.json`，19 条：原 14 条锚点随单入口改写，补 M15 钉住那一格、M16 清单封顶、M17 构建标识、M18 删除句的「登记」前提、M19 null 档） |
| Node 18.20.8 / 22.23.3 目标套件 | 293 / 293、293 / 293（`node18.r1.txt` / `node22.r1.txt`） |
| `npm run check` 第一次 / 第二次 | 2477 / 2475 / 0 / 2 两次（`check-1.r1.txt` / `check-2.r1.txt`；比修订前多 U1 三条） |
| `doctor --selftest` | 14 / 14（`doctor-selftest.r1.txt`） |

## 7. 暂缓与已知缺口

- **EV-148 剩余项**：`corrupt` 判定的人工确认出口——③「工具内没有出口」那一格的真正解法，需拍板。
- **EV-181**：读不出时七处文案不报原因（`readRunMeta` 把四种失败折成 null），① 与 ③ 只能靠人看 `git status` 与文件内容区分。
- **EV-182**：提交锚 `checkArchiveIntegrity` 在运行清单不可读 / 已丢失时的收尾文案与三档未统一（RUNBOOK 已按三档写，以 RUNBOOK 为准）。
- **EV-183**（代码双审 r1 CODEX-01）：`writeRunMeta` 与 `registerRun` 之间失败留下的未登记骨架被删掉时，没有任何锚会拦，判定悄悄降级。
- **第 6 处（`--await-approval` 复核读不出）只在竞态下可达**：runId 取自 `latestRunMeta` 读得出的那份，CLI 层没有端到端用例，由 U3 直接调 `verifyRoundForApproval` + `awaitApprovalRecovery` 守住接线。
- **EV-73 不变**：最新一份坏、较旧一份可读时，`gate` 仍采信较旧一份（F 格只记录）。

## 8. verify

`trivium verify --topic 留痕读不出的出口`（run `20261001T114113Z`）：`npm run typecheck` ✓ 1.7 s、`npm run build` ✓ 1.2 s、`npm test` ✓ 273.6 s，**通过**；留痕 `.reviews/留痕读不出的出口/verify/`。本节是 verify 之后补写的（只改本报告文字，不涉代码与测试）。

**src 已改**：提交后需从已提交状态重建（`npm run build`），再请用户在终端重装（`node dist/install.cjs --targets claude,glm,codex,gemini`），否则 `.trivium/bin/trivium` 用的仍是旧副本（`gate --check` 已告警「安装副本不是当前工作树构建的」）。
