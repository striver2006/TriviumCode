---
schema: trivium.disposition.v1
topic: M12-五组合受限准入判据
stage: code
role: claude
kind: response
run_id: 20261017T091735Z
addresses:
  - 2026-10-17-M12-五组合受限准入判据-gemini.md
  - 2026-10-17-M12-五组合受限准入判据-glm.md
---

# 代码应答：M12-五组合受限准入判据（第 1 轮）

gemini 侧 `approve`、零意见；glm 侧 `approve-with-nits`、两条 nit。两条都回代码核过，均接受。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | nit | 接受 | 属实：`agent-access-closeout-summary.mjs` 按裸组合名查受控任务，codex 的 `kimi` / `deepseek` 行会绑上 claude 侧的任务对象；`writeCriteriaFor` 对非受限行不消费 job，眼下无行为影响，但一行就能堵住跨 agent 误绑 | `scripts/agent-access-closeout-summary.mjs`：查找条件前置 `agent === 'claude'`，非 claude 行 job 恒为 null |
| GLM-02 | glm | nit | 接受 | 属实：`batch.mjs` 的 `dispatch` 只等 `close`，启动器或子进程在内层超时之外挂起时，「任一失败即停」会退化成挂起；真实取证前补上 | `doc/05_testing/evidence/m12-restricted-admission-20261017/batch.mjs`：`dispatch` 以独立进程组启动并设外层上限（路线刷新 45 分钟、其余 15 分钟），超限对整组发 SIGKILL，落派发记录（`timed_out: true`）后抛错，按失败即停处理；正常路径不变 |

## 修改计划

1. GLM-01：改查找条件，跑新单测与全量。
2. GLM-02：改 `dispatch`，`node --check` 语法核对；它只在真实取证时执行，代码阶段不跑真实派发。
3. 两项改完后 `install:local`，再进 verify。
