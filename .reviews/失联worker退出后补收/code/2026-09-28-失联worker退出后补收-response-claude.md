---
schema: trivium.disposition.v1
topic: 失联worker退出后补收
stage: code
role: claude
kind: response
run_id: 20260928T151256Z
addresses:
  - 2026-09-28-失联worker退出后补收-codex.md
  - 2026-09-28-失联worker退出后补收-gemini.md
  - 2026-09-28-失联worker退出后补收-glm.md
---

# 应答：失联worker退出后补收 · 代码双审第 1 轮

> 被审对象：`code/_meta/changes-20260928T151256Z.diff`（相对 HEAD `fc42d30` 的 15 个文件，127.5 KB）
> ｜ 运行：`20260928T151256Z`（约 11 分 26 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 3）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1）
> ｜ 共 5 条，**全部接受**，0 驳回、0 暂缓
> ｜ 命令 A 不设人工闸门：已按接受项修订，重跑读数写进报告 §7

## 0. 核实记录

- **CODEX-01**：成立。`doc/03_api/PROTOCOL_dual_critic_relay.md:360` 的 `--cancel` 条目在本次实施前只字未提 `gone` 格补收，
  仍写「终态分支只结束进程、不写 status.json 与归档」——这句话对 `mismatch` / `no_identity` 仍成立，但对 `gone` 格
  自本次起已不准确（它会补收 run.json / task.json，只是 status.json 不写）。实施报告 §4 记「PROTOCOL 不改（无锚点，
  grep 已核）」确实是我的疏漏：我当时只 grep 了字面 `EV-159`，没意识到 PROTOCOL 描述 `--cancel` 终态语义的段落
  不需要出现这个编号也构成相关锚点。
- **CODEX-02**：成立。`classifyLostCancel` 两时刻缺失分支收窄之后，「已不在」只靠单次 `kill(pid, 0)`，没有启动时刻
  可比对、因此没有第二重身份佐证——比 `alive` 格判「已退出」的 `lostWorkerGoneFrom`（进程不存在**或**取到的启动
  时刻与记录不同才算）弱。核实暴露面确实很窄（`--start` 两次 `ps` 同时失败，或升级窗口旧版记录），且
  `finalizeFailedRunMeta` 的「仍为 running 才写」前提与主题任务锁挡住两写者风险，接受意见给出的选项②（文档说明，
  不改判据）——改判据（选项①）会重新触及计划双审已核实过的收窄设计，且暴露面窄到不值得为此再收紧。
- **CODEX-03**：成立。两处问题都核实：① 主设计 v1.3.54 段被我的实施 diff 从「如实保留」处截断、续写内容没有独立
  粗体段首，破坏了「每版注记自成一段」的既有约定；② `gen-mutation-spec.mjs` 的 M1/M2 描述写的是计划里的内部编号
  `N6`/`N7`，但我实际把这两条测试写成了「`EV-159 classifyLostCancel 矩阵`」与「`EV-146 K5′`」的一部分，字面搜不到
  `N6`/`N7`，与其余条目（M3～M7 指向真实存在的 `EV-159 N1` / `N3`）体例不一致。
- **CODEX-04**：成立。主设计与 LLD 里「仍如实保留：……只剩确认退出到补收之间被中断的毫秒级窗口」把残余面说小了——
  漏了「判格时 pid 已被别的活进程复用，落 `mismatch` / `no_identity`，`finalizeLostAndReclaimLock` 永远进不去」这
  一条**不可重试**的残余，读者可能把它跟「毫秒级窗口」（可重试）混为一谈，也可能误以为本轮已把可重入性收干净。
- **GLM-01**：成立。`finalizeGoneWorker` 文档块「CLI 记录的结束在调用方已经做过（`cancelRun` 里 gone 格与 alive 格
  共用同一段 `workerConfirmedGone` 判定）」后半句对 `alive` 格不成立：`alive` 格在 `cancelRun` 里更早 `return` 进
  `cancelLostWorker`，到不了那段共享的 `workerConfirmedGone` 守卫块；它的 CLI 结束是 `cancelLostWorker` 第 3 步
  自己无条件做的，两者不是同一处代码。核实这是纯注释问题，`alive` 格的行为本身没有受影响（第 3 步在本轮 diff 里
  未改动），但这条注释位于并发敏感区，按它去重构确实会导致误删 `cancelLostWorker` 第 3 步、复刻 EV-154 要修的孤儿
  CLI 形态，值得改准。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：PROTOCOL 的 `--cancel` 条目描述 `gone` 格终态早退的那句话本次起对该格不准确，报告 §4 的「不改」结论错误 | `PROTOCOL_dual_critic_relay.md:360` 两处编辑：CLI 结束那句加「`gone` 格自 EV-159 起补收归档」的限定并指向下文；`--cancel` 条目末尾新增一句完整描述 `gone` 格补收（判据、补收内容、`termination`、锁回收、status.json 不写、结论句不复述、可重入）。报告 §4 表格随代码双审修订同步改准（见 §7） |
| CODEX-02 | codex | minor | 接受 | 核实成立：两时刻缺失分支的「已不在」判据确实弱于 `alive` 格；暴露面窄、有两写者防护，接受选项②（文档说明）而不改判据 | 主设计新增的「失联后取消的 gone 格补收」段（v1.3.56）里专门一句点出这一支判据比 `alive` 格弱、给出成因与暴露面、并说明本版接受不加固的理由 |
| CODEX-03 | codex | minor | 接受 | 两点都核实成立 | ① 主设计：把 v1.3.54 段的「如实保留」句尾改回单句收束（不再截断续写），新增独立粗体段「**失联后取消的 `gone` 格补收**（v1.3.56，EV-159 第一形态）」承载本轮全部变更说明；② `gen-mutation-spec.mjs` 的 M1/M2 描述改为指向真实测试标题字符串（`'EV-159 classifyLostCancel 矩阵'`、`'EV-146 K5′'`），重新生成 `mutation-spec.json`（锚点仍全部唯一，find/replace 未改，无需重跑全部变异） |
| CODEX-04 | codex | minor | 接受 | 核实成立：残余面遗漏了「pid 复用 ⇒ mismatch/no_identity ⇒ 不可重试」这一条，且与「毫秒级窗口」（可重试）混写 | 主设计新段与 `LLD_orchestrator.md` :479「仍会停在 running 的」一句都改为区分两类残余：可重试的中断窗口 vs 不可重试的 pid 复用（`mismatch`/`no_identity`），各自点明 |
| GLM-01 | glm | minor | 接受 | 核实成立：注释后半句对 `alive` 格不成立，`alive` 格早退到 `cancelLostWorker`、其 CLI 结束是该函数第 3 步自己无条件做的，不经共享的 `workerConfirmedGone` 守卫块 | `run-protocol.ts` `finalizeGoneWorker` 文档块改为只陈述 `gone` 格的事实（CLI 结束经 `cancelRun` 终态分支 `workerConfirmedGone` 守卫的那段，`gone` 格各形态下该判据必为真），并加一句显式说明「只对 gone 格成立」，指出 `alive` 格的 CLI 结束是 `cancelLostWorker` 第 3 步另外做的、不是同一处（代码双审 r1 GLM-01） |

## 2. 未采纳意见

无——5 条全部接受。

## 3. 改动范围确认

本轮修订**全部是文档与注释**：`doc/03_api/PROTOCOL_dual_critic_relay.md`、
`doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`、`doc/02_design/LLD_orchestrator.md`、
`src/trivium/run-protocol.ts`（仅 `finalizeGoneWorker` 的 JSDoc 注释）、
`doc/05_testing/evidence/lost-worker-gone-finalize-20260928/gen-mutation-spec.mjs`（仅 `desc` 字段）。
**没有改动任何可执行逻辑**——`classifyLostCancel`、`finalizeLostAndReclaimLock`、`finalizeGoneWorker`、`cancelRun`
的函数体与 r1 提交给代码双审时逐字节相同；因此本轮不需要重新走一遍全部变异（find/replace 锚点未变、mutation-spec.json
的 `cases[].find/replace` 逐字未改，只重新生成了包含新 `desc` 的规格文件），但仍重跑全量测试、typecheck、doctor
自检与零配额验收以确认文档改动没有引入语法或引用错误。读数见 §7。
