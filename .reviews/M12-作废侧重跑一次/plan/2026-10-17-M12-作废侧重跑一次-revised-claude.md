---
schema: trivium.disposition.v1
topic: M12-作废侧重跑一次
stage: plan
role: claude
kind: revised
run_id: 20261017T133619Z
addresses:
  - 2026-10-17-M12-作废侧重跑一次-gemini.md
  - 2026-10-17-M12-作废侧重跑一次-glm.md
---

# 裁决：M12-作废侧重跑一次 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-17-M12-作废侧重跑一次-claude.md`（r1，起点 `014c04ff`）
> 两侧：gemini `approve-with-nits`（3 nit），glm `approve-with-nits`（2 minor、2 nit）。7 条全部接受，合入后的计划见 `plan/2026-10-17-M12-作废侧重跑一次-r2-claude.md`。
> 裁决前回代码核了两处：`test/unit/run-files-parity.test.ts:38-41` 只扫 `run-protocol.ts`、`status.ts` 里 `path.join(runDir|dir, '字面量')` 的写法；`doc/03_api/PROTOCOL_dual_critic_relay.md:220` 仍写 `run.v2`，`:330`、`:337` 的循环协议按 `--start` 返回的 `max_waits` 定上限。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| AGY-01 | gemini | nit | 接受 | 属实：`fs.rename` 目标的父目录 `voided/〈侧〉/` 首次一定不存在，不先建就必然落进失败分支，r1 没写 | r2 §3.4：挪动前先 `mkdir -p` 目标父目录（递归创建），再改名；§4.3 单测核首次挪动成功 |
| AGY-02 | gemini | nit | 接受 | 属实：worker 回写只在 `p.note !== undefined` 时改 note（`run-protocol.ts:1198`），而 runner 成功收口的进展事件不带 note，重跑干净后该侧会一直挂着「作废重跑中」 | r2 §3.2 第 6 步：发生过作废重跑的一侧，之后每个终态进展事件都显式带 note（成功收口给 null，失败给 fail_reason）；`void_rerun` 标记保留不清（预算要一直算进去）；§4.2 R1 断言终态 note 不含「重跑中」 |
| AGY-03 | gemini | nit | 接受 | 属实：对账测试只扫两个写模块的字面量拼接；把挪动逻辑放进别的模块或写成字面量都会绕开或撞上它 | r2 §3.4：挪动钩子留在 `review.ts`、目录名只经 `VOIDED_ATTEMPTS_DIR` 常量拼接；该常量刻意不进 `RUN_DIR_FILE_NAMES`，由 §4.3 的新单测钉住，并在 `run-files.ts` 注释写明它为何不是运行目录层文件 |
| GLM-01 | glm | minor | 接受 | 属实：AGENTS 改动同步清单要求 schema 变更同步 PROTOCOL；更要紧的是 `:337` 的循环协议按旧语义定上限，不改的话按协议实现的消费方会在初值处停下 | r2 §5：PROTOCOL 补三处——`:330`/`:337` 改为以最近一次 `--wait` 的 `max_waits` 为准并注明作废重跑会追加；`:220` 的 `run.v2` 改为当前写形 `run.v3`；补逐侧 `attempts` 字段说明 |
| GLM-02 | glm | minor | 接受 | 属实：用户 D-7 的文字是「点名上一次命中的具体路径**或命令**」，r1 收紧成「命令文本一字不进」而没有像 run.v2→v3 那样显式声明。收紧的理由成立（命令可能夹带刚读到的对端原文），但不该静默改写拍板文字 | r2 §0 第 2 条显式声明偏离与理由；同时往回靠一步：命令通道的命中点名为「经命令 `〈程序名〉` 碰到〈位置〉」，程序名只取命令首个词的末段、限定字符集与长度，取不到就只写「经命令」——点到了「是哪条命令」，又不回显任何参数（§3.3 约束 1）。汇报时请用户确认这一落点 |
| GLM-03 | glm | nit | 接受 | 属实：改名失败时 `out/` 原样留在己方子树，守卫对己方子树整个不算命中，「同名覆盖」的前提又没写实。核过：三家适配器写进 `out/` 的是固定名（`stdout.jsonl` / `stdout.json`、`trace.json`、`rollout.jsonl`，与 `scrub.ts:76` 的清单一致），桩是 `stub-stdout.json` / `stub-trace.json` / `result.json`，覆盖式复用的前提成立；但仍应兜底 | r2 §3.4：改名失败时，对编排器自己算出的 `〈运行目录〉/〈侧〉/out` 这一个路径尽力整删一次再重跑；删也失败则告警「首次输出可能残留在己方子树、守卫看不见」并进 run 的 warnings；三家 `out/` 文件名固定这一前提写进正文 |
| GLM-04 | glm | nit | 接受 | 属实：r1 说条目 `status` 记「适配器层结果」，又说二次命中时把结果改判为 failed，最后一条记哪个可两读 | r2 §3.6：分层写死——条目 `status` 恒记适配器层结果（二次命中那条是 `ok`）、`voided: true`、条目 `fail_reason` 记适配器给的（通常 null）；改判只发生在侧级（`critics.〈侧〉.status: failed`、`fail_reason` 以 `peer_leak` 起头）。§4.2 R2 断言这一记法 |

## 顺带改正

- glm 在盲区里点出 r1 §1.1 的「AC-25 三审五格」数错了：`for (const x of THREE)` 两组各 3 格，加两侧作废、Driver 轮换各 1 格，共 **8 格**。r2 §1.1、§4.2 改准。
- glm 指出任务目标原文的 `--allow-partial` 在 CLI 里叫 `--allow-single`（受配置 `review.allow_partial_flag` 约束），r2 §0 第 3 条注明，正文统一用 `--allow-single`。

## 无修改及原因

无：7 条均接受并已写入 r2。
