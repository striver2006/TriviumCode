---
schema: trivium.disposition.v1
topic: M11-AC25三审检测收口
stage: plan
role: claude
kind: revised
run_id: 20261007T090748Z
addresses:
  - 2026-10-07-M11-AC25三审检测收口-codex.md
  - 2026-10-07-M11-AC25三审检测收口-gemini.md
  - 2026-10-07-M11-AC25三审检测收口-glm.md
---

# 计划修订：M11 第 3 步 AC-25 三审检测收口（第 1 轮裁决）

计划双审第 1 轮 run `20261007T090748Z`：三侧均 `approve-with-nits`，共 6 条（minor 3、nit 3）。接受 5 条、驳回 1 条。CODEX-02 ≡ AGY-01 ≡ GLM-01 是同一处缺格（`_meta` 通道没有跨轮翻转 a 的格），合并落地。新一轮计划见同目录 r2。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：FI-1～3 ⑦「`gate --check` 通过、`joint_blocker_rejected` 为告警」依赖 `gate.joint_blocker_policy` 缺省为 `warn`（`config.ts:416`、`gate.ts:672-690`），与 `failure_policy` 是对称的配置前提，前者前置核了、后者没有。缺省改 `hard` 时用例会从通过翻成失败，排查方向会被带偏 | r2 §2.3 公共部分补「前置核 `joint_blocker_policy === 'warn'`」，FI-1～3 ⑦ 与 FI-7 ② 引用 |
| CODEX-02 | codex | nit | 接受 | 属实：`_meta` 判据（`freeze.ts:327-332`）不含 driver，今天行为无差别，但正因为没有格，将来给 `_meta` 分支引入 Driver 特例时「上一轮 Driver 的结构化意见泄漏给本轮审核者」无人逮。与 AGY-01、GLM-01 同一处 | r2 §2.1 夹具表补「跨轮翻转 a 的 `_meta` 三件」一行，期望集对三家审核者各 +3 |
| CODEX-03 | codex | nit | 驳回 | 前提不成立：建议依据「请求上下文可得 driver」，而 `CriticRequest`（`types.ts` 约 :1660 起）没有 driver 字段，也没有本轮入选集合——桩看不到当轮 Driver。要做到这一格只有两条路：给全部适配器的请求契约加字段（改运行期契约，越出本步「不改运行期行为」的范围），或让桩去读运行目录里编排器的 `request.json`（把测试桩耦合到编排器文件布局）。两者代价都高于收益：桩只在设了 `TRIVIUM_STUB_CRITIC` 的测试进程里生效，调用点是本步新写、随代码双审一并受审的用例，对端列表由各格的 `--critics` 入选集合减本侧推出，Driver 本就不在其中。桩侧保留「已登记审核者、非本侧、非空」三项校验 | 无修改。r2 §2.2 写明桩不校验 Driver 的原因 |
| AGY-01 | gemini | minor | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| AGY-02 | gemini | nit | 接受 | 合理的防御：`peer:` 后的列表逐段 `trim`，空段与未登记 id 一律按失败返回并写明原因，与 `peer_leak` 筛空即失败同口径 | r2 §2.2 校验规则 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-02；GLM 给的增量估算（一行夹具、一条期望项）与全集相等断言相容，r2 按 AGY-01 的写法补齐三件 | 同 CODEX-02 |

## 另行采纳的说明（不属编号意见）

- GLM 在「未覆盖范围」里推演出 §3 的预期红名单偏保守：N2（无 schema 一律判不出）下 FI-1～3 的 hits 也会多出 Driver 原稿一条而红；A4a（跳过 codex 审查件）下 FI-8（claude 读 codex 与 gemini）也会红。推演成立，r2 §3 期望列改为「至少」并补这两处，实测以装置逐条记录为准。
