# 实施报告：失联worker退出后补收（EV-159 第一形态）

> 主题 `失联worker退出后补收`；起点 `fc42d30`；计划 `.reviews/失联worker退出后补收/plan/2026-09-28-失联worker退出后补收-r2-claude.md`。
> 计划双审第 1 轮 run `20260928T142320Z`：codex `approve-with-nits`（重要 1、次要 2）、gemini `request-changes`（重要 1、次要 1、吹毛求疵 1）、
> glm `request-changes`（重要 2、次要 2），共 10 条（去重后 8 条）全接受、0 驳回、0 暂缓。

## 1. 逐条落地（按 r2 章节）

- **§3.1 `classifyLostCancel` 收窄 `no_identity`**：pid 合法但两种启动时刻都缺失时改问 `processAlive(pid).alive`——
  进程不在归入 `gone` 格（一并补收），进程还在仍是 `no_identity`（维持现状）。`run-protocol.ts`。
- **§3.2 抽出 `finalizeLostAndReclaimLock`**：把 `cancelLostWorker`（alive 格）原第 4、5 步（补收 run.json / task.json
  为 failed、按 run_id + pid 复核回收锁）抽成共享函数，返回两步的 `FinalizeStep`；`noSecondChance` 文案改为肯定句
  「可以再跑一次 --cancel 重试……」（计划双审 r1 CODEX-02、GLM-03 落点）。
- **§3.3 新增 `finalizeGoneWorker`**：`gone` 格入口，只调 `finalizeLostAndReclaimLock`，不发信号；结论句固定为
  「工作进程 N 已不在」+「……见上方输出」，不按写入结果分流文案（计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02 落点——
  这是本轮唯一的一处「重要」级设计改动，从根子上排除了「结论句与步骤行矛盾」的可能）。
- **§3.4 接线**：`cancelRun` 终态分支在 CLI 结束块之后、`mismatch`/`no_identity` 判断之前插入
  `if (cell.kind === 'gone') return finalizeGoneWorker(ctx, runId, s, cell);`。
- **§3.5 文案改准**：`LostCancelCell` 文档块、`cancelLostWorker` 函数文档块「只有一格例外」改「两格例外」、
  「未能确认退出」告警、`meta.ts` 的「七个调用方」→「八个调用方」、`MANUAL_user.md` 两处、`LLD_orchestrator.md` 两处
  引述块与已知缺口表。
- **§3.6 第二形态暂缓**：升级前旧版判失联、无 `lost` 字段的运行，其结构化特征与「本版 worker 异常分支补收失败」
  逐位相同、判据不许读 `message`，无法区分；误写 `termination` 成因不可逆，维持现状，登记 BACKLOG。
- **§3.7 边界**：pid 不合形状、pid 合法+两时刻缺失+进程还在，两种情形维持 `no_identity`，不改。

## 2. 读数

| 项 | 读数 |
| :-- | :-- |
| 全量（`node --test "dist/test/**/*.test.js"`） | 2225 / 2227 通过（0 失败、2 跳过），两次一致 |
| `npm run typecheck` | 通过 |
| doctor `--selftest` | 14 / 14 |
| 源码变异（`scripts/mutation-check.mjs`，规格 `gen-mutation-spec.mjs` 生成） | 8 / 8 咬住（M1～M8，见 `mutation-output.txt`） |
| 零配额验收（`acceptance.mjs`，旧构建基线 `fc42d30`） | 6 / 6（构建、前提、A1～A4，见 `acceptance-output.txt` / `acceptance-readout.json`） |

### 2.1 新增 / 修改测试一览

- **单测 / 集成（`test/integration/run-protocol.test.ts`）**：
  - `EV-159 N1`（主线：worker 自己死了直接落 `gone` 格，补收 run.json/task.json、回锁）；
  - `EV-159 N2`（接替原 `EV-146 K8`：alive 格成功之后再跑一次 `--cancel` ⇒ `gone` 格、按前提跳过、可重入）；
  - `EV-159 N3`（`gone` 格下锁不相符两种：run_id 相同 pid 不同 / run_id 不同，不动锁、归档照常补收）；
  - `EV-159 N4`（`gone` 格归档写失败：告警措辞改为「可以再跑一次 --cancel 重试」，不再是「没有第二次机会」）；
  - `EV-159 classifyLostCancel 矩阵`（pid 不合法 / pid 合法+两时刻缺失+活着 / +已死 / pid 合法+有时刻+已死 四格）；
  - `EV-146 K4` / `K9` 断言随 §3.2 的共享函数文案同步更新；
  - `EV-146 K5′` 标题与断言更新（`R-K5P-N` 场景的 `classifyLostCancel` 结果从 `no_identity` 改判 `gone`，新增
    `classifyLostCancel` 直接断言与归档跳过分支的断言）。
  - **N5（mismatch 两种依据都不补收）未新增专门用例**：已由既有 `EV-158 U9`（`notThisCell` 骨架，覆盖 canonical 与
    legacy 两种 basis）与 `EV-146 K5④` 隐式覆盖——`notThisCell` 对每个场景都断言 `run.json` 不动，而这些场景都在
    `gone` 格新代码插入点之前就已经被 `mismatch` 分支拦截，不会触达新代码。
- **集成（`test/integration/gate-loop.test.ts`，真实 bundle + `hang_cli` 桩）**：
  - `EV-159 G1`（worker 被手工结束 SIGKILL、未经 `--cancel`；`--cancel` 落 `gone` 格：按记录结束两侧 CLI、补收
    run.json 与登记、回收锁；显式顺序断言——CLI 结束播报先于归档补收播报，计划双审 r1 CODEX-03 ≡ GLM-04 落点）；
  - `EV-159 G2`（G1 产物上再跑一次 `--cancel`：幂等，run.json / task.json / status.json 均逐字节不变）。

## 3. 偏离与如实登记

- 无实质偏离。唯一的措辞调整：`finalizeGoneWorker` 的结论句最终没有按 `finalizeLostAndReclaimLock` 的返回值动态分流
  （r1 草案曾这样设计），而是照抄 `alive` 格既有的「见上方输出」范式——这正是计划双审 r1 的核心裁决落点，已体现在 r2 定稿里，
  不是实施阶段临时改的。
- N5 没有新增独立用例，改为在报告里指出既有测试已覆盖——与计划 r2 §4.1 的原文本意一致（计划原文没有强制要求「必须是
  一条新测试」，只要求覆盖到这两种依据；核对后确认已被覆盖，为避免重复用例，选择如实记录而非硬造一条冗余测试）。

## 4. 文档同步

| 文档 | 改动 |
| :-- | :-- |
| 主设计 | v1.3.55 → v1.3.56；新增独立粗体段「失联后取消的 `gone` 格补收」（代码双审 r1 CODEX-03 落点：改前曾误把续写内容截断进 v1.3.54 段，已改回独立段）；v1.3.54 段「如实保留」句收束改准；新段里点出两时刻缺失分支判据弱于 alive 格（CODEX-02 落点）与残余面区分可重试 / 不可重试（CODEX-04 落点） |
| LLD_orchestrator.md | v1.1.13 → v1.1.14；4.2 引述块补 `gone` 格；「仍会停在 running 的」改准（含 CODEX-04 落点：区分中断窗口可重试 vs pid 复用不可重试）；已知缺口表 EV-159 行改为「第一形态已修、第二形态暂缓」 |
| MANUAL_user.md | v1.0.13 → v1.0.14；:651 改为「按前提补收」；:657 落款改「第二形态，暂缓」 |
| PROTOCOL_dual_critic_relay.md | **代码双审 r1 CODEX-01 落点**（本报告 r1 版误判「无锚点」，已改正）：`--cancel` 条目两处编辑——CLI 结束那句加 `gone` 格补收的限定并指向下文；条目末尾新增一句完整描述 `gone` 格补收（判据、内容、锁回收、status.json 不写、结论句范式、可重入） |
| BACKLOG | EV-159 行拆成「第一形态 done」「第二形态 暂缓」两段，同一编号 |
| PRD | `grep` 核过无字段级表述提到 `--cancel` 的 `gone` 格或「无需取消」，不改 |
| `src/trivium/run-protocol.ts`（注释） | `finalizeGoneWorker` 文档块改准 CLI 结束归属（代码双审 r1 GLM-01 落点：原文误称与 alive 格共用判定，实际只对 gone 格成立） |
| `gen-mutation-spec.mjs` | M1/M2 描述改为指向真实测试标题（代码双审 r1 CODEX-03 落点） |

## 5. 证据文件

`doc/05_testing/evidence/lost-worker-gone-finalize-20260928/`：

- `gen-mutation-spec.mjs` / `mutation-spec.json` / `mutation-output.txt`（含 `.r1.txt` 备份，代码双审修订前的读数；
  代码双审只改了 `desc` 字段与文档/注释，functions 的 find/replace 逐字未变，未重新执行全部 8 条变异）
- `acceptance.mjs` / `acceptance-output.txt` / `acceptance-readout.json`（含 `.r1.txt` 备份；代码双审修订后重跑，
  6/6，读数与修订前一致——预期之中，因为改动全是文档/注释）

## 6. 代码双审第 1 轮（run `20260928T151256Z`）

结论：codex `approve-with-nits`（重要 1、次要 3）、gemini `approve`（零意见）、glm `approve-with-nits`（次要 1）。
共 5 条，**全部接受**，0 驳回、0 暂缓。裁决与落点见
`.reviews/失联worker退出后补收/code/2026-09-28-失联worker退出后补收-response-claude.md`。

摘要：

- **CODEX-01（重要）**：`doc/03_api/PROTOCOL_dual_critic_relay.md:360` 描述 `--cancel` 终态语义的段落没有同步
  `gone` 格补收，本报告 r1 版「PROTOCOL 不改（无锚点）」的结论是错的——`grep` 字面 `EV-159` 找不到，但那段描述
  `--cancel` 终态分支行为的文字本身就是相关锚点，不需要出现编号。已修。
- **CODEX-02（次要）**：两时刻缺失分支收窄后的「已不在」判据比 `alive` 格弱（单次 `kill(pid,0)`，没有启动时刻佐证）。
  接受意见的文档说明选项、不改判据——暴露面窄（`--start` 两次 `ps` 同时失败，或升级窗口旧记录）且有两写者防护。
- **CODEX-03（次要）**：主设计 v1.3.54 段被本次编辑意外截断续写、没有独立粗体段首；变异规格 M1/M2 的描述指向计划
  内部编号 `N6`/`N7`，测试文件里没有这两个字面。两处均已修（改回独立段；描述改指真实测试标题）。
- **CODEX-04（次要）**：「仍如实保留……只剩毫秒级窗口」漏了「pid 复用 ⇒ mismatch/no_identity ⇒ 不可重试」这一条
  残余，与可重试的中断窗口混写。已在主设计与 LLD 里区分两类。
- **GLM-01（次要）**：`finalizeGoneWorker` 文档块声称 CLI 结束与 `alive` 格共用同一段判定，实际 `alive` 格早退到
  `cancelLostWorker`、其 CLI 结束是该函数第 3 步自己无条件做的，不经共享块——纯注释错误，已改准，避免误导日后
  重构时删掉 `cancelLostWorker` 第 3 步、复刻 EV-154 要修的孤儿 CLI 形态。

**改动范围**：本轮修订全部是文档与代码注释（`PROTOCOL_dual_critic_relay.md`、主设计、`LLD_orchestrator.md`、
`run-protocol.ts` 的 `finalizeGoneWorker` JSDoc、`gen-mutation-spec.mjs` 的 `desc` 字段），**没有改动任何可执行
逻辑**——`classifyLostCancel` / `finalizeLostAndReclaimLock` / `finalizeGoneWorker` / `cancelRun` 的函数体与代码
双审时逐字节相同。

## 7. 修订后读数

| 项 | 读数 |
| :-- | :-- |
| `npm run typecheck` | 通过 |
| 全量（`node --test "dist/test/**/*.test.js"`） | 2225 / 2227 通过（0 失败、2 跳过）——与修订前一致 |
| doctor `--selftest` | 14 / 14 |
| 源码变异 | 未重跑（find/replace 逐字未变，只重新生成了含新 `desc` 的 `mutation-spec.json`；沿用 8/8） |
| 零配额验收（`acceptance.mjs`） | 6 / 6，与修订前一致（构建 sha256 随重新构建而变，其余判据不变） |

跑完 verify 即停：不提交、不推送、不自行审批。
